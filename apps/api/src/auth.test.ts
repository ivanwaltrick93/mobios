import { TEMA_VAZIO } from '@mobios/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from './db/client.js';
import { app, cliente, emailAleatorio, entrar, novaOficina, SENHA, veiculo } from './testes/apoio.js';

// Autenticação, usuários, funções e permissões.

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
