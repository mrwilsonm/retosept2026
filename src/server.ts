import { buildApp } from './app.js';
import { envSchema } from './config/env.js';
try { process.loadEnvFile(); } catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
const config = envSchema.parse(process.env);
const app = await buildApp(config);
await app.listen({ port: config.PORT, host: config.HOST });
console.log(`Registro de Contratos: http://${config.HOST}:${config.PORT}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
