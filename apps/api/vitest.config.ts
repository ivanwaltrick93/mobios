import { defineConfig } from 'vitest/config';

process.loadEnvFile(new URL('../../.env', import.meta.url).pathname);

// Testes nunca tocam o banco de uso: trocam o nome do banco por mobios_test (criado em infra/db/init.sh).
const bancoDeTeste = (url: string) => url.replace(/\/[^/?]+(\?|$)/, '/mobios_test$1');
process.env.DATABASE_URL = bancoDeTeste(process.env.DATABASE_URL!);
process.env.DATABASE_MIGRATION_URL = bancoDeTeste(process.env.DATABASE_MIGRATION_URL!);

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_MIGRATION_URL: process.env.DATABASE_MIGRATION_URL,
    },
    globalSetup: ['./vitest.setup.ts'],
    fileParallelism: false,
  },
});
