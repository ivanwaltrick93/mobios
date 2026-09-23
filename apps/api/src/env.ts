import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3333),
  DATABASE_URL: z.url(),
  DATABASE_MIGRATION_URL: z.url().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  // Cookie de sessão só por HTTPS. Padrão: ligado em produção. Desligue apenas para acesso via http (ex.: localhost).
  COOKIE_SECURE: z.stringbool().optional(),
});

const lido = envSchema.parse(process.env);
export const env = { ...lido, COOKIE_SECURE: lido.COOKIE_SECURE ?? lido.NODE_ENV === 'production' };
export type Env = typeof env;
