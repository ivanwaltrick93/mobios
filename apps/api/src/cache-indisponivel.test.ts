import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Redis fora do ar: o cache não pode ser requisito para o MobiOS funcionar (docs/decisoes/0001). A URL aponta para
// uma porta fechada ANTES de carregar a API (env.ts lê o ambiente ao ser importado), por isso os imports são
// dinâmicos. Arquivo próprio: o Vitest isola os módulos por arquivo.
process.env.REDIS_URL = 'redis://:senha@127.0.0.1:1/1';

const { criarApp } = await import('./app.js');
const { db, sqlClient } = await import('./db/client.js');
const { criarOficinaComAdmin } = await import('./db/admin-inicial.js');
const { COOKIE_SESSAO } = await import('./lib/auth.js');

let app: Awaited<ReturnType<typeof criarApp>>;
beforeAll(async () => {
  app = await criarApp();
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe('Redis indisponível', () => {
  it('o Painel responde pelo banco, sem esperar o Redis, e a instância continua pronta', async () => {
    const email = `${crypto.randomUUID()}@teste.dev`;
    await criarOficinaComAdmin(db, { oficina: 'Oficina Sem Redis', nome: 'Admin', email, senha: 'senha-segura-123' });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, senha: 'senha-segura-123' },
    });
    const token = login.cookies.find((c) => c.name === COOKIE_SESSAO)!.value;

    for (let i = 0; i < 3; i++) {
      const inicio = performance.now();
      const res = await app.inject({ method: 'GET', url: '/api/painel', cookies: { [COOKIE_SESSAO]: token } });
      expect(res.statusCode).toBe(200);
      expect(res.json().indicadores[0]).toMatchObject({ id: 'clientes', valor: 0 });
      expect(performance.now() - inicio).toBeLessThan(2_000);
    }
    expect((await app.inject({ method: 'GET', url: '/api/saude' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/vivo' })).statusCode).toBe(200);
  });
});
