import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from './app.js';
import { db, sqlClient, withTenant } from './db/client.js';
import { criarOficinaComAdmin } from './db/admin-inicial.js';
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

const SENHA = 'senha-segura-123';
const emailAleatorio = () => `${randomUUID()}@teste.dev`;

async function entrar(email: string, senha = SENHA) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha } });
  const token = res.cookies.find((c) => c.name === COOKIE_SESSAO)?.value;
  const chamar = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, headers?: Record<string, string>) =>
    app.inject({ method, url, payload, headers, cookies: token ? { [COOKIE_SESSAO]: token } : {} });
  return { res, chamar };
}

/** Oficina nova com admin logado (o cadastro público não existe; admins nascem na instalação). */
async function novaOficina(nome: string) {
  const email = emailAleatorio();
  await criarOficinaComAdmin(db, { oficina: nome, nome: 'Admin', email, senha: SENHA });
  const sessao = await entrar(email);
  expect(sessao.res.statusCode).toBe(200);
  return { ...sessao, email };
}

describe('auth', () => {
  it('faz login do admin, com e-mail em qualquer caixa', async () => {
    const { email } = await novaOficina('Auto Center Teste');
    expect((await entrar(email, 'errada')).res.statusCode).toBe(401);
    expect((await entrar(emailAleatorio())).res.statusCode).toBe(401);

    const login = await entrar(email.toUpperCase());
    expect(login.res.statusCode).toBe(200);
    expect(login.res.json()).toMatchObject({ usuario: { papel: 'admin' }, oficina: { nome: 'Auto Center Teste' } });
  });

  it('não tem cadastro público', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('exige sessão nas rotas de negócio', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/clientes' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/usuarios' })).statusCode).toBe(401);
  });
});

