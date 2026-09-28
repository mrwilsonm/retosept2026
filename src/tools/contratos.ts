import { z } from 'zod';
import { extractedContractSchema, isoDate } from '../domain/contrato.js';
import { FileRepositories } from '../repositories/files.js';
import { contractualAttachment, extractContract } from '../services/extraction.js';
import { validateContract } from '../services/validation.js';
import { exclusive, OutputRepository } from '../repositories/output.js';
import { registerContract } from '../services/registration.js';
import { generateAlerts } from '../services/alerts.js';

export interface ToolContext { directory: string; sessionId: string }
const messageId = z.string().regex(/^[a-zA-Z0-9_-]+$/).describe('ID de la carpeta del mensaje en el buzón');
function defineTool<S extends z.ZodRawShape>(name: string, description: string, args: S,
  run: (input: z.infer<z.ZodObject<S>>, repo: FileRepositories) => Promise<unknown>) {
  return {
    description, args,
    async execute(input: unknown, ctx: ToolContext): Promise<string> {
      const repo = new FileRepositories(ctx.directory);
      let response: { ok: true; data: unknown } | { ok: false; error: string };
      try { response = { ok: true, data: await exclusive(repo.root, async () => {
        const parsed = z.object(args).strict().parse(input);
        await new OutputRepository(repo.root).recover();
        // RN6: initialize once before the first valid tool execution. Business no-ops
        // never modify this baseline; output operations are already serialized.
        await repo.ensureMaster();
        return run(parsed, repo);
      }) }; }
      catch (error) { response = { ok: false, error: error instanceof Error ? error.message : 'Error inesperado' }; }
      const id = z.object({ mensaje_id: z.string() }).safeParse(input);
      try {
        await repo.audit({ herramienta: name, mensaje_id: id.success ? id.data.mensaje_id : null,
          ok: response.ok, resumen: response.ok ? 'Completado' : 'Error de ejecución o validación' }, ctx.sessionId);
      } catch { return JSON.stringify({ ok: false, error: 'No se pudo escribir la auditoría' }); }
      return JSON.stringify(response);
    },
  };
}
export const leer_buzon = defineTool('contratos_leer_buzon', 'Lista los mensajes pendientes y detecta adjuntos contractuales.', {},
  async (_, repo) => {
    const pending = await repo.pendingReport();
    const mensajes = await Promise.all(pending.messages.map(async message => {
      const info = { id: message.id, de: message.de, asunto: message.asunto, fecha: message.fecha, adjuntos: message.adjuntos };
      try { return { ...info, tiene_contrato: Boolean(await contractualAttachment(repo, message)) }; }
      catch { return { ...info, tiene_contrato: false, error: 'No se pudo leer el adjunto' }; }
    }));
    return { mensajes, errores: pending.errors };
  });
export const extraer = defineTool('contratos_extraer', 'Extrae campos contractuales con confianza y evidencia del adjunto de un mensaje.',
  { mensaje_id: messageId }, async (input, repo) => {
    const attachment = await contractualAttachment(repo, await repo.message(input.mensaje_id));
    if (!attachment) throw new Error('El mensaje no contiene un contrato');
    return extractContract(attachment.text);
  });
export const registrar = defineTool('contratos_registrar', 'Valida y registra un contrato; requiere confirmación para campos dudosos o corregidos.', {
  mensaje_id: messageId,
  contrato: extractedContractSchema.describe('Contrato extraído o corregido por la persona revisora'),
  confirmado: z.boolean().optional().describe('Confirmación humana explícita de los campos revisados'),
  hoy: isoDate.optional().describe('Fecha de registro explícita; usar la fecha de referencia de la sesión'),
}, registerContract);
export const alertas = defineTool('contratos_alertas', 'Genera el reporte de vencimientos, pólizas y registros desde el corte.', {
  hoy: isoDate.describe('Fecha de referencia YYYY-MM-DD'),
}, (input, repo) => generateAlerts(input.hoy, repo));
export const validar = defineTool('contratos_validar', 'Clasifica el contrato contra el maestro y señala campos que requieren revisión.',
  { mensaje_id: messageId, contrato: extractedContractSchema.describe('Campos extraídos con confianza y evidencia') },
  async (input, repo) => {
    const message = await repo.message(input.mensaje_id);
    const attachment = await contractualAttachment(repo, message);
    if (!attachment) return { clasificacion: 'rechazado', motivo: 'El mensaje no contiene un contrato', requiere_revision: [] };
    const commercial = (await repo.commercials()).find(item => item.email.toLowerCase() === message.de.toLowerCase());
    return { ...validateContract(input.contrato, await repo.contracts(), attachment.text),
      comercial: commercial ?? null, avisos: commercial ? [] : ['Remitente no registrado en comerciales.json'] };
  });
