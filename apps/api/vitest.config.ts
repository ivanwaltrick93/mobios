import { defineConfig } from 'vitest/config';

process.loadEnvFile(new URL('../../.env', import.meta.url).pathname);

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test' },
    fileParallelism: false,
  },
});
