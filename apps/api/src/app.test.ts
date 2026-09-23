import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from './app.js';
import { db, sqlClient, withTenant } from './db/client.js';
import { TEMA_VAZIO } from '@mobios/shared';
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
  /** Id de uma função da oficina pelo nome. */
  const funcao = async (nome: string): Promise<string> =>
    (await sessao.chamar('GET', '/api/funcoes')).json().find((f: { nome: string }) => f.nome === nome).id;
  return { ...sessao, email, funcao };
}

describe('auth', () => {
  it('faz login do admin, com e-mail em qualquer caixa', async () => {
    const { email } = await novaOficina('Auto Center Teste');
    expect((await entrar(email, 'errada')).res.statusCode).toBe(401);
    expect((await entrar(emailAleatorio())).res.statusCode).toBe(401);

    const login = await entrar(email.toUpperCase());
    expect(login.res.statusCode).toBe(200);
    expect(login.res.json()).toMatchObject({ usuario: { admin: true, funcoes: [{ nome: 'Administrador' }] }, oficina: { nome: 'Auto Center Teste' } });
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
    const criado = await admin.chamar('POST', '/api/usuarios', { nome: 'Pedro', email: ` ${email.toUpperCase()} `, funcoes: [await admin.funcao('Mecânico')], senha: SENHA });
    expect(criado.statusCode).toBe(201);
    expect(criado.json()).toMatchObject({ nome: 'Pedro', email, funcoes: [{ nome: 'Mecânico', ativa: true }], ativo: true });
    expect(criado.body).not.toContain('senha');

    const [linha] = await db.execute(sql`select senha_hash from auth_usuario_por_email(${email})`);
    expect(linha!.senha_hash).toMatch(/^\$argon2id\$/);

    const lista = (await admin.chamar('GET', '/api/usuarios')).json();
    expect(lista.map((u: { nome: string }) => u.nome)).toEqual(['Admin', 'Pedro']);

    const mecanico = await entrar(email);
    expect(mecanico.res.json().usuario.funcoes.map((f: { nome: string }) => f.nome)).toEqual(['Mecânico']);
  });

  it('valida dados e recusa e-mail duplicado (inclusive de outra oficina)', async () => {
    const a = await novaOficina('Oficina Dup A');
    const b = await novaOficina('Oficina Dup B');
    const curta = await a.chamar('POST', '/api/usuarios', { nome: 'Ana', email: emailAleatorio(), funcoes: [await a.funcao('Atendente')], senha: '123' });
    expect(curta.statusCode).toBe(400);
    expect(curta.json().campos.senha).toBeDefined();
    expect((await a.chamar('POST', '/api/usuarios', { nome: 'Ana', email: emailAleatorio(), funcoes: ['nao-e-uuid'], senha: SENHA })).statusCode).toBe(400);

    const dup = await a.chamar('POST', '/api/usuarios', { nome: 'Ana', email: b.email, funcoes: [await a.funcao('Atendente')], senha: SENHA });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().erro).toBe('Já existe uma conta com este e-mail');
  });

  it('só admin gerencia usuários', async () => {
    const admin = await novaOficina('Oficina Permissões');
    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', { nome: 'Atendente', email, funcoes: [await admin.funcao('Atendente')], senha: SENHA });
    const atendente = await entrar(email);
    expect((await atendente.chamar('GET', '/api/usuarios')).statusCode).toBe(403);
    expect((await atendente.chamar('POST', '/api/usuarios', { nome: 'Hacker', email: emailAleatorio(), funcoes: [await admin.funcao('Administrador')], senha: SENHA })).statusCode).toBe(403);
    expect((await atendente.chamar('GET', '/api/clientes')).statusCode).toBe(200);
  });

  it('desativar ou trocar a senha vale na hora, inclusive para sessões abertas', async () => {
    const admin = await novaOficina('Oficina Desativação');
    const email = emailAleatorio();
    const { id } = (await admin.chamar('POST', '/api/usuarios', { nome: 'Carla', email, funcoes: [await admin.funcao('Financeiro')], senha: SENHA })).json();
    const carla = await entrar(email);
    expect((await carla.chamar('GET', '/api/clientes')).statusCode).toBe(200);

    const novaSenha = 'outra-senha-456';
    await admin.chamar('PUT', `/api/usuarios/${id}`, { nome: 'Carla', funcoes: [await admin.funcao('Financeiro')], ativo: true, novaSenha });
    expect((await entrar(email)).res.statusCode).toBe(401);
    expect((await entrar(email, novaSenha)).res.statusCode).toBe(200);

    await admin.chamar('PUT', `/api/usuarios/${id}`, { nome: 'Carla', funcoes: [await admin.funcao('Financeiro')], ativo: false });
    expect((await carla.chamar('GET', '/api/clientes')).statusCode).toBe(401);
    expect((await entrar(email, novaSenha)).res.statusCode).toBe(401);
  });

  it('admin não remove o próprio acesso', async () => {
    const admin = await novaOficina('Oficina Autoproteção');
    const { usuario } = (await admin.chamar('GET', '/api/auth/sessao')).json();
    expect((await admin.chamar('PUT', `/api/usuarios/${usuario.id}`, { nome: 'Admin', funcoes: [await admin.funcao('Atendente')], ativo: true })).statusCode).toBe(400);
    expect((await admin.chamar('PUT', `/api/usuarios/${usuario.id}`, { nome: 'Admin', funcoes: [await admin.funcao('Administrador')], ativo: false })).statusCode).toBe(400);
    expect((await admin.chamar('PUT', `/api/usuarios/${usuario.id}`, { nome: 'Admin Renomeado', funcoes: [await admin.funcao('Administrador')], ativo: true })).statusCode).toBe(200);
  });

  it('admin de uma oficina não enxerga nem altera usuários de outra', async () => {
    const a = await novaOficina('Oficina Users A');
    const b = await novaOficina('Oficina Users B');
    const { usuario } = (await a.chamar('GET', '/api/auth/sessao')).json();
    expect((await b.chamar('GET', '/api/usuarios')).json().map((u: { email: string }) => u.email)).toEqual([b.email]);
    expect((await b.chamar('PUT', `/api/usuarios/${usuario.id}`, { nome: 'Invasor', funcoes: [await b.funcao('Atendente')], ativo: false })).statusCode).toBe(404);
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

describe('personas e permissões', () => {
  it('cada função acessa só o que lhe cabe (docs/ENTREGAVEIS.md §1)', async () => {
    const admin = await novaOficina('Oficina Personas');
    const pessoa = async (funcao: string) => {
      const email = emailAleatorio();
      await admin.chamar('POST', '/api/usuarios', { nome: funcao, email, funcoes: [await admin.funcao(funcao)], senha: SENHA });
      return entrar(email);
    };
    const [atendente, mecanico, financeiro] = [await pessoa('Atendente'), await pessoa('Mecânico'), await pessoa('Financeiro')];
    const indicadores = async (s: Awaited<ReturnType<typeof entrar>>) => (await s.chamar('GET', '/api/painel')).json().indicadores.map((i: { id: string }) => i.id);

    // Atendente: cadastra clientes e veículos (abre O.S. e vende no balcão); sem relatórios e configurações.
    const cliente = await atendente.chamar('POST', '/api/clientes', { nome: 'Cliente do Balcão' });
    expect(cliente.statusCode).toBe(201);
    expect((await atendente.chamar('POST', '/api/veiculos', { clienteId: cliente.json().id, placa: 'BAL1C00', marca: 'Fiat', modelo: 'Uno' })).statusCode).toBe(201);
    expect((await atendente.chamar('GET', '/api/relatorios')).statusCode).toBe(403);
    expect((await atendente.chamar('GET', '/api/usuarios')).statusCode).toBe(403);
    expect((await atendente.chamar('PUT', '/api/configuracoes/aparencia', TEMA_VAZIO)).statusCode).toBe(403);
    expect(await indicadores(atendente)).not.toContain('faturado_hoje');

    // Mecânico: consulta clientes/veículos, não cadastra nem altera; sem relatórios e faturamento.
    expect((await mecanico.chamar('GET', '/api/clientes')).statusCode).toBe(200);
    expect((await mecanico.chamar('GET', `/api/veiculos?clienteId=${cliente.json().id}`)).json()).toHaveLength(1);
    expect((await mecanico.chamar('POST', '/api/clientes', { nome: 'Não pode' })).statusCode).toBe(403);
    expect((await mecanico.chamar('PUT', `/api/clientes/${cliente.json().id}`, { nome: 'Não pode' })).statusCode).toBe(403);
    expect((await mecanico.chamar('POST', '/api/veiculos', { clienteId: cliente.json().id, placa: 'MEC1A00', marca: 'VW', modelo: 'Gol' })).statusCode).toBe(403);
    expect((await mecanico.chamar('GET', '/api/relatorios')).statusCode).toBe(403);
    expect(await indicadores(mecanico)).not.toContain('faturado_hoje');

    // Financeiro: relatórios e faturamento; consulta cadastros sem alterar.
    expect((await financeiro.chamar('GET', '/api/relatorios/clientes')).statusCode).toBe(200);
    expect((await financeiro.chamar('DELETE', `/api/clientes/${cliente.json().id}`)).statusCode).toBe(403);
    expect(await indicadores(financeiro)).toContain('faturado_hoje');

    // Admin: tudo.
    expect(await indicadores(admin)).toContain('faturado_hoje');
    expect((await admin.chamar('GET', '/api/relatorios')).json()).toHaveLength(3);
  });
});

describe('funções e permissões configuráveis', () => {
  const acessos = (a: Partial<Record<string, string | null>> = {}) => ({ clientes: null, os: null, estoque: null, financeiro: null, relatorios: null, ...a });

  it('toda oficina nasce com Administrador fixo e as funções padrão aprovadas', async () => {
    const admin = await novaOficina('Oficina Funções Padrão');
    const lista = (await admin.chamar('GET', '/api/funcoes')).json();
    expect(lista.map((f: { nome: string; admin: boolean }) => [f.nome, f.admin])).toEqual([
      ['Administrador', true],
      ['Atendente', false],
      ['Financeiro', false],
      ['Mecânico', false],
    ]);
    const porNome = Object.fromEntries(lista.map((f: { nome: string }) => [f.nome, f]));
    expect(porNome.Administrador.acessos).toEqual(acessos({ clientes: 'editar', os: 'editar', estoque: 'editar', financeiro: 'editar', relatorios: 'consultar' }));
    expect(porNome.Atendente.acessos).toEqual(acessos({ clientes: 'editar', os: 'editar', estoque: 'editar' }));
    expect(porNome['Mecânico'].acessos).toEqual(acessos({ clientes: 'consultar', os: 'editar', estoque: 'consultar' }));
    expect(porNome.Financeiro.acessos).toEqual(acessos({ clientes: 'consultar', os: 'consultar', financeiro: 'editar', relatorios: 'consultar' }));
    expect(porNome.Administrador.usuarios).toBe(1);
  });

  it('admin cria função; mudanças de nível valem na hora para quem já está logado', async () => {
    const admin = await novaOficina('Oficina Almoxarife');
    const criada = await admin.chamar('POST', '/api/funcoes', { nome: 'Almoxarife', ativa: true, acessos: acessos({ clientes: 'consultar' }) });
    expect(criada.statusCode).toBe(201);
    const almox = criada.json();

    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', { nome: 'Almox', email, funcoes: [almox.id], senha: SENHA });
    const usuario = await entrar(email);
    expect(usuario.res.json().acessos).toEqual(acessos({ clientes: 'consultar' }));
    expect((await usuario.chamar('POST', '/api/clientes', { nome: 'Não pode' })).statusCode).toBe(403);
    expect((await usuario.chamar('GET', '/api/relatorios')).statusCode).toBe(403);

    await admin.chamar('PUT', `/api/funcoes/${almox.id}`, { nome: 'Almoxarife', ativa: true, acessos: acessos({ clientes: 'editar', relatorios: 'consultar' }) });
    expect((await usuario.chamar('POST', '/api/clientes', { nome: 'Agora pode' })).statusCode).toBe(201);
    expect((await usuario.chamar('GET', '/api/relatorios')).statusCode).toBe(200);
    expect((await usuario.chamar('GET', '/api/auth/sessao')).json().acessos.clientes).toBe('editar');
  });

  it('várias funções somam o maior nível de cada módulo', async () => {
    const admin = await novaOficina('Oficina Multi');
    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', { nome: 'Dupla', email, funcoes: [await admin.funcao('Mecânico'), await admin.funcao('Financeiro')], senha: SENHA });
    const dupla = await entrar(email);
    expect(dupla.res.json().acessos).toEqual(acessos({ clientes: 'consultar', os: 'editar', estoque: 'consultar', financeiro: 'editar', relatorios: 'consultar' }));
    expect(dupla.res.json().usuario.funcoes.map((f: { nome: string }) => f.nome)).toEqual(['Financeiro', 'Mecânico']);
  });

  it('desativar a função retira o acesso na hora; reativar devolve', async () => {
    const admin = await novaOficina('Oficina Desativa Função');
    const idFin = await admin.funcao('Financeiro');
    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', { nome: 'Fin', email, funcoes: [idFin], senha: SENHA });
    const fin = await entrar(email);
    expect((await fin.chamar('GET', '/api/relatorios')).statusCode).toBe(200);

    const financeiro = (await admin.chamar('GET', '/api/funcoes')).json().find((f: { id: string }) => f.id === idFin);
    await admin.chamar('PUT', `/api/funcoes/${idFin}`, { nome: 'Financeiro', ativa: false, acessos: financeiro.acessos });
    expect((await fin.chamar('GET', '/api/relatorios')).statusCode).toBe(403);
    expect((await fin.chamar('GET', '/api/auth/sessao')).json()).toMatchObject({ acessos: acessos(), usuario: { funcoes: [] } });
    // Função desativada não pode ser atribuída a ninguém.
    expect((await admin.chamar('POST', '/api/usuarios', { nome: 'X', email: emailAleatorio(), funcoes: [idFin], senha: SENHA })).statusCode).toBe(400);

    await admin.chamar('PUT', `/api/funcoes/${idFin}`, { nome: 'Financeiro', ativa: true, acessos: financeiro.acessos });
    expect((await fin.chamar('GET', '/api/relatorios')).statusCode).toBe(200);
  });

  it('Administrador é fixo, nomes são únicos e níveis precisam existir no módulo', async () => {
    const admin = await novaOficina('Oficina Regras Função');
    const idAdmin = await admin.funcao('Administrador');
    expect((await admin.chamar('PUT', `/api/funcoes/${idAdmin}`, { nome: 'Chefe', ativa: true, acessos: acessos() })).statusCode).toBe(400);
    const dup = await admin.chamar('POST', '/api/funcoes', { nome: 'atendente', ativa: true, acessos: acessos() });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().erro).toBe('Já existe uma função com este nome');
    expect((await admin.chamar('POST', '/api/funcoes', { nome: 'Gerente', ativa: true, acessos: acessos({ relatorios: 'editar' }) })).statusCode).toBe(400);
  });

  it('só o Administrador gerencia funções, e uma oficina não vê as funções de outra', async () => {
    const a = await novaOficina('Oficina Funções A');
    const b = await novaOficina('Oficina Funções B');
    const email = emailAleatorio();
    await a.chamar('POST', '/api/usuarios', { nome: 'Atendente', email, funcoes: [await a.funcao('Atendente')], senha: SENHA });
    const atendente = await entrar(email);
    expect((await atendente.chamar('GET', '/api/funcoes')).statusCode).toBe(403);
    expect((await atendente.chamar('POST', '/api/funcoes', { nome: 'Hack', ativa: true, acessos: acessos() })).statusCode).toBe(403);

    const idAtendenteA = await a.funcao('Atendente');
    expect((await b.chamar('PUT', `/api/funcoes/${idAtendenteA}`, { nome: 'Invasão', ativa: false, acessos: acessos() })).statusCode).toBe(404);
    // Atribuir a um usuário da B uma função da A é recusado.
    expect((await b.chamar('POST', '/api/usuarios', { nome: 'X', email: emailAleatorio(), funcoes: [idAtendenteA], senha: SENHA })).statusCode).toBe(400);
  });
});

describe('aparência', () => {
  it('admin define cores e botões; todos recebem o tema na sessão; outros papéis não alteram', async () => {
    const admin = await novaOficina('Oficina Cores');
    expect((await admin.chamar('GET', '/api/auth/sessao')).json().oficina.tema).toEqual(TEMA_VAZIO);

    const tema = { ...TEMA_VAZIO, corPrimaria: '#C2410C', corMenu: '#1E293B', corBotaoPrimario: '#15803D', corBotaoSecundario: '#F1F5F9', corBotaoSecundarioTexto: '#0F172A' };
    const salvo = await admin.chamar('PUT', '/api/configuracoes/aparencia', tema);
    expect(salvo.json()).toEqual({
      corPrimaria: '#c2410c',
      corMenu: '#1e293b',
      corBotaoPrimario: '#15803d',
      corBotaoPrimarioTexto: null,
      corBotaoSecundario: '#f1f5f9',
      corBotaoSecundarioTexto: '#0f172a',
    });
    // Salvar de novo atualiza a mesma linha (upsert pela PK tenant_id).
    expect((await admin.chamar('PUT', '/api/configuracoes/aparencia', { ...tema, corBotaoPrimarioTexto: '#FFFFFF' })).json().corBotaoPrimarioTexto).toBe('#ffffff');
    expect((await admin.chamar('PUT', '/api/configuracoes/aparencia', { ...TEMA_VAZIO, corPrimaria: 'laranja' })).statusCode).toBe(400);

    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', { nome: 'Mecânico', email, funcoes: [await admin.funcao('Mecânico')], senha: SENHA });
    const mecanico = await entrar(email);
    expect(mecanico.res.json().oficina.tema).toMatchObject({ corPrimaria: '#c2410c', corBotaoPrimario: '#15803d' });
    expect((await mecanico.chamar('PUT', '/api/configuracoes/aparencia', TEMA_VAZIO)).statusCode).toBe(403);

    const outra = await novaOficina('Oficina Sem Cores');
    expect((await outra.chamar('GET', '/api/configuracoes/aparencia')).json()).toEqual(TEMA_VAZIO);
  });
});

describe('marca pública (tela de login)', () => {
  it('entrega nome, tema e logo da oficina sem login, e nada além disso', async () => {
    const admin = await novaOficina('Oficina Pública');
    const { oficina } = (await admin.chamar('GET', '/api/auth/sessao')).json();
    await admin.chamar('PUT', '/api/configuracoes/aparencia', { ...TEMA_VAZIO, corPrimaria: '#7C3AED' });

    const res = await app.inject({ method: 'GET', url: `/api/publico/aparencia?oficina=${oficina.id}` });
    expect(res.json()).toEqual({ oficinaId: oficina.id, nome: 'Oficina Pública', tema: { ...TEMA_VAZIO, corPrimaria: '#7c3aed' }, logoVersao: null });
    expect((await app.inject({ method: 'GET', url: `/api/publico/logo?oficina=${oficina.id}` })).statusCode).toBe(404);

    // Várias oficinas no banco e nenhuma indicada: tema padrão, sem vazar nomes.
    const semParametro = (await app.inject({ method: 'GET', url: '/api/publico/aparencia' })).json();
    expect(semParametro).toEqual({ oficinaId: null, nome: null, tema: TEMA_VAZIO, logoVersao: null });
    expect((await app.inject({ method: 'GET', url: '/api/publico/aparencia?oficina=nao-e-uuid' })).json().nome).toBeNull();
    expect((await app.inject({ method: 'GET', url: `/api/publico/aparencia?oficina=${randomUUID()}` })).json().nome).toBeNull();
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
    await admin.chamar('POST', '/api/usuarios', { nome: 'Mecânico', email, funcoes: [await admin.funcao('Mecânico')], senha: SENHA });
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

describe('painel', () => {
  it('mostra indicadores reais, alertas e módulos pendentes sem números inventados', async () => {
    const a = await novaOficina('Oficina Painel');
    const vazio = (await a.chamar('GET', '/api/painel')).json();
    expect(vazio.indicadores.map((i: { id: string; valor: number | null }) => [i.id, i.valor])).toEqual([
      ['os_abertas', null],
      ['faturado_hoje', null],
      ['clientes', 0],
      ['veiculos', 0],
    ]);
    expect(vazio.alertas).toEqual([]);

    const c = (await a.chamar('POST', '/api/clientes', { nome: 'Sem Telefone' })).json();
    await a.chamar('POST', '/api/clientes', { nome: 'Com Telefone', telefone: '48999990000' });
    await a.chamar('POST', '/api/veiculos', { clienteId: c.id, placa: 'ABC1D23', marca: 'Fiat', modelo: 'Uno' });

    const painel = (await a.chamar('GET', '/api/painel')).json();
    const porId = Object.fromEntries(painel.indicadores.map((i: { id: string }) => [i.id, i]));
    expect(porId.clientes).toMatchObject({ valor: 2, detalhe: '2 cadastrado(s) hoje' });
    expect(porId.veiculos).toMatchObject({ valor: 1, detalhe: '1 cadastrado(s) hoje' });
    expect(painel.alertas.map((x: { mensagem: string }) => x.mensagem)).toEqual([
      '1 cliente(s) sem telefone: não será possível avisar quando o veículo ficar pronto.',
      '1 cliente(s) sem veículo cadastrado.',
    ]);

    const b = await novaOficina('Outra Oficina Painel');
    expect((await b.chamar('GET', '/api/painel')).json().indicadores[2].valor).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/api/painel' })).statusCode).toBe(401);
  });
});

describe('fotos da equipe', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const enviar = (s: Awaited<ReturnType<typeof entrar>>, id: string, corpo: Buffer | string, tipo = 'image/jpeg') =>
    s.chamar('PUT', `/api/fotos/usuario/${id}`, corpo as unknown as object, { 'content-type': tipo });

  it('o próprio usuário e o admin trocam a foto; a oficina toda vê; os demais não alteram', async () => {
    const admin = await novaOficina('Oficina Fotos');
    const criar = async (nome: string) => {
      const email = emailAleatorio();
      const { id } = (await admin.chamar('POST', '/api/usuarios', { nome, email, funcoes: [await admin.funcao('Mecânico')], senha: SENHA })).json();
      return { id, sessao: await entrar(email) };
    };
    const joao = await criar('João');
    const maria = await criar('Maria');

    // Sem foto: versão nula e 404.
    expect(joao.sessao.res.json().usuario.fotoVersao).toBeNull();
    expect((await maria.sessao.chamar('GET', `/api/fotos/usuario/${joao.id}`)).statusCode).toBe(404);

    // O próprio usuário envia a sua; colega não altera a dele.
    expect((await enviar(joao.sessao, joao.id, jpeg)).statusCode).toBe(204);
    expect((await enviar(maria.sessao, joao.id, jpeg)).statusCode).toBe(403);
    expect((await maria.sessao.chamar('DELETE', `/api/fotos/usuario/${joao.id}`)).statusCode).toBe(403);

    // Qualquer um da oficina vê; a versão aparece na sessão e na lista da equipe.
    const foto = await maria.sessao.chamar('GET', `/api/fotos/usuario/${joao.id}`);
    expect(foto.statusCode).toBe(200);
    expect(foto.headers['content-type']).toBe('image/jpeg');
    expect(foto.rawPayload.equals(jpeg)).toBe(true);
    expect((await joao.sessao.chamar('GET', '/api/auth/sessao')).json().usuario.fotoVersao).toMatch(/^\d+$/);
    const equipe = (await admin.chamar('GET', '/api/usuarios')).json();
    expect(equipe.find((u: { id: string }) => u.id === joao.id).fotoVersao).toMatch(/^\d+$/);
    expect(equipe.find((u: { id: string }) => u.id === maria.id).fotoVersao).toBeNull();

    // Admin troca e remove a foto de qualquer um.
    expect((await enviar(admin, maria.id, jpeg)).statusCode).toBe(204);
    expect((await admin.chamar('DELETE', `/api/fotos/usuario/${joao.id}`)).statusCode).toBe(204);
    expect((await maria.sessao.chamar('GET', `/api/fotos/usuario/${joao.id}`)).statusCode).toBe(404);

    // Validação igual à do logo.
    expect((await enviar(joao.sessao, joao.id, '<svg/>', 'image/svg+xml')).statusCode).toBe(415);
    expect((await enviar(joao.sessao, joao.id, Buffer.from('não é imagem'), 'image/png')).statusCode).toBe(415);

    // Outra oficina não vê nem altera.
    const outra = await novaOficina('Outra Oficina Fotos');
    expect((await outra.chamar('GET', `/api/fotos/usuario/${maria.id}`)).statusCode).toBe(404);
    expect((await enviar(outra, maria.id, jpeg)).statusCode).toBe(404);
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
    await a.chamar('POST', '/api/usuarios', { nome: 'Financeiro', email, funcoes: [await a.funcao('Financeiro')], senha: SENHA });
    const financeiro = await entrar(email);
    expect((await financeiro.chamar('GET', '/api/relatorios')).json().map((r: { id: string }) => r.id)).toEqual(['clientes', 'veiculos']);
    expect((await financeiro.chamar('GET', '/api/relatorios/usuarios')).statusCode).toBe(403);
    expect((await financeiro.chamar('GET', '/api/relatorios/usuarios/csv')).statusCode).toBe(403);

    const usuarios = (await a.chamar('GET', '/api/relatorios/usuarios/csv')).rawPayload.toString();
    expect(usuarios).toContain('Financeiro;');
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
    for (const tabela of ['clientes', 'veiculos', 'users', 'tenant_logos', 'tenant_aparencia', 'funcoes', 'funcao_permissoes', 'usuario_funcoes', 'usuario_fotos']) {
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
