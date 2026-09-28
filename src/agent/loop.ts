import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { contractValuesSchema, extractedContractSchema, type ContractField } from '../domain/contrato.js';
import type { LLMAdapter, ToolCall, ToolDefinition } from '../llm/adapter.js';
import { FileRepositories } from '../repositories/files.js';
import { leer_buzon, extraer, validar, registrar, alertas, type ToolContext } from '../tools/contratos.js';
import type { Session } from './session.js';

const registry = { contratos_leer_buzon: leer_buzon, contratos_extraer: extraer, contratos_validar: validar, contratos_registrar: registrar, contratos_alertas: alertas };
export const definitions: ToolDefinition[] = Object.entries(registry).map(([name, tool]) => ({
  name, description: tool.description, parameters: z.toJSONSchema(z.object(tool.args), { unrepresentable: 'any' }),
}));
const resultSchema = z.object({ ok: z.boolean(), data: z.unknown().optional(), error: z.string().optional() });
const reviewSchema = z.object({ requiere_revision: z.array(z.string()), contrato_resuelto: extractedContractSchema, clasificacion: z.string() });
export async function executeCall(call: ToolCall, ctx: ToolContext, session: Session): Promise<string> {
  let raw: string;
  const name = call.name as keyof typeof registry;
  if (!Object.hasOwn(registry, name)) raw = JSON.stringify({ ok: false, error: 'Herramienta desconocida' });
  else if (!z.object(registry[name].args).strict().safeParse(call.arguments).success) {
    raw = JSON.stringify({ ok: false, error: 'Argumentos inválidos para la herramienta' });
  } else if (name === 'contratos_registrar') {
    // The model never controls confirmed, corrected values, or the registration date.
    const args = z.object({ mensaje_id: z.string() }).safeParse(call.arguments);
    if (!args.success) raw = JSON.stringify({ ok: false, error: 'mensaje_id inválido' });
    else if (session.pending.some(p => p.mensajeId === args.data.mensaje_id)) raw = JSON.stringify({ ok: false, error: 'Revisión pendiente; utiliza la tarjeta de confirmación.' });
    else {
      const extracted = resultSchema.parse(JSON.parse(await executeCall({ id: randomUUID(), name: 'contratos_extraer', arguments: args.data }, ctx, session)));
      if (!extracted.ok) raw = JSON.stringify(extracted);
      else {
        await executeCall({ id: randomUUID(), name: 'contratos_validar', arguments: { ...args.data, contrato: extracted.data } }, ctx, session);
        raw = session.pending.some(p => p.mensajeId === args.data.mensaje_id)
          ? JSON.stringify({ ok: false, error: 'Revisión humana pendiente' })
          : await registrar.execute({ mensaje_id: args.data.mensaje_id, contrato: extracted.data, confirmado: false, hoy: session.today }, ctx);
      }
    }
  } else if (name === 'contratos_validar') {
    const args = z.object({ mensaje_id: z.string() }).safeParse(call.arguments);
    if (!args.success) raw = JSON.stringify({ ok: false, error: 'mensaje_id inválido' });
    else {
      const extracted = resultSchema.parse(JSON.parse(await executeCall({ id: randomUUID(), name: 'contratos_extraer', arguments: args.data }, ctx, session)));
      // Non-contract messages can still be classified using an empty extraction.
      const empty = Object.fromEntries(Object.keys(extractedContractSchema.shape).map(key => [key, { valor: null, confianza: 0 }]));
      raw = await validar.execute({ mensaje_id: args.data.mensaje_id, contrato: extracted.ok ? extracted.data : empty }, ctx);
      const parsed = resultSchema.parse(JSON.parse(raw));
      const review = reviewSchema.safeParse(parsed.data);
      if (parsed.ok && review.success && review.data.clasificacion !== 'rechazado') {
        const fields = review.data.requiere_revision.filter(key => key !== 'id_contrato' || review.data.contrato_resuelto.id_contrato.valor !== null);
        if (fields.length && !session.pending.some(p => p.mensajeId === args.data.mensaje_id)) session.pending.push({
          id: randomUUID(), mensajeId: args.data.mensaje_id, fields, contract: review.data.contrato_resuelto,
        });
      }
    }
  } else raw = await registry[name].execute(name === 'contratos_alertas' ? { hoy: session.today } : call.arguments, ctx);
  const result: unknown = JSON.parse(raw);
  session.toolCalls.push({ id: call.id, name: call.name, arguments: call.arguments, result });
  // Includes blocked and unknown calls as well as successful calls.
  await new FileRepositories(ctx.directory).audit({ herramienta: call.name, mensaje_id: null,
    ok: resultSchema.parse(result).ok, resumen: 'Llamada del agente' }, ctx.sessionId);
  return raw;
}
export async function runAgent(session: Session, adapter: LLMAdapter, ctx: ToolContext, instructions: string,
  limits: { iterations: number; tokens: number }) {
  for (let iteration = 0; iteration < limits.iterations; iteration++) {
    // UTF-8 bytes conservatively bound input token cost; no new call if its budget cannot fit.
    const inputBound = Buffer.byteLength(JSON.stringify({ messages: session.messages, instructions, definitions }), 'utf8') + 1024;
    const available = limits.tokens - session.usage.reservedTokens - inputBound;
    if (available < 128) return 'Se alcanzó el presupuesto de tokens de esta sesión. Revisa las acciones completadas en el historial.';
    const maximum = Math.min(3000, available);
    session.usage.reservedTokens += inputBound + maximum;
    const response = await adapter.send(session.messages, definitions, instructions, maximum);
    session.usage.inputTokens += response.inputTokens;
    session.usage.outputTokens += response.outputTokens;
    // Charge actual successful usage; keep reservations on failed/uncertain requests.
    session.usage.reservedTokens += response.inputTokens + response.outputTokens - inputBound - maximum;
    session.messages.push({ role: 'assistant', content: response.text, calls: response.calls, ...(response.continuation ? { continuation: response.continuation } : {}) });
    if (!response.calls.length) return response.text || 'No se recibió una respuesta de texto. Puedes reintentar.';
    for (const [index, call] of response.calls.entries()) {
      let content: string;
      if (session.pending.length || index >= 25) {
        const result = { ok: false, error: 'Turno pausado: revisión humana o límite de llamadas.' };
        content = JSON.stringify(result);
        session.toolCalls.push({ id: call.id, name: call.name, arguments: call.arguments, result });
        await new FileRepositories(ctx.directory).audit({ herramienta: call.name, mensaje_id: null, ok: false, resumen: result.error }, ctx.sessionId);
      } else content = await executeCall(call, ctx, session);
      session.messages.push({ role: 'tool', name: call.name, callId: call.id, content });
    }
    if (session.pending.length) return 'Hay campos que requieren revisión. Revisa sus valores y evidencia en la tarjeta. ¿Confirmas los datos corregidos o rechazas este registro?';
  }
  return 'Se alcanzó el límite de iteraciones. Las acciones completadas están en el historial; puedes pedir continuar con los mensajes pendientes.';
}
export const confirmationSchema = z.object({
  id: z.string().uuid(), decision: z.enum(['confirmar', 'rechazar']),
  corrections: contractValuesSchema.partial().strict().default({}),
});
export async function confirm(session: Session, request: z.infer<typeof confirmationSchema>, ctx: ToolContext): Promise<string> {
  const pending = session.pending.find(p => p.id === request.id);
  if (!pending) throw new Error('La confirmación no pertenece a esta sesión o ya fue atendida.');
  if (request.decision === 'rechazar') {
    session.pending = session.pending.filter(p => p.id !== request.id);
    await new FileRepositories(ctx.directory).audit({ herramienta: 'confirmacion_humana', mensaje_id: pending.mensajeId, ok: true, resumen: 'Registro rechazado por la persona revisora' }, ctx.sessionId);
    return `Se rechazó el registro de ${pending.mensajeId}; no se modificó el maestro.`;
  }
  const contract = structuredClone(pending.contract);
  for (const [key, value] of Object.entries(request.corrections)) {
    Object.assign(contract[key as ContractField], { valor: value, confianza: 1, evidencia: 'Dato confirmado mediante la interfaz de revisión humana' });
  }
  const args = { mensaje_id: pending.mensajeId, contrato: contract, confirmado: true, hoy: session.today };
  const raw = await registrar.execute(args, ctx);
  const result = resultSchema.parse(JSON.parse(raw));
  session.toolCalls.push({ id: randomUUID(), name: 'contratos_registrar', arguments: args, result });
  if (!result.ok) return `No se pudo registrar: ${result.error ?? 'revisa los campos faltantes'}`;
  session.pending = session.pending.filter(p => p.id !== request.id);
  const alertArgs = { hoy: session.today };
  const report: unknown = JSON.parse(await alertas.execute(alertArgs, ctx));
  session.toolCalls.push({ id: randomUUID(), name: 'contratos_alertas', arguments: alertArgs, result: report });
  return `Revisión aplicada a ${pending.mensajeId}. Resultado: ${JSON.stringify(result.data)}. Se actualizaron las alertas; puedes pedir continuar con el buzón.`;
}
