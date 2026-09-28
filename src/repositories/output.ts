import { mkdir, readFile, rename, lstat, unlink, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const queues = new Map<string, Promise<unknown>>();
/** Serialize output operations within the single application process. */
export async function exclusive<T>(directory: string, run: () => Promise<T>): Promise<T> {
  const key = path.resolve(directory);
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(run);
  queues.set(key, current);
  try { return await current; }
  finally { if (queues.get(key) === current) queues.delete(key); }
}
const journalSchema = z.array(z.object({ file: z.string(), content: z.string() }));
export class OutputRepository {
  constructor(readonly root: string) {}
  private async safe(file: string): Promise<string> {
    const base = path.resolve(this.root, 'out');
    const target = path.resolve(base, file);
    if (!target.startsWith(base + path.sep)) throw new Error('Ruta de salida inválida');
    let current = path.resolve(this.root);
    for (const segment of ['out', ...path.relative(base, target).split(path.sep)]) {
      current = path.join(current, segment);
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('No se permiten enlaces simbólicos en out/'); }
      catch (error) { if (!isMissing(error)) throw error; }
    }
    return target;
  }
  async read(file: string, fallback = ''): Promise<string> {
    try { return await readFile(await this.safe(file), 'utf8'); }
    catch (error) { if (isMissing(error)) return fallback; throw error; }
  }
  async atomic(file: string, content: string): Promise<void> {
    const target = await this.safe(file);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { flag: 'wx' });
    await rename(temporary, target);
  }
  async append(file: string, content: string): Promise<void> {
    const target = await this.safe(file);
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, content);
  }
  /** A durable intent allows idempotent roll-forward after interrupted multi-file writes. */
  async recover(): Promise<void> {
    const raw = await this.read('.pending-transaction.json');
    if (!raw) return;
    const entries = journalSchema.parse(JSON.parse(raw));
    for (const entry of entries) {
      if (entry.file.startsWith('.')) throw new Error('Entrada de transacción inválida');
      await this.atomic(entry.file, entry.content);
    }
    await unlink(await this.safe('.pending-transaction.json'));
  }
  async commit(entries: { file: string; content: string }[]): Promise<void> {
    await this.recover();
    for (const entry of entries) await this.safe(entry.file);
    await this.atomic('.pending-transaction.json', JSON.stringify(entries));
    await this.recover();
  }
}
function isMissing(error: unknown) { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
