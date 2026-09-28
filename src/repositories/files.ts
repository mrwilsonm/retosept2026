import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { contractRecordSchema, type ContractRecord } from '../domain/contrato.js';
import { OutputRepository } from './output.js';

export const messageSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/), de: z.email(), para: z.email(),
  asunto: z.string(), fecha: z.string(), cuerpo: z.string(),
  adjuntos: z.array(z.string().regex(/^[a-zA-Z0-9_.-]+$/).refine(s => s !== '.' && s !== '..')),
});
export type MailMessage = z.infer<typeof messageSchema>;
const commercialSchema = z.array(z.object({ email: z.email(), nombre: z.string(), region: z.string() }));

export class FileRepositories {
  readonly root: string;
  constructor(directory: string) { this.root = path.resolve(directory); }

  /** Reject traversal and symlinks escaping the fixture directory. */
  private async fixture(...segments: string[]): Promise<string> {
    const base = await realpath(path.join(this.root, 'fixtures/reto-02'));
    const target = await realpath(path.resolve(base, ...segments));
    if (!target.startsWith(`${base}${path.sep}`)) throw new Error('Ruta de fixture inválida');
    return target;
  }
  async message(id: string): Promise<MailMessage> {
    messageSchema.shape.id.parse(id);
    const file = await this.fixture('buzon', id, 'correo.json');
    const message = messageSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (message.id !== id) throw new Error('El ID del correo no coincide con su carpeta');
    return message;
  }
  async attachment(message: MailMessage, filename: string): Promise<string> {
    if (!message.adjuntos.includes(filename)) throw new Error('Adjunto no declarado');
    return readFile(await this.fixture('buzon', message.id, filename), 'utf8');
  }
  async pending(): Promise<MailMessage[]> {
    return (await this.pendingReport()).messages;
  }
  async pendingReport(): Promise<{ messages: MailMessage[]; errors: { id: string; error: string }[] }> {
    let processed: string[] = [];
    try {
      processed = z.array(z.string()).parse(JSON.parse(await new OutputRepository(this.root).read('procesados.json', '[]')));
    } catch (error) { if (!isMissing(error)) throw error; }
    const entries = await readdir(await this.fixture('buzon'), { withFileTypes: true });
    const messages: MailMessage[] = [];
    const errors: { id: string; error: string }[] = [];
    for (const entry of entries.filter(e => e.isDirectory() && !processed.includes(e.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      try { messages.push(await this.message(entry.name)); }
      catch { errors.push({ id: entry.name, error: 'No se pudo leer o validar este correo' }); }
    }
    return { messages, errors };
  }
  async contracts(): Promise<ContractRecord[]> {
    let source = await new OutputRepository(this.root).read('sharepoint/maestro-contratos.csv', '__MISSING__');
    if (source === '__MISSING__') source = await readFile(await this.fixture('maestro-contratos.csv'), 'utf8');
    if (!source.trim()) throw new Error('El maestro está vacío o dañado');
    const rows: unknown = parse(source, { columns: true, skip_empty_lines: true, bom: true });
    return z.array(z.record(z.string(), z.string())).parse(rows).map(row => contractRecordSchema.parse({
      ...row, valor: Number(row.valor), requiere_poliza: z.enum(['true', 'false']).parse(row.requiere_poliza) === 'true',
    }));
  }
  async ensureMaster(): Promise<void> {
    const output = path.join(this.root, 'out/sharepoint');
    await mkdir(output, { recursive: true });
    try {
      await copyFile(await this.fixture('maestro-contratos.csv'), path.join(output, 'maestro-contratos.csv'), constants.COPYFILE_EXCL);
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error; }
  }
  async commercials() {
    return commercialSchema.parse(JSON.parse(await readFile(await this.fixture('comerciales.json'), 'utf8')));
  }
  async audit(event: { herramienta: string; mensaje_id: string | null; ok: boolean; resumen: string }, sessionId: string) {
    await new OutputRepository(this.root).append('log.jsonl', `${JSON.stringify({ ts: new Date().toISOString(), sessionId, ...event })}\n`);
  }
}
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
