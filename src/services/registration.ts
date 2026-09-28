import { z } from 'zod';
import { contractRecordSchema, type ContractField, type ContractRecord, type ExtractedContract, isoDate } from '../domain/contrato.js';
import { fold } from '../domain/normalization.js';
import { FileRepositories } from '../repositories/files.js';
import { OutputRepository } from '../repositories/output.js';
import { contractualAttachment, extractContract } from './extraction.js';
import { validateContract } from './validation.js';

const receiptSchema = z.object({ id_contrato: z.string(), accion: z.enum(['nuevo', 'actualizacion']), ruta_archivo: z.string() });
const receiptsSchema = z.record(z.string(), receiptSchema);
export function slugify(value: string): string {
  const result = fold(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!result) throw new Error('Nombre de cliente sin caracteres utilizables');
  return result;
}
function csv(rows: ContractRecord[]): string {
  const keys = Object.keys(contractRecordSchema.shape) as (keyof ContractRecord)[];
  const quote = (value: unknown) => `"${String(value).replace(/"/g, '""')}"`;
  return `${keys.join(',')}\n${rows.map(row => keys.map(key => quote(row[key])).join(',')).join('\n')}\n`;
}
export async function registerContract(input: {
  mensaje_id: string; contrato: ExtractedContract; confirmado?: boolean | undefined; hoy?: string | undefined;
}, repo: FileRepositories) {
  const output = new OutputRepository(repo.root);
  const receipts = receiptsSchema.parse(JSON.parse(await output.read('registros.json', '{}')));
  const prior = receipts[input.mensaje_id];
  if (prior) return { ...prior, ya_procesado: true };
  const message = await repo.message(input.mensaje_id);
  const attachment = await contractualAttachment(repo, message);
  if (!attachment) return { accion: 'rechazado', motivo: 'El mensaje no contiene un contrato' };
  const rows = await repo.contracts();
  const original = extractContract(attachment.text);
  // Recompute baseline confidence; callers cannot suppress review by inflating scores.
  const baseline = validateContract(original, rows, attachment.text);
  if (baseline.clasificacion === 'rechazado') return { accion: 'rechazado', motivo: baseline.motivo };
  const validation = validateContract(input.contrato, rows, attachment.text);
  if (validation.clasificacion === 'rechazado') return { accion: 'rechazado', motivo: validation.motivo };
  const changed = (Object.keys(original) as ContractField[]).filter(key =>
    input.contrato[key].valor !== original[key].valor && input.contrato[key].valor !== baseline.contrato_resuelto[key].valor);
  const review = [...new Set([...baseline.requiere_revision, ...validation.requiere_revision, ...changed])]
    .filter(key => !(key === 'id_contrato' && input.contrato.id_contrato.valor === null));
  if (review.length && !input.confirmado) throw new Error(`requiere revisión: ${review.join(', ')}`);
  if (validation.requiere_revision.includes('coincidencia_maestro')) throw new Error('Coincidencia ambigua: no se puede seleccionar automáticamente el contrato base');
  if (validation.clasificacion === 'duplicado') return { accion: 'duplicado', id_contrato: validation.id_contrato_existente };
  const values = Object.fromEntries(Object.entries(validation.contrato_resuelto).map(([key, field]) => [key, field.valor]));
  const today = isoDate.parse(input.hoy ?? new Date().toISOString().slice(0, 10));
  const start = isoDate.parse(values.fecha_inicio);
  let id = validation.id_contrato_existente ?? input.contrato.id_contrato.valor;
  if (!id) {
    const prefix = `AUTO-${start.slice(0, 4)}-`;
    const sequence = Math.max(0, ...rows.filter(row => row.id_contrato.startsWith(prefix)).map(row => Number(row.id_contrato.slice(prefix.length))).filter(Number.isFinite)) + 1;
    id = `${prefix}${String(sequence).padStart(4, '0')}`;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Identificador contractual no seguro para archivado');
  const existing = rows.find(row => row.id_contrato === validation.id_contrato_existente);
  const commercial = (await repo.commercials()).find(item => item.email.toLowerCase() === message.de.toLowerCase());
  const relative = `Contratos/${start.slice(0, 4)}/${slugify(String(values.cliente))}/${id}.txt`;
  const policyChanged = existing && (values.fecha_fin !== existing.fecha_fin || values.valor !== existing.valor || values.tipo_poliza !== existing.tipo_poliza);
  const record = contractRecordSchema.parse({ ...values, id_contrato: id,
    estado_poliza: values.requiere_poliza ? (policyChanged ? 'pendiente' : existing?.estado_poliza === 'no_aplica' ? 'pendiente' : existing?.estado_poliza ?? 'pendiente') : 'no_aplica',
    comercial: commercial?.nombre ?? existing?.comercial ?? '', ruta_sharepoint: relative,
    fecha_registro: existing?.fecha_registro ?? today, fuente: existing?.fuente ?? 'buzon',
  });
  if (record.fecha_fin < record.fecha_inicio) throw new Error('La fecha fin es anterior a la fecha inicio');
  if (record.requiere_poliza && !record.tipo_poliza) throw new Error('Debe especificar el tipo de póliza requerido');
  const differences = Object.fromEntries((Object.keys(record) as (keyof ContractRecord)[])
    .filter(key => !existing || record[key] !== existing[key]).map(key => [key, { antes: existing?.[key] ?? null, despues: record[key] }]));
  const receipt = receiptSchema.parse({ id_contrato: id, accion: validation.clasificacion, ruta_archivo: `out/sharepoint/${relative}` });
  receipts[input.mensaje_id] = receipt;
  const processed = z.array(z.string()).parse(JSON.parse(await output.read('procesados.json', '[]')));
  const history = await output.read('sharepoint/historial.jsonl');
  const updated = existing ? rows.map(row => row.id_contrato === id ? record : row) : [...rows, record];
  const archiveCopy = `sharepoint/versiones/${id}/${message.id}.txt`;
  await output.commit([
    { file: `sharepoint/${relative}`, content: attachment.text },
    { file: archiveCopy, content: attachment.text },
    { file: 'sharepoint/maestro-contratos.csv', content: csv(updated) },
    { file: 'sharepoint/historial.jsonl', content: history + JSON.stringify({ ts: `${today}T00:00:00.000Z`, id_contrato: id,
      accion: receipt.accion, cambios: differences, mensaje_id: message.id, confirmado: Boolean(input.confirmado),
      campos_confirmados: review, ruta_version: `out/${archiveCopy}` }) + '\n' },
    { file: 'procesados.json', content: JSON.stringify([...new Set([...processed, message.id])], null, 2) },
    { file: 'registros.json', content: JSON.stringify(receipts, null, 2) },
  ]);
  return receipt;
}
