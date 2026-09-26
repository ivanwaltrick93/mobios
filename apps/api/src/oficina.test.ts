import { randomUUID } from 'node:crypto';
import { hojeIso, somarDias, TEMA_VAZIO } from '@mobios/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTenant } from './db/client.js';
import { app, cliente, emailAleatorio, entrar, esquecerPainel, novaOficina, SENHA, veiculo } from './testes/apoio.js';

// Oficina: aparência, marca pública, logo, painel, fotos da equipe e relatórios; e a saúde da API.

describe('saúde da API', () => {
  it('vida: responde sem login e sem depender do banco', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/vivo' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('prontidão: responde pronta, sem login, quando o banco responde', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/saude' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
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

    await esquecerPainel(a.chamar);
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

    // Aniversariantes da semana, pelo índice (coluna aniversario): hoje e daqui a 3 dias entram; daqui a 10, não.
    const nascido = (dias: number) => `1992${somarDias(hojeIso(), dias).slice(4)}`;
    await a.chamar('POST', '/api/clientes', cliente({ nome: 'Faz Anos em 3 Dias', dataNascimento: nascido(3) }));
    await a.chamar('POST', '/api/clientes', cliente({ nome: 'Faz Anos Hoje', dataNascimento: nascido(0) }));
    await a.chamar('POST', '/api/clientes', cliente({ nome: 'Faz Anos em 10 Dias', dataNascimento: nascido(10) }));
    // Cadastro antigo sem WhatsApp: conta como incompleto.
    const tenant = (await a.chamar('GET', '/api/auth/sessao')).json().oficina.id;
    await withTenant(tenant, (tx) => tx.execute(sql`update clientes set whatsapp = null where id = ${c.id}`));
    await esquecerPainel(a.chamar);
    const depois = (await a.chamar('GET', '/api/painel')).json();
    expect(depois.aniversariantes.map((x: { nome: string; dias: number }) => [x.nome, x.dias])).toEqual([
      ['Faz Anos Hoje', 0],
      ['Faz Anos em 3 Dias', 3],
    ]);
    expect(depois.alertas.map((x: { mensagem: string }) => x.mensagem)).toEqual([
      '1 cliente(s) com cadastro incompleto: complete antes de abrir O.S.',
      '4 cliente(s) sem veículo cadastrado.',
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
