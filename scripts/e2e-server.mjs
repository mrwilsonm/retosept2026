// Test-only provider: no network calls, no secrets and an isolated writable directory.
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../dist/src/app.js';
import { envSchema } from '../dist/src/config/env.js';
import { extractContract } from '../dist/src/services/extraction.js';
const root = await mkdtemp(path.join(tmpdir(), 'reto-browser-'));
for (const folder of ['fixtures', 'agent', 'src/knowledge', 'dist/web']) await cp(folder, path.join(root, folder), { recursive: true });
const contracts = {};
for (const id of ['msg-001', 'msg-006']) contracts[id] = extractContract(await readFile(`fixtures/reto-02/buzon/${id}/contrato.txt`, 'utf8'));
const sequence = [
  ['contratos_leer_buzon', {}],
  ['contratos_extraer', { mensaje_id: 'msg-001' }],
  ['contratos_validar', { mensaje_id: 'msg-001', contrato: contracts['msg-001'] }],
  ['contratos_registrar', { mensaje_id: 'msg-001', contrato: contracts['msg-001'] }],
  ['contratos_extraer', { mensaje_id: 'msg-006' }],
  ['contratos_validar', { mensaje_id: 'msg-006', contrato: contracts['msg-006'] }],
];
const adapter = { async send(messages) {
  const index = messages.filter(message => message.role === 'assistant' && message.calls?.length).length;
  const step = sequence[index];
  return { text: step ? '' : 'Procesamiento de prueba finalizado.', inputTokens: 100, outputTokens: 50,
    calls: step ? [{ id: `browser-${index}`, name: step[0], arguments: step[1] }] : [] };
} };
const app = await buildApp(envSchema.parse({ LLM_API_KEY: 'test-only', LLM_MODEL: 'test-only' }), root, adapter);
await app.listen({ host: '127.0.0.1', port: 3101 });
async function close() { await app.close(); await rm(root, { recursive: true, force: true }); process.exit(0); }
process.on('SIGTERM', close);
process.on('SIGINT', close);