describe('usuários', () => {
  it('admin cadastra usuário; senha fica só como hash Argon2id', async () => {
    const admin = await novaOficina('Oficina Usuários');
    const email = emailAleatorio();
    const criado = await admin.chamar('POST', '/api/usuarios', { nome: 'Pedro', email: ` ${email.toUpperCase()} `, papel: 'mecanico', senha: SENHA });
    expect(criado.statusCode).toBe(201);
    expect(criado.json()).toMatchObject({ nome: 'Pedro', email, papel: 'mecanico', ativo: true });
    expect(criado.body).not.toContain('senha');

    const [linha] = await db.execute(sql`select senha_hash from auth_usuario_por_email(${email})`);
    expect(linha!.senha_hash).toMatch(/^\$argon2id\$/);

    const lista = (await admin.chamar('GET', '/api/usuarios')).json();
    expect(lista.map((u: { nome: string }) => u.nome)).toEqual(['Admin', 'Pedro']);

    const mecanico = await entrar(email);
    expect(mecanico.res.json().usuario.papel).toBe('mecanico');
  });

  it('valida dados e recusa e-mail duplicado (inclusive de outra oficina)', async () => {
    const a = await novaOficina('Oficina Dup A');
    const b = await novaOficina('Oficina Dup B');
    const curta = await a.chamar('POST', '/api/usuarios', { nome: 'Ana', email: emailAleatorio(), papel: 'atendente', senha: '123' });
    expect(curta.statusCode).toBe(400);
    expect(curta.json().campos.senha).toBeDefined();
    expect((await a.chamar('POST', '/api/usuarios', { nome: 'Ana', email: emailAleatorio(), papel: 'chefe', senha: SENHA })).statusCode).toBe(400);

    const dup = await a.chamar('POST', '/api/usuarios', { nome: 'Ana', email: b.email, papel: 'atendente', senha: SENHA });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().erro).toBe('Já existe uma conta com este e-mail');
  });

  it('só admin gerencia usuários', async () => {
    const admin = await novaOficina('Oficina Permissões');
    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', { nome: 'Atendente', email, papel: 'atendente', senha: SENHA });
    const atendente = await entrar(email);
    expect((await atendente.chamar('GET', '/api/usuarios')).statusCode).toBe(403);
    expect((await atendente.chamar('POST', '/api/usuarios', { nome: 'Hacker', email: emailAleatorio(), papel: 'admin', senha: SENHA })).statusCode).toBe(403);
    expect((await atendente.chamar('GET', '/api/clientes')).statusCode).toBe(200);
  });

  it('desativar ou trocar a senha vale na hora, inclusive para sessões abertas', async () => {
    const admin = await novaOficina('Oficina Desativação');
    const email = emailAleatorio();
    const { id } = (await admin.chamar('POST', '/api/usuarios', { nome: 'Carla', email, papel: 'financeiro', senha: SENHA })).json();
    const carla = await entrar(email);
    expect((await carla.chamar('GET', '/api/clientes')).statusCode).toBe(200);

    const novaSenha = 'outra-senha-456';
    await admin.chamar('PUT', `/api/usuarios/${id}`, { nome: 'Carla', papel: 'financeiro', ativo: true, novaSenha });
    expect((await entrar(email)).res.statusCode).toBe(401);
    expect((await entrar(email, novaSenha)).res.statusCode).toBe(200);

    await admin.chamar('PUT', `/api/usuarios/${id}`, { nome: 'Carla', papel: 'financeiro', ativo: false });
    expect((await carla.chamar('GET', '/api/clientes')).statusCode).toBe(401);
    expect((await entrar(email, novaSenha)).res.statusCode).toBe(401);
  });

  it('admin não remove o próprio acesso', async () => {
    const admin = await novaOficina('Oficina Autoproteção');
    const { usuario } = (await admin.chamar('GET', '/api/auth/sessao')).json();
    expect((await admin.chamar('PUT', `/api/usuarios/${usuario.id}`, { nome: 'Admin', papel: 'atendente', ativo: true })).statusCode).toBe(400);
    expect((await admin.chamar('PUT', `/api/usuarios/${usuario.id}`, { nome: 'Admin', papel: 'admin', ativo: false })).statusCode).toBe(400);
    expect((await admin.chamar('PUT', `/api/usuarios/${usuario.id}`, { nome: 'Admin Renomeado', papel: 'admin', ativo: true })).statusCode).toBe(200);
  });

  it('admin de uma oficina não enxerga nem altera usuários de outra', async () => {
    const a = await novaOficina('Oficina Users A');
    const b = await novaOficina('Oficina Users B');
    const { usuario } = (await a.chamar('GET', '/api/auth/sessao')).json();
    expect((await b.chamar('GET', '/api/usuarios')).json().map((u: { email: string }) => u.email)).toEqual([b.email]);
    expect((await b.chamar('PUT', `/api/usuarios/${usuario.id}`, { nome: 'Invasor', papel: 'atendente', ativo: false })).statusCode).toBe(404);
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

describe('aparência', () => {
  it('admin define cores; todos recebem o tema na sessão; outros papéis não alteram', async () => {
    const admin = await novaOficina('Oficina Cores');
    expect((await admin.chamar('GET', '/api/auth/sessao')).json().oficina.tema).toEqual({ corPrimaria: null, corMenu: null });

    const salvo = await admin.chamar('PUT', '/api/configuracoes/aparencia', { corPrimaria: '#C2410C', corMenu: '#1E293B' });
    expect(salvo.json()).toEqual({ corPrimaria: '#c2410c', corMenu: '#1e293b' });
    expect((await admin.chamar('PUT', '/api/configuracoes/aparencia', { corPrimaria: 'laranja', corMenu: null })).statusCode).toBe(400);

    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', { nome: 'Mecânico', email, papel: 'mecanico', senha: SENHA });
    const mecanico = await entrar(email);
    expect(mecanico.res.json().oficina.tema.corPrimaria).toBe('#c2410c');
    expect((await mecanico.chamar('PUT', '/api/configuracoes/aparencia', { corPrimaria: null, corMenu: null })).statusCode).toBe(403);

    const outra = await novaOficina('Oficina Sem Cores');
    expect((await outra.chamar('GET', '/api/configuracoes/aparencia')).json()).toEqual({ corPrimaria: null, corMenu: null });
  });
});

describe('logo da oficina', () => {
  // PNG 1x1 válido.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const enviar = (s: Awaited<ReturnType<typeof entrar>>, corpo: Buffer | string, tipo = 'image/png') =>
    s.chamar('PUT', '/api/configuracoes/logo', corpo as unknown as object, { 'content-type': tipo });

  it('admin envia o logo, que fica no banco e é servido a todos da oficina', async () => {
    const admin = await novaOficina('Oficina Logo');
    expect((await admin.chamar('GET', '/api/auth/sessao')).json().oficina.logoVersao).toBeNull();
    expect((await admin.chamar('GET', '/api/configuracoes/logo')).statusCode).toBe(404);

    expect((await enviar(admin, png)).statusCode).toBe(204);
    const [linha] = await withTenant((await admin.chamar('GET', '/api/auth/sessao')).json().oficina.id, (tx) =>
      tx.execute(sql`select tipo, tamanho, conteudo from tenant_logos`),
    );
    expect(linha).toMatchObject({ tipo: 'image/png', tamanho: png.length });
    expect(Buffer.from(linha!.conteudo as Uint8Array).equals(png)).toBe(true);

    const versao = (await admin.chamar('GET', '/api/auth/sessao')).json().oficina.logoVersao;
    expect(versao).toMatch(/^\d+$/);

    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', { nome: 'Mecânico', email, papel: 'mecanico', senha: SENHA });
    const mecanico = await entrar(email);
    const logo = await mecanico.chamar('GET', '/api/configuracoes/logo');
    expect(logo.statusCode).toBe(200);
    expect(logo.headers['content-type']).toBe('image/png');
    expect(logo.rawPayload.equals(png)).toBe(true);
    expect((await mecanico.chamar('GET', '/api/configuracoes/logo', undefined, { 'if-none-match': logo.headers.etag as string })).statusCode).toBe(304);
    expect((await enviar(mecanico, png)).statusCode).toBe(403);
    expect((await mecanico.chamar('DELETE', '/api/configuracoes/logo')).statusCode).toBe(403);

    const outra = await novaOficina('Oficina Sem Logo');
    expect((await outra.chamar('GET', '/api/configuracoes/logo')).statusCode).toBe(404);

    expect((await admin.chamar('DELETE', '/api/configuracoes/logo')).statusCode).toBe(204);
    expect((await admin.chamar('GET', '/api/configuracoes/logo')).statusCode).toBe(404);
    expect((await admin.chamar('GET', '/api/auth/sessao')).json().oficina.logoVersao).toBeNull();
  });

  it('recusa formato falso, SVG e arquivo acima de 1 MB', async () => {
    const admin = await novaOficina('Oficina Logo Inválido');
    expect((await enviar(admin, Buffer.from('<script>alert(1)</script>'), 'image/png')).statusCode).toBe(415);
    expect((await enviar(admin, '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml')).statusCode).toBe(415);
    const grande = Buffer.concat([png, Buffer.alloc(1024 * 1024)]);
    const res = await enviar(admin, grande);
    expect(res.statusCode).toBe(413);
    expect(res.json().erro).toBe('Arquivo grande demais.');
  });
});

describe('relatórios', () => {
  it('lista, filtra por período e exporta CSV para Excel', async () => {
    const admin = await novaOficina('Oficina Relatórios');
    const c = (await admin.chamar('POST', '/api/clientes', { nome: 'Maria; Silva', cpfCnpj: '529.982.247-25', telefone: '=1+1' })).json();
    await admin.chamar('POST', '/api/veiculos', { clienteId: c.id, placa: 'ABC1234', marca: 'VW', modelo: 'Gol', kmAtual: 125000 });

    const ids = (await admin.chamar('GET', '/api/relatorios')).json().map((r: { id: string }) => r.id);
    expect(ids).toEqual(['clientes', 'veiculos', 'usuarios']);

    const previa = (await admin.chamar('GET', '/api/relatorios/clientes')).json();
    expect(previa.total).toBe(1);
    expect(previa.linhas[0]).toMatchObject({ nome: 'Maria; Silva', documento: '529.982.247-25', veiculos: '1', tipo: 'Pessoa física' });

    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    expect((await admin.chamar('GET', `/api/relatorios/clientes?de=${hoje}&ate=${hoje}`)).json().total).toBe(1);
    expect((await admin.chamar('GET', '/api/relatorios/clientes?ate=2000-01-01')).json().total).toBe(0);
    expect((await admin.chamar('GET', '/api/relatorios/clientes?de=2030-01-02&ate=2030-01-01')).statusCode).toBe(400);

    const csv = await admin.chamar('GET', '/api/relatorios/veiculos/csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toMatch(/attachment; filename="veiculos-\d{4}-\d{2}-\d{2}\.csv"/);
    const texto = csv.rawPayload.toString('utf8');
    expect(texto.startsWith('\uFEFFPlaca;Marca;')).toBe(true);
    expect(texto).toContain('ABC-1234;VW;Gol;;;125.000;;"Maria; Silva";\'=1+1;');
  });

  it('respeita a função e o isolamento por oficina', async () => {
    const a = await novaOficina('Oficina Rel A');
    const b = await novaOficina('Oficina Rel B');
    await a.chamar('POST', '/api/clientes', { nome: 'Cliente Secreto da A' });
    expect((await b.chamar('GET', '/api/relatorios/clientes')).json().total).toBe(0);
    expect((await b.chamar('GET', '/api/relatorios/clientes/csv')).rawPayload.toString()).not.toContain('Secreto');

    const email = emailAleatorio();
    await a.chamar('POST', '/api/usuarios', { nome: 'Atendente', email, papel: 'atendente', senha: SENHA });
    const atendente = await entrar(email);
    expect((await atendente.chamar('GET', '/api/relatorios')).json().map((r: { id: string }) => r.id)).toEqual(['clientes', 'veiculos']);
    expect((await atendente.chamar('GET', '/api/relatorios/usuarios')).statusCode).toBe(403);
    expect((await atendente.chamar('GET', '/api/relatorios/usuarios/csv')).statusCode).toBe(403);

    const usuarios = (await a.chamar('GET', '/api/relatorios/usuarios/csv')).rawPayload.toString();
    expect(usuarios).toContain('Atendente;');
    expect(usuarios).not.toMatch(/argon2|senha/i);
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
    for (const tabela of ['clientes', 'veiculos', 'users', 'tenant_logos']) {
      const linhas = await db.execute(sql`select count(*)::int as n from ${sql.identifier(tabela)}`);
      expect(linhas[0]!.n, tabela).toBe(0);
    }
  });

  it('toda tabela com tenant_id tem RLS ativo', async () => {
    const semRls = await db.execute(sql`
      select c.relname from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
      where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
        and not c.relrowsecurity`);
    expect(semRls.map((r) => r.relname)).toEqual([]);
  });
});
