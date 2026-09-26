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
  const chamar = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: object | string,
    headers?: Record<string, string>,
  ) => app.inject({ method, url, payload, headers, cookies: token ? { [COOKIE_SESSAO]: token } : {} });
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

// ---------- Dados válidos de cadastro (cada chamada gera documento, placa e chassi únicos) ----------

const aleatorio = (conjunto: string, n: number) =>
  Array.from({ length: n }, () => conjunto[Math.floor(Math.random() * conjunto.length)]).join('');

function cpfAleatorio() {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (base: number[]) => {
    const resto = base.reduce((acc, n, i) => acc + n * (base.length + 1 - i), 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  d.push(dv(d));
  d.push(dv(d));
  return d.join('');
}

const ENDERECO = {
  tipo: 'residencial',
  cep: '88015-100',
  logradouro: 'Rua Felipe Schmidt',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Florianópolis',
  uf: 'SC',
};

const cliente = (dados: object = {}) => ({
  tipo: 'PF',
  nome: 'Cliente Teste',
  cpfCnpj: cpfAleatorio(),
  telefone: '(48) 3222-1000',
  whatsapp: '(48) 99999-0000',
  clienteDesde: '2024-01-10',
  enderecos: [ENDERECO],
  ...dados,
});

const veiculo = (clienteId: string, dados: object = {}) => ({
  clienteId,
  placa: `${aleatorio('ABCDEFGHJKLMNPRSTUVWXYZ', 3)}${aleatorio('0123456789', 1)}${aleatorio('ABCDEFGHJ', 1)}${aleatorio('0123456789', 2)}`,
  chassi: aleatorio('ABCDEFGHJKLMNPRSTUVWXYZ0123456789', 17),
  marca: 'Fiat',
  modelo: 'Uno',
  anoFabricacao: 2020,
  anoModelo: 2020,
  ...dados,
});

describe('auth', () => {
  it('faz login do admin, com e-mail em qualquer caixa', async () => {
    const { email } = await novaOficina('Auto Center Teste');
    expect((await entrar(email, 'errada')).res.statusCode).toBe(401);
    expect((await entrar(emailAleatorio())).res.statusCode).toBe(401);

    const login = await entrar(email.toUpperCase());
    expect(login.res.statusCode).toBe(200);
    expect(login.res.json()).toMatchObject({
      usuario: { admin: true, funcoes: [{ nome: 'Administrador' }] },
      oficina: { nome: 'Auto Center Teste' },
    });
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

describe('limite de tentativas de login', () => {
  const tentar = (email: string, senha: string, ip: string) =>
    app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha }, remoteAddress: ip });
  /** Simula a passagem do tempo: encerra bloqueios e janelas em aberto. */
  const passarTempo = () =>
    db.execute(
      sql`update login_tentativas set bloqueado_ate = null, janela_inicio = now() - interval '1 hour' where bloqueado_ate is not null`,
    );

  it('por e-mail: 5 erros bloqueiam a conta por um tempo, mesmo com a senha certa e de outro IP', async () => {
    const { email } = await novaOficina('Oficina Limite E-mail');
    const ip = '10.20.0.1';
    for (let i = 0; i < 4; i++) expect((await tentar(email, 'errada', ip)).statusCode).toBe(401);
    // Acertar antes do limite zera a contagem do e-mail.
    expect((await tentar(email, SENHA, ip)).statusCode).toBe(200);
    for (let i = 0; i < 5; i++) expect((await tentar(email, 'errada', ip)).statusCode).toBe(401);

    const bloqueado = await tentar(email, SENHA, ip);
    expect(bloqueado.statusCode).toBe(429);
    expect(bloqueado.json().erro).toBe('Muitas tentativas de login. Tente novamente em 15 minuto(s).');
    expect((await tentar(email.toUpperCase(), SENHA, '10.20.0.2')).statusCode).toBe(429);
    // O banco não guarda e-mail nem IP em claro.
    const chaves = (await db.execute(sql`select chave from login_tentativas`)) as unknown as { chave: string }[];
    expect(chaves.some((c) => c.chave.includes('@') || c.chave.includes('10.20'))).toBe(false);

    await passarTempo();
    expect((await tentar(email, SENHA, ip)).statusCode).toBe(200);
  });

  it('por IP: 20 erros bloqueiam o endereço, inclusive para outros e-mails (existentes ou não)', async () => {
    const { email } = await novaOficina('Oficina Limite IP');
    const ip = '10.20.1.1';
    for (let i = 0; i < 20; i++) expect((await tentar(emailAleatorio(), 'errada', ip)).statusCode).toBe(401);
    expect((await tentar(email, SENHA, ip)).statusCode).toBe(429);
    expect((await tentar(email, SENHA, '10.20.1.2')).statusCode).toBe(200);
    await passarTempo();
    expect((await tentar(email, SENHA, ip)).statusCode).toBe(200);
  });
});

describe('troca da própria senha', () => {
  it('exige a senha atual, recusa repetir a mesma e a nova passa a valer no login', async () => {
    const o = await novaOficina('Oficina Troca Senha');
    const trocar = (senhaAtual: string, novaSenha: string) =>
      o.chamar('POST', '/api/auth/senha', { senhaAtual, novaSenha });

    const errada = await trocar('errada', 'nova-senha-123');
    expect(errada.statusCode).toBe(400);
    expect(errada.json().erro).toBe('Senha atual incorreta.');
    expect((await trocar(SENHA, SENHA)).json().campos.novaSenha).toBe('A nova senha deve ser diferente da atual');
    expect((await trocar(SENHA, 'curta')).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/auth/senha', payload: {} })).statusCode).toBe(401);

    expect((await trocar(SENHA, 'nova-senha-123')).statusCode).toBe(204);
    expect((await entrar(o.email)).res.statusCode).toBe(401);
    expect((await entrar(o.email, 'nova-senha-123')).res.statusCode).toBe(200);
  });
});

describe('usuários', () => {
  it('admin cadastra usuário; senha fica só como hash Argon2id', async () => {
    const admin = await novaOficina('Oficina Usuários');
    const email = emailAleatorio();
    const criado = await admin.chamar('POST', '/api/usuarios', {
      nome: 'Pedro',
      email: ` ${email.toUpperCase()} `,
      funcoes: [await admin.funcao('Mecânico')],
      senha: SENHA,
    });
    expect(criado.statusCode).toBe(201);
    expect(criado.json()).toMatchObject({
      nome: 'Pedro',
      email,
      funcoes: [{ nome: 'Mecânico', ativa: true }],
      ativo: true,
    });
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
    const curta = await a.chamar('POST', '/api/usuarios', {
      nome: 'Ana',
      email: emailAleatorio(),
      funcoes: [await a.funcao('Atendente')],
      senha: '123',
    });
    expect(curta.statusCode).toBe(400);
    expect(curta.json().campos.senha).toBeDefined();
    expect(
      (
        await a.chamar('POST', '/api/usuarios', {
          nome: 'Ana',
          email: emailAleatorio(),
          funcoes: ['nao-e-uuid'],
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(400);

    const dup = await a.chamar('POST', '/api/usuarios', {
      nome: 'Ana',
      email: b.email,
      funcoes: [await a.funcao('Atendente')],
      senha: SENHA,
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().erro).toBe('Já existe uma conta com este e-mail');
  });

  it('só admin gerencia usuários', async () => {
    const admin = await novaOficina('Oficina Permissões');
    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', {
      nome: 'Atendente',
      email,
      funcoes: [await admin.funcao('Atendente')],
      senha: SENHA,
    });
    const atendente = await entrar(email);
    expect((await atendente.chamar('GET', '/api/usuarios')).statusCode).toBe(403);
    expect(
      (
        await atendente.chamar('POST', '/api/usuarios', {
          nome: 'Hacker',
          email: emailAleatorio(),
          funcoes: [await admin.funcao('Administrador')],
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(403);
    expect((await atendente.chamar('GET', '/api/clientes')).statusCode).toBe(200);
  });

  it('desativar ou trocar a senha vale na hora, inclusive para sessões abertas', async () => {
    const admin = await novaOficina('Oficina Desativação');
    const email = emailAleatorio();
    const { id } = (
      await admin.chamar('POST', '/api/usuarios', {
        nome: 'Carla',
        email,
        funcoes: [await admin.funcao('Financeiro')],
        senha: SENHA,
      })
    ).json();
    const carla = await entrar(email);
    expect((await carla.chamar('GET', '/api/clientes')).statusCode).toBe(200);

    const novaSenha = 'outra-senha-456';
    await admin.chamar('PUT', `/api/usuarios/${id}`, {
      nome: 'Carla',
      funcoes: [await admin.funcao('Financeiro')],
      ativo: true,
      novaSenha,
    });
    expect((await entrar(email)).res.statusCode).toBe(401);
    expect((await entrar(email, novaSenha)).res.statusCode).toBe(200);

    await admin.chamar('PUT', `/api/usuarios/${id}`, {
      nome: 'Carla',
      funcoes: [await admin.funcao('Financeiro')],
      ativo: false,
    });
    expect((await carla.chamar('GET', '/api/clientes')).statusCode).toBe(401);
    expect((await entrar(email, novaSenha)).res.statusCode).toBe(401);
  });

  it('admin não remove o próprio acesso', async () => {
    const admin = await novaOficina('Oficina Autoproteção');
    const { usuario } = (await admin.chamar('GET', '/api/auth/sessao')).json();
    expect(
      (
        await admin.chamar('PUT', `/api/usuarios/${usuario.id}`, {
          nome: 'Admin',
          funcoes: [await admin.funcao('Atendente')],
          ativo: true,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await admin.chamar('PUT', `/api/usuarios/${usuario.id}`, {
          nome: 'Admin',
          funcoes: [await admin.funcao('Administrador')],
          ativo: false,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await admin.chamar('PUT', `/api/usuarios/${usuario.id}`, {
          nome: 'Admin Renomeado',
          funcoes: [await admin.funcao('Administrador')],
          ativo: true,
        })
      ).statusCode,
    ).toBe(200);
  });

  it('admin de uma oficina não enxerga nem altera usuários de outra', async () => {
    const a = await novaOficina('Oficina Users A');
    const b = await novaOficina('Oficina Users B');
    const { usuario } = (await a.chamar('GET', '/api/auth/sessao')).json();
    expect((await b.chamar('GET', '/api/usuarios')).json().map((u: { email: string }) => u.email)).toEqual([b.email]);
    expect(
      (
        await b.chamar('PUT', `/api/usuarios/${usuario.id}`, {
          nome: 'Invasor',
          funcoes: [await b.funcao('Atendente')],
          ativo: false,
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('clientes e veículos', () => {
  it('valida documento, contato, endereço e placa', async () => {
    const { chamar } = await novaOficina('Oficina Validação');
    const cpf = await chamar('POST', '/api/clientes', cliente({ cpfCnpj: '123.456.789-00' }));
    expect(cpf.statusCode).toBe(400);
    expect(cpf.json().campos.cpfCnpj).toBe('CPF inválido');
    expect(
      (await chamar('POST', '/api/clientes', cliente({ cpfCnpj: '11.222.333/0001-81' }))).json().campos.cpfCnpj,
    ).toBe('Pessoa física: informe um CPF');
    const semEndereco = await chamar('POST', '/api/clientes', cliente({ enderecos: [] }));
    expect(semEndereco.statusCode).toBe(400);
    expect(semEndereco.json().campos.enderecos).toBe('Cadastre ao menos um endereço');
    expect((await chamar('POST', '/api/clientes', cliente({ whatsapp: '' }))).json().campos.whatsapp).toBeDefined();
    expect(
      (await chamar('POST', '/api/clientes', cliente({ enderecos: [{ ...ENDERECO, cep: '1' }] }))).json().campos[
        'enderecos.0.cep'
      ],
    ).toBe('CEP inválido');

    const criado = await chamar(
      'POST',
      '/api/clientes',
      cliente({ nome: 'João', cpfCnpj: '529.982.247-25', dataNascimento: '1990-05-01', sexo: 'masculino' }),
    );
    expect(criado.statusCode).toBe(201);
    const joao = criado.json();
    expect(joao).toMatchObject({
      cpfCnpj: '52998224725',
      telefone: '4832221000',
      whatsapp: '48999990000',
      dataNascimento: '1990-05-01',
      clienteDesde: '2024-01-10',
      ativo: true,
      pendencias: [],
      enderecos: [{ cep: '88015100', uf: 'SC', pais: 'Brasil', principal: true, faturamento: false }],
    });
    const dup = await chamar('POST', '/api/clientes', cliente({ cpfCnpj: '529.982.247-25' }));
    expect(dup.statusCode).toBe(409);

    expect((await chamar('POST', '/api/veiculos', veiculo(joao.id, { placa: 'XX-1' }))).statusCode).toBe(400);
    expect((await chamar('POST', '/api/veiculos', veiculo(joao.id, { chassi: '123' }))).statusCode).toBe(400);
    expect(
      (await chamar('POST', '/api/veiculos', veiculo(joao.id, { anoModelo: 2025 }))).json().campos.anoModelo,
    ).toBeDefined();
    const v = await chamar(
      'POST',
      '/api/veiculos',
      veiculo(joao.id, { placa: 'bra-2e19', chassi: '9bwzzz377vt004251', renavam: '63938648428', combustivel: 'flex' }),
    );
    expect(v.statusCode).toBe(201);
    expect(v.json()).toMatchObject({
      placa: 'BRA2E19',
      chassi: '9BWZZZ377VT004251',
      principal: true,
      status: 'ativo',
      ultimaVisita: null,
      pendencias: [],
    });
    expect((await chamar('POST', '/api/veiculos', veiculo(joao.id, { chassi: '9BWZZZ377VT004251' }))).json().erro).toBe(
      'Já existe um veículo com este chassi',
    );
    // Chassi é opcional (vários veículos sem chassi não colidem no índice único).
    expect((await chamar('POST', '/api/veiculos', veiculo(joao.id, { chassi: '' }))).json()).toMatchObject({
      chassi: null,
      principal: false,
      pendencias: [],
    });
    expect((await chamar('POST', '/api/veiculos', veiculo(joao.id, { chassi: '' }))).statusCode).toBe(201);

    const exclusao = await chamar('DELETE', `/api/clientes/${joao.id}`);
    expect(exclusao.statusCode).toBe(409);
    expect(exclusao.json().erro).toContain('tem veículos');
  });

  it('PJ: endereços com finalidades; edição regrava os endereços e mantém um principal', async () => {
    const { chamar } = await novaOficina('Oficina PJ');
    const cargos: { id: string; nome: string }[] = (await chamar('GET', '/api/opcoes/cargos')).json();
    const cargo = (nome: string) => cargos.find((c) => c.nome === nome)!.id;
    const CARLOS = {
      nome: 'Carlos Gestor',
      telefone: '(48) 99888-7777',
      telefoneWhatsapp: true,
      cargoId: cargo('Gestor de frota'),
    };
    const pjDados = (d: object) => cliente({ tipo: 'PJ', responsaveis: [CARLOS], ...d });

    // Responsável é obrigatório na PJ; o primeiro vira principal.
    const semResponsavel = await chamar(
      'POST',
      '/api/clientes',
      cliente({ tipo: 'PJ', cpfCnpj: '11.444.777/0001-61' }),
    );
    expect(semResponsavel.json().campos.responsaveis).toBe('Cadastre ao menos um responsável pela empresa');
    expect(
      (
        await chamar(
          'POST',
          '/api/clientes',
          pjDados({ cpfCnpj: '11.444.777/0001-61', responsaveis: [{ ...CARLOS, cargoId: '' }] }),
        )
      ).json().campos['responsaveis.0.cargoId'],
    ).toBeDefined();

    const pj = (
      await chamar(
        'POST',
        '/api/clientes',
        pjDados({
          nome: 'Transportes Exemplo Ltda',
          cpfCnpj: '11.222.333/0001-81',
          rgIe: 'ISENTO',
          enderecos: [
            { ...ENDERECO, tipo: 'comercial', faturamento: true, cobranca: true },
            { ...ENDERECO, tipo: 'outro', logradouro: 'Rodovia SC-401', principal: true, entrega: true },
          ],
        }),
      )
    ).json();
    expect(pj.responsaveis).toEqual([
      {
        id: expect.any(String),
        nome: 'Carlos Gestor',
        telefone: '48998887777',
        telefoneWhatsapp: true,
        email: null,
        cargoId: cargo('Gestor de frota'),
        cargoNome: 'Gestor de frota',
        principal: true,
      },
    ]);
    expect(pj.pendencias).toEqual([]);
    expect(
      pj.enderecos.map(
        (e: { logradouro: string; principal: boolean; faturamento: boolean; entrega: boolean; cobranca: boolean }) => [
          e.logradouro,
          e.principal,
          e.faturamento,
          e.entrega,
          e.cobranca,
        ],
      ),
    ).toEqual([
      ['Rodovia SC-401', true, false, true, false],
      ['Rua Felipe Schmidt', false, true, false, true],
    ]);
    const dois = await chamar(
      'PUT',
      `/api/clientes/${pj.id}`,
      pjDados({
        cpfCnpj: '11222333000181',
        enderecos: [ENDERECO, { ...ENDERECO, principal: true }, { ...ENDERECO, principal: true }],
      }),
    );
    expect(dois.json().campos.enderecos).toBe('Marque apenas um endereço como principal');

    // CNPJ alfanumérico: gravado sem pontuação, em maiúsculas; a busca acha com ou sem máscara.
    const alfa = await chamar(
      'POST',
      '/api/clientes',
      pjDados({ nome: 'Nova Empresa', cpfCnpj: '12.abc.345/01de-35' }),
    );
    expect(alfa.json().cpfCnpj).toBe('12ABC34501DE35');
    expect(
      (await chamar('GET', '/api/clientes?q=12.ABC.345')).json().itens.map((c: { nome: string }) => c.nome),
    ).toEqual(['Nova Empresa']);
    expect((await chamar('POST', '/api/clientes', pjDados({ cpfCnpj: '12ABC34501DE35' }))).json().erro).toBe(
      'Já existe um cliente com este CPF/CNPJ',
    );
    expect((await chamar('POST', '/api/clientes', pjDados({ cpfCnpj: '12ABC34501DE36' }))).json().campos.cpfCnpj).toBe(
      'CNPJ inválido',
    );

    const editado = (
      await chamar(
        'PUT',
        `/api/clientes/${pj.id}`,
        pjDados({ nome: 'Transportes Exemplo', cpfCnpj: '11222333000181', ativo: false }),
      )
    ).json();
    expect(editado).toMatchObject({
      nome: 'Transportes Exemplo',
      ativo: false,
      enderecos: [{ logradouro: 'Rua Felipe Schmidt', principal: true }],
    });
    expect(editado.enderecos).toHaveLength(1);

    // Vários responsáveis, um principal; função desativada continua valendo para quem já a usava.
    const motorista = {
      nome: 'Dani Motorista',
      telefone: '(48) 3222-0000',
      email: 'Dani@Empresa.com',
      cargoId: cargo('Motorista'),
      principal: true,
    };
    const dupla = (
      await chamar(
        'PUT',
        `/api/clientes/${pj.id}`,
        pjDados({ cpfCnpj: '11222333000181', responsaveis: [CARLOS, motorista] }),
      )
    ).json();
    expect(
      dupla.responsaveis.map((r: { nome: string; principal: boolean; email: string | null }) => [
        r.nome,
        r.principal,
        r.email,
      ]),
    ).toEqual([
      ['Dani Motorista', true, 'dani@empresa.com'],
      ['Carlos Gestor', false, null],
    ]);
    const admin = { chamar };
    await admin.chamar('PUT', `/api/opcoes/cargos/${cargo('Motorista')}`, { nome: 'Motorista', ativa: false });
    expect(
      (
        await chamar(
          'PUT',
          `/api/clientes/${pj.id}`,
          pjDados({ cpfCnpj: '11222333000181', responsaveis: [CARLOS, motorista] }),
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await chamar('POST', '/api/clientes', pjDados({ cpfCnpj: '11.444.777/0001-61', responsaveis: [motorista] })))
        .statusCode,
    ).toBe(400);
    expect(
      (await chamar('GET', '/api/opcoes/cargos')).json().find((c: { nome: string }) => c.nome === 'Motorista'),
    ).toMatchObject({ ativa: false, usos: 1 });

    // PF não guarda responsáveis.
    expect((await chamar('POST', '/api/clientes', cliente({ responsaveis: [CARLOS] }))).json().responsaveis).toEqual(
      [],
    );
  });

  it('listas de origem e relacionamento: editáveis pelo admin, só itens ativos na escolha', async () => {
    const admin = await novaOficina('Oficina Listas');
    const origens = (await admin.chamar('GET', '/api/opcoes/origens')).json();
    expect(origens.map((o: { nome: string }) => o.nome)).toEqual([
      'Campanha',
      'Concessionária',
      'Indicação',
      'Loja',
      'Site',
    ]);
    expect(
      (await admin.chamar('GET', '/api/opcoes/relacionamentos')).json().map((o: { nome: string }) => o.nome),
    ).toEqual(['Consumidor final', 'Empresa', 'Frota', 'Seguradora']);

    const whats = (await admin.chamar('POST', '/api/opcoes/origens', { nome: 'WhatsApp', ativa: true })).json();
    expect((await admin.chamar('POST', '/api/opcoes/origens', { nome: 'whatsapp', ativa: true })).json().erro).toBe(
      'Já existe um item com este nome',
    );
    const c = (await admin.chamar('POST', '/api/clientes', cliente({ origemId: whats.id }))).json();
    expect(c).toMatchObject({ origemId: whats.id, origemNome: 'WhatsApp' });

    // Desativado: some da escolha para clientes novos, mas quem já tinha mantém.
    const desativada = (
      await admin.chamar('PUT', `/api/opcoes/origens/${whats.id}`, { nome: 'WhatsApp', ativa: false })
    ).json();
    expect(desativada).toMatchObject({ ativa: false, usos: 1 });
    expect((await admin.chamar('POST', '/api/clientes', cliente({ origemId: whats.id }))).statusCode).toBe(400);
    expect(
      (await admin.chamar('PUT', `/api/clientes/${c.id}`, cliente({ cpfCnpj: c.cpfCnpj, origemId: whats.id })))
        .statusCode,
    ).toBe(200);

    // Outra oficina não usa os itens desta; só o admin altera as listas.
    const outra = await novaOficina('Outra Oficina Listas');
    expect((await outra.chamar('POST', '/api/clientes', cliente({ relacionamentoId: origens[0].id }))).statusCode).toBe(
      400,
    );
    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', {
      nome: 'Atendente',
      email,
      funcoes: [await admin.funcao('Atendente')],
      senha: SENHA,
    });
    const atendente = await entrar(email);
    expect((await atendente.chamar('GET', '/api/opcoes/origens')).statusCode).toBe(200);
    expect((await atendente.chamar('POST', '/api/opcoes/origens', { nome: 'Rádio', ativa: true })).statusCode).toBe(
      403,
    );
  });

  it('veículo principal, sugestões de marca/modelo e transferência para outro cliente', async () => {
    const { chamar } = await novaOficina('Oficina Frota');
    const ana = (await chamar('POST', '/api/clientes', cliente({ nome: 'Ana' }))).json();
    const bia = (await chamar('POST', '/api/clientes', cliente({ nome: 'Bia' }))).json();
    // Placas fixas: a busca de clientes também procura os dígitos do texto no telefone e no WhatsApp, e uma placa
    // aleatória com dígitos contidos em (48) 3222-1000 ou (48) 99999-0000 (ex.: ABC1D00) traria também a Bia.
    const gol = (
      await chamar('POST', '/api/veiculos', veiculo(ana.id, { placa: 'GOL1A23', marca: 'Volkswagen', modelo: 'Gol' }))
    ).json();
    const polo = (
      await chamar(
        'POST',
        '/api/veiculos',
        veiculo(ana.id, { placa: 'POL4B56', marca: 'Volkswagen', modelo: 'Polo', principal: true }),
      )
    ).json();
    const principais = async (id: string) =>
      (await chamar('GET', `/api/veiculos?clienteId=${id}`))
        .json()
        .map((v: { modelo: string; principal: boolean }) => `${v.modelo}${v.principal ? '*' : ''}`);
    expect(await principais(ana.id)).toEqual(['Polo*', 'Gol']);

    // Desmarcar o principal passa a vez a outro veículo do cliente.
    await chamar('PUT', `/api/veiculos/${polo.id}`, {
      ...veiculo(ana.id, { placa: polo.placa, chassi: polo.chassi, marca: 'Volkswagen', modelo: 'Polo' }),
      principal: false,
    });
    expect(await principais(ana.id)).toEqual(['Gol*', 'Polo']);

    expect((await chamar('GET', '/api/veiculos/sugestoes?marca=volkswagen')).json()).toEqual({
      marcas: ['Volkswagen'],
      modelos: ['Gol', 'Polo'],
    });

    // Lista com os veículos de cada cliente; a busca encontra o dono pela placa (com ou sem hífen).
    const busca = (
      await chamar(
        'GET',
        `/api/clientes?q=${encodeURIComponent(`${gol.placa.slice(0, 3)}-${gol.placa.slice(3)}`.toLowerCase())}`,
      )
    ).json();
    expect(busca.itens.map((c: { nome: string }) => c.nome)).toEqual(['Ana']);
    expect(busca.itens[0]).toMatchObject({ totalVeiculos: 2, veiculos: [{ modelo: 'Gol' }, { modelo: 'Polo' }] });

    // Venda para a Bia: mesmo registro, novo dono, volta a ativo.
    await chamar('PUT', `/api/veiculos/${gol.id}`, {
      ...veiculo(ana.id, { placa: gol.placa, chassi: gol.chassi, marca: 'Volkswagen', modelo: 'Gol' }),
      principal: true,
      status: 'vendido',
    });
    const transferido = await chamar('POST', `/api/veiculos/${gol.id}/transferir`, { clienteId: bia.id });
    expect(transferido.json()).toMatchObject({ id: gol.id, clienteId: bia.id, status: 'ativo', principal: true });
    expect(await principais(ana.id)).toEqual(['Polo*']);
    expect((await chamar('POST', `/api/veiculos/${gol.id}/transferir`, { clienteId: bia.id })).statusCode).toBe(400);
  });

  it('cadastros antigos aparecem como incompletos', async () => {
    const admin = await novaOficina('Oficina Legado');
    const { oficina } = (await admin.chamar('GET', '/api/auth/sessao')).json();
    const [antigo] = await withTenant(oficina.id, (tx) =>
      tx.execute(sql`insert into clientes (nome) values ('Cliente Antigo') returning id`),
    );
    const [empresa] = await withTenant(oficina.id, (tx) =>
      tx.execute(sql`insert into clientes (nome, tipo) values ('Empresa Antiga', 'PJ') returning id`),
    );
    expect((await admin.chamar('GET', `/api/clientes/${empresa!.id}`)).json().pendencias).toEqual([
      'CPF/CNPJ',
      'telefone',
      'WhatsApp',
      'endereço',
      'responsável',
    ]);
    await withTenant(oficina.id, (tx) =>
      tx.execute(
        sql`insert into veiculos (cliente_id, placa, marca, modelo, principal) values (${antigo!.id}, 'OLD1A23', 'Fiat', 'Uno', true)`,
      ),
    );
    expect((await admin.chamar('GET', `/api/clientes/${antigo!.id}`)).json().pendencias).toEqual([
      'CPF/CNPJ',
      'telefone',
      'WhatsApp',
      'endereço',
    ]);
    expect((await admin.chamar('GET', `/api/veiculos?clienteId=${antigo!.id}`)).json()[0].pendencias).toEqual([
      'ano de fabricação',
      'ano modelo',
    ]);
    const alertas = (await admin.chamar('GET', '/api/painel'))
      .json()
      .alertas.map((a: { mensagem: string }) => a.mensagem);
    expect(alertas).toEqual([
      '2 cliente(s) com cadastro incompleto: complete antes de abrir O.S.',
      '1 veículo(s) com cadastro incompleto (ano de fabricação ou modelo): complete antes de abrir O.S.',
      '1 cliente(s) sem veículo cadastrado.',
    ]);
  });
});

describe('lista de clientes: filtros, aniversários e frota', () => {
  /** Data de nascimento de alguém que faz aniversário daqui a `dias` dias (30 anos atrás). */
  const nascimento = (dias: number) => {
    const hoje = new Date(`${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}T00:00:00Z`);
    hoje.setUTCDate(hoje.getUTCDate() + dias);
    hoje.setUTCFullYear(hoje.getUTCFullYear() - 30);
    return hoje.toISOString().slice(0, 10);
  };

  it('filtra por status, tipo, período de "cliente desde", origem, relacionamento e aniversário', async () => {
    const { chamar } = await novaOficina('Oficina Filtros');
    const origens: { id: string; nome: string }[] = (await chamar('GET', '/api/opcoes/origens')).json();
    const relacoes: { id: string; nome: string }[] = (await chamar('GET', '/api/opcoes/relacionamentos')).json();
    const [origem] = origens;
    const [relacao] = relacoes;
    const criar = async (dados: object) => (await chamar('POST', '/api/clientes', cliente(dados))).json();
    const ana = await criar({ nome: 'Ana Hoje', dataNascimento: nascimento(0), clienteDesde: '2020-05-01' });
    await criar({
      nome: 'Beto Semana',
      dataNascimento: nascimento(3),
      clienteDesde: '2023-01-15',
      origemId: origem!.id,
    });
    await criar({
      nome: 'Caio Longe',
      dataNascimento: nascimento(40),
      relacionamentoId: relacao!.id,
      clienteDesde: '2019-03-01',
      ativo: false,
    });

    const nomes = async (filtro: Record<string, string>) =>
      (await chamar('GET', `/api/clientes?${new URLSearchParams(filtro)}`))
        .json()
        .itens.map((c: { nome: string }) => c.nome);

    expect(await nomes({})).toEqual(['Ana Hoje', 'Beto Semana', 'Caio Longe']);
    expect(await nomes({ ativo: 'true' })).toEqual(['Ana Hoje', 'Beto Semana']);
    expect(await nomes({ ativo: 'false' })).toEqual(['Caio Longe']);
    expect(await nomes({ tipo: 'PJ' })).toEqual([]);
    expect(await nomes({ desde: '2021-01-01', ate: '2023-12-31' })).toEqual(['Beto Semana']);
    expect(await nomes({ desde: '2023-01-15' })).toEqual(['Beto Semana']);
    expect(await nomes({ origemId: origem!.id })).toEqual(['Beto Semana']);
    expect(await nomes({ relacionamentoId: relacao!.id })).toEqual(['Caio Longe']);
    expect(await nomes({ aniversario: 'hoje' })).toEqual(['Ana Hoje']);
    expect(await nomes({ aniversario: 'semana' })).toEqual(['Ana Hoje', 'Beto Semana']);
    expect((await chamar('GET', '/api/clientes?desde=2024-01-01&ate=2023-01-01')).statusCode).toBe(400);

    // Ordenação pela coluna: cliente desde (mais recente primeiro) e nome decrescente; coluna fora da lista, 400.
    expect(await nomes({ ativo: '', ordenar: 'clienteDesde', direcao: 'desc' })).toEqual([
      'Beto Semana',
      'Ana Hoje',
      'Caio Longe',
    ]);
    expect(await nomes({ ativo: '', ordenar: 'nome', direcao: 'desc' })).toEqual([
      'Caio Longe',
      'Beto Semana',
      'Ana Hoje',
    ]);
    expect((await chamar('GET', '/api/clientes?ordenar=cpfCnpj')).statusCode).toBe(400);

    const [primeiro] = (await chamar('GET', '/api/clientes?aniversario=semana')).json().itens;
    expect(primeiro).toMatchObject({ nome: 'Ana Hoje', diasAteAniversario: 0, cidade: 'Florianópolis/SC' });
    expect((await chamar('GET', `/api/clientes/${ana.id}`)).json().diasAteAniversario).toBe(0);

    // Página inicial: aniversariantes ativos de hoje e da semana, o de hoje primeiro.
    const painel = (await chamar('GET', '/api/painel')).json();
    expect(painel.aniversariantes.map((a: { nome: string; dias: number }) => [a.nome, a.dias])).toEqual([
      ['Ana Hoje', 0],
      ['Beto Semana', 3],
    ]);
  });

  it('lista geral de veículos com busca pela placa, marca ou dono, paginada', async () => {
    const { chamar } = await novaOficina('Oficina Frota');
    const dono = (await chamar('POST', '/api/clientes', cliente({ nome: 'Dona Frota' }))).json();
    await chamar('POST', '/api/veiculos', veiculo(dono.id, { placa: 'FRT1A23', marca: 'Toyota', modelo: 'Corolla' }));
    await chamar('POST', '/api/veiculos', veiculo(dono.id, { placa: 'FRT2B34', marca: 'Fiat', modelo: 'Uno' }));

    const lista = (await chamar('GET', '/api/veiculos/lista?porPagina=1')).json();
    expect(lista.total).toBe(2);
    expect(lista.itens).toEqual([expect.objectContaining({ placa: 'FRT1A23', clienteNome: 'Dona Frota' })]);
    expect((await chamar('GET', '/api/veiculos/lista?q=frt-2b')).json().itens[0].placa).toBe('FRT2B34');
    expect((await chamar('GET', '/api/veiculos/lista?q=toyota')).json().total).toBe(1);
    expect((await chamar('GET', '/api/veiculos/lista?q=dona')).json().total).toBe(2);
    expect((await chamar('GET', '/api/veiculos/lista?status=vendido')).json().total).toBe(0);
  });
});

describe('importação de clientes por planilha', () => {
  const planilha = (...linhas: string[]) => `\uFEFF${linhas.join('\r\n')}\r\n`;
  const CABECALHO =
    'tipo;nome;cpf_cnpj;telefone;whatsapp;origem;cep;logradouro;numero;bairro;cidade;uf;' +
    'responsavel_nome;responsavel_funcao;responsavel_telefone';
  const endereco = '88015-100;Rua Felipe Schmidt;100;Centro;Florianópolis;SC';

  it('cria PF e PJ pelas regras do cadastro e relata cada linha inválida com a coluna', async () => {
    const { chamar } = await novaOficina('Oficina Importa Clientes');
    const importar = (texto: string) => chamar('POST', '/api/clientes/importar', texto, { 'content-type': 'text/csv' });
    const origem: string = (await chamar('GET', '/api/opcoes/origens')).json()[0].nome;
    const funcao: string = (await chamar('GET', '/api/opcoes/cargos')).json()[0].nome;
    const cpf = cpfAleatorio();

    const resultado = (
      await importar(
        planilha(
          CABECALHO,
          `PF;Ana Importada;${cpf};(48) 3222-1000;(48) 99999-0000;${origem.toUpperCase()};${endereco};;;`,
          `pj;Auto Peças Ltda;11.222.333/0001-81;4832221000;48999990000;;${endereco};Carlos;${funcao};48999991111`,
          `PF;CPF Errado;111.111.111-11;4832221000;48999990000;;${endereco};;;`,
          `PJ;Sem Responsável;11.444.777/0001-61;4832221000;48999990000;;${endereco};;;`,
          `PF;Ana Repetida;${cpf};4832221000;48999990000;;${endereco};;;`,
          `PF;Origem Errada;${cpfAleatorio()};4832221000;48999990000;Rádio;${endereco};;;`,
          `PF;Sem CEP;${cpfAleatorio()};4832221000;48999990000;;;Rua A;1;Centro;Florianópolis;SC;;;`,
        ),
      )
    ).json();
    expect(resultado).toMatchObject({ linhas: 7, importadas: 2, ignoradas: 0 });
    expect(resultado.erros).toEqual([
      { linha: 4, mensagem: 'cpf_cnpj: CPF inválido' },
      { linha: 5, mensagem: 'responsavel_nome: Cadastre ao menos um responsável pela empresa' },
      { linha: 6, mensagem: `CPF/CNPJ ${cpf} repetido na planilha (já aparece na linha 2).` },
      { linha: 7, mensagem: 'origem: "Rádio" não está na lista (Configurações → Origem do cliente).' },
      { linha: 8, mensagem: 'cep: Informe o CEP' },
    ]);

    const [ana] = (await chamar('GET', `/api/clientes?q=${cpf}`)).json().itens;
    const detalhe = (await chamar('GET', `/api/clientes/${ana.id}`)).json();
    expect(detalhe).toMatchObject({
      nome: 'Ana Importada',
      origemNome: origem,
      enderecos: [{ cep: '88015100', principal: true, tipo: 'residencial' }],
    });
    const [pj] = (await chamar('GET', '/api/clientes?q=Auto Peças')).json().itens;
    expect((await chamar('GET', `/api/clientes/${pj.id}`)).json().responsaveis).toMatchObject([
      { nome: 'Carlos', cargoNome: funcao, principal: true },
    ]);
  });

  it('CPF/CNPJ já cadastrado atualiza o cliente sem perder os outros endereços nem as colunas ausentes', async () => {
    const { chamar } = await novaOficina('Oficina Atualiza Clientes');
    const cpf = cpfAleatorio();
    const segundo = { ...ENDERECO, logradouro: 'Rua Secundária', principal: false };
    await chamar(
      'POST',
      '/api/clientes',
      cliente({
        nome: 'Nome Antigo',
        cpfCnpj: cpf,
        email: 'antigo@teste.dev',
        enderecos: [{ ...ENDERECO, principal: true }, segundo],
      }),
    );

    const resultado = await chamar(
      'POST',
      '/api/clientes/importar',
      planilha(
        'tipo;nome;cpf_cnpj;telefone;whatsapp;cep;logradouro;numero;bairro;cidade;uf',
        `PF;Nome Novo;${cpf};4832221000;48999990000;01310-100;Avenida Paulista;1000;Bela Vista;São Paulo;SP`,
      ),
      { 'content-type': 'text/csv' },
    );
    expect(resultado.json()).toMatchObject({ importadas: 1, erros: [] });
    const [c] = (await chamar('GET', `/api/clientes?q=${cpf}`)).json().itens;
    const detalhe = (await chamar('GET', `/api/clientes/${c.id}`)).json();
    expect(detalhe.nome).toBe('Nome Novo');
    expect(detalhe.email).toBe('antigo@teste.dev'); // coluna ausente: mantém
    expect(
      detalhe.enderecos.map((e: { logradouro: string; principal: boolean }) => [e.logradouro, e.principal]),
    ).toEqual([
      ['Avenida Paulista', true],
      ['Rua Secundária', false],
    ]);
  });
});

describe('personas e permissões', () => {
  it('cada função acessa só o que lhe cabe (docs/ENTREGAVEIS.md §1)', async () => {
    const admin = await novaOficina('Oficina Personas');
    const pessoa = async (funcao: string) => {
      const email = emailAleatorio();
      await admin.chamar('POST', '/api/usuarios', {
        nome: funcao,
        email,
        funcoes: [await admin.funcao(funcao)],
        senha: SENHA,
      });
      return entrar(email);
    };
    const [atendente, mecanico, financeiro] = [
      await pessoa('Atendente'),
      await pessoa('Mecânico'),
      await pessoa('Financeiro'),
    ];
    const indicadores = async (s: Awaited<ReturnType<typeof entrar>>) =>
      (await s.chamar('GET', '/api/painel')).json().indicadores.map((i: { id: string }) => i.id);

    // Atendente: cadastra clientes e veículos (abre O.S. e vende no balcão); sem relatórios e configurações.
    const balcao = await atendente.chamar('POST', '/api/clientes', cliente({ nome: 'Cliente do Balcão' }));
    expect(balcao.statusCode).toBe(201);
    expect((await atendente.chamar('POST', '/api/veiculos', veiculo(balcao.json().id))).statusCode).toBe(201);
    expect((await atendente.chamar('GET', '/api/relatorios')).statusCode).toBe(403);
    expect((await atendente.chamar('GET', '/api/usuarios')).statusCode).toBe(403);
    expect((await atendente.chamar('PUT', '/api/configuracoes/aparencia', TEMA_VAZIO)).statusCode).toBe(403);
    expect(await indicadores(atendente)).not.toContain('faturamento');

    // Mecânico: consulta clientes/veículos, não cadastra nem altera; sem relatórios e faturamento.
    expect((await mecanico.chamar('GET', '/api/clientes')).statusCode).toBe(200);
    expect((await mecanico.chamar('GET', `/api/veiculos?clienteId=${balcao.json().id}`)).json()).toHaveLength(1);
    expect((await mecanico.chamar('POST', '/api/clientes', { nome: 'Não pode' })).statusCode).toBe(403);
    expect((await mecanico.chamar('PUT', `/api/clientes/${balcao.json().id}`, { nome: 'Não pode' })).statusCode).toBe(
      403,
    );
    expect(
      (
        await mecanico.chamar('POST', '/api/veiculos', {
          clienteId: balcao.json().id,
          placa: 'MEC1A00',
          marca: 'VW',
          modelo: 'Gol',
        })
      ).statusCode,
    ).toBe(403);
    expect((await mecanico.chamar('GET', '/api/relatorios')).statusCode).toBe(403);
    expect(await indicadores(mecanico)).not.toContain('faturamento');

    // Financeiro: relatórios e faturamento; consulta cadastros sem alterar.
    expect((await financeiro.chamar('GET', '/api/relatorios/clientes')).statusCode).toBe(200);
    expect((await financeiro.chamar('DELETE', `/api/clientes/${balcao.json().id}`)).statusCode).toBe(403);
    expect(await indicadores(financeiro)).toContain('faturamento');

    // Admin: tudo.
    expect(await indicadores(admin)).toContain('faturamento');
    expect((await admin.chamar('GET', '/api/relatorios')).json()).toHaveLength(3);
  });
});

describe('funções e permissões configuráveis', () => {
  const acessos = (a: Partial<Record<string, string | null>> = {}) => ({
    clientes: null,
    orcamentos: null,
    aprovar_orcamentos: null,
    aprovacao_comercial: null,
    os: null,
    pecas_os: null,
    materiais: null,
    servicos: null,
    precos: null,
    custos: null,
    estoque: null,
    recebimentos: null,
    financeiro: null,
    relatorios: null,
    ...a,
  });

  it('toda oficina nasce com Administrador fixo e as funções padrão aprovadas', async () => {
    const admin = await novaOficina('Oficina Funções Padrão');
    const lista = (await admin.chamar('GET', '/api/funcoes')).json();
    expect(lista.map((f: { nome: string; admin: boolean }) => [f.nome, f.admin])).toEqual([
      ['Administrador', true],
      ['Almoxarife', false],
      ['Atendente', false],
      ['Financeiro', false],
      ['Mecânico', false],
    ]);
    const porNome = Object.fromEntries(lista.map((f: { nome: string }) => [f.nome, f]));
    expect(porNome.Administrador.acessos).toEqual(
      acessos({
        clientes: 'editar',
        orcamentos: 'editar',
        aprovar_orcamentos: 'editar',
        aprovacao_comercial: 'editar',
        os: 'editar',
        pecas_os: 'editar',
        materiais: 'editar',
        servicos: 'editar',
        precos: 'editar',
        custos: 'editar',
        estoque: 'editar',
        recebimentos: 'editar',
        financeiro: 'editar',
        relatorios: 'consultar',
      }),
    );
    expect(porNome.Atendente.acessos).toEqual(
      acessos({
        clientes: 'editar',
        orcamentos: 'editar',
        aprovar_orcamentos: 'editar',
        os: 'editar',
        pecas_os: 'editar',
        materiais: 'consultar',
        servicos: 'consultar',
        precos: 'consultar',
        estoque: 'editar',
        recebimentos: 'editar',
      }),
    );
    expect(porNome['Mecânico'].acessos).toEqual(
      acessos({
        clientes: 'consultar',
        orcamentos: 'consultar',
        os: 'editar',
        materiais: 'consultar',
        servicos: 'consultar',
        estoque: 'consultar',
      }),
    );
    // Almoxarife: adiciona peças pela O.S. aberta; só consulta clientes, veículos, O.S. e estoque.
    expect(porNome.Almoxarife.acessos).toEqual(
      acessos({
        clientes: 'consultar',
        orcamentos: 'consultar',
        os: 'consultar',
        pecas_os: 'editar',
        materiais: 'editar',
        servicos: 'consultar',
        precos: 'consultar',
        estoque: 'consultar',
      }),
    );
    // Pagamento: só quem tem Recebimentos (Atendente e Financeiro); o Mecânico não.
    expect(porNome.Financeiro.acessos).toEqual(
      acessos({
        clientes: 'consultar',
        orcamentos: 'editar',
        aprovar_orcamentos: 'editar',
        os: 'consultar',
        materiais: 'consultar',
        servicos: 'editar',
        precos: 'editar',
        recebimentos: 'editar',
        financeiro: 'editar',
        relatorios: 'consultar',
      }),
    );
    expect(porNome.Administrador.usuarios).toBe(1);
    expect(porNome.Almoxarife.usuarios).toBe(0);
  });

  it('admin cria função; mudanças de nível valem na hora para quem já está logado', async () => {
    const admin = await novaOficina('Oficina Função Nova');
    const criada = await admin.chamar('POST', '/api/funcoes', {
      nome: 'Estagiário',
      ativa: true,
      acessos: acessos({ clientes: 'consultar' }),
    });
    expect(criada.statusCode).toBe(201);
    const almox = criada.json();

    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', { nome: 'Estagiário', email, funcoes: [almox.id], senha: SENHA });
    const usuario = await entrar(email);
    expect(usuario.res.json().acessos).toEqual(acessos({ clientes: 'consultar' }));
    expect((await usuario.chamar('POST', '/api/clientes', { nome: 'Não pode' })).statusCode).toBe(403);
    expect((await usuario.chamar('GET', '/api/relatorios')).statusCode).toBe(403);

    await admin.chamar('PUT', `/api/funcoes/${almox.id}`, {
      nome: 'Estagiário',
      ativa: true,
      acessos: acessos({ clientes: 'editar', relatorios: 'consultar' }),
    });
    expect((await usuario.chamar('POST', '/api/clientes', cliente({ nome: 'Agora pode' }))).statusCode).toBe(201);
    expect((await usuario.chamar('GET', '/api/relatorios')).statusCode).toBe(200);
    expect((await usuario.chamar('GET', '/api/auth/sessao')).json().acessos.clientes).toBe('editar');
  });

  it('relatórios de clientes e veículos exigem também acesso a Clientes e veículos', async () => {
    const admin = await novaOficina('Oficina Relatório Restrito');
    const funcao = (
      await admin.chamar('POST', '/api/funcoes', {
        nome: 'Só relatórios',
        ativa: true,
        acessos: acessos({ relatorios: 'consultar' }),
      })
    ).json();
    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', { nome: 'Analista', email, funcoes: [funcao.id], senha: SENHA });
    const analista = await entrar(email);

    expect((await analista.chamar('GET', '/api/relatorios')).json()).toEqual([]);
    expect((await analista.chamar('GET', '/api/relatorios/clientes')).statusCode).toBe(403);
    expect((await analista.chamar('GET', '/api/relatorios/veiculos/csv')).statusCode).toBe(403);

    await admin.chamar('PUT', `/api/funcoes/${funcao.id}`, {
      nome: 'Só relatórios',
      ativa: true,
      acessos: acessos({ relatorios: 'consultar', clientes: 'consultar' }),
    });
    const ids = (await analista.chamar('GET', '/api/relatorios')).json().map((r: { id: string }) => r.id);
    expect(ids).toEqual(['clientes', 'veiculos']);
    expect((await analista.chamar('GET', '/api/relatorios/clientes')).statusCode).toBe(200);
  });

  it('várias funções somam o maior nível de cada módulo', async () => {
    const admin = await novaOficina('Oficina Multi');
    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', {
      nome: 'Dupla',
      email,
      funcoes: [await admin.funcao('Mecânico'), await admin.funcao('Financeiro')],
      senha: SENHA,
    });
    const dupla = await entrar(email);
    expect(dupla.res.json().acessos).toEqual(
      acessos({
        clientes: 'consultar',
        orcamentos: 'editar', // Mecânico consulta, Financeiro edita: vale o maior
        aprovar_orcamentos: 'editar',
        os: 'editar',
        materiais: 'consultar',
        servicos: 'editar', // Mecânico consulta, Financeiro edita: vale o maior
        precos: 'editar',
        estoque: 'consultar',
        recebimentos: 'editar',
        financeiro: 'editar',
        relatorios: 'consultar',
      }),
    );
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
    await admin.chamar('PUT', `/api/funcoes/${idFin}`, {
      nome: 'Financeiro',
      ativa: false,
      acessos: financeiro.acessos,
    });
    expect((await fin.chamar('GET', '/api/relatorios')).statusCode).toBe(403);
    expect((await fin.chamar('GET', '/api/auth/sessao')).json()).toMatchObject({
      acessos: acessos(),
      usuario: { funcoes: [] },
    });
    // Função desativada não pode ser atribuída a ninguém.
    expect(
      (
        await admin.chamar('POST', '/api/usuarios', {
          nome: 'X',
          email: emailAleatorio(),
          funcoes: [idFin],
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(400);

    await admin.chamar('PUT', `/api/funcoes/${idFin}`, {
      nome: 'Financeiro',
      ativa: true,
      acessos: financeiro.acessos,
    });
    expect((await fin.chamar('GET', '/api/relatorios')).statusCode).toBe(200);
  });

  it('Administrador é fixo, nomes são únicos e níveis precisam existir no módulo', async () => {
    const admin = await novaOficina('Oficina Regras Função');
    const idAdmin = await admin.funcao('Administrador');
    expect(
      (await admin.chamar('PUT', `/api/funcoes/${idAdmin}`, { nome: 'Chefe', ativa: true, acessos: acessos() }))
        .statusCode,
    ).toBe(400);
    const dup = await admin.chamar('POST', '/api/funcoes', { nome: 'atendente', ativa: true, acessos: acessos() });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().erro).toBe('Já existe uma função com este nome');
    expect(
      (
        await admin.chamar('POST', '/api/funcoes', {
          nome: 'Gerente',
          ativa: true,
          acessos: acessos({ relatorios: 'editar' }),
        })
      ).statusCode,
    ).toBe(400);
  });

  it('só o Administrador gerencia funções, e uma oficina não vê as funções de outra', async () => {
    const a = await novaOficina('Oficina Funções A');
    const b = await novaOficina('Oficina Funções B');
    const email = emailAleatorio();
    await a.chamar('POST', '/api/usuarios', {
      nome: 'Atendente',
      email,
      funcoes: [await a.funcao('Atendente')],
      senha: SENHA,
    });
    const atendente = await entrar(email);
    expect((await atendente.chamar('GET', '/api/funcoes')).statusCode).toBe(403);
    expect(
      (await atendente.chamar('POST', '/api/funcoes', { nome: 'Hack', ativa: true, acessos: acessos() })).statusCode,
    ).toBe(403);

    const idAtendenteA = await a.funcao('Atendente');
    expect(
      (await b.chamar('PUT', `/api/funcoes/${idAtendenteA}`, { nome: 'Invasão', ativa: false, acessos: acessos() }))
        .statusCode,
    ).toBe(404);
    // Atribuir a um usuário da B uma função da A é recusado.
    expect(
      (
        await b.chamar('POST', '/api/usuarios', {
          nome: 'X',
          email: emailAleatorio(),
          funcoes: [idAtendenteA],
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('aparência', () => {
  it('admin define cores e botões; todos recebem o tema na sessão; outros papéis não alteram', async () => {
    const admin = await novaOficina('Oficina Cores');
    expect((await admin.chamar('GET', '/api/auth/sessao')).json().oficina.tema).toEqual(TEMA_VAZIO);

    const tema = {
      ...TEMA_VAZIO,
      corPrimaria: '#C2410C',
      corMenu: '#1E293B',
      corBotaoPrimario: '#15803D',
      corBotaoSecundario: '#F1F5F9',
      corBotaoSecundarioTexto: '#0F172A',
    };
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
    expect(
      (await admin.chamar('PUT', '/api/configuracoes/aparencia', { ...tema, corBotaoPrimarioTexto: '#FFFFFF' })).json()
        .corBotaoPrimarioTexto,
    ).toBe('#ffffff');
    expect(
      (await admin.chamar('PUT', '/api/configuracoes/aparencia', { ...TEMA_VAZIO, corPrimaria: 'laranja' })).statusCode,
    ).toBe(400);

    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', {
      nome: 'Mecânico',
      email,
      funcoes: [await admin.funcao('Mecânico')],
      senha: SENHA,
    });
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
    expect(res.json()).toEqual({
      oficinaId: oficina.id,
      nome: 'Oficina Pública',
      tema: { ...TEMA_VAZIO, corPrimaria: '#7c3aed' },
      logoVersao: null,
    });
    expect((await app.inject({ method: 'GET', url: `/api/publico/logo?oficina=${oficina.id}` })).statusCode).toBe(404);

    // Várias oficinas no banco e nenhuma indicada: tema padrão, sem vazar nomes.
    const semParametro = (await app.inject({ method: 'GET', url: '/api/publico/aparencia' })).json();
    expect(semParametro).toEqual({ oficinaId: null, nome: null, tema: TEMA_VAZIO, logoVersao: null });
    expect(
      (await app.inject({ method: 'GET', url: '/api/publico/aparencia?oficina=nao-e-uuid' })).json().nome,
    ).toBeNull();
    expect(
      (await app.inject({ method: 'GET', url: `/api/publico/aparencia?oficina=${randomUUID()}` })).json().nome,
    ).toBeNull();
  });
});

describe('logo da oficina', () => {
  // PNG 1x1 válido.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
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
    await admin.chamar('POST', '/api/usuarios', {
      nome: 'Mecânico',
      email,
      funcoes: [await admin.funcao('Mecânico')],
      senha: SENHA,
    });
    const mecanico = await entrar(email);
    const logo = await mecanico.chamar('GET', '/api/configuracoes/logo');
    expect(logo.statusCode).toBe(200);
    expect(logo.headers['content-type']).toBe('image/png');
    expect(logo.rawPayload.equals(png)).toBe(true);
    expect(
      (
        await mecanico.chamar('GET', '/api/configuracoes/logo', undefined, {
          'if-none-match': logo.headers.etag as string,
        })
      ).statusCode,
    ).toBe(304);
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
      ['clientes', 0],
      ['veiculos', 0],
      ['orcamentos', 0],
      ['valor_aprovado', 0],
      ['ticket_medio', 0],
      ['taxa_aprovacao', null],
      ['os_abertas', null],
      ['faturamento', null],
    ]);
    expect(vazio.periodo.id).toBe('mes');
    expect(vazio.orcamentosPorSituacao).toEqual([]);
    expect(vazio.alertas).toEqual([]);

    const c = (await a.chamar('POST', '/api/clientes', cliente({ nome: 'Com Veículo' }))).json();
    await a.chamar('POST', '/api/clientes', cliente({ nome: 'Sem Veículo' }));
    await a.chamar('POST', '/api/veiculos', veiculo(c.id));

    const painel = (await a.chamar('GET', '/api/painel')).json();
    const porId = Object.fromEntries(painel.indicadores.map((i: { id: string }) => [i.id, i]));
    expect(porId.clientes).toMatchObject({ valor: 2, detalhe: '2 novo(s) no período' });
    expect(porId.veiculos).toMatchObject({ valor: 1, detalhe: '1 novo(s) no período' });
    // Sem nada no período anterior, não há base para a variação.
    expect(porId.clientes.variacao).toBeNull();
    expect((await a.chamar('GET', '/api/painel?periodo=hoje')).json().periodo.inicio).toBe(
      (await a.chamar('GET', '/api/painel?periodo=hoje')).json().periodo.fim,
    );
    expect((await a.chamar('GET', '/api/painel?periodo=ano')).statusCode).toBe(400);
    expect(painel.alertas.map((x: { mensagem: string }) => x.mensagem)).toEqual([
      '1 cliente(s) sem veículo cadastrado.',
    ]);

    const b = await novaOficina('Outra Oficina Painel');
    expect((await b.chamar('GET', '/api/painel')).json().indicadores[0]).toMatchObject({ id: 'clientes', valor: 0 });
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
      const { id } = (
        await admin.chamar('POST', '/api/usuarios', {
          nome,
          email,
          funcoes: [await admin.funcao('Mecânico')],
          senha: SENHA,
        })
      ).json();
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
    const c = (
      await admin.chamar(
        'POST',
        '/api/clientes',
        cliente({ nome: 'Maria; Silva', cpfCnpj: '529.982.247-25', rgIe: '=1+1' }),
      )
    ).json();
    await admin.chamar(
      'POST',
      '/api/veiculos',
      veiculo(c.id, { placa: 'ABC1234', chassi: '9BWZZZ377VT004251', marca: 'VW', modelo: 'Gol', kmAtual: 125000 }),
    );

    const ids = (await admin.chamar('GET', '/api/relatorios')).json().map((r: { id: string }) => r.id);
    expect(ids).toEqual(['clientes', 'veiculos', 'usuarios']);

    const previa = (await admin.chamar('GET', '/api/relatorios/clientes')).json();
    expect(previa.total).toBe(1);
    expect(previa.linhas[0]).toMatchObject({
      nome: 'Maria; Silva',
      documento: '529.982.247-25',
      veiculos: '1',
      tipo: 'Pessoa física',
      whatsapp: '(48) 99999-0000',
      endereco: 'Rua Felipe Schmidt, 100 - Centro - 88015-100',
      cidade: 'Florianópolis/SC',
      clienteDesde: '10/01/2024',
      status: 'Ativo',
      pendencias: '',
    });
    expect((await admin.chamar('GET', '/api/relatorios/clientes/csv')).rawPayload.toString('utf8')).toContain(
      ";'=1+1;",
    );

    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    expect((await admin.chamar('GET', `/api/relatorios/clientes?de=${hoje}&ate=${hoje}`)).json().total).toBe(1);
    expect((await admin.chamar('GET', '/api/relatorios/clientes?ate=2000-01-01')).json().total).toBe(0);
    expect((await admin.chamar('GET', '/api/relatorios/clientes?de=2030-01-02&ate=2030-01-01')).statusCode).toBe(400);

    const csv = await admin.chamar('GET', '/api/relatorios/veiculos/csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toMatch(/attachment; filename="veiculos-\d{4}-\d{2}-\d{2}\.csv"/);
    const texto = csv.rawPayload.toString('utf8');
    expect(texto.startsWith('\uFEFFPlaca;Marca;')).toBe(true);
    expect(texto).toContain(
      'ABC-1234;VW;Gol;;2020;2020;;;125.000;9BWZZZ377VT004251;;Ativo;Sim;;"Maria; Silva";(48) 99999-0000;;',
    );
  });

  it('respeita a função e o isolamento por oficina', async () => {
    const a = await novaOficina('Oficina Rel A');
    const b = await novaOficina('Oficina Rel B');
    await a.chamar('POST', '/api/clientes', cliente({ nome: 'Cliente Secreto da A' }));
    expect((await b.chamar('GET', '/api/relatorios/clientes')).json().total).toBe(0);
    expect((await b.chamar('GET', '/api/relatorios/clientes/csv')).rawPayload.toString()).not.toContain('Secreto');

    const email = emailAleatorio();
    await a.chamar('POST', '/api/usuarios', {
      nome: 'Financeiro',
      email,
      funcoes: [await a.funcao('Financeiro')],
      senha: SENHA,
    });
    const financeiro = await entrar(email);
    expect((await financeiro.chamar('GET', '/api/relatorios')).json().map((r: { id: string }) => r.id)).toEqual([
      'clientes',
      'veiculos',
    ]);
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

    const clienteA = (await a.chamar('POST', '/api/clientes', cliente({ nome: 'Cliente da A' }))).json();

    expect((await b.chamar('GET', '/api/clientes')).json()).toEqual({ itens: [], total: 0 });
    expect((await b.chamar('GET', `/api/clientes/${clienteA.id}`)).statusCode).toBe(404);
    expect((await b.chamar('PUT', `/api/clientes/${clienteA.id}`, cliente({ nome: 'Invadido' }))).statusCode).toBe(404);
    expect((await b.chamar('DELETE', `/api/clientes/${clienteA.id}`)).statusCode).toBe(404);

    // FK composta impede vincular um veículo ao cliente de outra oficina.
    const invasao = await b.chamar('POST', '/api/veiculos', veiculo(clienteA.id));
    expect(invasao.statusCode).toBe(409);

    const listaA = (await a.chamar('GET', '/api/clientes')).json();
    expect(listaA.itens.map((c: { nome: string }) => c.nome)).toEqual(['Cliente da A']);
  });

  it('sem tenant definido, o banco não devolve nenhuma linha', async () => {
    for (const tabela of [
      'clientes',
      'veiculos',
      'users',
      'tenant_logos',
      'tenant_aparencia',
      'funcoes',
      'funcao_permissoes',
      'usuario_funcoes',
      'usuario_fotos',
      'cliente_enderecos',
      'origens_cliente',
      'relacionamentos_cliente',
      'cliente_responsaveis',
      'cargos_responsavel',
      'tipos_material',
      'tipos_deposito',
      'categorias',
      'marcas',
      'materiais',
      'depositos',
      'tabelas_preco',
      'materiais_precos',
      'precos_eventos',
      'estoques',
      'estoque_ajustes',
      'precos_padrao',
      'precos_padrao_eventos',
      'servicos',
      'classificacoes_servico',
      'orcamentos',
      'orcamento_itens',
      'orcamentos_eventos',
      'alcadas_desconto',
      'alcadas_desconto_eventos',
      'aprovacoes_comerciais',
      'aprovacoes_comerciais_eventos',
      'materiais_pmc_eventos',
    ]) {
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
