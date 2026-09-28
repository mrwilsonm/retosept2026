import { afterEach, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { extraer, registrar, alertas, leer_buzon } from '../src/tools/contratos.js';
import { extractedContractSchema, type ExtractedContract } from '../src/domain/contrato.js';
import { FileRepositories } from '../src/repositories/files.js';
import { OutputRepository } from '../src/repositories/output.js';
import { daysBetween } from '../src/services/alerts.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'reto-registro-'));
  directories.push(directory);
  await cp('fixtures', path.join(directory, 'fixtures'), { recursive: true });
  return { directory, sessionId: 'test' };
}
const unwrap = (raw: string) => z.object({ ok: z.literal(true), data: z.unknown() }).parse(JSON.parse(raw)).data;
async function extract(ctx: Awaited<ReturnType<typeof setup>>, id: string) {
  return extractedContractSchema.parse(unwrap(await extraer.execute({ mensaje_id: id }, ctx)));
}
function corrected(contract: ExtractedContract): ExtractedContract {
  const copy = structuredClone(contract);
  copy.fecha_inicio = { valor: '2026-08-31', confianza: 1, evidencia: 'Dato aportado por revisión humana simulada' };
  copy.fecha_fin = { valor: '2027-08-31', confianza: 1, evidencia: 'Dato aportado por revisión humana simulada' };
  return copy;
}
it('registra nuevos, actualiza una sola fila y conserva historial y versiones', async () => {
  const ctx = await setup();
  const fixture = await readFile(path.join(ctx.directory, 'fixtures/reto-02/maestro-contratos.csv'));
  for (const id of ['msg-001', 'msg-002', 'msg-003']) {
    unwrap(await registrar.execute({ mensaje_id: id, contrato: await extract(ctx, id), hoy: '2026-09-03' }, ctx));
  }
  const rows = await new FileRepositories(ctx.directory).contracts();
  expect(rows).toHaveLength(10);
  expect(rows.find(r => r.id_contrato === 'CT-2026-015')?.estado_poliza).toBe('pendiente');
  expect(rows.find(r => r.id_contrato === 'CT-2026-016')?.estado_poliza).toBe('no_aplica');
  expect(rows.find(r => r.id_contrato === 'CT-2026-011')).toMatchObject({ valor: 520000, fecha_fin: '2027-11-01', estado_poliza: 'pendiente' });
  expect(await readFile(path.join(ctx.directory, 'fixtures/reto-02/maestro-contratos.csv'))).toEqual(fixture);
  const history = (await readFile(path.join(ctx.directory, 'out/sharepoint/historial.jsonl'), 'utf8')).trim().split('\n');
  expect(history).toHaveLength(3);
  expect(JSON.parse(history[2] ?? '{}')).toMatchObject({ accion: 'actualizacion', cambios: { valor: { antes: 350000, despues: 520000 } } });
  expect(await readFile(path.join(ctx.directory, 'out/sharepoint/versiones/CT-2026-011/msg-003.txt'), 'utf8')).toContain('OTROSÍ');
});
it('bloquea baja confianza, confianza inflada y confirmación con fechas ausentes', async () => {
  const ctx = await setup();
  const contract = await extract(ctx, 'msg-006');
  expect(JSON.parse(await registrar.execute({ mensaje_id: 'msg-006', contrato: contract }, ctx))).toMatchObject({ ok: false, error: expect.stringContaining('requiere revisión') });
  const inflated = corrected(contract);
  inflated.valor.confianza = 1;
  expect(JSON.parse(await registrar.execute({ mensaje_id: 'msg-006', contrato: inflated }, ctx))).toMatchObject({ ok: false });
  expect(JSON.parse(await registrar.execute({ mensaje_id: 'msg-006', contrato: contract, confirmado: true }, ctx))).toMatchObject({ ok: false });
  expect(await readdir(path.join(ctx.directory, 'out'))).toEqual(['log.jsonl']);
  expect(unwrap(await registrar.execute({ mensaje_id: 'msg-006', contrato: corrected(contract), confirmado: true, hoy: '2026-09-03' }, ctx)))
    .toMatchObject({ accion: 'nuevo', id_contrato: 'CM-2026-03' });
});
it('no duplica registros ni historial ante llamadas concurrentes y reintentos', async () => {
  const ctx = await setup();
  const contract = await extract(ctx, 'msg-001');
  const responses = await Promise.all(Array.from({ length: 5 }, () => registrar.execute({ mensaje_id: 'msg-001', contrato: contract, hoy: '2026-09-03' }, ctx)));
  responses.forEach(raw => expect(unwrap(raw)).toMatchObject({ id_contrato: 'CT-2026-015' }));
  expect(await new FileRepositories(ctx.directory).contracts()).toHaveLength(9);
  expect((await readFile(path.join(ctx.directory, 'out/sharepoint/historial.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1);
  const pending = z.object({ mensajes: z.array(z.object({ id: z.string() })) }).parse(unwrap(await leer_buzon.execute({}, ctx)));
  expect(pending.mensajes.map(m => m.id)).not.toContain('msg-001');
});
it('duplicados y cotizaciones no escriben archivos de negocio', async () => {
  const ctx = await setup();
  const contract = await extract(ctx, 'msg-004');
  expect(unwrap(await registrar.execute({ mensaje_id: 'msg-004', contrato: contract }, ctx))).toMatchObject({ accion: 'duplicado' });
  expect(unwrap(await registrar.execute({ mensaje_id: 'msg-005', contrato: contract }, ctx))).toMatchObject({ accion: 'rechazado' });
  expect(await readdir(path.join(ctx.directory, 'out'))).toEqual(['log.jsonl']);
});
it('genera IDs secuenciales cuando el contrato no trae número', async () => {
  const ctx = await setup();
  for (const [id, number] of [['msg-001', 'CT-2026-015'], ['msg-002', 'CT-2026-016']]) {
    const file = path.join(ctx.directory, `fixtures/reto-02/buzon/${id}/contrato.txt`);
    await writeFile(file, (await readFile(file, 'utf8')).replace(`No. ${number}`, ''));
  }
  for (const [index, id] of ['msg-001', 'msg-002'].entries()) {
    expect(unwrap(await registrar.execute({ mensaje_id: id, contrato: await extract(ctx, id), hoy: '2026-09-03' }, ctx)))
      .toMatchObject({ id_contrato: `AUTO-2026-000${index + 1}` });
  }
});
it('recupera una transacción interrumpida antes de atender otra herramienta', async () => {
  const ctx = await setup();
  const output = new OutputRepository(ctx.directory);
  await output.atomic('.pending-transaction.json', JSON.stringify([{ file: 'procesados.json', content: '["msg-001"]' }]));
  const result = z.object({ mensajes: z.array(z.object({ id: z.string() })) }).parse(unwrap(await leer_buzon.execute({}, ctx)));
  expect(result.mensajes.map(m => m.id)).not.toContain('msg-001');
  expect(await readdir(path.join(ctx.directory, 'out'))).not.toContain('.pending-transaction.json');
  await expect(output.atomic('../escape.txt', 'no')).rejects.toThrow('Ruta');
});
it('calcula alertas inclusivas y excluye contratos ya vencidos', async () => {
  const ctx = await setup();
  const result = z.object({ vencen: z.array(z.object({ id_contrato: z.string() })), polizas_pendientes: z.array(z.object({ id_contrato: z.string() })) })
    .parse(unwrap(await alertas.execute({ hoy: '2026-09-03' }, ctx)));
  expect(result.vencen.map(r => r.id_contrato)).toEqual(['CT-2026-004', 'CT-2026-009']);
  expect(result.polizas_pendientes.map(r => r.id_contrato)).toEqual(['CT-2026-004']);
  expect(daysBetween('2026-09-03', '2026-11-02')).toBe(60);
  expect(JSON.parse(await alertas.execute({ hoy: '2026-02-30' }, ctx))).toMatchObject({ ok: false });
});
it('no permite inventar partes y objeto en un adjunto rechazable aun con confirmación', async () => {
  const ctx = await setup();
  const contract = await extract(ctx, 'msg-001');
  await writeFile(path.join(ctx.directory, 'fixtures/reto-02/buzon/msg-001/contrato.txt'), 'CONTRATO sin partes ni objeto');
  expect(unwrap(await registrar.execute({ mensaje_id: 'msg-001', contrato: contract, confirmado: true }, ctx)))
    .toMatchObject({ accion: 'rechazado' });
  expect(await new FileRepositories(ctx.directory).contracts()).toHaveLength(8);
});
