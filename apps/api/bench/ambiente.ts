// Ambiente comum do benchmark (medir.ts e carga.ts): API em processo apontando para o banco mobios_bench, conexão do
// dono para pg_stat_statements, sessões dos três perfis e os ids usados nas URLs dos cenários.
// Nunca aponta para os bancos de uso ou de testes: a URL é montada aqui, sempre com /mobios_bench.
import postgres from 'postgres';

const raiz = new URL('../../../', import.meta.url);
// Antes do .env: loadEnvFile não sobrescreve o que já está definido, e a senha que vale é a do benchmark.
process.loadEnvFile(new URL('infra/bench/.credenciais', raiz).pathname);
process.loadEnvFile(new URL('.env', raiz).pathname);

const noBench = (url: string) => url.replace(/\/[^/?]+(\?|$)/, '/mobios_bench$1');
process.env.DATABASE_URL = noBench(process.env.DATABASE_URL!);
process.env.NODE_ENV = 'test';

export const dono = postgres(noBench(process.env.DATABASE_MIGRATION_URL!), { max: 1, onnotice: () => {} });

const { criarApp } = await import('../src/app.js');
const { sqlClient } = await import('../src/db/client.js');
const { COOKIE_SESSAO } = await import('../src/lib/auth.js');
export const app = await criarApp();

async function entrar(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, senha: process.env.ADMIN_SENHA },
  });
  const token = res.cookies.find((c) => c.name === COOKIE_SESSAO)?.value;
  if (!token) throw new Error(`Não entrou como ${email}: ${res.statusCode} ${res.body}`);
  return token;
}

const [grande] = await dono`select t.id from tenants t join users u on u.tenant_id = t.id
  where u.email = 'admin@bench.local'`;
const [tabela] = await dono`select id from tabelas_preco where tenant_id = ${grande!.id} and padrao`;
const [orcamento] = await dono`select id from orcamentos where tenant_id = ${grande!.id}
  and status = 'aprovado' order by criado_em desc limit 1`;
const [tabelaPequena] = await dono`select tp.id from tabelas_preco tp join users u on u.tenant_id = tp.tenant_id
  where u.email = 'pequena@bench.local' and tp.padrao`;

export const ids = {
  tabela: tabela!.id as string,
  orcamento: orcamento!.id as string,
  tabelaPequena: tabelaPequena!.id as string,
};

const sessoes = {
  admin: await entrar('admin@bench.local'),
  vendedor: await entrar('vendedor@bench.local'),
  pequena: await entrar('pequena@bench.local'),
};
export type Sessao = keyof typeof sessoes;

/** GET na API em processo, como o perfil indicado. */
export const chamar = (sessao: Sessao, url: string) =>
  app.inject({ method: 'GET', url, cookies: { [COOKIE_SESSAO]: sessoes[sessao] } });

/** Percentil `p` (0–100) de uma lista já ordenada. */
export const percentil = (ordenados: number[], p: number) =>
  ordenados[Math.min(ordenados.length - 1, Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1))]!;

export async function encerrar() {
  await app.close();
  await sqlClient.end();
  await dono.end();
}
