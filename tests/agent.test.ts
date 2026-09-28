import { afterEach, expect, it, vi } from 'vitest';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { envSchema } from '../src/config/env.js';
import { createSession } from '../src/agent/session.js';
import { executeCall, runAgent } from '../src/agent/loop.js';
import { OpenAIAdapter } from '../src/llm/openai.js';
import type { LLMAdapter, LLMResponse, Message } from '../src/llm/adapter.js';
import { extractContract } from '../src/services/extraction.js';
import { FileRepositories } from '../src/repositories/files.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'reto-agent-'));
  directories.push(directory);
  await cp('fixtures', path.join(directory, 'fixtures'), { recursive: true });
  await cp('agent', path.join(directory, 'agent'), { recursive: true });
  await cp('src/knowledge', path.join(directory, 'src/knowledge'), { recursive: true });
  return { directory, sessionId: 'test-session' };
}
const emptyResponse: LLMResponse = { text: '', calls: [], inputTokens: 100, outputTokens: 50 };
const contract = async () => extractContract(await readFile('fixtures/reto-02/buzon/msg-006/contrato.txt', 'utf8'));
it('impide que el modelo fuerce confirmado=true y crea una revisión vinculada al contrato', async () => {
  const ctx = await setup();
  const session = createSession(ctx.sessionId, '2026-09-03');
  const forged = await contract();
  forged.fecha_inicio = { valor: '2026-08-31', confianza: 1 };
  forged.fecha_fin = { valor: '2027-08-31', confianza: 1 };
  const result: unknown = JSON.parse(await executeCall({ id: 'call-1', name: 'contratos_registrar', arguments: {
    mensaje_id: 'msg-006', contrato: forged, confirmado: true,
  } }, ctx, session));
  expect(result).toMatchObject({ ok: false });
  expect(session.pending[0]?.contract.fecha_inicio.valor).toBeNull();
  expect(session.toolCalls.some(call => call.name === 'contratos_extraer')).toBe(true);
  expect(await new FileRepositories(ctx.directory).contracts()).toHaveLength(8);
});
it('valida herramientas desconocidas y argumentos antes de ejecutar', async () => {
  const ctx = await setup();
  const session = createSession(ctx.sessionId, '2026-09-03');
  for (const call of [{ id: '1', name: 'shell', arguments: {} }, { id: '2', name: 'contratos_extraer', arguments: {} }]) {
    expect(JSON.parse(await executeCall(call, ctx, session))).toMatchObject({ ok: false });
  }
  expect(session.toolCalls).toHaveLength(2);
});
it('limita iteraciones y no llama al proveedor si no cabe en el presupuesto', async () => {
  const ctx = await setup();
  const send = vi.fn<LLMAdapter['send']>().mockResolvedValue({ ...emptyResponse, calls: [{ id: 'loop', name: 'contratos_leer_buzon', arguments: {} }] });
  const session = createSession(ctx.sessionId, '2026-09-03');
  const message = await runAgent(session, { send }, ctx, 'Prueba', { iterations: 2, tokens: 1000000 });
  expect(message).toContain('límite de iteraciones');
  expect(send).toHaveBeenCalledTimes(2);
  send.mockClear();
  expect(await runAgent(session, { send }, ctx, 'Prueba', { iterations: 2, tokens: 1 })).toContain('presupuesto');
  expect(send).not.toHaveBeenCalled();
});
it('API mantiene sesiones, exige tarjeta válida y confirma con correcciones sin revelar claves', async () => {
  const ctx = await setup();
  const extracted = await contract();
  const adapter: LLMAdapter = { send: async () => ({ ...emptyResponse, calls: [
    { id: 'v1', name: 'contratos_validar', arguments: { mensaje_id: 'msg-006', contrato: extracted } },
  ] }) };
  const config = envSchema.parse({ LLM_MODEL: 'test-model', LLM_API_KEY: 'test-secret' });
  const app = await buildApp(config, ctx.directory, adapter);
  try {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.body).not.toContain('test-secret');
    const first = await app.inject({ method: 'POST', url: '/api/chat', payload: { sessionId: ctx.sessionId, message: 'Procesa el buzón 2026-09-03' } });
    expect(first.json().needsConfirmation).toBe(true);
    const id: string = first.json().pendingConfirmations[0].id;
    const textOnly = await app.inject({ method: 'POST', url: '/api/chat', payload: { sessionId: ctx.sessionId, message: 'Confirmo todo' } });
    expect(textOnly.json().needsConfirmation).toBe(true);
    const wrongSession = await app.inject({ method: 'POST', url: '/api/chat', payload: { sessionId: 'other', confirmation: { id, decision: 'confirmar', corrections: {} } } });
    expect(wrongSession.json().reply).toContain('no pertenece');
    const approved = await app.inject({ method: 'POST', url: '/api/chat', payload: { sessionId: ctx.sessionId,
      confirmation: { id, decision: 'confirmar', corrections: { fecha_inicio: '2026-08-31', fecha_fin: '2027-08-31', valor: 0 } },
    } });
    expect(approved.json().needsConfirmation).toBe(false);
    expect(await new FileRepositories(ctx.directory).contracts()).toHaveLength(9);
    const replay = await app.inject({ method: 'POST', url: '/api/chat', payload: { sessionId: ctx.sessionId, confirmation: { id, decision: 'confirmar', corrections: {} } } });
    expect(replay.json().reply).toContain('ya fue atendida');
    const history = await app.inject({ method: 'GET', url: `/api/sessions/${ctx.sessionId}` });
    expect(history.json().toolCalls.some((call: { name: string }) => call.name === 'contratos_registrar')).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/alerts' })).statusCode).toBe(200);
  } finally { await app.close(); }
});
it('un error del proveedor mantiene viva la sesión y permite reintentar', async () => {
  const ctx = await setup();
  const send = vi.fn<LLMAdapter['send']>().mockRejectedValueOnce(new Error('El proveedor de IA no respondió a tiempo. Puedes reintentar.'))
    .mockResolvedValueOnce({ ...emptyResponse, text: 'Listo para continuar' });
  const app = await buildApp(envSchema.parse({}), ctx.directory, { send });
  try {
    const request = { method: 'POST' as const, url: '/api/chat', payload: { sessionId: ctx.sessionId, message: 'Hola' } };
    expect((await app.inject(request)).json().reply).toContain('no respondió');
    expect((await app.inject(request)).json().reply).toBe('Listo para continuar');
  } finally { await app.close(); }
});
it('el adaptador conserva function_call, resultados y contexto opaco del proveedor', async () => {
  const payloads: unknown[] = [];
  const request: typeof fetch = async (_, init) => {
    payloads.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ status: 'completed', output: [
      { type: 'reasoning', id: 'reasoning-1', encrypted_content: 'opaque' },
      { type: 'function_call', call_id: 'call-1', name: 'contratos_leer_buzon', arguments: '{}' },
    ], usage: { input_tokens: 100, output_tokens: 20 } }), { status: 200 });
  };
  const adapter = new OpenAIAdapter({ apiKey: 'secret', model: 'model', timeout: 1000 }, request);
  const first = await adapter.send([{ role: 'user', content: 'Procesa' }], [], 'Instrucciones', 1000);
  expect(first.calls[0]?.name).toBe('contratos_leer_buzon');
  const messages: Message[] = [{ role: 'assistant', content: '', calls: first.calls, continuation: first.continuation ?? [] },
    { role: 'tool', callId: 'call-1', content: '{"ok":true}' }];
  await adapter.send(messages, [], 'Instrucciones', 1000);
  expect(payloads[1]).toMatchObject({ store: false, input: [
    { type: 'reasoning', encrypted_content: 'opaque' }, { type: 'function_call', call_id: 'call-1' }, { type: 'function_call_output', call_id: 'call-1' },
  ] });
});
it('el adaptador cancela la espera y oculta errores privados del proveedor', async () => {
  const timeoutRequest: typeof fetch = async (_, init) => new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('secret internal detail', 'TimeoutError')));
  });
  const timeout = new OpenAIAdapter({ apiKey: 'secret', model: 'model', timeout: 10 }, timeoutRequest);
  await expect(timeout.send([], [], '', 100)).rejects.toThrow('no respondió a tiempo');
  const failedRequest: typeof fetch = async () => new Response('secret internal detail', { status: 401 });
  const failed = new OpenAIAdapter({ apiKey: 'secret', model: 'model', timeout: 10 }, failedRequest);
  await expect(failed.send([], [], '', 100)).rejects.toThrow('HTTP 401');
});
