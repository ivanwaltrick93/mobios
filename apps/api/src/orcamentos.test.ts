import { randomUUID } from 'node:crypto';
import { hojeIso, somarDias } from '@mobios/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from './app.js';
import { db, sqlClient, withTenant } from './db/client.js';
import { criarOficinaComAdmin } from './db/admin-inicial.js';
import { COOKIE_SESSAO } from './lib/auth.js';

// Orçamentos (docs/modulos/ORCAMENTOS.md) e a tabela de preço padrão. Mesmo esquema de app.test.ts.
let app: Awaited<ReturnType<typeof criarApp>>;
beforeAll(async () => {
  app = await criarApp();
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const SENHA = 'senha-segura-123';
type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function entrar(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: SENHA } });
  const token = res.cookies.find((c) => c.name === COOKIE_SESSAO)!.value;
  return (method: Metodo, url: string, payload?: object) =>
    app.inject({ method, url, payload, cookies: { [COOKIE_SESSAO]: token } });
}
type Chamar = Awaited<ReturnType<typeof entrar>>;

const hoje = hojeIso();

async function novaOficina(nome: string) {
  const email = `${randomUUID()}@teste.dev`;
  const { tenant } = await criarOficinaComAdmin(db, { oficina: nome, nome: 'Admin Teste', email, senha: SENHA });
  const chamar = await entrar(email);
  const tid = tenant.id;
  /** Usuário com uma função padrão (já logado). */
  const pessoa = async (funcao: string) => {
    const funcoes = (await chamar('GET', '/api/funcoes')).json() as { id: string; nome: string }[];
    const e = `${randomUUID()}@teste.dev`;
    const usuario = (
      await chamar('POST', '/api/usuarios', {
        nome: `${funcao} ${e.slice(0, 4)}`,
        email: e,
        funcoes: [funcoes.find((f) => f.nome === funcao)!.id],
        senha: SENHA,
      })
    ).json() as { id: string };
    return { id: usuario.id, chamar: await entrar(e) };
  };
  /** SQL direto na oficina (dados de teste que a API não cria, como cadastro incompleto ou datas passadas). */
  const banco = (consulta: ReturnType<typeof sql>) => withTenant(tid, (tx) => tx.execute(consulta));
  return { chamar, tid, pessoa, banco };
}
type Oficina = Awaited<ReturnType<typeof novaOficina>>;

