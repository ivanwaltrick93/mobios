import { criarApp } from './app.js';
import { sqlClient } from './db/client.js';
import { env } from './env.js';

const app = await criarApp();
await app.listen({ port: env.PORT, host: '0.0.0.0' });

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, async () => {
    await app.close();
    await sqlClient.end();
    process.exit(0);
  });
}
