import { hojeIso, MODULO_IDS, somarDias } from '@mobios/shared';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { app, cliente, emailAleatorio, entrar, novaOficina, SENHA } from './testes/apoio.js';

// Cache de leitura do Painel no Redis (docs/decisoes/0001-redis-cache-de-leitura.md). Precisa do Redis do compose;
// os testes usam o banco lógico 1 (vitest.config.ts). O caso sem Redis está em cache-indisponivel.test.ts.

const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
afterAll(() => {
  redis.disconnect();
});

type Oficina = Awaited<ReturnType<typeof novaOficina>>;
const tenantDe = async (o: Oficina) => (await o.chamar('GET', '/api/auth/sessao')).json().oficina.id as string;
const chavesDoPainel = (tenant: string) => redis.keys(`mobios:test:t:${tenant}:painel:*`);
const painel = async (o: { chamar: Oficina['chamar'] }) => (await o.chamar('GET', '/api/painel')).json();
const clientes = (p: { indicadores: { id: string; valor: number }[] }) =>
  p.indicadores.find((i) => i.id === 'clientes')!.valor;
/** A gravação no Redis não é esperada pela resposta: aguarda a chave aparecer. */
async function esperarChave(tenant: string, quantas = 1) {
  for (let i = 0; i < 50 && (await chavesDoPainel(tenant)).length < quantas; i++)
    await new Promise((r) => setTimeout(r, 20));
  return chavesDoPainel(tenant);
}

describe('cache do Painel', () => {
  it('falta: calcula no banco e guarda com prazo; acerto: devolve o guardado sem recalcular', async () => {
    const a = await novaOficina('Oficina Cache');
    const tenant = await tenantDe(a);
    const primeiro = await painel(a);
    const [chave] = await esperarChave(tenant);
    expect(chave).toMatch(new RegExp(`^mobios:test:t:${tenant}:painel:v1:${hojeIso()}:mes:[\\w-]{16}$`));
    // 60 s com variação de ±10%.
    expect(await redis.ttl(chave!)).toBeGreaterThanOrEqual(50);
    expect(await redis.ttl(chave!)).toBeLessThanOrEqual(66);

    // Um cliente novo não aparece enquanto vale o cache: a resposta é a guardada, com o mesmo instante de cálculo.
    await a.chamar('POST', '/api/clientes', cliente({ nome: 'Depois do cache' }));
    const segundo = await painel(a);
    expect(segundo).toEqual(primeiro);
    expect(clientes(segundo)).toBe(0);

    // Expirado o prazo, a próxima leitura volta ao banco e guarda de novo.
    await redis.del(chave!);
    const terceiro = await painel(a);
    expect(clientes(terceiro)).toBe(1);
    expect(terceiro.atualizadoEm).not.toBe(primeiro.atualizadoEm);
    expect(await esperarChave(tenant)).toHaveLength(1);
  });

  it('cada período tem a própria chave', async () => {
    const a = await novaOficina('Oficina Cache Períodos');
    const tenant = await tenantDe(a);
    await a.chamar('GET', '/api/painel?periodo=hoje');
    await a.chamar('GET', '/api/painel?periodo=7d');
    expect((await esperarChave(tenant, 2)).map((c) => c.split(':')[7]).sort()).toEqual(['7d', 'hoje']);
  });

  it('uma oficina nunca recebe o Painel guardado de outra', async () => {
    const a = await novaOficina('Oficina Cache A');
    const b = await novaOficina('Oficina Cache B');
    await a.chamar('POST', '/api/clientes', cliente({ nome: 'Só da A' }));
    // Os dois são administradores: mesmo perfil de acesso, chaves diferentes pela oficina.
    expect(clientes(await painel(a))).toBe(1);
    await esperarChave(await tenantDe(a));
    expect(clientes(await painel(b))).toBe(0);
    expect(clientes(await painel(a))).toBe(1);
  });

  it('o perfil de acesso entra na chave: sem acesso a Clientes, nada de aniversariantes; mudou a função, vale na hora', async () => {
    const admin = await novaOficina('Oficina Cache Perfis');
    const nascido = `1992${somarDias(hojeIso(), 1).slice(4)}`;
    await admin.chamar('POST', '/api/clientes', cliente({ nome: 'Faz Anos Amanhã', dataNascimento: nascido }));
    expect((await painel(admin)).aniversariantes.map((x: { nome: string }) => x.nome)).toEqual(['Faz Anos Amanhã']);

    const nenhum = Object.fromEntries(MODULO_IDS.map((m) => [m, null]));
    const funcao = (
      await admin.chamar('POST', '/api/funcoes', {
        nome: 'Só relatórios',
        ativa: true,
        acessos: { ...nenhum, relatorios: 'consultar' },
      })
    ).json();
    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', { nome: 'Analista', email, funcoes: [funcao.id], senha: SENHA });
    const analista = await entrar(email);
    expect((await painel(analista)).aniversariantes).toEqual([]);

    await admin.chamar('PUT', `/api/funcoes/${funcao.id}`, {
      nome: 'Só relatórios',
      ativa: true,
      acessos: { ...nenhum, relatorios: 'consultar', clientes: 'consultar' },
    });
    expect((await painel(analista)).aniversariantes.map((x: { nome: string }) => x.nome)).toEqual(['Faz Anos Amanhã']);
  });

  it('o cache não dispensa a autenticação', async () => {
    const a = await novaOficina('Oficina Cache Sessão');
    await painel(a);
    await esperarChave(await tenantDe(a));
    expect((await app.inject({ method: 'GET', url: '/api/painel' })).statusCode).toBe(401);
  });

  it('muitas leituras ao mesmo tempo, sem nada guardado, respondem todas iguais', async () => {
    const a = await novaOficina('Oficina Cache Concorrência');
    await a.chamar('POST', '/api/clientes', cliente({ nome: 'Um' }));
    const respostas = await Promise.all(Array.from({ length: 20 }, () => a.chamar('GET', '/api/painel')));
    expect(respostas.every((r) => r.statusCode === 200)).toBe(true);
    expect(new Set(respostas.map((r) => clientes(r.json())))).toEqual(new Set([1]));
  });
});
