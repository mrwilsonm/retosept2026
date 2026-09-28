import { rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { extractedContractSchema } from './src/domain/contrato.js';
import { leer_buzon, extraer, validar, registrar, alertas } from './src/tools/contratos.js';

const ctx = { directory: process.cwd(), sessionId: 'demo' };
const hoy = '2026-09-03';
await rm(path.resolve(ctx.directory, 'out'), { recursive: true, force: true });
const envelope = z.object({ ok: z.literal(true), data: z.unknown() });
function data(raw: string): unknown { return envelope.parse(JSON.parse(raw)).data; }
const mailbox = z.object({ mensajes: z.array(z.object({ id: z.string(), tiene_contrato: z.boolean() })) });
const expected: Record<string, string> = {
  'msg-001': 'nuevo', 'msg-002': 'nuevo', 'msg-003': 'actualizacion',
  'msg-004': 'duplicado', 'msg-005': 'rechazado', 'msg-006': 'nuevo',
};
console.log('RETO 02 — DEMO DETERMINÍSTICA COMPLETA DEL CORE');
let passed = 0;
const messages = mailbox.parse(data(await leer_buzon.execute({}, ctx))).mensajes;
for (const message of messages) {
  try {
    const contract = message.tiene_contrato
      ? extractedContractSchema.parse(data(await extraer.execute({ mensaje_id: message.id }, ctx)))
      : extractedContractSchema.parse(Object.fromEntries(Object.keys(extractedContractSchema.shape).map(key => [key, { valor: null, confianza: 0 }])));
    const validation = z.object({ clasificacion: z.string(), requiere_revision: z.array(z.string()) })
      .parse(data(await validar.execute({ mensaje_id: message.id, contrato: contract }, ctx)));
    if (validation.clasificacion !== expected[message.id]) throw new Error('Clasificación inesperada');
    console.log(`${message.id}: ${validation.clasificacion}; revisión: ${validation.requiere_revision.join(', ') || 'ninguna'}`);
    const raw: unknown = JSON.parse(await registrar.execute({ mensaje_id: message.id, contrato: contract, hoy }, ctx));
    if (message.id === 'msg-006') {
      z.object({ ok: z.literal(false), error: z.string().startsWith('requiere revisión') }).parse(raw);
      console.log('  Registro bloqueado sin confirmación.');
      // These are explicitly simulated human inputs, not extracted dates.
      contract.fecha_inicio = { valor: '2026-08-31', confianza: 1, evidencia: 'Fecha aportada en revisión humana SIMULADA' };
      contract.fecha_fin = { valor: '2027-08-31', confianza: 1, evidencia: 'Fecha aportada en revisión humana SIMULADA' };
      data(await registrar.execute({ mensaje_id: message.id, contrato: contract, confirmado: true, hoy }, ctx));
      console.log('  Confirmación SIMULADA: valor 0, inicio 2026-08-31, fin 2027-08-31 → registrado.');
    } else {
      const result = z.object({ accion: z.string() }).parse(envelope.parse(raw).data);
      if (result.accion !== expected[message.id]) throw new Error('Acción inesperada');
      console.log(`  Acción: ${result.accion}`);
    }
    passed++;
  } catch (error) { console.error(`${message.id}: ${error instanceof Error ? error.message : 'Error'}`); }
}
data(await alertas.execute({ hoy }, ctx));
console.log(`Casos completos: ${passed}/6. Alertas: out/alertas.md`);
if (passed !== 6) process.exitCode = 1;