/** Cliente completo ou incompleto (só o nome), com um veículo. */
async function clienteComVeiculo(o: Oficina, nome: string, completo = true) {
  const [c] = await o.banco(sql`insert into clientes (nome, cpf_cnpj, telefone, whatsapp)
    values (${nome}, ${completo ? String(Date.now()).slice(-11).padStart(11, '1') : null},
      ${completo ? '4832221000' : null}, ${completo ? '48999990000' : null}) returning id`);
  if (completo)
    await o.banco(sql`insert into cliente_enderecos (cliente_id, tipo, cep, logradouro, numero, bairro, cidade, uf, principal)
      values (${c!.id}, 'residencial', '88000000', 'Rua A', '1', 'Centro', 'Florianópolis', 'SC', true)`);
  const placa = `ABC${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
  const [v] = await o.banco(sql`insert into veiculos (cliente_id, placa, marca, modelo)
    values (${c!.id}, ${placa}, 'Fiat', 'Uno') returning id`);
  return { id: c!.id as string, veiculoId: v!.id as string, placa };
}

/** Catálogo básico: tabela padrão, vendedor, materiais (um com múltiplo 6) e serviços com preço. */
async function cenario(nome: string) {
  const o = await novaOficina(nome);
  const tipoId = ((await o.chamar('GET', '/api/opcoes/tiposMaterial')).json() as { id: string; nome: string }[]).find(
    (t) => t.nome === 'Peça',
  )!.id;
  const categoria = (await o.chamar('POST', '/api/categorias', { nome: 'Peças' })).json();
  const material = async (sku: string, extra: object = {}) =>
    (
      await o.chamar('POST', '/api/materiais', {
        sku,
        descricao: `Material ${sku}`,
        tipoId,
        categoriaId: categoria.id,
        unidade: 'UN',
        ...extra,
      })
    ).json();
  const varejo = (await o.chamar('POST', '/api/tabelas-preco', { codigo: 'VAREJO', nome: 'Varejo' })).json();
  const atacado = (await o.chamar('POST', '/api/tabelas-preco', { codigo: 'ATACADO', nome: 'Atacado' })).json();
  const preco = (item: { materialId?: string; servicoId?: string }, tabelaPrecoId: string, precoCentavos: number) =>
    o.chamar('PUT', '/api/precos/padrao', { ...item, tabelaPrecoId, precoCentavos });

  const filtro = await material('FIL-1');
  const oleo = await material('OLEO-6', { multiplo: 6 });
  const semVenda = await material('SEMVENDA', { permiteVenda: false });
  const semPreco = await material('SEMPRECO');
  const alinhamento = (await o.chamar('POST', '/api/servicos', { nome: 'Alinhamento', formaPreco: 'fechado' })).json();
  const mecanica = (
    await o.chamar('POST', '/api/servicos', { nome: 'Mecânica geral', formaPreco: 'hora', tempoMinutos: '1:30' })
  ).json();
  await preco({ materialId: filtro.id }, varejo.id, 12_345);
  await preco({ materialId: oleo.id }, varejo.id, 5_000);
  await preco({ materialId: semVenda.id }, varejo.id, 1_000);
  await preco({ servicoId: alinhamento.id }, varejo.id, 8_000);
  await preco({ servicoId: mecanica.id }, varejo.id, 20_000);
  await preco({ materialId: filtro.id }, atacado.id, 10_000);

  const atendente = await o.pessoa('Atendente');
  const vendedor = (
    await o.chamar('POST', '/api/vendedores', { usuarioId: atendente.id, whatsapp: '(48) 99999-0000' })
  ).json();
  const cliente = await clienteComVeiculo(o, 'Maria Silva');
  return {
    ...o,
    material,
    preco,
    varejo,
    atacado,
    filtro,
    oleo,
    semVenda,
    semPreco,
    alinhamento,
    mecanica,
    atendente,
    vendedor,
    cliente,
  };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;

const orcamento = (c: Cenario, itens: object[], extra: object = {}) => ({
  clienteId: c.cliente.id,
  veiculoId: c.cliente.veiculoId,
  vendedorId: c.vendedor.id,
  validadeAte: null,
  itens,
  ...extra,
});
const itemFiltro = (c: Cenario, extra: object = {}) => ({
  tipo: 'material',
  materialId: c.filtro.id,
  quantidade: 1,
  ...extra,
});

/** Itens como a tela reenvia: o id e a negociação de cada item gravado. */
const reenviar = (o: {
  itens: {
    id: string;
    tipo: string;
    materialId: string | null;
    servicoId: string | null;
    quantidade: number | null;
    tempoMinutos: number | null;
    precoUnitarioCentavos: number;
  }[];
}) =>
  o.itens.map((i) => ({
    id: i.id,
    tipo: i.tipo,
    ...(i.materialId ? { materialId: i.materialId } : { servicoId: i.servicoId }),
    ...(i.quantidade != null ? { quantidade: i.quantidade } : { tempoMinutos: i.tempoMinutos }),
    ...(i.materialId ? { precoUnitarioCentavos: i.precoUnitarioCentavos } : {}),
  }));

const transicao = (chamar: Chamar, id: string, acao: string, versao: number, motivo?: string) =>
  chamar('POST', `/api/orcamentos/${id}/${acao}`, { versao, motivo });

describe('tabela de preço padrão', () => {
  it('a primeira tabela nasce padrão; só uma por oficina, sempre ativa e sem exclusão', async () => {
    const o = await novaOficina('Oficina Tabela Padrão');
    const primeira = (await o.chamar('POST', '/api/tabelas-preco', { codigo: 'A', nome: 'Primeira' })).json();
    const segunda = (await o.chamar('POST', '/api/tabelas-preco', { codigo: 'B', nome: 'Segunda' })).json();
    expect([primeira.padrao, segunda.padrao]).toEqual([true, false]);

    // Padrão não inativa nem é excluída.
    const inativar = await o.chamar('PATCH', `/api/tabelas-preco/${primeira.id}/status`, { ativo: false });
    expect(inativar.statusCode).toBe(400);
    expect(inativar.json().erro).toMatch(/tabela padrão não pode ser inativada/);
    expect((await o.chamar('DELETE', `/api/tabelas-preco/${primeira.id}`)).statusCode).toBe(409);

    // Marcar outra tira a marca da anterior; tabela inativa não pode ser padrão.
    expect((await o.chamar('PATCH', `/api/tabelas-preco/${segunda.id}/padrao`)).json().padrao).toBe(true);
    const lista = (await o.chamar('GET', '/api/tabelas-preco')).json() as { nome: string; padrao: boolean }[];
    expect(lista.filter((t) => t.padrao).map((t) => t.nome)).toEqual(['Segunda']);
    await o.chamar('PATCH', `/api/tabelas-preco/${primeira.id}/status`, { ativo: false });
    expect((await o.chamar('PATCH', `/api/tabelas-preco/${primeira.id}/padrao`)).statusCode).toBe(400);

    // Quem só consulta preços não marca.
    const atendente = await o.pessoa('Atendente');
    expect((await atendente.chamar('PATCH', `/api/tabelas-preco/${segunda.id}/padrao`)).statusCode).toBe(403);
  });

  it('sem tabela padrão, a oficina não consegue fazer orçamento', async () => {
    const o = await novaOficina('Oficina Sem Tabela');
    const atendente = await o.pessoa('Atendente');
    const vendedor = (
      await o.chamar('POST', '/api/vendedores', { usuarioId: atendente.id, whatsapp: '(48) 99999-0000' })
    ).json();
    const cliente = await clienteComVeiculo(o, 'Sem Tabela');
    const res = await o.chamar('POST', '/api/orcamentos', {
      clienteId: cliente.id,
      vendedorId: vendedor.id,
      validadeAte: null,
      itens: [],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().erro).toMatch(/não tem tabela de preço padrão/);
  });
});

describe('orçamento: rascunho', () => {
  it('número sequencial, tabela padrão, múltiplo de venda, horas em múltiplos e negociação só para baixo', async () => {
    const c = await cenario('Oficina Orçamento Rascunho');
    const criar = await c.chamar(
      'POST',
      '/api/orcamentos',
      orcamento(c, [
        // 10% sobre R$ 123,45 = R$ 12,345 → desconto arredondado para cima: R$ 12,35.
        itemFiltro(c, { quantidade: 2, descontoPercentual: 10 }),
        { tipo: 'material', materialId: c.oleo.id, quantidade: 7 },
        { tipo: 'servico', servicoId: c.alinhamento.id, quantidade: 1.2 },
        { tipo: 'servico', servicoId: c.mecanica.id, tempoMinutos: '2:00' },
      ]),
    );
    expect(criar.statusCode).toBe(201);
    const o = criar.json();
    expect(o).toMatchObject({ numero: 1, versaoOrcamento: 1, situacao: 'rascunho', precosEm: hoje });
    expect(o.tabela.nome).toBe('Varejo');
    expect(
      o.itens.map((i: { codigo: string; quantidade: number; tempoMinutos: number }) => [
        i.codigo,
        i.quantidade ?? i.tempoMinutos,
      ]),
    ).toEqual([
      ['FIL-1', 2],
      ['OLEO-6', 12], // múltiplo 6: 7 → 12
      ['000001', 2], // preço fechado: inteiro, para cima
      ['000002', 180], // 1:30 por vez: 2:00 → 3:00
    ]);
    expect(o.itens[0]).toMatchObject({
      precoTabelaCentavos: 12_345,
      precoUnitarioCentavos: 11_110,
      descontoPercentual: 10,
      brutoCentavos: 24_690,
      descontoCentavos: 2_470,
      totalCentavos: 22_220,
    });
    // Valor-hora: R$ 200/h × 3h.
    expect(o.itens[3].totalCentavos).toBe(60_000);
    expect(o.subtotalCentavos).toBe(24_690 + 60_000 + 16_000 + 60_000);
    expect(o.totalCentavos).toBe(o.subtotalCentavos - 2_470);
    expect(o.avisos.join(' ')).toMatch(/OLEO-6.*arredondada para 12.*múltiplo de venda 6/);

    // O segundo orçamento da oficina é o número 2.
    expect((await c.chamar('POST', '/api/orcamentos', orcamento(c, []))).json().numero).toBe(2);

    // Preço digitado acima da tabela, serviço com negociação, item sem preço e material sem "Permite venda".
    const erros = await Promise.all([
      c.chamar('POST', '/api/orcamentos', orcamento(c, [itemFiltro(c, { precoUnitarioCentavos: 12_346 })])),
      c.chamar(
        'POST',
        '/api/orcamentos',
        orcamento(c, [{ tipo: 'servico', servicoId: c.alinhamento.id, quantidade: 1, descontoPercentual: 5 }]),
      ),
      c.chamar(
        'POST',
        '/api/orcamentos',
        orcamento(c, [{ tipo: 'material', materialId: c.semPreco.id, quantidade: 1 }]),
      ),
      c.chamar(
        'POST',
        '/api/orcamentos',
        orcamento(c, [{ tipo: 'material', materialId: c.semVenda.id, quantidade: 1 }]),
      ),
    ]);
    expect(erros.map((r) => r.statusCode)).toEqual([400, 400, 400, 400]);
    expect(erros[0]!.json().erro).toMatch(/não pode ficar acima do preço da tabela/);
    expect(erros[1]!.json().erro).toMatch(/serviço não aceita negociação/);
    expect(erros[2]!.json().erro).toMatch(/não tem preço na tabela/);
    expect(erros[3]!.json().erro).toMatch(/Permite venda/);

    // A busca mostra o item sem preço (null) e esconde o que não permite venda.
    const busca = (
      await c.chamar('GET', `/api/orcamentos/apoio/itens?q=Material&tabelaPrecoId=${c.varejo.id}`)
    ).json() as { codigo: string; precoCentavos: number | null }[];
    expect(busca.map((i) => [i.codigo, i.precoCentavos])).toEqual([
      ['FIL-1', 12_345],
      ['OLEO-6', 5_000],
      ['SEMPRECO', null],
    ]);
  });

  it('cliente inativo ou incompleto recebe orçamento (com aviso); veículo de outro cliente e vendedor inativo não', async () => {
    const c = await cenario('Oficina Orçamento Cliente');
    const incompleto = await clienteComVeiculo(c, 'João Incompleto', false);
    await c.banco(sql`update clientes set ativo = false where id = ${incompleto.id}`);
    const o = (
      await c.chamar(
        'POST',
        '/api/orcamentos',
        orcamento(c, [itemFiltro(c)], { clienteId: incompleto.id, veiculoId: incompleto.veiculoId }),
      )
    ).json();
    expect(o.cliente.ativo).toBe(false);
    expect(o.cliente.pendencias).toEqual(['CPF/CNPJ', 'telefone', 'WhatsApp', 'endereço']);

    const veiculoDeOutro = await c.chamar(
      'POST',
      '/api/orcamentos',
      orcamento(c, [], { clienteId: incompleto.id, veiculoId: c.cliente.veiculoId }),
    );
    expect(veiculoDeOutro.json().campos).toEqual({ veiculoId: 'Veículo de outro cliente' });

    await c.chamar('PATCH', `/api/vendedores/${c.vendedor.id}/status`, { ativo: false, motivo: 'Teste' });
    const inativo = await c.chamar('POST', '/api/orcamentos', orcamento(c, []));
    expect(inativo.json().campos).toEqual({ vendedorId: 'Escolha um vendedor ativo' });
    // O rascunho que já tinha o vendedor continua editável, mas não é emitido com ele inativo.
    const editado = await c.chamar('PUT', `/api/orcamentos/${o.id}`, {
      ...orcamento(c, reenviar(o), { clienteId: incompleto.id, veiculoId: null }),
      versao: o.versao,
    });
    expect(editado.statusCode).toBe(200);
    const emitir = await transicao(c.chamar, o.id, 'emitir', editado.json().versao);
    expect(emitir.json().erro).toMatch(/vendedor deste orçamento está inativo/);
  });

  it('trocar a tabela volta ao preço cheio da nova e remove, com aviso, os itens sem preço nela', async () => {
    const c = await cenario('Oficina Orçamento Troca Tabela');
    const o = (
      await c.chamar(
        'POST',
        '/api/orcamentos',
        orcamento(c, [
          itemFiltro(c, { precoUnitarioCentavos: 11_000 }),
          { tipo: 'servico', servicoId: c.alinhamento.id, quantidade: 1 },
        ]),
      )
    ).json();
    const trocada = await c.chamar('PUT', `/api/orcamentos/${o.id}`, {
      ...orcamento(c, reenviar(o), { tabelaPrecoId: c.atacado.id }),
      versao: o.versao,
    });
    expect(trocada.statusCode).toBe(200);
    const t = trocada.json();
    expect(t.tabela.nome).toBe('Atacado');
    expect(
      t.itens.map((i: { codigo: string; precoUnitarioCentavos: number }) => [i.codigo, i.precoUnitarioCentavos]),
    ).toEqual([['FIL-1', 10_000]]);
    expect(t.avisos).toEqual(['000001 — Alinhamento foi removido: não tem preço na nova tabela.']);
    expect(t.eventos[1].evento).toBe('tabela_trocada');

    // Versão antiga: 409.
    const antiga = await c.chamar('PUT', `/api/orcamentos/${o.id}`, { ...orcamento(c, []), versao: o.versao });
    expect(antiga.statusCode).toBe(409);
  });

  it('rascunho de outro dia é recalculado ao abrir: mantém o valor do cliente e tira o que perdeu preço', async () => {
    const c = await cenario('Oficina Orçamento Recalculo');
    const barato = await c.material('BARATO');
    await c.preco({ materialId: barato.id }, c.varejo.id, 10_000);
    const o = (
      await c.chamar(
        'POST',
        '/api/orcamentos',
        orcamento(c, [
          itemFiltro(c, { precoUnitarioCentavos: 12_000 }), // tabela 123,45; cliente paga 120,00
          { tipo: 'material', materialId: barato.id, quantidade: 1 },
          { tipo: 'material', materialId: c.oleo.id, quantidade: 6 },
          { tipo: 'servico', servicoId: c.alinhamento.id, quantidade: 1 },
        ]),
      )
    ).json();
    await c.banco(sql`update orcamentos set precos_em = ${somarDias(hoje, -1)} where id = ${o.id}`);

    // Novos preços: filtro sobe, "barato" cai, serviço sobe, óleo perde o preço.
    await c.preco({ materialId: c.filtro.id }, c.varejo.id, 15_000);
    await c.preco({ materialId: barato.id }, c.varejo.id, 8_000);
    await c.preco({ servicoId: c.alinhamento.id }, c.varejo.id, 9_000);
    await c.chamar('DELETE', `/api/precos/padrao?materialId=${c.oleo.id}&tabelaPrecoId=${c.varejo.id}`);

    // Antes de recalcular não se altera nem emite.
    const semRecalcular = await c.chamar('PUT', `/api/orcamentos/${o.id}`, {
      ...orcamento(c, reenviar(o)),
      versao: o.versao,
    });
    expect(semRecalcular.statusCode).toBe(409);
    expect(semRecalcular.json().erro).toMatch(/Abra o orçamento de novo para recalcular/);

    const r = (await c.chamar('POST', `/api/orcamentos/${o.id}/recalcular`)).json();
    expect(r.precosEm).toBe(hoje);
    expect(
      r.itens.map((i: { codigo: string; precoTabelaCentavos: number; precoUnitarioCentavos: number }) => [
        i.codigo,
        i.precoTabelaCentavos,
        i.precoUnitarioCentavos,
      ]),
    ).toEqual([
      ['FIL-1', 15_000, 12_000], // subiu: mantém os R$ 120,00 com desconto
      ['BARATO', 8_000, 8_000], // caiu: fica o novo
      ['000001', 9_000, 9_000], // serviço: sempre o novo
    ]);
    expect(r.avisos.join(' ')).toMatch(/OLEO-6 — Material OLEO-6 foi removido/);
    expect(r.eventos[0].evento).toBe('precos_recalculados');
    // No mesmo dia, abrir de novo não muda nada.
    expect((await c.chamar('POST', `/api/orcamentos/${o.id}/recalcular`)).json().versao).toBe(r.versao);
  });
});

describe('orçamento: emissão, aprovação e versões', () => {
  it('emitir congela o conteúdo; validade padrão de 7 dias e no máximo 30', async () => {
    const c = await cenario('Oficina Orçamento Emissão');
    const vazio = (await c.chamar('POST', '/api/orcamentos', orcamento(c, []))).json();
    expect((await transicao(c.chamar, vazio.id, 'emitir', vazio.versao)).json().erro).toMatch(/ao menos um/);

    const longo = (
      await c.chamar('POST', '/api/orcamentos', orcamento(c, [itemFiltro(c)], { validadeAte: somarDias(hoje, 31) }))
    ).json();
    const recusado = await transicao(c.chamar, longo.id, 'emitir', longo.versao);
    expect(recusado.statusCode).toBe(400);
    expect(recusado.json().campos.validadeAte).toMatch(/No máximo/);

    const o = (await c.chamar('POST', '/api/orcamentos', orcamento(c, [itemFiltro(c)]))).json();
    const emitido = (await transicao(c.chamar, o.id, 'emitir', o.versao)).json();
    expect(emitido).toMatchObject({ situacao: 'emitido', validadeAte: somarDias(hoje, 7) });

    // Conteúdo imutável: pela API (409) e pelo banco (trigger), mesmo por fora dela.
    const editar = await c.chamar('PUT', `/api/orcamentos/${o.id}`, { ...orcamento(c, []), versao: emitido.versao });
    expect(editar.statusCode).toBe(409);
    await expect(
      c.banco(sql`update orcamento_itens set preco_unitario_centavos = 1 where orcamento_id = ${o.id}`),
    ).rejects.toThrow();
    // Emitir de novo não vale.
    expect((await transicao(c.chamar, o.id, 'emitir', emitido.versao)).statusCode).toBe(409);
  });

  it('aprovação só por quem tem "Aprovar orçamentos", até o dia seguinte ao da validade', async () => {
    const c = await cenario('Oficina Orçamento Aprovação');
    const mecanico = await c.pessoa('Mecânico');
    const o = (await c.chamar('POST', '/api/orcamentos', orcamento(c, [itemFiltro(c)]))).json();
    const emitido = (await transicao(c.chamar, o.id, 'emitir', o.versao)).json();
    const enviado = (await transicao(c.chamar, o.id, 'enviar', emitido.versao)).json();
    expect(enviado.situacao).toBe('enviado');

    // Mecânico consulta, mas não aprova nem cria.
    expect((await mecanico.chamar('GET', `/api/orcamentos/${o.id}`)).statusCode).toBe(200);
    expect((await mecanico.chamar('POST', '/api/orcamentos', orcamento(c, []))).statusCode).toBe(403);
    expect((await transicao(mecanico.chamar, o.id, 'aprovar', enviado.versao)).statusCode).toBe(403);

    // Validade ontem: ainda aprovável hoje (tolerância de um dia).
    await c.banco(sql`update orcamentos set validade_ate = ${somarDias(hoje, -1)} where id = ${o.id}`);
    const aprovado = (await transicao(c.atendente.chamar, o.id, 'aprovar', enviado.versao)).json();
    expect(aprovado).toMatchObject({ situacao: 'aprovado', aprovadoPor: expect.stringMatching(/^Atendente/) });
    expect(aprovado.aprovadoEm).toBeTruthy();
    expect((await transicao(c.chamar, o.id, 'nova-versao', aprovado.versao)).statusCode).toBe(409);

    // Validade anteontem: vencido (calculado), não aprova nem gera versão.
    const outro = (await c.chamar('POST', '/api/orcamentos', orcamento(c, [itemFiltro(c)]))).json();
    const outroEmitido = (await transicao(c.chamar, outro.id, 'emitir', outro.versao)).json();
    await c.banco(sql`update orcamentos set validade_ate = ${somarDias(hoje, -2)} where id = ${outro.id}`);
    expect((await c.chamar('GET', `/api/orcamentos/${outro.id}`)).json().situacao).toBe('vencido');
    expect((await transicao(c.chamar, outro.id, 'aprovar', outroEmitido.versao)).statusCode).toBe(409);
    expect((await transicao(c.chamar, outro.id, 'nova-versao', outroEmitido.versao)).statusCode).toBe(409);
    const vencidos = (await c.chamar('GET', '/api/orcamentos?situacao=vencido')).json();
    expect(vencidos.itens.map((i: { id: string }) => i.id)).toEqual([outro.id]);
  });

  it('nova versão: mesmo número, anterior cancelada, só a última aprova; recusa com motivo', async () => {
    const c = await cenario('Oficina Orçamento Versões');
    const o = (await c.chamar('POST', '/api/orcamentos', orcamento(c, [itemFiltro(c, { quantidade: 3 })]))).json();
    expect((await transicao(c.chamar, o.id, 'nova-versao', o.versao)).statusCode).toBe(409); // rascunho
    const v1 = (await transicao(c.chamar, o.id, 'emitir', o.versao)).json();

    const criada = await transicao(c.chamar, o.id, 'nova-versao', v1.versao);
    expect(criada.statusCode).toBe(201);
    const v2 = criada.json();
    expect(v2).toMatchObject({ numero: v1.numero, versaoOrcamento: 2, situacao: 'rascunho', validadeAte: null });
    expect(v2.itens[0]).toMatchObject({ codigo: 'FIL-1', quantidade: 3 });
    expect(
      v2.versoes.map((v: { versaoOrcamento: number; situacao: string }) => [v.versaoOrcamento, v.situacao]),
    ).toEqual([
      [2, 'rascunho'],
      [1, 'cancelado'],
    ]);
    const antiga = (await c.chamar('GET', `/api/orcamentos/${o.id}`)).json();
    expect(antiga.motivoCancelamento).toBe('Substituído pela versão 2.');
    expect((await transicao(c.chamar, o.id, 'aprovar', antiga.versao)).statusCode).toBe(409);

    // O banco não aceita duas versões vivas do mesmo número.
    await expect(c.banco(sql`update orcamentos set status = 'rascunho' where id = ${o.id}`)).rejects.toThrow();

    // A partir da versão 2 o cliente não muda.
    const outroCliente = await clienteComVeiculo(c, 'Outro Cliente');
    const trocaCliente = await c.chamar('PUT', `/api/orcamentos/${v2.id}`, {
      ...orcamento(c, reenviar(v2), { clienteId: outroCliente.id, veiculoId: null }),
      versao: v2.versao,
    });
    expect(trocaCliente.statusCode).toBe(400);
    expect(trocaCliente.json().campos).toEqual({ clienteId: 'O cliente não muda a partir da versão 2' });

    const v2Emitida = (await transicao(c.chamar, v2.id, 'emitir', v2.versao)).json();
    const recusada = (await transicao(c.atendente.chamar, v2.id, 'recusar', v2Emitida.versao, 'Achou caro')).json();
    expect(recusada).toMatchObject({ situacao: 'recusado', motivoRecusa: 'Achou caro' });
    expect(recusada.eventos[0]).toMatchObject({ evento: 'recusado', detalhe: 'Achou caro' });

    // Lista: busca pelo número formatado e pela placa; as duas versões aparecem.
    const porNumero = (await c.chamar('GET', '/api/orcamentos?q=ORC-0000000001')).json();
    expect(porNumero.itens.map((i: { versaoOrcamento: number }) => i.versaoOrcamento)).toEqual([2, 1]);
    expect((await c.chamar('GET', `/api/orcamentos?q=${c.cliente.placa}`)).json().total).toBe(2);
    expect((await c.chamar('GET', '/api/orcamentos?situacao=recusado')).json().total).toBe(1);
  });
});
