import { randomUUID } from 'node:crypto';
import { hojeIso, SEM_ACESSO, somarDias } from '@mobios/shared';
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

    // A busca mostra o item sem preço (null) e esconde o que não permite venda. Estoque: saldo livre somado dos
    // depósitos (disponível − reservado); serviço não tem.
    const loja = ((await c.chamar('GET', '/api/opcoes/tiposDeposito')).json() as { id: string; nome: string }[]).find(
      (t) => t.nome === 'Loja',
    )!;
    const deposito = (
      await c.chamar('POST', '/api/depositos', { codigo: 'LOJA', nome: 'Loja', tipoId: loja.id })
    ).json();
    const deposito2 = (
      await c.chamar('POST', '/api/depositos', { codigo: 'LOJA2', nome: 'Loja 2', tipoId: loja.id })
    ).json();
    await c.banco(sql`insert into estoques (material_id, deposito_id, disponivel, reservado)
      values (${c.filtro.id}, ${deposito.id}, 30, 6), (${c.filtro.id}, ${deposito2.id}, 2, 0)`);
    const busca = (
      await c.chamar('GET', `/api/orcamentos/apoio/itens?q=Material&tabelaPrecoId=${c.varejo.id}`)
    ).json() as { codigo: string; precoCentavos: number | null; estoque: number | null }[];
    expect(busca.map((i) => [i.codigo, i.precoCentavos, i.estoque])).toEqual([
      ['FIL-1', 12_345, 26],
      ['OLEO-6', 5_000, 0],
      ['SEMPRECO', null, 0],
    ]);
    const servico = (
      await c.chamar('GET', `/api/orcamentos/apoio/itens?q=Alinhamento&tabelaPrecoId=${c.varejo.id}`)
    ).json() as { estoque: number | null }[];
    expect(servico[0]!.estoque).toBeNull();

    // Filtro por tipo: só materiais ou só serviços; vazio = os dois.
    const tipos = async (tipo: string, q: string) =>
      (
        (
          await c.chamar(
            'GET',
            `/api/orcamentos/apoio/itens?${new URLSearchParams({ q, tabelaPrecoId: c.varejo.id, tipo })}`,
          )
        ).json() as {
          tipo: string;
        }[]
      ).map((i) => i.tipo);
    expect(new Set(await tipos('', 'a'))).toEqual(new Set(['material', 'servico']));
    expect(new Set(await tipos('material', 'a'))).toEqual(new Set(['material']));
    expect(new Set(await tipos('servico', 'a'))).toEqual(new Set(['servico']));
    expect(
      (await c.chamar('GET', `/api/orcamentos/apoio/itens?q=a&tabelaPrecoId=${c.varejo.id}&tipo=outro`)).statusCode,
    ).toBe(400);
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

    // Painel do Início: valor aprovado, ticket, taxa de aprovação e aprovados por vendedor.
    const painel = (await c.chamar('GET', '/api/painel')).json();
    const kpi = Object.fromEntries(painel.indicadores.map((i: { id: string }) => [i.id, i]));
    expect(kpi.orcamentos.valor).toBe(1);
    expect(kpi.valor_aprovado.valor).toBe(aprovado.totalCentavos);
    expect(kpi.ticket_medio.valor).toBe(aprovado.totalCentavos);
    expect(kpi.taxa_aprovacao.valor).toBe(100);
    expect(painel.orcamentosPorSituacao).toEqual([
      { situacao: 'aprovado', quantidade: 1, totalCentavos: aprovado.totalCentavos },
    ]);
    expect(painel.aprovadosPorVendedor[0]).toMatchObject({ quantidade: 1, totalCentavos: aprovado.totalCentavos });

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

