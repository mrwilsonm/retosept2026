import { z } from 'zod';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  value => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Fecha inválida',
);
export const country = z.enum(['CO', 'EC', 'PE', 'PA', 'HN']);
export const currency = z.enum(['COP', 'USD', 'PEN', 'PAB', 'HNL']);
export const contractValuesSchema = z.object({
  id_contrato: z.string().min(1),
  cliente: z.string().min(1),
  nit_cliente: z.string().regex(/^\d+$/),
  pais: country,
  objeto: z.string().min(1).max(200),
  valor: z.number().finite().nonnegative(),
  moneda: currency,
  fecha_inicio: isoDate,
  fecha_fin: isoDate,
  requiere_poliza: z.boolean(),
  tipo_poliza: z.string(),
});
export const contractRecordSchema = contractValuesSchema.extend({
  estado_poliza: z.enum(['vigente', 'pendiente', 'vencida', 'no_aplica']),
  comercial: z.string(),
  ruta_sharepoint: z.string(),
  fecha_registro: isoDate,
  fuente: z.enum(['buzon', 'manual', 'migracion']),
});
const field = <T extends z.ZodType>(schema: T) => z.object({
  valor: schema.nullable(),
  confianza: z.number().min(0).max(1),
  evidencia: z.string().optional(),
});
const values = contractValuesSchema.shape;
export const extractedContractSchema = z.object({
  id_contrato: field(values.id_contrato), cliente: field(values.cliente),
  nit_cliente: field(values.nit_cliente), pais: field(values.pais),
  objeto: field(values.objeto), valor: field(values.valor), moneda: field(values.moneda),
  fecha_inicio: field(values.fecha_inicio), fecha_fin: field(values.fecha_fin),
  requiere_poliza: field(values.requiere_poliza), tipo_poliza: field(values.tipo_poliza),
});
export type ContractRecord = z.infer<typeof contractRecordSchema>;
export type ExtractedContract = z.infer<typeof extractedContractSchema>;
export type Field<T> = { valor: T | null; confianza: number; evidencia?: string };
export type ContractField = keyof ExtractedContract;
export const REVIEW_THRESHOLD = 0.8;
