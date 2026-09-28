import { currency, extractedContractSchema, type ExtractedContract, type Field } from '../domain/contrato.js';
import { deriveEndDateFromMonths, fold, normalizeAmount, normalizeNit, normalizeText, parseExplicitDate } from '../domain/normalization.js';
import { FileRepositories, type MailMessage } from '../repositories/files.js';

export function isContract(text: string): boolean {
  return /^(?:contrato\b|otrosi\b)/.test(fold(text.trim()));
}
export async function contractualAttachment(repo: FileRepositories, message: MailMessage) {
  for (const filename of message.adjuntos) {
    if (!filename.endsWith('.txt')) continue;
    const text = await repo.attachment(message, filename);
    if (isContract(text)) return { filename, text };
  }
  return null;
}
function field<T>(value: T | null, confidence = 1, evidence?: string): Field<T> {
  return { valor: value, confianza: value === null ? 0 : confidence, ...(evidence ? { evidencia: evidence } : {}) };
}
export function extractContract(raw: string): ExtractedContract {
  const text = normalizeText(raw);
  if (!text) throw new Error('Texto contractual vacío');
  if (!isContract(text)) throw new Error('El adjunto no es un contrato');
  const normalized = fold(text);
  const amendment = normalized.startsWith('otrosi');
  const id = text.match(/\b(?:CT|CM)-\d{4}-\d+\b/)?.[0] ?? null;
  const party = text.match(/Entre\s+(?:los suscritos,\s*)?(.+?),\s*(?:identificad[ao]\s+con\s+)?(NIT|RUC|RTN)\s+([\d.-]+)([^\n]*?)(?:,\s*(?:representad[ao])|\(EL CONTRATANTE\))/i);
  const partyContext = fold(party?.[0] ?? '');
  const country = /ecuador|quito/.test(partyContext) ? 'EC' : /peru|lima/.test(partyContext) ? 'PE'
    : /panama/.test(partyContext) ? 'PA' : /honduras|sula/.test(partyContext) ? 'HN'
    : /colombia|bogota|medellin|barranquilla/.test(partyContext) ? 'CO' : null;
  const object = text.match(/\bOBJETO\.\s*([^\n]+)/i)?.[1]?.trim() ?? null;
  const amountClause = text.split('\n').find(line => /\bVALOR\b/.test(line)) ?? '';
  const explicitCodes = [...amountClause.matchAll(/\b([A-Z]{3})\s*\$?\s*\d[\d.,]*/g)]
    .map(match => match[1]).filter(code => code !== undefined && code !== 'IVA');
  for (const code of explicitCodes) {
    if (!currency.safeParse(code).success) throw new Error(`Moneda no admitida: ${code}`);
  }
  const demand = /no tiene un valor determinado|valor indeterminado|por demanda/.test(fold(amountClause));
  const amount = amountClause.match(/\b(COP|USD|PEN|PAB|HNL)\s*\$?\s*([\d.,]+)/);
  const rawCurrency = amount?.[1] ?? (demand ? text.match(/\b(COP|USD|PEN|PAB|HNL)\b/)?.[1] : undefined);
  const termClause = text.split('\n').find(line => /\bPLAZO\b/.test(line)) ?? '';
  const from = termClause.match(/desde\s+(.+?)(?=\s+hasta\b|$)/i)?.[1];
  const until = termClause.match(/hasta\s+([^\n]+)/i)?.[1];
  const start = from ? parseExplicitDate(from) : null;
  let end = until ? parseExplicitDate(until) : null;
  const months = termClause.match(/(?:\((\d+)\)|(\d+))\s*meses/i);
  let endConfidence = 1;
  if (!end && start && months) { end = deriveEndDateFromMonths(start, Number(months[1] ?? months[2])); endConfidence = 0.7; }
  const policyClause = text.split('\n').find(line => /GARANT[IÍ]AS\./i.test(line)) ?? '';
  const policyText = fold(policyClause);
  const policyRequired = policyClause ? !/no (?:se )?(?:requiere|exige)/.test(policyText) : amendment ? null : false;
  const types = [
    ['cumplimiento', /cumplimiento/], ['calidad', /calidad/],
    ['responsabilidad_civil', /responsabilidad civil/], ['salarios_prestaciones', /salarios|prestaciones/],
  ] as const;
  const policyTypes = policyRequired === null ? null : types.filter(([, re]) => re.test(policyText)).map(([name]) => name).join(';');
  return extractedContractSchema.parse({
    id_contrato: field(id, 1, id ?? undefined),
    cliente: field(party?.[1]?.trim() ?? null, 1, party?.[0]),
    nit_cliente: field(party?.[3] ? normalizeNit(party[3]) : null, 1, party?.[3]),
    pais: field(country, 0.95, party?.[0]),
    objeto: field(object?.slice(0, 200) ?? null, 1, object ? `${object}${object.length > 200 ? ' [Resumido por truncamiento a 200 caracteres]' : ''}` : undefined),
    valor: field(demand ? 0 : amount?.[2] ? normalizeAmount(amount[2]) : null, demand ? 0.6 : 1, amountClause),
    moneda: field(rawCurrency ? currency.parse(rawCurrency) : null, demand ? 0.85 : 1, demand ? 'Moneda de las órdenes en cláusula de garantías' : amountClause),
    fecha_inicio: field(start, 1, from ?? 'No se indica día exacto de inicio'),
    fecha_fin: field(end, endConfidence, until ?? termClause),
    requiere_poliza: field(policyRequired, 0.9, policyClause || (amendment ? undefined : 'No hay cláusula de garantías en el texto completo')),
    tipo_poliza: field(policyTypes, 0.9, policyClause || (amendment ? undefined : 'No se exige póliza')),
  });
}
