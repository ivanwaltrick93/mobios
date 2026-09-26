import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3333),
  DATABASE_URL: z.url(),
  DATABASE_MIGRATION_URL: z.url().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  // Cookie de sessão só por HTTPS. Padrão: ligado em produção. Desligue apenas para acesso via http (ex.: localhost).
  COOKIE_SECURE: z.stringbool().optional(),
  // Endereços dos proxies confiáveis na frente da API (formato do proxy-addr: IP, CIDR ou "uniquelocal").
  // Define o IP real do cliente, usado no limite de tentativas de login. Vazio = não confia em X-Forwarded-For.
  TRUST_PROXY: z.string().trim().optional(),
  // Pool de conexões por instância da API (docs/performance/DATABASE.md §Pool): instâncias × DB_POOL_MAX precisa
  // caber no max_connections do Postgres, com folga para migração e administração.
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  // Consulta mais longa que isso é cancelada (protege o pool de uma consulta descontrolada; a exportação de CSV
  // mais pesada cabe com folga). 0 = sem limite.
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
  // Transação parada sem enviar comandos por mais que isso é encerrada (conexão presa por erro de código).
  DB_IDLE_TX_TIMEOUT_MS: z.coerce.number().int().min(0).default(60_000),
  // Cache de leitura (docs/decisoes/0001-redis-cache-de-leitura.md). Vazio = desligado: tudo direto do Postgres.
  REDIS_URL: z.preprocess((v) => v || undefined, z.url().optional()),
  // Prazo do Painel no cache, em segundos (0 = sem cache para o Painel).
  CACHE_TTL_PAINEL_S: z.coerce.number().int().min(0).max(3600).default(60),
});

const lido = envSchema.parse(process.env);
export const env = { ...lido, COOKIE_SECURE: lido.COOKIE_SECURE ?? lido.NODE_ENV === 'production' };
export type Env = typeof env;
