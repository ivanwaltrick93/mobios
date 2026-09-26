import { defineConfig } from 'vitest/config';

process.loadEnvFile(new URL('../../.env', import.meta.url).pathname);

// Testes nunca tocam o banco de uso: trocam o nome do banco por mobios_test (criado em infra/db/init.sh).
const bancoDeTeste = (url: string) => url.replace(/\/[^/?]+(\?|$)/, '/mobios_test$1');
process.env.DATABASE_URL = bancoDeTeste(process.env.DATABASE_URL!);
process.env.DATABASE_MIGRATION_URL = bancoDeTeste(process.env.DATABASE_MIGRATION_URL!);

// Cache dos testes no Redis do compose, no banco lógico 1 (o 0 é o de uso). Sem REDIS_URL no .env, usa o padrão do
// compose; os testes de cache precisam do Redis rodando (docker compose up -d db redis).
const redisPadrao = `redis://:${process.env.REDIS_PASSWORD || 'mobios_redis'}@localhost:${process.env.REDIS_PORT || 6379}`;
process.env.REDIS_URL = `${(process.env.REDIS_URL || redisPadrao).replace(/\/\d*$/, '')}/1`;

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_MIGRATION_URL: process.env.DATABASE_MIGRATION_URL,
      REDIS_URL: process.env.REDIS_URL,
    },
    globalSetup: ['./vitest.setup.ts'],
    fileParallelism: false,
  },
});
