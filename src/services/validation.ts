import { type ContractField, type ContractRecord, type ExtractedContract, REVIEW_THRESHOLD } from '../domain/contrato.js';
import { fold, objectSimilarity } from '../domain/normalization.js';

export type Classification = 'nuevo' | 'actualizacion' | 'duplicado' | 'rechazado';
export interface Validation {
  clasificacion: Classification;
  requiere_revision: string[];
  diferencias: Record<string, { antes: unknown; despues: unknown }>;
  contrato_resuelto: ExtractedContract;
  id_contrato_existente?: string;
  motivo?: string;
}
export function validateContract(contract: ExtractedContract, master: ContractRecord[], text: string): Validation {
  const amendment = fold(text.trim()).startsWith('otrosi');
  const resolved = structuredClone(contract);
  const direct = master.find(row => row.id_contrato === contract.id_contrato.valor);
  const candidates = direct ? [direct] : master.filter(row => row.nit_cliente === contract.nit_cliente.valor
    && contract.objeto.valor !== null && objectSimilarity(row.objeto, contract.objeto.valor) >= 0.9);
  const existing = candidates.length === 1 ? candidates[0] : undefined;
  // Inherit only unmodified fields for an amendment. Never manufacture extraction evidence.
  if (amendment && existing) {
    for (const key of Object.keys(resolved) as ContractField[]) {
      if (resolved[key].valor === null) {
        Object.assign(resolved[key], { valor: existing[key], confianza: 1, evidencia: `Maestro ${existing.id_contrato}: campo conservado por otrosí` });
      }
    }
  }
  const review = (Object.keys(resolved) as ContractField[]).filter(key => resolved[key].confianza < REVIEW_THRESHOLD);
  const differences: Validation['diferencias'] = {};
  if (existing) {
    for (const key of Object.keys(resolved) as ContractField[]) {
      const value = resolved[key].valor;
      if (value !== null && value !== existing[key]) differences[key] = { antes: existing[key], despues: value };
    }
    for (const key of ['nit_cliente', 'pais', 'moneda'] as const) {
      if (resolved[key].valor !== null && resolved[key].valor !== existing[key] && !review.includes(key)) review.push(key);
    }
  }
  const result = (classification: Classification, reason?: string): Validation => ({
    clasificacion: classification, requiere_revision: [...new Set(review)], diferencias: differences,
    contrato_resuelto: resolved, ...(existing ? { id_contrato_existente: existing.id_contrato } : {}),
    ...(reason ? { motivo: reason } : {}),
  });
  if (!resolved.cliente.valor || !resolved.objeto.valor) return result('rechazado', 'No se identifican partes y objeto contractual');
  if (candidates.length > 1) {
    return { ...result('actualizacion'), requiere_revision: [...review, 'coincidencia_maestro'] };
  }
  if (amendment && !existing) return result('rechazado', 'Otrosí sin contrato base identificable en el maestro');
  if (resolved.fecha_inicio.valor && resolved.fecha_fin.valor && resolved.fecha_fin.valor < resolved.fecha_inicio.valor) {
    throw new Error('La fecha fin es anterior a la fecha inicio');
  }
  if (!amendment && direct && ['valor', 'fecha_inicio', 'fecha_fin'].every(key => {
    const field = key as 'valor' | 'fecha_inicio' | 'fecha_fin';
    return resolved[field].valor === direct[field];
  })) return result('duplicado');
  return result(existing ? 'actualizacion' : 'nuevo');
}