describe('orçamento: vendedor e demais usuários', () => {
  it('vendedor: orçamento no nome dele e só os próprios; os demais consultam todos e quem pode aprova', async () => {
    const c = await cenario('Oficina Orçamento Vendedores');
    const outra = await c.pessoa('Atendente');
    const vendedorB = (
      await c.chamar('POST', '/api/vendedores', { usuarioId: outra.id, whatsapp: '(48) 99999-1111' })
    ).json();
    const financeiro = await c.pessoa('Financeiro');

    // A sessão diz quem atua como vendedor (o Administrador nunca).
    expect((await c.atendente.chamar('GET', '/api/auth/sessao')).json().vendedorId).toBe(c.vendedor.id);
    expect((await c.chamar('GET', '/api/auth/sessao')).json().vendedorId).toBeNull();

    // O vendedor cria no próprio nome, mesmo pedindo outro; o Administrador escolhe.
    const doA = (
      await c.atendente.chamar('POST', '/api/orcamentos', orcamento(c, [itemFiltro(c)], { vendedorId: vendedorB.id }))
    ).json();
    expect(doA.vendedor.id).toBe(c.vendedor.id);
    const doB = (
      await c.chamar('POST', '/api/orcamentos', orcamento(c, [itemFiltro(c)], { vendedorId: vendedorB.id }))
    ).json();
    expect(doB.vendedor.id).toBe(vendedorB.id);

    // Só os próprios: lista (mesmo filtrando por outro), detalhe, edição e aprovação do outro = 404.
    const listaA = (await c.atendente.chamar('GET', `/api/orcamentos?vendedorId=${vendedorB.id}`)).json();
    expect(listaA.itens.map((o: { id: string }) => o.id)).toEqual([doA.id]);
    expect((await c.atendente.chamar('GET', `/api/orcamentos/${doB.id}`)).statusCode).toBe(404);
    expect(
      (await c.atendente.chamar('PUT', `/api/orcamentos/${doB.id}`, { ...orcamento(c, []), versao: doB.versao }))
        .statusCode,
    ).toBe(404);
    const bEmitido = (await transicao(c.chamar, doB.id, 'emitir', doB.versao)).json();
    expect((await transicao(c.atendente.chamar, doB.id, 'aprovar', bEmitido.versao)).statusCode).toBe(404);

    // Quem não é vendedor nem Administrador: consulta todos, não cria nem edita; com "Aprovar orçamentos", aprova.
    expect((await financeiro.chamar('GET', '/api/orcamentos')).json().total).toBe(2);
    expect((await financeiro.chamar('POST', '/api/orcamentos', orcamento(c, []))).statusCode).toBe(403);
    expect((await financeiro.chamar('GET', '/api/orcamentos/apoio/clientes')).statusCode).toBe(403);
    expect((await transicao(financeiro.chamar, doB.id, 'aprovar', bEmitido.versao)).json().situacao).toBe('aprovado');

    // Início: o vendedor vê só os próprios números; o Administrador, os de todos.
    const kpi = async (chamar: Chamar, id: string) =>
      (await chamar('GET', '/api/painel')).json().indicadores.find((i: { id: string }) => i.id === id).valor;
    expect(await kpi(c.atendente.chamar, 'orcamentos')).toBe(1);
    expect(await kpi(c.chamar, 'orcamentos')).toBe(2);
    expect(await kpi(c.atendente.chamar, 'valor_aprovado')).toBe(0);

    // Janela de clientes: abre listando os ativos, com placas; filtros de tipo e situação.
    const janela = (await c.atendente.chamar('GET', '/api/orcamentos/apoio/clientes')).json();
    expect(janela.itens[0]).toMatchObject({ nome: 'Maria Silva', tipo: 'PF', placas: [c.cliente.placa] });
    expect((await c.atendente.chamar('GET', '/api/orcamentos/apoio/clientes?tipo=PJ')).json().total).toBe(0);
    expect(
      (await c.atendente.chamar('GET', `/api/orcamentos/apoio/clientes?q=${c.cliente.placa.toLowerCase()}`)).json()
        .total,
    ).toBe(1);
  });
});

describe('gravação automática do rascunho', () => {
  it('não registra "Alterado" a cada gravação, mas mantém "Descontos alterados"', async () => {
    const c = await cenario('Oficina Gravação Automática');
    const o = (await c.atendente.chamar('POST', '/api/orcamentos', orcamento(c, [itemFiltro(c)]))).json();
    const gravar = async (atual: typeof o, desconto: number, automatico?: boolean) =>
      (
        await c.atendente.chamar('PUT', `/api/orcamentos/${o.id}`, {
          ...orcamento(c, [{ ...reenviar(atual)[0], precoUnitarioCentavos: undefined, descontoPercentual: desconto }]),
          versao: atual.versao,
          automatico,
        })
      ).json();
    const eventos = (x: { eventos: { evento: string }[] }) => x.eventos.map((e) => e.evento);

    const auto = await gravar(o, 5, true);
    expect(auto.itens[0].descontoPercentual).toBe(5);
    expect(eventos(auto)).toEqual(['descontos_alterados', 'criado']);
    // O mesmo item (id reenviado) não duplica.
    expect(auto.itens).toHaveLength(1);
    expect(auto.itens[0].id).toBe(o.itens[0].id);

    const manual = await gravar(auto, 5);
    expect(eventos(manual)).toEqual(['alterado', 'descontos_alterados', 'criado']);
  });
});

