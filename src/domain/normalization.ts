import { isoDate } from './contrato.js';

export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
export function normalizeNit(text: string): string {
  return (text.split('-')[0] ?? '').replace(/\D/g, '');
}
export function normalizeAmount(raw: string): number {
  let value = raw.trim().replace(/\s/g, '');
  if (!/^\d+(?:[.,]\d+)*$/.test(value)) throw new Error('Valor monetario inválido');
  const lastDot = value.lastIndexOf('.');
  const lastComma = value.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const grouping = decimal === '.' ? ',' : '.';
    const [integer, fraction] = value.split(decimal);
    if (!integer || !fraction || !/^\d{2}$/.test(fraction)) throw new Error('Decimales inválidos');
    const groups = integer.split(grouping);
    if (groups.length > 1 && (!/^\d{1,3}$/.test(groups[0] ?? '') || groups.slice(1).some(g => !/^\d{3}$/.test(g)))) {
      throw new Error('Separadores de miles inválidos');
    }
    value = `${groups.join('')}.${fraction}`;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const groups = value.split(lastDot >= 0 ? '.' : ',');
    if (groups.length === 2 && groups[1]?.length === 2) value = groups.join('.');
    else if (/^\d{1,3}$/.test(groups[0] ?? '') && groups.slice(1).every(g => /^\d{3}$/.test(g))) value = groups.join('');
    else throw new Error('Separadores monetarios ambiguos');
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('Valor monetario inválido');
  return number;
}
const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function parseExplicitDate(text: string): string | null {
  const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (iso) return isoDate.parse(iso);
  const match = fold(text).match(/(?:\((\d{1,2})\)|(\d{1,2}))\s+de\s+([a-z]+)\s+de\s+(\d{4})/);
  if (!match) return null;
  const month = months.indexOf(match[3] ?? '') + 1;
  const day = match[1] ?? match[2] ?? '';
  return isoDate.parse(`${match[4]}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`);
}
/** Calendar-month addition, clamped to the last day of the target month. */
export function deriveEndDateFromMonths(start: string, monthsToAdd: number): string {
  isoDate.parse(start);
  if (!Number.isInteger(monthsToAdd) || monthsToAdd < 0) throw new Error('Plazo inválido');
  const date = new Date(`${start}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + monthsToAdd);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}
/** Normalized Levenshtein similarity, insensitive to accents and punctuation. */
export function objectSimilarity(a: string, b: string): number {
  const clean = (s: string) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
  const x = clean(a); const y = clean(b);
  if (!x || !y) return 0;
  let previous = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      current[j] = Math.min((current[j - 1] ?? 0) + 1, (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return 1 - (previous[y.length] ?? 0) / Math.max(x.length, y.length);
}
