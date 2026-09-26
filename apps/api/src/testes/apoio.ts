import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect } from 'vitest';
import { criarApp } from '../app.js';
import { db, sqlClient } from '../db/client.js';
import { criarOficinaComAdmin } from '../db/admin-inicial.js';
import { COOKIE_SESSAO } from '../lib/auth.js';

// Apoio aos testes de integração (auth, clientes, oficina e RLS): sobe a API uma vez por arquivo de teste, que
// importa este módulo, e oferece sessão, oficina nova e dados válidos de cadastro. Exigem o Postgres rodando e as
// migrações aplicadas (vitest.setup.ts).

export let app: Awaited<ReturnType<typeof criarApp>>;

beforeAll(async () => {
  app = await criarApp();
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

export const SENHA = 'senha-segura-123';
export const emailAleatorio = () => `${randomUUID()}@teste.dev`;

export async function entrar(email: string, senha = SENHA) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha } });
  const token = res.cookies.find((c) => c.name === COOKIE_SESSAO)?.value;
  const chamar = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: object | string,
    headers?: Record<string, string>,
  ) => app.inject({ method, url, payload, headers, cookies: token ? { [COOKIE_SESSAO]: token } : {} });
  return { res, chamar };
}

/** Oficina nova com admin logado (o cadastro público não existe; admins nascem na instalação). */
export async function novaOficina(nome: string) {
  const email = emailAleatorio();
  await criarOficinaComAdmin(db, { oficina: nome, nome: 'Admin', email, senha: SENHA });
  const sessao = await entrar(email);
  expect(sessao.res.statusCode).toBe(200);
  /** Id de uma função da oficina pelo nome. */
  const funcao = async (nome: string): Promise<string> =>
    (await sessao.chamar('GET', '/api/funcoes')).json().find((f: { nome: string }) => f.nome === nome).id;
  return { ...sessao, email, funcao };
}

// ---------- Dados válidos de cadastro (cada chamada gera documento, placa e chassi únicos) ----------

export const aleatorio = (conjunto: string, n: number) =>
  Array.from({ length: n }, () => conjunto[Math.floor(Math.random() * conjunto.length)]).join('');

export function cpfAleatorio() {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (base: number[]) => {
    const resto = base.reduce((acc, n, i) => acc + n * (base.length + 1 - i), 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  d.push(dv(d));
  d.push(dv(d));
  return d.join('');
}

export const ENDERECO = {
  tipo: 'residencial',
  cep: '88015-100',
  logradouro: 'Rua Felipe Schmidt',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Florianópolis',
  uf: 'SC',
};

export const cliente = (dados: object = {}) => ({
  tipo: 'PF',
  nome: 'Cliente Teste',
  cpfCnpj: cpfAleatorio(),
  telefone: '(48) 3222-1000',
  whatsapp: '(48) 99999-0000',
  clienteDesde: '2024-01-10',
  enderecos: [ENDERECO],
  ...dados,
});

export const veiculo = (clienteId: string, dados: object = {}) => ({
  clienteId,
  placa: `${aleatorio('ABCDEFGHJKLMNPRSTUVWXYZ', 3)}${aleatorio('0123456789', 1)}${aleatorio('ABCDEFGHJ', 1)}${aleatorio('0123456789', 2)}`,
  chassi: aleatorio('ABCDEFGHJKLMNPRSTUVWXYZ0123456789', 17),
  marca: 'Fiat',
  modelo: 'Uno',
  anoFabricacao: 2020,
  anoModelo: 2020,
  ...dados,
});
