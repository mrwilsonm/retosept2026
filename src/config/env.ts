import { z } from 'zod';
export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  LLM_PROVIDER: z.literal('openai').default('openai'),
  LLM_MODEL: z.string().default(''),
  LLM_API_KEY: z.string().default(''),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(30000),
  AGENT_MAX_ITERATIONS: z.coerce.number().int().min(1).max(50).default(25),
  AGENT_MAX_TOKENS: z.coerce.number().int().min(1024).max(1000000).default(200000),
  APP_MAX_TOKENS: z.coerce.number().int().min(1024).max(10000000).default(1000000),
});
export type AppConfig = z.infer<typeof envSchema>;
