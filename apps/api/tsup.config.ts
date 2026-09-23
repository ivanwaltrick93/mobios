import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/db/migrate.ts'],
  format: 'esm',
  target: 'node22',
  // O pacote compartilhado é código-fonte TS: embutido no bundle.
  noExternal: ['@mobios/shared'],
  clean: true,
});
