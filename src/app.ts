import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isoDate } from './domain/contrato.js';
import { confirm, confirmationSchema, runAgent } from './agent/loop.js';
import { createSession, type Session } from './agent/session.js';
import { OpenAIAdapter } from './llm/openai.js';
import type { LLMAdapter } from './llm/adapter.js';
import type { AppConfig } from './config/env.js';

const sessionId = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const chatSchema = z.object({ sessionId, message: z.string().max(8000).default(''), hoy: isoDate.optional(), confirmation: confirmationSchema.optional() }).strict();
export async function buildApp(config: AppConfig, directory = process.cwd(), injectedAdapter?: LLMAdapter) {
  const app = Fastify({ logger: false, bodyLimit: 65536 });
  const sessions = new Map<string, Session>();
  const adapter = injectedAdapter ?? new OpenAIAdapter({ apiKey: config.LLM_API_KEY, model: config.LLM_MODEL, timeout: config.LLM_TIMEOUT_MS });
  const instructions = await readFile(path.join(directory, 'agent/prompt.md'), 'utf8') + '\n' + await readFile(path.join(directory, 'src/knowledge/registro-contratos.md'), 'utf8');
  let processing = false;
  const view = (session: Session) => ({
    id: session.id, messages: session.messages.filter(m => m.role !== 'tool').map(m => ({ role: m.role, content: m.content })).filter(m => m.content),
    toolCalls: session.toolCalls, needsConfirmation: session.pending.length > 0, pendingConfirmations: session.pending, usage: session.usage,
  });
  app.get('/api/health', async () => ({ ok: true, provider: config.LLM_PROVIDER, model: config.LLM_MODEL, configured: Boolean(config.LLM_API_KEY && config.LLM_MODEL) }));
  app.get('/api/sessions/:id', async (request, reply) => {
    const args = z.object({ id: sessionId }).safeParse(request.params);
    if (!args.success) return reply.code(400).send({ error: 'ID inválido' });
    const session = sessions.get(args.data.id);
    return session ? view(session) : reply.code(404).send({ error: 'Sesión no encontrada' });
  });
  app.post('/api/chat', async (request, reply) => {
    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Solicitud inválida; revisa los campos y las fechas.' });
    if (processing) return reply.code(409).send({ error: 'Hay una operación en curso. Reintenta cuando termine.' });
    const body = parsed.data;
    let session = sessions.get(body.sessionId);
    if (!session) {
      if (sessions.size >= 100) return reply.code(429).send({ error: 'Se alcanzó el límite de sesiones de esta instancia.' });
      session = createSession(body.sessionId, body.hoy ?? new Date().toISOString().slice(0, 10));
      sessions.set(body.sessionId, session);
    }
    if (!session.pending.length) {
      const date = body.hoy ?? body.message.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
      if (date) {
        const valid = isoDate.safeParse(date);
        if (!valid.success) return reply.code(400).send({ error: 'Fecha de referencia inválida' });
        session.today = valid.data;
      }
    }
    processing = true;
    const offset = session.toolCalls.length;
    const ctx = { directory, sessionId: session.id };
    session.messages.push({ role: 'user', content: body.message || (body.confirmation ? `Revisión humana: ${body.confirmation.decision}` : 'Continuar') });
    let answer: string;
    try {
      if (body.confirmation) answer = await confirm(session, body.confirmation, ctx);
      else if (session.pending.length) answer = 'Completa la tarjeta de revisión para confirmar o rechazar los datos. La confirmación por texto no autoriza el registro.';
      else {
        const used = [...sessions.values()].reduce((sum, s) => sum + s.usage.reservedTokens, 0);
        const remaining = config.APP_MAX_TOKENS - used;
        if (remaining < 1024) answer = 'Se alcanzó el presupuesto global de tokens de esta instancia.';
        else answer = await runAgent(session, adapter, ctx, `${instructions}\nFecha de referencia de esta sesión: ${session.today}`, {
          iterations: config.AGENT_MAX_ITERATIONS, tokens: Math.min(config.AGENT_MAX_TOKENS, session.usage.reservedTokens + remaining),
        });
      }
    } catch (error) {
      answer = error instanceof Error && (error.message.startsWith('El proveedor') || error.message.startsWith('No se pudo completar') || error.message.startsWith('Configura ') || error.message.startsWith('La confirmación'))
        ? error.message : 'No se pudo completar la operación. La sesión sigue disponible; revisa los resultados y reintenta.';
    } finally { processing = false; }
    const last = session.messages.at(-1);
    if (last?.role !== 'assistant' || last.content !== answer) session.messages.push({ role: 'assistant', content: answer });
    return { reply: answer, ...view(session), toolCalls: session.toolCalls.slice(offset) };
  });
  app.get('/api/alerts', async (_, reply) => {
    try { return { markdown: await readFile(path.join(directory, 'out/alertas.md'), 'utf8') }; }
    catch { return reply.code(404).send({ error: 'Aún no se ha generado un reporte de alertas.' }); }
  });
  const web = path.join(directory, 'dist/web');
  try { await access(web); await app.register(staticFiles, { root: web }); } catch { /* API remains testable without the frontend build. */ }
  return app;
}
