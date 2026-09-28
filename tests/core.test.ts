import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { extractedContractSchema, isoDate } from '../src/domain/contrato.js';
import { deriveEndDateFromMonths, normalizeAmount, normalizeNit, objectSimilarity, parseExplicitDate } from '../src/domain/normalization.js';
import { FileRepositories } from '../src/repositories/files.js';
import { extractContract } from '../src/services/extraction.js';
import { validateContract } from '../src/services/validation.js';
import { extraer, leer_buzon, validar } from '../src/tools/contratos.js';

const temporaries: string[] = [];
afterEach(async () => { await Promise.all(temporaries.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'reto-02-test-'));
  temporaries.push(root);
  await cp(path.resolve('fixtures'), path.join(root, 'fixtures'), { recursive: true });
  return { directory: root, sessionId: 'test' };
}
const envelope = z.object({ ok: z.literal(true), data: z.unknown() });
const unpack = (raw: string) => envelope.parse(JSON.parse(raw)).data;
async function fixtureText(id: string, filename = 'contrato.txt') {
  return readFile(path.resolve('fixtures/reto-02/buzon', id, filename), 'utf8');
}
async function checksum(directory: string): Promise<string> {
  const hash = createHash('sha256');
  async function walk(dir: string): Promise<void> {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else { hash.update(path.relative(directory, file)); hash.update(await readFile(file)); }
    }
  }
  await walk(directory);
  return hash.digest('hex');
}
describe('Normalización y límites', () => {
  it('normaliza NIT sin perder ceros de otros identificadores', () => {
    expect(normalizeNit('890.900.111-4')).toBe('890900111');
    expect(normalizeNit('08019995123456')).toBe('08019995123456');
  });
  it.each([['265.000.000', 265000000], ['120,000.00', 120000], ['1.234,50', 1234.5], ['0', 0]])('normaliza %s', (raw, expected) => {
    expect(normalizeAmount(raw)).toBe(expected);
  });
  it.each(['1.2.3', '1,234.5.6', '-100', 'abc'])('rechaza valor mal formado %s', value => {
    expect(() => normalizeAmount(value)).toThrow();
  });
  it('valida fechas reales y años bisiestos', () => {
    expect(parseExplicitDate('el quince (15) de agosto de 2026')).toBe('2026-08-15');
    expect(isoDate.safeParse('2026-02-29').success).toBe(false);
    expect(isoDate.safeParse('2024-02-29').success).toBe(true);
    expect(parseExplicitDate('agosto de 2026')).toBeNull();
  });
  it('ajusta meses al último día sin desbordar', () => {
    expect(deriveEndDateFromMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(deriveEndDateFromMonths('2024-02-29', 12)).toBe('2025-02-28');
  });
  it('calcula similitud normalizada sin considerar vacíos como coincidencia', () => {
    expect(objectSimilarity('Célula ágil.', 'celula agil')).toBe(1);
    expect(objectSimilarity('', '')).toBe(0);
    expect(objectSimilarity('Soporte SAP', 'Servicios jurídicos')).toBeLessThan(0.9);
  });
});
describe('Extracción con evidencia', () => {
  it('deriva fin con menor confianza cuando hay inicio explícito y plazo sin hasta', async () => {
    const original = await fixtureText('msg-001');
    const text = original.replace(/TERCERA\. PLAZO\.[^\n]+/, 'TERCERA. PLAZO. El contrato dura doce (12) meses desde el primero (1) de agosto de 2026.');
    const contract = extractContract(text);
    expect(contract.fecha_inicio.valor).toBe('2026-08-01');
    expect(contract.fecha_fin).toMatchObject({ valor: '2027-08-01', confianza: 0.7 });
  });
  it('distingue una moneda no admitida de una moneda ausente', async () => {
    const text = await fixtureText('msg-001');
    expect(() => extractContract(text.replace('COP $265.000.000', 'EUR 265.000.000'))).toThrow('Moneda no admitida: EUR');
    expect(extractContract('CONTRATO sin datos').moneda.valor).toBeNull();
  });
  it('extrae el cliente extranjero y no el país del contratista', async () => {
    const contract = extractContract(await fixtureText('msg-002'));
    expect(contract.pais.valor).toBe('EC');
    expect(contract.valor.valor).toBe(120000);
    expect(contract.fecha_inicio.valor).toBe('2026-08-15');
    expect(contract.fecha_fin.valor).toBe('2027-08-14');
    expect(contract.requiere_poliza.valor).toBe(false);
  });
  it('no convierte el umbral de póliza en valor del contrato por demanda', async () => {
    const contract = extractContract(await fixtureText('msg-006'));
    expect(contract.valor).toMatchObject({ valor: 0, confianza: 0.6 });
    expect(contract.fecha_inicio.valor).toBeNull();
    expect(contract.fecha_fin.valor).toBeNull();
    expect(contract.requiere_poliza.valor).toBe(true);
  });
  it('rechaza texto vacío y conserva campos ausentes', () => {
    expect(() => extractContract('')).toThrow('vacío');
    expect(extractContract('CONTRATO sin datos').valor).toMatchObject({ valor: null, confianza: 0 });
  });
});
describe('Reglas de negocio', () => {
  it('conserva los campos no modificados de un otrosí y reporta cambios', async () => {
    const text = await fixtureText('msg-003', 'otrosi.txt');
    const extracted = extractContract(text);
    expect(extracted.objeto.valor).toBeNull();
    const ctx = await workspace();
    const result = validateContract(extracted, await new FileRepositories(ctx.directory).contracts(), text);
    expect(result.clasificacion).toBe('actualizacion');
    expect(result.requiere_revision).toEqual([]);
    expect(result.contrato_resuelto.fecha_inicio.valor).toBe('2026-05-02');
    expect(result.contrato_resuelto.objeto.evidencia).toContain('Maestro');
    expect(result.diferencias.valor).toEqual({ antes: 350000, despues: 520000 });
    expect(result.diferencias.fecha_fin).toEqual({ antes: '2027-05-01', despues: '2027-11-01' });
  });
  it('no acepta otrosí huérfano ni fecha fin anterior al inicio', async () => {
    const text = await fixtureText('msg-003', 'otrosi.txt');
    expect(validateContract(extractContract(text), [], text).clasificacion).toBe('rechazado');
    const contract = extractContract(await fixtureText('msg-001'));
    contract.fecha_fin.valor = '2020-01-01';
    expect(() => validateContract(contract, [], 'CONTRATO')).toThrow('anterior');
  });
  it('usa umbral estricto de 0.8 y detecta conflicto de identificación', async () => {
    const text = await fixtureText('msg-004');
    const contract = extractContract(text);
    contract.valor.confianza = 0.8;
    const ctx = await workspace();
    const master = await new FileRepositories(ctx.directory).contracts();
    expect(validateContract(contract, master, text).requiere_revision).not.toContain('valor');
    contract.valor.confianza = 0.79;
    contract.nit_cliente.valor = '1234';
    expect(validateContract(contract, master, text).requiere_revision).toEqual(expect.arrayContaining(['valor', 'nit_cliente']));
  });
});
describe('Herramientas y repositorios', () => {
  it('reporta moneda no admitida y permite procesar el siguiente correo', async () => {
    const ctx = await workspace();
    const file = path.join(ctx.directory, 'fixtures/reto-02/buzon/msg-001/contrato.txt');
    await writeFile(file, (await readFile(file, 'utf8')).replace('COP $265.000.000', 'EUR 265.000.000'));
    expect(JSON.parse(await extraer.execute({ mensaje_id: 'msg-001' }, ctx)))
      .toMatchObject({ ok: false, error: expect.stringContaining('Moneda no admitida: EUR') });
    expect(JSON.parse(await extraer.execute({ mensaje_id: 'msg-002' }, ctx))).toMatchObject({ ok: true });
  });
  it('aísla correos y adjuntos dañados para no abortar el lote', async () => {
    const ctx = await workspace();
    await writeFile(path.join(ctx.directory, 'fixtures/reto-02/buzon/msg-001/correo.json'), '{inválido');
    await rm(path.join(ctx.directory, 'fixtures/reto-02/buzon/msg-002/contrato.txt'));
    const result = z.object({ mensajes: z.array(z.object({ id: z.string(), error: z.string().optional() })), errores: z.array(z.object({ id: z.string() })) })
      .parse(unpack(await leer_buzon.execute({}, ctx)));
    expect(result.mensajes).toHaveLength(5);
    expect(result.errores[0]?.id).toBe('msg-001');
    expect(result.mensajes.find(m => m.id === 'msg-002')?.error).toBeDefined();
  });
  it('clasifica 6/6, audita y mantiene fixtures intactos', async () => {
    const ctx = await workspace();
    const before = await checksum(path.join(ctx.directory, 'fixtures'));
    const messages = z.object({ mensajes: z.array(z.object({ id: z.string(), tiene_contrato: z.boolean() })) })
      .parse(unpack(await leer_buzon.execute({}, ctx))).mensajes;
    expect(messages).toHaveLength(6);
    expect(messages.find(m => m.id === 'msg-005')?.tiene_contrato).toBe(false);
    const expected = ['nuevo', 'nuevo', 'actualizacion', 'duplicado', 'rechazado', 'nuevo'];
    for (const [index, message] of messages.entries()) {
      const contract = message.tiene_contrato ? unpack(await extraer.execute({ mensaje_id: message.id }, ctx))
        : Object.fromEntries(Object.keys(extractedContractSchema.shape).map(key => [key, { valor: null, confianza: 0 }]));
      const result = z.object({ clasificacion: z.string(), requiere_revision: z.array(z.string()) })
        .parse(unpack(await validar.execute({ mensaje_id: message.id, contrato: contract }, ctx)));
      expect(result.clasificacion).toBe(expected[index]);
      if (message.id === 'msg-006') expect(result.requiere_revision).toEqual(['valor', 'fecha_inicio', 'fecha_fin']);
    }
    expect(await checksum(path.join(ctx.directory, 'fixtures'))).toBe(before);
    const log = await readFile(path.join(ctx.directory, 'out/log.jsonl'), 'utf8');
    expect(log.trim().split('\n')).toHaveLength(12);
    expect(await readdir(path.join(ctx.directory, 'out'))).toEqual(['log.jsonl', 'sharepoint']);
    expect(await readFile(path.join(ctx.directory, 'out/sharepoint/maestro-contratos.csv')))
      .toEqual(await readFile(path.join(ctx.directory, 'fixtures/reto-02/maestro-contratos.csv')));
  });
  it('excluye procesados y copia el maestro sin sobrescribirlo', async () => {
    const ctx = await workspace();
    const repo = new FileRepositories(ctx.directory);
    await repo.ensureMaster();
    const target = path.join(ctx.directory, 'out/sharepoint/maestro-contratos.csv');
    expect(await readFile(target)).toEqual(await readFile(path.join(ctx.directory, 'fixtures/reto-02/maestro-contratos.csv')));
    await writeFile(target, 'marcador');
    await repo.ensureMaster();
    expect(await readFile(target, 'utf8')).toBe('marcador');
    await writeFile(path.join(ctx.directory, 'out/procesados.json'), '["msg-001"]');
    expect((await repo.pending()).map(m => m.id)).not.toContain('msg-001');
  });
  it('devuelve errores JSON para argumentos inválidos, rutas y mensajes inexistentes', async () => {
    const ctx = await workspace();
    for (const id of ['../../secret', 'msg-999']) {
      expect(JSON.parse(await extraer.execute({ mensaje_id: id }, ctx))).toMatchObject({ ok: false });
    }
    expect(JSON.parse(await validar.execute({ mensaje_id: 'msg-001', contrato: {} }, ctx))).toMatchObject({ ok: false });
  });
});
