import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from './app.js';
import { db, sqlClient } from './db/client.js';
import { COOKIE_SESSAO } from './lib/auth.js';

// Testes de integração: exigem o Postgres rodando e as migrações aplicadas.
let app: Awaited<ReturnType<typeof criarApp>>;

beforeAll(async () => {
  app = await criarApp();
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function novaOficina(nome: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/cadastro',
    payload: { nomeOficina: nome, nome: 'Dono', email: `${randomUUID()}@teste.dev`, senha: 'senha-segura-123' },
  });
  expect(res.statusCode).toBe(201);
  const token = res.cookies.find((c) => c.name === COOKIE_SESSAO)!.value;
  const chamar = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, payload, cookies: { [COOKIE_SESSAO]: token } });
  return { chamar, sessao: res.json() };
}

describe('auth', () => {
  it('cadastra oficina, abre sessão e faz login', async () => {
    const email = `${randomUUID()}@teste.dev`;
    const cadastro = await app.inject({
      method: 'POST',
      url: '/api/auth/cadastro',
      payload: { nomeOficina: 'Auto Center Teste', nome: 'Maria', email, senha: 'senha-segura-123' },
    });
    expect(cadastro.statusCode).toBe(201);
    expect(cadastro.json().usuario.papel).toBe('dono');

    const errado = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: 'errada' } });
    expect(errado.statusCode).toBe(401);

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: email.toUpperCase(), senha: 'senha-segura-123' } });
    expect(login.statusCode).toBe(200);
    expect(login.json().oficina.nome).toBe('Auto Center Teste');
  });

  it('recusa e-mail duplicado', async () => {
    const payload = { nomeOficina: 'Oficina Dup', nome: 'Fulano', email: `${randomUUID()}@teste.dev`, senha: 'senha-segura-123' };
    await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload });
    const res = await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload });
    expect(res.statusCode).toBe(409);
  });

  it('exige sessão nas rotas de negócio', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/clientes' });
    expect(res.statusCode).toBe(401);
  });
});

describe('clientes e veículos', () => {
  it('valida CPF e placa', async () => {
    const { chamar } = await novaOficina('Oficina Validação');
    const cpf = await chamar('POST', '/api/clientes', { nome: 'João', cpfCnpj: '123.456.789-00' });
    expect(cpf.statusCode).toBe(400);
    expect(cpf.json().campos.cpfCnpj).toBe('CPF inválido');

    const cliente = (await chamar('POST', '/api/clientes', { nome: 'João', cpfCnpj: '529.982.247-25' })).json();
    expect(cliente.cpfCnpj).toBe('52998224725');

    const placa = await chamar('POST', '/api/veiculos', { clienteId: cliente.id, placa: 'XX-1', marca: 'Fiat', modelo: 'Uno' });
    expect(placa.statusCode).toBe(400);

    const veiculo = await chamar('POST', '/api/veiculos', { clienteId: cliente.id, placa: 'bra-2e19', marca: 'Fiat', modelo: 'Uno', ano: 2020 });
    expect(veiculo.statusCode).toBe(201);
    expect(veiculo.json().placa).toBe('BRA2E19');

    const comVeiculo = await chamar('DELETE', `/api/clientes/${cliente.id}`);
    expect(comVeiculo.statusCode).toBe(409);
  });
});

describe('isolamento entre oficinas (RLS)', () => {
  it('uma oficina não enxerga nem altera dados de outra', async () => {
    const a = await novaOficina('Oficina A');
    const b = await novaOficina('Oficina B');

    const clienteA = (await a.chamar('POST', '/api/clientes', { nome: 'Cliente da A' })).json();

    expect((await b.chamar('GET', '/api/clientes')).json()).toEqual({ itens: [], total: 0 });
    expect((await b.chamar('GET', `/api/clientes/${clienteA.id}`)).statusCode).toBe(404);
    expect((await b.chamar('PUT', `/api/clientes/${clienteA.id}`, { nome: 'Invadido' })).statusCode).toBe(404);
    expect((await b.chamar('DELETE', `/api/clientes/${clienteA.id}`)).statusCode).toBe(404);

    // FK composta impede vincular um veículo ao cliente de outra oficina.
    const invasao = await b.chamar('POST', '/api/veiculos', { clienteId: clienteA.id, placa: 'ABC1234', marca: 'VW', modelo: 'Gol' });
    expect(invasao.statusCode).toBe(409);

    const listaA = (await a.chamar('GET', '/api/clientes')).json();
    expect(listaA.itens.map((c: { nome: string }) => c.nome)).toEqual(['Cliente da A']);
  });

  it('sem tenant definido, o banco não devolve nenhuma linha', async () => {
    const linhas = await db.execute(sql`select count(*)::int as n from clientes`);
    expect(linhas[0]!.n).toBe(0);
  });

  it('toda tabela com tenant_id tem RLS ativo', async () => {
    const semRls = await db.execute(sql`
      select c.relname from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
      where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
        and c.relname <> 'users' and not c.relrowsecurity`);
    expect(semRls.map((r) => r.relname)).toEqual([]);
  });
});