describe('contexto do cliente no orçamento', () => {
  it('traz cadastro, veículos, últimos orçamentos e o último aprovado; o vendedor vê só os dele', async () => {
    const c = await cenario('Oficina Contexto Cliente');
    const outro = await c.pessoa('Atendente');
    await c.chamar('POST', '/api/vendedores', { usuarioId: outro.id, whatsapp: '(48) 99999-0002' });
    const criar = async (chamar: Chamar, extra: object = {}) =>
      (await chamar('POST', '/api/orcamentos', orcamento(c, [itemFiltro(c)], extra))).json();

    const meu = await criar(c.atendente.chamar);
    const emitido = (await transicao(c.atendente.chamar, meu.id, 'emitir', meu.versao)).json();
    expect((await transicao(c.chamar, meu.id, 'aprovar', emitido.versao)).statusCode).toBe(200);
    const dele = await criar(outro.chamar);

    const url = `/api/orcamentos/apoio/clientes/${c.cliente.id}/contexto`;
    const admin = (await c.chamar('GET', url)).json();
    expect(admin).toMatchObject({
      nome: 'Maria Silva',
      tipo: 'PF',
      ativo: true,
      pendencias: [],
      endereco: { cidade: 'Florianópolis', uf: 'SC' },
      veiculos: [{ placa: c.cliente.placa }],
      ultimoAprovado: { id: meu.id, totalCentavos: 12_345 },
    });
    expect(admin.orcamentos.map((o: { id: string }) => o.id)).toEqual([dele.id, meu.id]);
    expect(admin.totalOrcamentos).toBe(2);
    expect(admin.orcamentos[1].situacao).toBe('aprovado');

    // O outro vendedor vê só o dele: nem o orçamento nem a aprovação do colega.
    const vendedor = (await outro.chamar('GET', url)).json();
    expect(vendedor.orcamentos.map((o: { id: string }) => o.id)).toEqual([dele.id]);
    expect(vendedor.ultimoAprovado).toBeNull();
    expect(vendedor.totalOrcamentos).toBe(1);

    // Recentes: clientes dos últimos orçamentos (do vendedor; da oficina para o Administrador), sem repetir.
    const joao = await clienteComVeiculo(c, 'João Souza');
    await criar(c.atendente.chamar, { clienteId: joao.id, veiculoId: joao.veiculoId });
    await criar(c.atendente.chamar);
    const nomes = async (chamar: Chamar) =>
      ((await chamar('GET', '/api/orcamentos/apoio/clientes/recentes')).json() as { nome: string }[]).map(
        (r) => r.nome,
      );
    expect(await nomes(c.atendente.chamar)).toEqual(['Maria Silva', 'João Souza']);
    expect(await nomes(outro.chamar)).toEqual(['Maria Silva']);
    expect(await nomes(c.chamar)).toEqual(['Maria Silva', 'João Souza']);

    // Inexistente (ou de outra oficina): 404. Quem não altera orçamentos: 403.
    expect((await c.chamar('GET', `/api/orcamentos/apoio/clientes/${randomUUID()}/contexto`)).statusCode).toBe(404);
    const outraOficina = await cenario('Oficina Contexto Outra');
    expect((await outraOficina.chamar('GET', url)).statusCode).toBe(404);
    const financeiro = await c.pessoa('Financeiro');
    expect((await financeiro.chamar('GET', url)).statusCode).toBe(403);
    expect((await financeiro.chamar('GET', '/api/orcamentos/apoio/clientes/recentes')).statusCode).toBe(403);
  });
});

// ---------- Aprovação comercial por alçada (docs/modulos/APROVACAO_COMERCIAL.md) ----------

type AprovacaoDoc = { id: string; status: string; percentual: number; alcadaSolicitante: number } | null;

/**
 * Cenário com alçadas: Atendente (o vendedor) 5%, Gerente 15% (aprova, pode ser vendedor), Administrador 100%.
 * A alçada é por item (o % digitado): filtro a R$ 123,45 com 8% → 8,00% (R$ 9,88 de desconto).
 */
async function comAlcadas(nome: string) {
  const c = await cenario(nome);
  const funcoes = (await c.chamar('GET', '/api/funcoes')).json() as { id: string; nome: string }[];
  const funcaoId = (n: string) => funcoes.find((f) => f.nome === n)!.id;
  const gerenteFuncao = (
    await c.chamar('POST', '/api/funcoes', {
      nome: 'Gerente',
      descricao: null,
      ativa: true,
      parametros: ['VENDEDOR'],
      acessos: { ...SEM_ACESSO, orcamentos: 'consultar', aprovacao_comercial: 'editar' },
    })
  ).json() as { id: string };
  const alcada = async (id: string, percentual: number, ativa = true) => {
    const lista = (await c.chamar('GET', '/api/alcadas')).json() as { funcaoId: string; versao: number | null }[];
    return c.chamar('PUT', `/api/alcadas/${id}`, {
      percentual,
      ativa,
      versao: lista.find((a) => a.funcaoId === id)!.versao,
    });
  };
  expect((await alcada(funcaoId('Atendente'), 5)).statusCode).toBe(200);
  expect((await alcada(gerenteFuncao.id, 15)).statusCode).toBe(200);
  const gerente = await c.pessoa('Gerente');
  const gerente2 = await c.pessoa('Gerente');
  /** Cria e emite um orçamento com o filtro no desconto pedido; devolve o orçamento depois de emitir. */
  const emitir = async (chamar: Chamar, desconto: number, extra: object = {}) => {
    const o = (
      await chamar('POST', '/api/orcamentos', orcamento(c, [itemFiltro(c, { descontoPercentual: desconto })], extra))
    ).json();
    const emitido = await transicao(chamar, o.id, 'emitir', o.versao);
    return { resposta: emitido, o: emitido.json() };
  };
  const aprovacao = (chamar: Chamar, id: string) => chamar('GET', `/api/aprovacoes-comerciais/${id}`);
  const decidir = (chamar: Chamar, id: string, acao: 'aprovar' | 'reprovar', versao: number, justificativa?: string) =>
    chamar('POST', `/api/aprovacoes-comerciais/${id}/${acao}`, { versao, justificativa });
  return { ...c, funcaoId, gerenteFuncao, alcada, gerente, gerente2, emitir, aprovacao, decidir };
}

describe('aprovação comercial por alçada', () => {
  it('desconto dentro da alçada emite normalmente, sem aprovação, e registra quem deu o desconto', async () => {
    const c = await comAlcadas('Oficina Alçada Dentro');
    expect((await c.atendente.chamar('GET', '/api/alcadas/minha')).json()).toEqual({
      percentual: 500,
      funcao: 'Atendente',
    });
    const { o } = await c.emitir(c.atendente.chamar, 3);
    expect(o.situacao).toBe('emitido');
    expect(o.aprovacaoComercial).toBeNull();
    const desconto = o.eventos.find((e: { evento: string }) => e.evento === 'descontos_alterados');
    expect(desconto.detalhe).toMatch(/sem desconto → 3,00%.*Desconto total: 3,01%/);
    expect(desconto.usuario).toMatch(/^Atendente/);

    // Igual à alçada também está dentro: o Administrador (100%) emite 100% sem pedir aprovação.
    const tudo = await c.emitir(c.chamar, 100);
    expect(tudo.o.situacao).toBe('emitido');
  });

  it('acima da alçada: aguarda aprovação, com retrato, histórico, itens congelados e alerta no Início', async () => {
    const c = await comAlcadas('Oficina Alçada Acima');
    const { o } = await c.emitir(c.atendente.chamar, 8);
    expect(o.situacao).toBe('aguardando_aprovacao_comercial');
    expect(o.emitidoEm).toBeNull();
    const pedido = o.aprovacaoComercial as NonNullable<AprovacaoDoc> & { solicitanteFuncao: string };
    expect(pedido).toMatchObject({ status: 'pendente', percentual: 800, alcadaSolicitante: 500 });
    expect(pedido.solicitanteFuncao).toBe('Atendente');
    expect(o.eventos[0].evento).toBe('aprovacao_comercial_solicitada');
    expect(o.eventos[0].detalhe).toBe('1 item: desconto de até 8,00%, acima da alçada de 5,00% (Atendente).');

    // Aguardando: não se edita nem se registra a decisão do cliente.
    const editar = await c.atendente.chamar('PUT', `/api/orcamentos/${o.id}`, {
      ...orcamento(c, reenviar(o)),
      versao: o.versao,
    });
    expect(editar.statusCode).toBe(409);
    expect(editar.json().erro).toMatch(/aguardando aprovação comercial/);
    expect((await transicao(c.chamar, o.id, 'aprovar', o.versao)).statusCode).toBe(409);
    const itens = c.banco(sql`update orcamento_itens set quantidade = 2 where orcamento_id = ${o.id}`);
    await expect(itens).rejects.toThrow();

    const detalhe = (await c.aprovacao(c.gerente.chamar, pedido.id)).json();
    expect(detalhe).toMatchObject({
      tipoDocumento: 'orcamento',
      documentoId: o.id,
      documentoNumero: `ORC-${String(o.numero).padStart(10, '0')}`,
      documentoVersao: 1,
      clienteNome: 'Maria Silva',
      subtotalCentavos: 12_345,
      descontoCentavos: 988,
      totalCentavos: 11_357,
      podeDecidir: true,
      motivoBloqueio: null,
    });
    expect(detalhe.snapshot).toMatchObject({ validadeDias: 7, vendedor: expect.any(String), descontoCentavos: 988 });
    expect(detalhe.snapshot.itens).toEqual([
      expect.objectContaining({ codigo: 'FIL-1', percentual: 800, acimaDaAlcada: true }),
    ]);
    expect(detalhe.aprovadores).toEqual([
      { funcao: 'Gerente', alcada: 1500 },
      { funcao: 'Administrador', alcada: 10_000 },
    ]);
    expect(detalhe.eventos.map((e: { evento: string }) => e.evento)).toEqual(['necessaria', 'solicitada']);

    const lista = (await c.gerente.chamar('GET', '/api/aprovacoes-comerciais?posso=true')).json();
    expect(lista.itens.map((a: { id: string }) => a.id)).toEqual([pedido.id]);
    const painel = (await c.gerente.chamar('GET', '/api/painel')).json();
    expect(painel.alertas[0].mensagem).toMatch(/^1 aprovação\(ões\) comercial\(is\)/);

    // Sem o módulo, o vendedor não abre a área de aprovações (vê tudo pelo próprio orçamento).
    expect((await c.atendente.chamar('GET', '/api/aprovacoes-comerciais')).statusCode).toBe(403);
  });

  it('gerente com alçada aprova: o orçamento é emitido e a alçada do momento fica no histórico', async () => {
    const c = await comAlcadas('Oficina Alçada Aprova');
    const { o } = await c.emitir(c.atendente.chamar, 8, { validadeAte: somarDias(hoje, 3) });
    const pedido = o.aprovacaoComercial as NonNullable<AprovacaoDoc>;
    const lida = (await c.aprovacao(c.gerente.chamar, pedido.id)).json();

    const aprovada = await c.decidir(c.gerente.chamar, pedido.id, 'aprovar', lida.versao);
    expect(aprovada.statusCode).toBe(200);
    expect(aprovada.json()).toMatchObject({
      status: 'aprovada',
      decisorFuncao: 'Gerente',
      alcadaDecisor: 1500,
      podeDecidir: false,
    });
    expect(aprovada.json().eventos.at(-1)).toMatchObject({ evento: 'aprovada', funcao: 'Gerente', alcada: 1500 });

    // Emitido agora, com a validade pedida (3 dias) contando da aprovação.
    const emitido = (await c.atendente.chamar('GET', `/api/orcamentos/${o.id}`)).json();
    expect(emitido.situacao).toBe('emitido');
    expect(emitido.validadeAte).toBe(somarDias(hoje, 3));
    expect(emitido.aprovacaoComercial).toMatchObject({ status: 'aprovada', alcadaDecisor: 1500 });
    expect(emitido.eventos.slice(0, 2).map((e: { evento: string }) => e.evento)).toEqual([
      'emitido',
      'aprovado_comercialmente',
    ]);

    // Não se aprova de novo, nem com a versão nova.
    expect((await c.decidir(c.gerente.chamar, pedido.id, 'aprovar', lida.versao)).statusCode).toBe(409);
    expect((await c.decidir(c.chamar, pedido.id, 'aprovar', aprovada.json().versao)).statusCode).toBe(409);

    // Mudar a alçada depois não reescreve o histórico.
    await c.alcada(c.gerenteFuncao.id, 10);
    expect((await c.aprovacao(c.chamar, pedido.id)).json().alcadaDecisor).toBe(1500);
    const historico = (await c.chamar('GET', '/api/alcadas/historico')).json();
    expect(historico[0]).toMatchObject({ funcao: 'Gerente', percentualAntes: 1500, percentualDepois: 1000 });
  });

  it('a alçada é por item: um item acima dela manda para aprovação mesmo com o total diluído', async () => {
    const c = await comAlcadas('Oficina Alçada Por Item');
    // Óleo (R$ 50,00 × 6) sem desconto e filtro (R$ 123,45) com 15%: no total dá 4,34% (dentro de 5%), mas o
    // filtro passa da alçada do Atendente.
    const o = (
      await c.atendente.chamar(
        'POST',
        '/api/orcamentos',
        orcamento(c, [
          { tipo: 'material', materialId: c.oleo.id, quantidade: 6 },
          itemFiltro(c, { descontoPercentual: 15 }),
        ]),
      )
    ).json();
    const emitido = (await transicao(c.atendente.chamar, o.id, 'emitir', o.versao)).json();
    expect(emitido.situacao).toBe('aguardando_aprovacao_comercial');
    expect(emitido.aprovacaoComercial).toMatchObject({ percentual: 1500, alcadaSolicitante: 500 });
    const detalhe = (await c.aprovacao(c.gerente.chamar, emitido.aprovacaoComercial.id)).json();
    expect(
      detalhe.snapshot.itens.map((i: { codigo: string; percentual: number; acimaDaAlcada: boolean }) => [
        i.codigo,
        i.percentual,
        i.acimaDaAlcada,
      ]),
    ).toEqual([
      ['OLEO-6', 0, false],
      ['FIL-1', 1500, true],
    ]);

    // Igual à alçada, por item, não pede aprovação: 5% digitado vale 5,00%, embora o desconto em centavos seja
    // arredondado a favor do cliente (R$ 6,18 de R$ 123,45 = 5,006%).
    const noLimite = await c.emitir(c.atendente.chamar, 5);
    expect(noLimite.o.itens[0].descontoCentavos).toBe(618);
    expect(noLimite.o.situacao).toBe('emitido');
  });

  it('margem na aprovação: PMC congelado no item, serviço fora, só para quem tem Custos e margem', async () => {
    const c = await comAlcadas('Oficina Margem');
    const pmc = (centavos: number, anterior: number | null) =>
      c.chamar('PUT', `/api/materiais/${c.filtro.id}/pmc`, { pmcCentavos: centavos, anteriorCentavos: anterior });
    await pmc(8_000, null);
    // Filtro (R$ 123,45, 8% → R$ 113,57) com PMC R$ 80,00 + serviço de alinhamento (R$ 80,00, sem PMC).
    const o = (
      await c.atendente.chamar(
        'POST',
        '/api/orcamentos',
        orcamento(c, [
          itemFiltro(c, { descontoPercentual: 8 }),
          { tipo: 'servico', servicoId: c.alinhamento.id, quantidade: 1 },
        ]),
      )
    ).json();
    // A resposta do orçamento (a que o vendedor usa) nunca traz o PMC.
    expect(o.itens[0]).not.toHaveProperty('pmcCentavos');
    // O PMC ficou congelado ao incluir: mudar o cadastro antes da emissão não muda o orçamento.
    await pmc(10_000, 8_000);
    const emitido = (await transicao(c.atendente.chamar, o.id, 'emitir', o.versao)).json();
    const id = emitido.aprovacaoComercial.id as string;

    const margem = (await c.aprovacao(c.chamar, id)).json().snapshot.margem;
    expect(margem).toMatchObject({ produtosConsiderados: 1, servicosExcluidos: 1, produtosSemPmc: 0 });
    expect(margem.comDesconto).toMatchObject({ receitaCentavos: 11_357, custoCentavos: 8_000, margemCentavos: 3_357 });
    expect(margem.comDesconto.margemPercentual).toBeCloseTo(29.5589, 3);
    expect(margem.semDesconto).toMatchObject({ receitaCentavos: 12_345, margemCentavos: 4_345 });
    expect(
      margem.itens.map((i: { considerado: boolean; motivo: string | null; pmcCentavos: number | null }) => [
        i.considerado,
        i.motivo,
        i.pmcCentavos,
      ]),
    ).toEqual([
      [true, null, 8_000],
      [false, 'servico', null],
    ]);

    // Aprovação histórica não muda com o cadastro (caso 8).
    await pmc(12_000, 10_000);
    expect((await c.aprovacao(c.chamar, id)).json().snapshot.margem.comDesconto.custoCentavos).toBe(8_000);
    // O gerente decide, mas sem "Custos e margem" não recebe a margem.
    const doGerente = (await c.aprovacao(c.gerente.chamar, id)).json();
    expect(doGerente.podeDecidir).toBe(true);
    expect(doGerente.snapshot).not.toHaveProperty('margem');
  });

  it('alçada insuficiente não aprova; o Administrador aprova; quem pediu não decide', async () => {
    const c = await comAlcadas('Oficina Alçada Insuficiente');
    const vinte = (await c.emitir(c.atendente.chamar, 20)).o.aprovacaoComercial as NonNullable<AprovacaoDoc>;
    expect(vinte.percentual).toBe(2000);
    const lida = (await c.aprovacao(c.gerente.chamar, vinte.id)).json();
    expect(lida).toMatchObject({
      podeDecidir: false,
      motivoBloqueio: 'Sua alçada (15,00%) não cobre 20,00% de desconto.',
    });
    const negado = await c.decidir(c.gerente.chamar, vinte.id, 'aprovar', lida.versao);
    expect(negado.statusCode).toBe(403);
    expect((await c.gerente.chamar('GET', '/api/aprovacoes-comerciais?posso=true')).json().total).toBe(0);

    const cinquenta = (await c.emitir(c.atendente.chamar, 50)).o.aprovacaoComercial as NonNullable<AprovacaoDoc>;
    for (const pedido of [vinte, cinquenta]) {
      const versao = (await c.aprovacao(c.chamar, pedido.id)).json().versao;
      const ok = await c.decidir(c.chamar, pedido.id, 'aprovar', versao);
      expect(ok.json()).toMatchObject({ status: 'aprovada', decisorFuncao: 'Administrador', alcadaDecisor: 10_000 });
    }

    // Gerente que também é vendedor pede 20%; mesmo com a alçada aumentada depois, não aprova o próprio pedido.
    const vendedorGerente = (
      await c.chamar('POST', '/api/vendedores', { usuarioId: c.gerente.id, whatsapp: '(48) 99999-0001' })
    ).json();
    expect(vendedorGerente.id).toBeDefined();
    const proprio = (await c.emitir(c.gerente.chamar, 20)).o.aprovacaoComercial as NonNullable<AprovacaoDoc>;
    await c.alcada(c.gerenteFuncao.id, 25);
    const meu = (await c.aprovacao(c.gerente.chamar, proprio.id)).json();
    expect(meu.motivoBloqueio).toBe('Quem pediu a aprovação não pode decidi-la.');
    expect((await c.decidir(c.gerente.chamar, proprio.id, 'aprovar', meu.versao)).statusCode).toBe(403);
    // O vendedor-gerente só enxerga o que é dele ou o que a alçada dele cobre; o outro gerente decide.
    const visiveis = (await c.gerente.chamar('GET', '/api/aprovacoes-comerciais?status=')).json();
    expect(visiveis.itens.map((a: { id: string }) => a.id)).toEqual([proprio.id]);
    expect((await c.decidir(c.gerente2.chamar, proprio.id, 'aprovar', meu.versao)).statusCode).toBe(200);
  });

  it('reprovação exige justificativa; a nova versão é reavaliada e a aprovação da anterior permanece', async () => {
    const c = await comAlcadas('Oficina Alçada Versões');
    const v1 = (await c.emitir(c.atendente.chamar, 8)).o;
    const pedidoV1 = v1.aprovacaoComercial.id as string;
    await c.decidir(c.gerente.chamar, pedidoV1, 'aprovar', 1);

    // v2 com 12%: a aprovação da v1 não vale para ela.
    const lidaV1 = (await c.atendente.chamar('GET', `/api/orcamentos/${v1.id}`)).json();
    const v2 = (await transicao(c.atendente.chamar, v1.id, 'nova-versao', lidaV1.versao)).json();
    expect(v2.aprovacaoComercial).toBeNull();
    const alterada = (
      await c.atendente.chamar('PUT', `/api/orcamentos/${v2.id}`, {
        ...orcamento(c, [{ ...reenviar(v2)[0], precoUnitarioCentavos: undefined, descontoPercentual: 12 }]),
        versao: v2.versao,
      })
    ).json();
    const emitidaV2 = (await transicao(c.atendente.chamar, v2.id, 'emitir', alterada.versao)).json();
    expect(emitidaV2.situacao).toBe('aguardando_aprovacao_comercial');
    const pedidoV2 = emitidaV2.aprovacaoComercial.id as string;
    expect(pedidoV2).not.toBe(pedidoV1);
    expect((await c.aprovacao(c.gerente.chamar, pedidoV2)).json().documentoVersao).toBe(2);
    expect((await c.aprovacao(c.gerente.chamar, pedidoV1)).json()).toMatchObject({
      status: 'aprovada',
      documentoVersao: 1,
    });

    // Reprovar sem justificativa: 400. Com ela: v2 reprovada comercialmente, com o motivo no histórico.
    expect((await c.decidir(c.gerente.chamar, pedidoV2, 'reprovar', 1)).statusCode).toBe(400);
    expect((await c.decidir(c.gerente.chamar, pedidoV2, 'reprovar', 1, '   ')).statusCode).toBe(400);
    const reprovada = await c.decidir(c.gerente.chamar, pedidoV2, 'reprovar', 1, 'Acima da política comercial.');
    expect(reprovada.json()).toMatchObject({ status: 'reprovada', justificativa: 'Acima da política comercial.' });
    const v2Reprovada = (await c.atendente.chamar('GET', `/api/orcamentos/${v2.id}`)).json();
    expect(v2Reprovada.situacao).toBe('reprovado_comercialmente');
    expect(v2Reprovada.eventos[0]).toMatchObject({
      evento: 'reprovado_comercialmente',
      detalhe: 'Acima da política comercial.',
    });

    // Para corrigir, nova versão (a v3 nasce rascunho).
    const v3 = (await transicao(c.atendente.chamar, v2.id, 'nova-versao', v2Reprovada.versao)).json();
    expect([v3.versaoOrcamento, v3.situacao]).toEqual([3, 'rascunho']);
  });

  it('o solicitante retira o pedido (volta a rascunho); cancelar o orçamento cancela o pedido', async () => {
    const c = await comAlcadas('Oficina Alçada Retirar');
    const { o } = await c.emitir(c.atendente.chamar, 8);
    // Só quem pediu retira (o Administrador altera o orçamento, mas não retira o pedido de outro).
    expect((await transicao(c.chamar, o.id, 'retirar-aprovacao', o.versao)).statusCode).toBe(403);
    const retirado = (await transicao(c.atendente.chamar, o.id, 'retirar-aprovacao', o.versao)).json();
    expect(retirado.situacao).toBe('rascunho');
    expect(retirado.aprovacaoComercial.status).toBe('cancelada');
    const cancelada = (await c.aprovacao(c.chamar, o.aprovacaoComercial.id)).json();
    expect(cancelada.eventos.at(-1)).toMatchObject({
      evento: 'cancelada',
      detalhe: 'Pedido retirado pelo solicitante.',
    });

    // Emitido de novo e cancelado: a pendente é cancelada junto.
    const outra = (await transicao(c.atendente.chamar, o.id, 'emitir', retirado.versao)).json();
    expect(outra.aprovacaoComercial.status).toBe('pendente');
    const cancelado = (await transicao(c.atendente.chamar, o.id, 'cancelar', outra.versao, 'Cliente desistiu')).json();
    expect(cancelado.situacao).toBe('cancelado');
    expect(cancelado.aprovacaoComercial.status).toBe('cancelada');
  });

  it('decisões simultâneas: só a primeira vale', async () => {
    const c = await comAlcadas('Oficina Alçada Concorrência');
    const pedido = (await c.emitir(c.atendente.chamar, 8)).o.aprovacaoComercial as NonNullable<AprovacaoDoc>;
    const respostas = await Promise.all([
      c.decidir(c.gerente.chamar, pedido.id, 'aprovar', 1),
      c.decidir(c.gerente2.chamar, pedido.id, 'reprovar', 1, 'Não'),
    ]);
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const final = (await c.aprovacao(c.chamar, pedido.id)).json();
    expect(final.eventos.filter((e: { evento: string }) => ['aprovada', 'reprovada'].includes(e.evento))).toHaveLength(
      1,
    );
  });

  it('sem ninguém com alçada suficiente, a emissão é recusada', async () => {
    const c = await comAlcadas('Oficina Alçada Sem Aprovador');
    await c.alcada(c.funcaoId('Administrador'), 30);
    const { resposta } = await c.emitir(c.atendente.chamar, 50);
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().erro).toMatch(
      /Nenhum usuário pode aprovar 50,00% de desconto \(a maior alçada de quem aprova é 30,00%\)/,
    );
    // Alçada inativa vale 0%.
    await c.alcada(c.funcaoId('Atendente'), 5, false);
    expect((await c.atendente.chamar('GET', '/api/alcadas/minha')).json().percentual).toBe(0);
  });

  it('histórico e decisão não podem ser alterados nem apagados, nem por fora da API', async () => {
    const c = await comAlcadas('Oficina Alçada Imutável');
    const pedido = (await c.emitir(c.atendente.chamar, 8)).o.aprovacaoComercial as NonNullable<AprovacaoDoc>;
    await c.decidir(c.gerente.chamar, pedido.id, 'aprovar', 1);
    for (const consulta of [
      sql`update aprovacoes_comerciais_eventos set detalhe = 'x' where aprovacao_id = ${pedido.id}`,
      sql`delete from aprovacoes_comerciais_eventos where aprovacao_id = ${pedido.id}`,
      sql`update aprovacoes_comerciais set justificativa = 'x' where id = ${pedido.id}`,
      sql`delete from aprovacoes_comerciais where id = ${pedido.id}`,
      sql`update alcadas_desconto_eventos set percentual_depois = 0`,
    ])
      await expect(c.banco(consulta)).rejects.toThrow();
  });

  it('só o Administrador configura alçadas, com a versão lida e valores válidos', async () => {
    const c = await comAlcadas('Oficina Alçada Configuração');
    expect((await c.atendente.chamar('GET', '/api/alcadas')).statusCode).toBe(403);
    expect(
      (await c.gerente.chamar('PUT', `/api/alcadas/${c.gerenteFuncao.id}`, { percentual: 99, ativa: true, versao: 1 }))
        .statusCode,
    ).toBe(403);
    const lista = (await c.chamar('GET', '/api/alcadas')).json();
    expect(lista.map((a: { funcao: string; percentual: number }) => [a.funcao, a.percentual])).toEqual([
      ['Administrador', 10_000],
      ['Almoxarife', 0],
      ['Atendente', 500],
      ['Financeiro', 0],
      ['Gerente', 1500],
      ['Mecânico', 0],
    ]);
    const gerente = lista.find((a: { funcao: string }) => a.funcao === 'Gerente');
    const url = `/api/alcadas/${c.gerenteFuncao.id}`;
    expect((await c.chamar('PUT', url, { percentual: 20, ativa: true, versao: gerente.versao + 1 })).statusCode).toBe(
      409,
    );
    expect((await c.chamar('PUT', url, { percentual: 100.5, ativa: true, versao: gerente.versao })).statusCode).toBe(
      400,
    );
    expect((await c.chamar('PUT', url, { percentual: 7.555, ativa: true, versao: gerente.versao })).statusCode).toBe(
      400,
    );
    const ok = await c.chamar('PUT', url, { percentual: 7.5, ativa: true, versao: gerente.versao });
    expect(ok.json()).toMatchObject({ percentual: 750, versao: gerente.versao + 1 });
  });
});
