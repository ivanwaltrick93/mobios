import { randomUUID } from 'node:crypto';
import { hojeIso, SEM_ACESSO } from '@mobios/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from './app.js';
import { db, sqlClient, withTenant } from './db/client.js';
import { criarOficinaComAdmin } from './db/admin-inicial.js';
import { COOKIE_SESSAO } from './lib/auth.js';

// Ordens de Serviço, onda 5.1 (docs/modulos/ORDENS_SERVICO.md) e conversão do orçamento (ORCAMENTOS.md §6).
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
  // `tipo`: envio de arquivo como o próprio corpo (fotos da O.S.).
  return (method: Metodo, url: string, payload?: object | Buffer, tipo?: string) =>
    app.inject({
      method,
      url,
      payload,
      headers: tipo ? { 'content-type': tipo } : undefined,
      cookies: { [COOKIE_SESSAO]: token },
    });
}
type Chamar = Awaited<ReturnType<typeof entrar>>;

async function novaOficina(nome: string) {
  const email = `${randomUUID()}@teste.dev`;
  const { tenant } = await criarOficinaComAdmin(db, { oficina: nome, nome: 'Admin Teste', email, senha: SENHA });
  const chamar = await entrar(email);
  const funcoes = async () => (await chamar('GET', '/api/funcoes')).json() as { id: string; nome: string }[];
  /** Usuário com uma função (já logado). */
  const pessoa = async (funcao: string, nomePessoa = funcao) => {
    const f = (await funcoes()).find((x) => x.nome === funcao)!;
    const e = `${randomUUID()}@teste.dev`;
    const u = (
      await chamar('POST', '/api/usuarios', {
        nome: `${nomePessoa} ${e.slice(0, 4)}`,
        email: e,
        funcoes: [f.id],
        senha: SENHA,
      })
    ).json() as { id: string; nome: string };
    return { id: u.id, nome: u.nome, chamar: await entrar(e) };
  };
  const banco = (consulta: ReturnType<typeof sql>) => withTenant(tenant.id, (tx) => tx.execute(consulta));
  return { chamar, tid: tenant.id, pessoa, banco, funcoes };
}
type Oficina = Awaited<ReturnType<typeof novaOficina>>;

/** Cliente com o cadastro completo e um veículo completo (ativo, com os anos). */
async function clienteCompleto(o: Oficina, nome: string) {
  const [c] = await o.banco(sql`insert into clientes (nome, cpf_cnpj, telefone, whatsapp)
    values (${nome}, ${String(Math.floor(Math.random() * 1e11)).padStart(11, '7')}, '4832221000', '48999990000')
    returning id`);
  await o.banco(sql`insert into cliente_enderecos (cliente_id, tipo, cep, logradouro, numero, bairro, cidade, uf, principal)
    values (${c!.id}, 'residencial', '88000000', 'Rua A', '1', 'Centro', 'Florianópolis', 'SC', true)`);
  const placa = `OSX${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
  const [v] =
    await o.banco(sql`insert into veiculos (cliente_id, placa, marca, modelo, ano_fabricacao, ano_modelo, km_atual)
    values (${c!.id}, ${placa}, 'Fiat', 'Uno', 2020, 2021, 50000) returning id`);
  return { id: c!.id as string, veiculoId: v!.id as string, placa };
}

/** Oficina com tabela padrão, produto, produto sem uso em O.S., serviços (fechado e por hora), vendedor e cliente. */
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
        descricao: `Produto ${sku}`,
        tipoId,
        categoriaId: categoria.id,
        unidade: 'UN',
        ...extra,
      })
    ).json();
  const varejo = (await o.chamar('POST', '/api/tabelas-preco', { codigo: 'VAREJO', nome: 'Varejo' })).json();
  const preco = (item: { materialId?: string; servicoId?: string }, precoCentavos: number) =>
    o.chamar('PUT', '/api/precos/padrao', { ...item, tabelaPrecoId: varejo.id, precoCentavos });
  const filtro = await material('FIL-OS');
  const semUso = await material('SEMUSO', { permiteUsoOs: false });
  const alinhamento = (await o.chamar('POST', '/api/servicos', { nome: 'Alinhamento', formaPreco: 'fechado' })).json();
  await preco({ materialId: filtro.id }, 10_000);
  await preco({ materialId: semUso.id }, 5_000);
  await preco({ servicoId: alinhamento.id }, 8_000);
  const atendente = await o.pessoa('Atendente');
  const vendedor = (
    await o.chamar('POST', '/api/vendedores', { usuarioId: atendente.id, whatsapp: '(48) 99999-0000' })
  ).json();
  const cliente = await clienteCompleto(o, 'Joana Pereira');
  return { ...o, material, preco, varejo, filtro, semUso, alinhamento, atendente, vendedor, cliente };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;

const abrir = (c: Cenario, chamar: Chamar = c.chamar, extra: object = {}) =>
  chamar('POST', '/api/ordens-servico', {
    clienteId: c.cliente.id,
    veiculoId: c.cliente.veiculoId,
    kmEntrada: 52_000,
    relatoCliente: 'Barulho na suspensão',
    vendedorId: '',
    previsaoEntrega: '',
    ...extra,
  });
const servico = (c: Cenario, extra: object = {}) => ({
  tipo: 'servico',
  servicoId: c.alinhamento.id,
  quantidade: 1,
  ...extra,
});
const produto = (c: Cenario, extra: object = {}) => ({
  tipo: 'material',
  materialId: c.filtro.id,
  quantidade: 2,
  ...extra,
});
const servicoAvulso = {
  avulso: true,
  tipo: 'servico',
  descricao: 'Soldar suporte do escapamento',
  formaPreco: 'hora',
  tempoMinutos: '1:30',
  precoUnitarioCentavos: 6_000,
};
const pecaAvulsa = {
  avulso: true,
  tipo: 'material',
  descricao: 'Parafuso especial',
  unidade: 'UN',
  quantidade: 3,
  precoUnitarioCentavos: 1_200,
};

type Os = {
  id: string;
  numero: number;
  situacao: string;
  versao: number;
  totalCentavos: number;
  itens: {
    id: string;
    tipo: string;
    avulso: boolean;
    codigo: string | null;
    descricao: string;
    materialId: string | null;
    servicoId: string | null;
    quantidade: number | null;
    tempoMinutos: number | null;
    precoUnitarioCentavos: number;
    precoTabelaCentavos: number;
    totalCentavos: number;
    aprovacao: string;
    formaPreco: string | null;
    unidade: string;
    executadoEm: string | null;
    executadoPor: string | null;
    mecanicos: { id: string; nome: string }[];
  }[];
  permissoes: { alterar: boolean; produtos: boolean };
  [k: string]: unknown;
};

/** Itens como a tela reenvia (id, o que muda, e os avulsos inteiros). */
const reenviar = (os: Os) =>
  os.itens.map((i) =>
    i.avulso
      ? {
          id: i.id,
          avulso: true,
          tipo: i.tipo,
          descricao: i.descricao,
          ...(i.tipo === 'servico' ? { formaPreco: i.formaPreco } : { unidade: i.unidade }),
          ...(i.tempoMinutos != null ? { tempoMinutos: i.tempoMinutos } : { quantidade: i.quantidade }),
          precoUnitarioCentavos: i.precoUnitarioCentavos,
        }
      : {
          id: i.id,
          tipo: i.tipo,
          ...(i.materialId ? { materialId: i.materialId } : { servicoId: i.servicoId }),
          ...(i.quantidade != null ? { quantidade: i.quantidade } : { tempoMinutos: i.tempoMinutos }),
          ...(i.materialId ? { precoUnitarioCentavos: i.precoUnitarioCentavos } : {}),
        },
  );
const salvarItens = (chamar: Chamar, os: Os, itens: object[]) =>
  chamar('PUT', `/api/ordens-servico/${os.id}/itens`, { itens, versao: os.versao });
const acao = (chamar: Chamar, os: Os, nomeAcao: string, motivo?: string) =>
  chamar('POST', `/api/ordens-servico/${os.id}/${nomeAcao}`, { versao: os.versao, motivo });

/** Orçamento aprovado (Administrador): cria, emite e aprova. */
async function orcamentoAprovado(c: Cenario, itens: object[], extra: object = {}) {
  const o = (
    await c.chamar('POST', '/api/orcamentos', {
      clienteId: c.cliente.id,
      veiculoId: c.cliente.veiculoId,
      vendedorId: c.vendedor.id,
      validadeAte: null,
      itens,
      ...extra,
    })
  ).json();
  const emitido = (await c.chamar('POST', `/api/orcamentos/${o.id}/emitir`, { versao: o.versao })).json();
  return (await c.chamar('POST', `/api/orcamentos/${o.id}/aprovar`, { versao: emitido.versao })).json();
}

describe('O.S.: abertura no balcão (OS-02)', () => {
  it('abre com número por oficina, tabela padrão e atualiza o veículo; números simultâneos não se repetem', async () => {
    const c = await cenario('Oficina OS Abertura');
    const res = await abrir(c);
    expect(res.statusCode).toBe(201);
    const os = res.json();
    expect(os).toMatchObject({
      numero: 1,
      situacao: 'aberta',
      kmEntrada: 52_000,
      tabela: { codigo: 'VAREJO' },
      orcamento: null,
      itens: [],
      permissoes: { alterar: true, produtos: true },
    });
    expect(os.eventos[0]).toMatchObject({ evento: 'criada', situacaoNova: 'aberta' });
    const [v] = await c.banco(
      sql`select km_atual, ultima_visita::text as dia from veiculos where id = ${c.cliente.veiculoId}`,
    );
    expect(v).toEqual({ km_atual: 52_000, dia: hojeIso() });
    // Km menor que o atual não diminui o do veículo.
    await abrir(c, c.chamar, { kmEntrada: 10 });
    const [v2] = await c.banco(sql`select km_atual from veiculos where id = ${c.cliente.veiculoId}`);
    expect(v2!.km_atual).toBe(52_000);

    const simultaneas = await Promise.all(Array.from({ length: 5 }, () => abrir(c)));
    const numeros = simultaneas.map((r) => r.json().numero as number).sort((a, b) => a - b);
    expect(numeros).toEqual([3, 4, 5, 6, 7]);
  });

  it('bloqueia cliente inativo ou incompleto, veículo de outro cliente, vendido ou incompleto, e km inválido', async () => {
    const c = await cenario('Oficina OS Bloqueios');
    const outro = await clienteCompleto(c, 'Outro Cliente');
    const erro = async (extra: object) => {
      const r = await abrir(c, c.chamar, extra);
      return [r.statusCode, r.json().erro as string];
    };
    expect(await erro({ veiculoId: outro.veiculoId })).toEqual([400, 'O veículo escolhido não é deste cliente.']);
    expect((await abrir(c, c.chamar, { kmEntrada: -1 })).statusCode).toBe(400);
    expect((await abrir(c, c.chamar, { kmEntrada: undefined })).statusCode).toBe(400);

    await c.banco(sql`update veiculos set ano_modelo = null where id = ${c.cliente.veiculoId}`);
    expect((await erro({}))[1]).toMatch(/Complete o cadastro do veículo.*ano modelo/);
    await c.banco(sql`update veiculos set ano_modelo = 2021, status = 'vendido' where id = ${c.cliente.veiculoId}`);
    expect((await erro({}))[1]).toMatch(/está vendido/);
    await c.banco(sql`update veiculos set status = 'ativo' where id = ${c.cliente.veiculoId}`);
    await c.banco(sql`update clientes set whatsapp = null where id = ${c.cliente.id}`);
    expect((await erro({}))[1]).toMatch(/Complete o cadastro do cliente.*WhatsApp/);
    await c.banco(sql`update clientes set whatsapp = '48999990000', ativo = false where id = ${c.cliente.id}`);
    expect((await erro({}))[1]).toMatch(/está inativo/);
  });

  it('sem tabela de preço padrão não abre; quem não edita O.S. não abre', async () => {
    const o = await novaOficina('Oficina OS Sem Tabela');
    const cliente = await clienteCompleto(o, 'Sem Tabela');
    const r = await o.chamar('POST', '/api/ordens-servico', {
      clienteId: cliente.id,
      veiculoId: cliente.veiculoId,
      kmEntrada: 1,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toMatch(/tabela de preço padrão/);
    const financeiro = await o.pessoa('Financeiro');
    const f = await financeiro.chamar('POST', '/api/ordens-servico', {
      clienteId: cliente.id,
      veiculoId: cliente.veiculoId,
      kmEntrada: 1,
    });
    expect(f.statusCode).toBe(403);
  });
});

describe('O.S.: itens e situações', () => {
  it('itens do catálogo e avulsos, aprovação total do cliente e o ciclo até a execução', async () => {
    const c = await cenario('Oficina OS Ciclo');
    let os = (await abrir(c)).json() as Os;
    const r = await salvarItens(c.chamar, os, [
      servico(c),
      produto(c, { descontoPercentual: 5 }),
      servicoAvulso,
      pecaAvulsa,
    ]);
    expect(r.statusCode).toBe(200);
    os = r.json();
    expect(os.itens.map((i) => [i.codigo, i.avulso, i.aprovacao, i.totalCentavos])).toEqual([
      ['000001', false, 'pendente', 8_000],
      ['FIL-OS', false, 'pendente', 19_000],
      [null, true, 'pendente', 9_000],
      [null, true, 'pendente', 3_600],
    ]);
    expect(os).toMatchObject({
      subtotalServicosCentavos: 17_000,
      subtotalMateriaisCentavos: 23_600,
      descontoCentavos: 1_000,
      totalCentavos: 39_600,
    });

    // Com itens pendentes, não executa; aguardando o cliente, os itens não mudam.
    expect((await acao(c.chamar, os, 'iniciar-execucao')).statusCode).toBe(409);
    os = (await acao(c.chamar, os, 'iniciar-diagnostico')).json();
    expect(os.situacao).toBe('em_diagnostico');
    os = (await acao(c.chamar, os, 'solicitar-aprovacao')).json();
    expect(os.situacao).toBe('aguardando_aprovacao');
    expect((await salvarItens(c.chamar, os, reenviar(os))).statusCode).toBe(409);
    expect((await acao(c.chamar, os, 'iniciar-execucao')).statusCode).toBe(409);

    os = (await acao(c.chamar, os, 'aprovar')).json();
    expect(os.situacao).toBe('aprovada');
    expect(os.itens.every((i) => i.aprovacao === 'aprovado')).toBe(true);
    expect(os.aprovadaPor).toBe('Admin Teste');

    // Depois da aprovação do cliente, item novo entra direto, aprovado.
    os = (await salvarItens(c.chamar, os, [...reenviar(os), servico(c, { quantidade: 2 })])).json();
    expect(os.itens.at(-1)!.aprovacao).toBe('aprovado');

    os = (await acao(c.chamar, os, 'iniciar-execucao')).json();
    expect(os.situacao).toBe('em_execucao');
    os = (await acao(c.chamar, os, 'aguardar-peca', 'Pastilha em falta')).json();
    expect(os.situacao).toBe('aguardando_peca');
    os = (await acao(c.chamar, os, 'retomar')).json();
    expect(os.situacao).toBe('em_execucao');

    // Versão velha e transição inválida: 409. Cancelar exige motivo.
    expect((await acao(c.chamar, { ...os, versao: 1 }, 'aguardar-peca')).statusCode).toBe(409);
    expect((await acao(c.chamar, os, 'aprovar')).statusCode).toBe(409);
    expect((await acao(c.chamar, os, 'cancelar')).statusCode).toBe(400);
    os = (await acao(c.chamar, os, 'cancelar', 'Cliente desistiu')).json();
    expect(os).toMatchObject({ situacao: 'cancelada', motivoCancelamento: 'Cliente desistiu' });
    expect((await acao(c.chamar, os, 'retomar')).statusCode).toBe(409);

    const eventos = (os.eventos as { evento: string }[]).map((e) => e.evento).reverse();
    expect(eventos).toEqual([
      'criada',
      'itens_alterados',
      'descontos_alterados',
      'diagnostico_iniciado',
      'aprovacao_solicitada',
      'aprovada',
      'itens_alterados',
      'execucao_iniciada',
      'aguardando_peca',
      'execucao_retomada',
      'cancelada',
    ]);
    // Histórico só de inclusão.
    await expect(c.banco(sql`delete from os_eventos where ordem_servico_id = ${os.id}`)).rejects.toThrow();
  });

  it('cliente recusa: O.S. recusada; produto sem "Permite uso em O.S." não entra; avulso sem desconto', async () => {
    const c = await cenario('Oficina OS Recusa');
    let os = (await abrir(c)).json() as Os;
    const semUso = await salvarItens(c.chamar, os, [{ tipo: 'material', materialId: c.semUso.id, quantidade: 1 }]);
    expect(semUso.statusCode).toBe(400);
    expect(semUso.json().erro).toMatch(/Permite uso em O.S./);
    const invalido = await salvarItens(c.chamar, os, [{ ...pecaAvulsa, unidade: undefined }]);
    expect(invalido.statusCode).toBe(400);

    os = (await salvarItens(c.chamar, os, [servico(c)])).json();
    os = (await acao(c.chamar, os, 'solicitar-aprovacao')).json();
    os = (await acao(c.chamar, os, 'recusar', 'Achou caro')).json();
    expect(os).toMatchObject({ situacao: 'recusada', motivoRecusa: 'Achou caro' });
  });

  it('produto na O.S. exige "Peças na O.S."; o mecânico vinculado inclui serviço, mas não produto', async () => {
    const c = await cenario('Oficina OS Peças');
    const mecanico = await c.pessoa('Mecânico');
    let os = (await abrir(c)).json() as Os;
    os = (
      await c.chamar('POST', `/api/ordens-servico/${os.id}/mecanicos`, { usuarioId: mecanico.id, versao: os.versao })
    ).json();
    expect(os.mecanicosVinculados).toEqual([{ id: mecanico.id, nome: mecanico.nome }]);
    const visto = (await mecanico.chamar('GET', `/api/ordens-servico/${os.id}`)).json() as Os;
    expect(visto.permissoes).toEqual({ alterar: true, produtos: false });
    expect((await salvarItens(mecanico.chamar, visto, [produto(c)])).statusCode).toBe(403);
    expect((await salvarItens(mecanico.chamar, visto, [pecaAvulsa])).statusCode).toBe(403);
    expect((await salvarItens(mecanico.chamar, visto, [servico(c)])).statusCode).toBe(200);
  });
});

describe('O.S.: quem vê e quem altera', () => {
  it('o mecânico só vê as vinculadas; qualquer vendedor vê todas e altera as dele; os demais conforme o módulo', async () => {
    const c = await cenario('Oficina OS Visibilidade');
    const mecanico = await c.pessoa('Mecânico');
    const financeiro = await c.pessoa('Financeiro');
    // Vendedor sem "O.S." na função: vê todas e altera só a O.S. em que é o vendedor.
    await c.chamar('POST', '/api/funcoes', {
      nome: 'Vendedor externo',
      descricao: null,
      ativa: true,
      parametros: ['VENDEDOR'],
      acessos: { ...SEM_ACESSO, orcamentos: 'editar' },
    });
    const externo = await c.pessoa('Vendedor externo');
    const vendedorExterno = (
      await c.chamar('POST', '/api/vendedores', { usuarioId: externo.id, whatsapp: '(48) 98888-0000' })
    ).json();

    const dele = (await abrir(c, c.chamar, { vendedorId: vendedorExterno.id })).json() as Os;
    const outra = (await abrir(c)).json() as Os;

    const lista = async (chamar: Chamar) =>
      ((await chamar('GET', '/api/ordens-servico')).json().itens as { id: string }[]).map((o) => o.id).sort();
    expect(await lista(mecanico.chamar)).toEqual([]);
    expect((await mecanico.chamar('GET', `/api/ordens-servico/${dele.id}`)).statusCode).toBe(404);
    await c.chamar('POST', `/api/ordens-servico/${dele.id}/mecanicos`, { usuarioId: mecanico.id, versao: dele.versao });
    expect(await lista(mecanico.chamar)).toEqual([dele.id]);
    expect((await mecanico.chamar('GET', `/api/ordens-servico?mecanicoId=${mecanico.id}`)).json().total).toBe(1);

    expect(await lista(externo.chamar)).toEqual([dele.id, outra.id].sort());
    const minha = (await externo.chamar('GET', `/api/ordens-servico/${dele.id}`)).json() as Os;
    expect(minha.permissoes.alterar).toBe(true);
    expect((await acao(externo.chamar, minha, 'iniciar-diagnostico')).statusCode).toBe(200);
    expect((await acao(externo.chamar, outra, 'iniciar-diagnostico')).statusCode).toBe(403);
    expect((await abrir(c, externo.chamar)).statusCode).toBe(403);

    // Financeiro consulta O.S.: vê todas, não altera.
    expect(await lista(financeiro.chamar)).toEqual([dele.id, outra.id].sort());
    expect((await acao(financeiro.chamar, outra, 'iniciar-diagnostico')).statusCode).toBe(403);
    // Sem acesso nenhum a O.S. (e sem ser vendedor): 403.
    await c.chamar('POST', '/api/funcoes', {
      nome: 'Só clientes',
      descricao: null,
      ativa: true,
      acessos: { ...SEM_ACESSO, clientes: 'consultar' },
    });
    const semOs = await c.pessoa('Só clientes');
    expect((await semOs.chamar('GET', '/api/ordens-servico')).statusCode).toBe(403);

    // Mecânico vinculável: só usuário com função de mecânico.
    const r = await c.chamar('POST', `/api/ordens-servico/${outra.id}/mecanicos`, {
      usuarioId: financeiro.id,
      versao: outra.versao,
    });
    expect(r.statusCode).toBe(400);
    const mecanicos = (await c.chamar('GET', '/api/ordens-servico/apoio/mecanicos')).json() as { id: string }[];
    expect(mecanicos.map((m) => m.id)).toEqual([mecanico.id]);
  });

  it('isolamento: O.S., clientes e veículos de outra oficina nunca participam', async () => {
    const a = await cenario('Oficina OS A');
    const b = await cenario('Oficina OS B');
    const doA = (await abrir(a)).json() as Os;
    expect((await b.chamar('GET', `/api/ordens-servico/${doA.id}`)).statusCode).toBe(404);
    expect((await acao(b.chamar, doA, 'iniciar-diagnostico')).statusCode).toBe(404);
    expect((await b.chamar('GET', '/api/ordens-servico')).json().total).toBe(0);
    const cruzada = await b.chamar('POST', '/api/ordens-servico', {
      clienteId: a.cliente.id,
      veiculoId: a.cliente.veiculoId,
      kmEntrada: 1,
    });
    expect(cruzada.statusCode).toBe(400);
    const itemCruzado = await salvarItens(a.chamar, doA, [
      { tipo: 'servico', servicoId: b.alinhamento.id, quantidade: 1 },
    ]);
    expect(itemCruzado.statusCode).toBe(400);
  });

  it('busca por número, cliente ou placa; filtro de situação; "O.S. em aberto" no Início', async () => {
    const c = await cenario('Oficina OS Busca');
    const os = (await abrir(c)).json() as Os;
    const outra = await clienteCompleto(c, 'Carlos Andrade');
    await abrir(c, c.chamar, { clienteId: outra.id, veiculoId: outra.veiculoId });
    const achar = async (q: string) =>
      (
        (await c.chamar('GET', `/api/ordens-servico?q=${encodeURIComponent(q)}`)).json().itens as { numero: number }[]
      ).map((o) => o.numero);
    expect(await achar('OS-000001')).toEqual([1]);
    expect(await achar('andrade')).toEqual([2]);
    expect(await achar(c.cliente.placa)).toEqual([1]);
    await acao(c.chamar, os, 'cancelar', 'Teste');
    expect((await c.chamar('GET', '/api/ordens-servico?situacao=cancelada')).json().total).toBe(1);
    const painel = (await c.chamar('GET', '/api/painel')).json();
    expect(painel.indicadores.find((i: { id: string }) => i.id === 'os_abertas').valor).toBe(1);
  });
});

describe('conversão do orçamento em O.S. (ORCAMENTOS.md §6)', () => {
  it('orçamento aprovado com serviço vira O.S. aberta com os itens aprovados; o orçamento fica intacto', async () => {
    const c = await cenario('Oficina OS Conversão');
    const orc = await orcamentoAprovado(c, [
      { tipo: 'servico', servicoId: c.alinhamento.id, quantidade: 1 },
      { tipo: 'material', materialId: c.filtro.id, quantidade: 2, descontoPercentual: 3 },
    ]);
    const res = await c.atendente.chamar('POST', `/api/orcamentos/${orc.id}/converter`, { kmEntrada: 60_000 });
    expect(res.statusCode).toBe(201);
    expect(res.json().destino).toBe('ordem_servico');
    const os = (await c.chamar('GET', `/api/ordens-servico/${res.json().ordemServicoId}`)).json() as Os;
    expect(os).toMatchObject({
      situacao: 'aberta',
      orcamento: { id: orc.id, numero: orc.numero, versaoOrcamento: 1 },
      vendedor: { id: c.vendedor.id },
      totalCentavos: orc.totalCentavos,
    });
    expect(os.itens.map((i) => [i.codigo, i.aprovacao, i.precoUnitarioCentavos])).toEqual([
      ['000001', 'aprovado', 8_000],
      ['FIL-OS', 'aprovado', 9_700],
    ]);
    // O orçamento continua aprovado e só aponta a O.S.
    const depois = (await c.chamar('GET', `/api/orcamentos/${orc.id}`)).json();
    expect(depois).toMatchObject({
      situacao: 'aprovado',
      versao: orc.versao,
      ordemServico: { id: os.id, numero: os.numero },
    });

    // Uma O.S. por orçamento, para sempre (mesmo cancelada).
    await acao(c.chamar, os, 'cancelar', 'Desistiu');
    const segunda = await c.chamar('POST', `/api/orcamentos/${orc.id}/converter`, { kmEntrada: 60_000 });
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().erro).toBe(
      `Este orçamento já foi convertido na O.S. OS-${String(os.numero).padStart(6, '0')}.`,
    );

    // Retrato: mudar o preço e o nome no cadastro não muda a O.S.
    await c.preco({ materialId: c.filtro.id }, 99_999);
    await c.banco(sql`update materiais set descricao = 'Outro nome' where id = ${c.filtro.id}`);
    const retrato = (await c.chamar('GET', `/api/ordens-servico/${os.id}`)).json() as Os;
    expect(retrato.itens[1]).toMatchObject({ descricao: 'Produto FIL-OS', precoTabelaCentavos: 10_000 });
  });

  it('só produtos, não aprovado, sem veículo, outro vendedor e quem não é vendedor', async () => {
    const c = await cenario('Oficina OS Conversão Regras');
    const soProdutos = await orcamentoAprovado(c, [{ tipo: 'material', materialId: c.filtro.id, quantidade: 1 }]);
    const r1 = await c.chamar('POST', `/api/orcamentos/${soProdutos.id}/converter`, { kmEntrada: 1 });
    expect(r1.statusCode).toBe(409);
    expect(r1.json().erro).toMatch(/só tem produtos e não pode virar O.S.*Pedido de Venda/);
    expect((await c.chamar('GET', '/api/ordens-servico')).json().total).toBe(0);

    const rascunho = (
      await c.chamar('POST', '/api/orcamentos', {
        clienteId: c.cliente.id,
        veiculoId: c.cliente.veiculoId,
        vendedorId: c.vendedor.id,
        validadeAte: null,
        itens: [{ tipo: 'servico', servicoId: c.alinhamento.id, quantidade: 1 }],
      })
    ).json();
    const r2 = await c.chamar('POST', `/api/orcamentos/${rascunho.id}/converter`, { kmEntrada: 1 });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().erro).toMatch(/Só orçamento aprovado vira O.S./);

    const semVeiculo = await orcamentoAprovado(c, [{ tipo: 'servico', servicoId: c.alinhamento.id, quantidade: 1 }], {
      veiculoId: null,
    });
    expect((await c.chamar('POST', `/api/orcamentos/${semVeiculo.id}/converter`, { kmEntrada: 1 })).statusCode).toBe(
      400,
    );
    const comVeiculo = await c.chamar('POST', `/api/orcamentos/${semVeiculo.id}/converter`, {
      kmEntrada: 1,
      veiculoId: c.cliente.veiculoId,
    });
    expect(comVeiculo.statusCode).toBe(201);

    // Outro vendedor: não enxerga (404). Mecânico (não vendedor): 403.
    const outroAtendente = await c.pessoa('Atendente');
    await c.chamar('POST', '/api/vendedores', { usuarioId: outroAtendente.id, whatsapp: '(48) 97777-0000' });
    const aprovado = await orcamentoAprovado(c, [{ tipo: 'servico', servicoId: c.alinhamento.id, quantidade: 1 }]);
    expect(
      (await outroAtendente.chamar('POST', `/api/orcamentos/${aprovado.id}/converter`, { kmEntrada: 1 })).statusCode,
    ).toBe(404);
    const mecanico = await c.pessoa('Mecânico');
    expect(
      (await mecanico.chamar('POST', `/api/orcamentos/${aprovado.id}/converter`, { kmEntrada: 1 })).statusCode,
    ).toBe(403);
  });

  it('duas conversões ao mesmo tempo criam uma O.S. só', async () => {
    const c = await cenario('Oficina OS Conversão Simultânea');
    const orc = await orcamentoAprovado(c, [{ tipo: 'servico', servicoId: c.alinhamento.id, quantidade: 1 }]);
    const respostas = await Promise.all(
      Array.from({ length: 3 }, () => c.chamar('POST', `/api/orcamentos/${orc.id}/converter`, { kmEntrada: 5 })),
    );
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
    expect((await c.chamar('GET', '/api/ordens-servico')).json().total).toBe(1);
  });
});

describe('O.S.: alçada de desconto (aprovação comercial tipo O.S.)', () => {
  async function comAlcadas(nome: string) {
    const c = await cenario(nome);
    const funcoes = await c.funcoes();
    const idDe = (n: string) => funcoes.find((f) => f.nome === n)!.id;
    const gerenteFuncao = (
      await c.chamar('POST', '/api/funcoes', {
        nome: 'Gerente',
        descricao: null,
        ativa: true,
        acessos: { ...SEM_ACESSO, os: 'editar', aprovacao_comercial: 'editar' },
      })
    ).json() as { id: string };
    const alcada = async (id: string, percentual: number) => {
      const lista = (await c.chamar('GET', '/api/alcadas')).json() as { funcaoId: string; versao: number | null }[];
      return c.chamar('PUT', `/api/alcadas/${id}`, {
        percentual,
        ativa: true,
        versao: lista.find((a) => a.funcaoId === id)!.versao,
      });
    };
    await alcada(idDe('Atendente'), 5);
    await alcada(gerenteFuncao.id, 20);
    const gerente = await c.pessoa('Gerente');
    const os = (await abrir(c)).json() as Os;
    return { ...c, gerente, os };
  }

  it('desconto acima da alçada trava a O.S. até a decisão; aprovado, segue', async () => {
    const c = await comAlcadas('Oficina OS Alçada');
    let os = (await salvarItens(c.atendente.chamar, c.os, [produto(c, { descontoPercentual: 3 })])).json() as Os;
    expect(os.aprovacaoComercial).toBeNull();
    os = (
      await salvarItens(c.atendente.chamar, os, [
        { ...reenviar(os)[0], precoUnitarioCentavos: undefined, descontoPercentual: 10 },
      ])
    ).json();
    expect(os.aprovacaoComercial).toMatchObject({ status: 'pendente', percentual: 1_000, alcadaSolicitante: 500 });
    expect((await salvarItens(c.atendente.chamar, os, reenviar(os))).statusCode).toBe(409);
    expect((await acao(c.atendente.chamar, os, 'iniciar-diagnostico')).statusCode).toBe(409);

    const pendentes = (await c.gerente.chamar('GET', '/api/aprovacoes-comerciais?status=pendente')).json();
    expect(pendentes.itens).toEqual([
      expect.objectContaining({ tipoDocumento: 'ordem_servico', documentoId: os.id, documentoNumero: 'OS-000001' }),
    ]);
    const detalhe = (await c.gerente.chamar('GET', `/api/aprovacoes-comerciais/${pendentes.itens[0].id}`)).json();
    expect(detalhe.snapshot.documento).toEqual({ tipo: 'ordem_servico', numero: 'OS-000001', versao: 1 });
    expect(detalhe.snapshot.itens[0]).toMatchObject({ codigo: 'FIL-OS', acimaDaAlcada: true, percentual: 1_000 });
    const aprovou = await c.gerente.chamar('POST', `/api/aprovacoes-comerciais/${detalhe.id}/aprovar`, {
      versao: detalhe.versao,
    });
    expect(aprovou.statusCode).toBe(200);
    os = (await c.chamar('GET', `/api/ordens-servico/${os.id}`)).json();
    expect(os.aprovacaoComercial).toMatchObject({ status: 'aprovada' });
    expect(os.itens[0]!.precoUnitarioCentavos).toBe(9_000);
    expect((await acao(c.atendente.chamar, os, 'iniciar-diagnostico')).statusCode).toBe(200);
  });

  it('reprovado: os itens voltam ao preço de tabela; cancelar a O.S. cancela o pedido pendente', async () => {
    const c = await comAlcadas('Oficina OS Alçada Reprova');
    let os = (
      await salvarItens(c.atendente.chamar, c.os, [servico(c), produto(c, { descontoPercentual: 12 })])
    ).json() as Os;
    const pendentes = (await c.gerente.chamar('GET', '/api/aprovacoes-comerciais?status=pendente')).json().itens as {
      id: string;
      versao: number;
    }[];
    const { id: aprovacaoId, versao } = pendentes[0]!;
    await c.gerente.chamar('POST', `/api/aprovacoes-comerciais/${aprovacaoId}/reprovar`, {
      versao,
      justificativa: 'Margem baixa.',
    });
    os = (await c.chamar('GET', `/api/ordens-servico/${os.id}`)).json();
    expect(os.itens.map((i) => [i.codigo, i.precoUnitarioCentavos])).toEqual([
      ['000001', 8_000],
      ['FIL-OS', 10_000],
    ]);
    expect(os).toMatchObject({ descontoCentavos: 0, totalCentavos: 28_000 });
    expect((os.eventos as { evento: string; detalhe: string }[])[0]).toMatchObject({
      evento: 'reprovado_comercialmente',
      detalhe: 'Margem baixa. Voltaram ao preço de tabela: FIL-OS — Produto FIL-OS.',
    });

    // Novo pedido e cancelamento: o pedido é cancelado junto.
    os = (
      await salvarItens(c.atendente.chamar, os, [...reenviar(os).slice(0, 1), produto(c, { descontoPercentual: 15 })])
    ).json();
    os = (await acao(c.atendente.chamar, os, 'cancelar', 'Sem acordo')).json();
    expect(os.aprovacaoComercial).toMatchObject({ status: 'cancelada' });
  });
});

describe('O.S.: recepção e diagnóstico (onda 5.2)', () => {
  /** Imagem mínima que passa na checagem pelos bytes (assinatura PNG). */
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
  const enviarFoto = (chamar: Chamar, os: Os, categoria = 'entrada', conteudo = PNG, tipo = 'image/png') =>
    chamar('POST', `/api/ordens-servico/${os.id}/fotos?categoria=${categoria}&versao=${os.versao}`, conteudo, tipo);
  const checklist = (os: Os, extra: object = {}) => ({
    itens: [
      { item: 'Estepe', estado: 'presente' },
      { item: 'Macaco', estado: 'ausente' },
      { item: 'Rádio / som', estado: 'avariado', observacao: 'Botão quebrado' },
    ],
    combustivel: 'um_quarto',
    avariasEntrada: 'Risco na porta traseira direita',
    versao: os.versao,
    ...extra,
  });

  it('checklist de entrada: itens, combustível e avarias; regravado inteiro; repetido, versão e situação', async () => {
    const c = await cenario('Oficina OS Checklist');
    const os = (await abrir(c)).json() as Os;
    const r = await c.chamar('PUT', `/api/ordens-servico/${os.id}/checklist`, checklist(os));
    expect(r.statusCode).toBe(200);
    const salva = r.json();
    expect(salva.checklist).toEqual([
      { item: 'Estepe', estado: 'presente', observacao: null },
      { item: 'Macaco', estado: 'ausente', observacao: null },
      { item: 'Rádio / som', estado: 'avariado', observacao: 'Botão quebrado' },
    ]);
    expect(salva).toMatchObject({ combustivel: 'um_quarto', avariasEntrada: 'Risco na porta traseira direita' });
    expect(salva.checklistEm).not.toBeNull();
    expect(salva.eventos[0]).toMatchObject({
      evento: 'checklist_registrado',
      detalhe: '3 item(ns); ausente: Macaco; avariado: Rádio / som; combustível 1/4.',
    });

    // Regravar troca a lista inteira; combustível vazio vira sem informação.
    const trocada = (
      await c.chamar(
        'PUT',
        `/api/ordens-servico/${os.id}/checklist`,
        checklist(salva, { itens: [{ item: 'Tapetes', estado: 'nao_aplicavel' }], combustivel: '' }),
      )
    ).json();
    expect(trocada.checklist.map((i: { item: string }) => i.item)).toEqual(['Tapetes']);
    expect(trocada.combustivel).toBeNull();

    const repetido = await c.chamar(
      'PUT',
      `/api/ordens-servico/${os.id}/checklist`,
      checklist(trocada, {
        itens: [
          { item: 'Estepe', estado: 'presente' },
          { item: 'estepe', estado: 'ausente' },
        ],
      }),
    );
    expect(repetido.statusCode).toBe(400);
    expect((await c.chamar('PUT', `/api/ordens-servico/${os.id}/checklist`, checklist(salva))).statusCode).toBe(409);

    const cancelada = (await acao(c.chamar, trocada, 'cancelar', 'Cliente desistiu')).json() as Os;
    expect((await c.chamar('PUT', `/api/ordens-servico/${os.id}/checklist`, checklist(cancelada))).statusCode).toBe(
      409,
    );
  });

  it('diagnóstico: o mecânico vinculado registra; quem só consulta, não; apagar deixa vazio', async () => {
    const c = await cenario('Oficina OS Diagnóstico');
    const mecanico = await c.pessoa('Mecânico');
    const financeiro = await c.pessoa('Financeiro');
    const os = (await abrir(c)).json() as Os;
    const vinculada = (
      await c.chamar('POST', `/api/ordens-servico/${os.id}/mecanicos`, { usuarioId: mecanico.id, versao: os.versao })
    ).json() as Os;

    const texto = 'Bucha da bandeja dianteira esquerda gasta. Recomendo trocar o par.';
    const r = await mecanico.chamar('PUT', `/api/ordens-servico/${os.id}/diagnostico`, {
      diagnostico: texto,
      versao: vinculada.versao,
    });
    expect(r.statusCode).toBe(200);
    const comDiagnostico = r.json();
    expect(comDiagnostico.diagnostico).toBe(texto);
    expect(comDiagnostico.eventos[0]).toMatchObject({ evento: 'diagnostico_registrado', detalhe: texto });

    expect(
      (
        await financeiro.chamar('PUT', `/api/ordens-servico/${os.id}/diagnostico`, {
          diagnostico: 'x',
          versao: comDiagnostico.versao,
        })
      ).statusCode,
    ).toBe(403);
    const apagado = (
      await c.chamar('PUT', `/api/ordens-servico/${os.id}/diagnostico`, {
        diagnostico: '  ',
        versao: comDiagnostico.versao,
      })
    ).json();
    expect(apagado.diagnostico).toBeNull();
  });

  it('fotos: até 5 por O.S., tipo pelos bytes, imagem só para quem vê a O.S., remoção com histórico', async () => {
    const c = await cenario('Oficina OS Fotos');
    const outra = await cenario('Oficina OS Fotos B');
    const mecanico = await c.pessoa('Mecânico');
    let os = (await abrir(c)).json() as Os;

    const r = await enviarFoto(c.chamar, os, 'avaria');
    expect(r.statusCode).toBe(201);
    os = r.json();
    const fotos = os.fotos as { id: string; categoria: string; tamanho: number; criadaPor: string }[];
    expect(fotos).toHaveLength(1);
    expect(fotos[0]).toMatchObject({ categoria: 'avaria', tamanho: PNG.length, criadaPor: 'Admin Teste' });
    expect((os.eventos as { evento: string; detalhe: string }[])[0]).toMatchObject({
      evento: 'foto_adicionada',
      detalhe: 'Avaria',
    });

    const imagem = await c.chamar('GET', `/api/ordens-servico/${os.id}/fotos/${fotos[0]!.id}`);
    expect(imagem.statusCode).toBe(200);
    expect(imagem.headers['content-type']).toBe('image/png');
    expect(imagem.rawPayload.equals(PNG)).toBe(true);
    // Outra oficina e o mecânico não vinculado não veem a foto.
    expect((await outra.chamar('GET', `/api/ordens-servico/${os.id}/fotos/${fotos[0]!.id}`)).statusCode).toBe(404);
    expect((await mecanico.chamar('GET', `/api/ordens-servico/${os.id}/fotos/${fotos[0]!.id}`)).statusCode).toBe(404);

    // Tipo pelos bytes, não pelo cabeçalho; categoria inválida; versão lida.
    expect((await enviarFoto(c.chamar, os, 'entrada', Buffer.from('não é imagem'))).statusCode).toBe(415);
    expect((await enviarFoto(c.chamar, os, 'lataria')).statusCode).toBe(400);
    expect((await enviarFoto(c.chamar, { ...os, versao: 1 })).statusCode).toBe(409);

    for (let n = 0; n < 3; n++) os = (await enviarFoto(c.chamar, os)).json();
    // Duas ao mesmo tempo com 4 gravadas: só uma entra (a outra esbarra no limite ou na versão).
    const [a, b] = await Promise.all([enviarFoto(c.chamar, os), enviarFoto(c.chamar, os)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    os = (await c.chamar('GET', `/api/ordens-servico/${os.id}`)).json();
    expect(os.fotos).toHaveLength(5);
    const sexta = await enviarFoto(c.chamar, os);
    expect(sexta.statusCode).toBe(409);
    expect(sexta.json().erro).toContain('5 fotos');

    const primeira = (os.fotos as { id: string }[])[0]!.id;
    const semFoto = await c.chamar('DELETE', `/api/ordens-servico/${os.id}/fotos/${primeira}?versao=${os.versao}`);
    expect(semFoto.statusCode).toBe(200);
    expect(semFoto.json().fotos).toHaveLength(4);
    expect(semFoto.json().eventos[0]).toMatchObject({ evento: 'foto_removida', detalhe: 'Avaria' });
    expect((await c.chamar('GET', `/api/ordens-servico/${os.id}/fotos/${primeira}`)).statusCode).toBe(404);
  });
});

describe('O.S.: execução (onda 5.3)', () => {
  /** O.S. em execução com um serviço e um produto aprovados, e um mecânico vinculado. */
  async function emExecucao(nome: string) {
    const c = await cenario(nome);
    const mecanico = await c.pessoa('Mecânico');
    let os = (await abrir(c)).json() as Os;
    os = (await salvarItens(c.chamar, os, [servico(c), produto(c)])).json();
    os = (await acao(c.chamar, os, 'solicitar-aprovacao')).json();
    os = (await acao(c.chamar, os, 'aprovar')).json();
    os = (
      await c.chamar('POST', `/api/ordens-servico/${os.id}/mecanicos`, { usuarioId: mecanico.id, versao: os.versao })
    ).json();
    return { c, mecanico, os };
  }
  const executar = (chamar: Chamar, os: Os, itemId: string, desfazer = false) =>
    chamar('POST', `/api/ordens-servico/${os.id}/itens/${itemId}/${desfazer ? 'desfazer-execucao' : 'executar'}`, {
      versao: os.versao,
    });
  const solicitar = (chamar: Chamar, os: Os, descricao = 'Pastilha de freio dianteira') =>
    chamar('POST', `/api/ordens-servico/${os.id}/solicitacoes-peca`, {
      descricao,
      quantidade: 1,
      observacao: 'Lado esquerdo',
      versao: os.versao,
    });

  it('confirma a execução por serviço; conclui só com os serviços executados e sem peça pendente', async () => {
    const { c, mecanico, os: inicial } = await emExecucao('Oficina OS Execução');
    let os = inicial;
    const [servicoId, produtoId] = os.itens.map((i) => i.id) as [string, string];

    // Antes de iniciar a execução, não confirma.
    expect((await executar(mecanico.chamar, os, servicoId)).statusCode).toBe(409);
    os = (await acao(c.chamar, os, 'iniciar-execucao')).json();
    const incompleta = await acao(c.chamar, os, 'concluir');
    expect(incompleta.statusCode).toBe(409);
    expect(incompleta.json().erro).toContain('Alinhamento');
    expect(os.pendenciasConclusao).toEqual(['Serviço(s) sem execução confirmada: Alinhamento.']);

    expect((await executar(mecanico.chamar, os, produtoId)).statusCode).toBe(400);
    const r = await executar(mecanico.chamar, os, servicoId);
    expect(r.statusCode).toBe(200);
    os = r.json();
    expect(os.itens[0]).toMatchObject({ executadoPor: mecanico.nome });
    expect(os.itens[0]!.executadoEm).not.toBeNull();
    expect((await executar(mecanico.chamar, os, servicoId)).statusCode).toBe(409);

    // Serviço executado não muda nem sai; o produto continua editável e o serviço mantém a execução.
    const semServico = reenviar(os).slice(1);
    expect((await salvarItens(c.chamar, os, semServico)).statusCode).toBe(409);
    const [servicoReenviado, produtoReenviado] = reenviar(os);
    expect(
      (await salvarItens(c.chamar, os, [{ ...servicoReenviado, quantidade: 2 }, produtoReenviado!])).statusCode,
    ).toBe(409);
    os = (await salvarItens(c.chamar, os, [servicoReenviado!, { ...produtoReenviado, quantidade: 3 }])).json();
    expect(os.itens[0]!.executadoEm).not.toBeNull();

    // Desfazer e confirmar de novo.
    os = (await executar(mecanico.chamar, os, servicoId, true)).json();
    expect(os.itens[0]!.executadoEm).toBeNull();
    os = (await executar(mecanico.chamar, os, servicoId)).json();

    // Peça pendente segura a conclusão; o mecânico pede, não atende; quem tem "Peças na O.S." atende.
    os = (await solicitar(mecanico.chamar, os)).json();
    const [solicitacao] = os.solicitacoesPeca as { id: string; status: string }[];
    expect(solicitacao).toMatchObject({ status: 'pendente', solicitadaPor: mecanico.nome, quantidade: 1 });
    expect(os.pecasSolicitadas).toBe(1);
    expect((await acao(c.chamar, os, 'concluir')).statusCode).toBe(409);
    const url = `/api/ordens-servico/${os.id}/solicitacoes-peca/${solicitacao!.id}`;
    expect((await mecanico.chamar('POST', `${url}/atender`, { versao: os.versao })).statusCode).toBe(403);
    expect((await c.atendente.chamar('POST', `${url}/recusar`, { versao: os.versao })).statusCode).toBe(400);
    os = (
      await c.atendente.chamar('POST', `${url}/atender`, { versao: os.versao, resposta: 'Incluída nos itens' })
    ).json();
    expect((os.solicitacoesPeca as object[])[0]).toMatchObject({
      status: 'atendida',
      resolvidaPor: c.atendente.nome,
      resposta: 'Incluída nos itens',
    });
    expect((await c.atendente.chamar('POST', `${url}/recusar`, { versao: os.versao, resposta: 'x' })).statusCode).toBe(
      409,
    );

    expect(os.pendenciasConclusao).toEqual([]);
    os = (await acao(mecanico.chamar, os, 'concluir')).json();
    expect(os).toMatchObject({ situacao: 'concluida', concluidaPor: mecanico.nome });
    expect((await salvarItens(c.chamar, os, reenviar(os))).statusCode).toBe(409);
    expect((await executar(mecanico.chamar, os, servicoId, true)).statusCode).toBe(409);
    const eventos = (os.eventos as { evento: string }[]).map((e) => e.evento);
    expect(eventos.slice(0, 3)).toEqual(['concluida', 'solicitacao_atendida', 'peca_solicitada']);
    // Concluída sai das "em aberto".
    expect((await c.chamar('GET', `/api/ordens-servico?abertas=true`)).json().total).toBe(0);
  });

  it('mecânicos por serviço: atribuir vincula à O.S., regravar mantém, desvincular tira do serviço', async () => {
    const { c, mecanico, os: inicial } = await emExecucao('Oficina OS Mecânico por serviço');
    let os = inicial;
    const outro = await c.pessoa('Mecânico', 'Segundo mecânico');
    const financeiro = await c.pessoa('Financeiro');
    const servicoId = os.itens[0]!.id;
    const atribuir = (usuarioIds: string[]) =>
      c.chamar('PUT', `/api/ordens-servico/${os.id}/itens/${servicoId}/mecanicos`, { usuarioIds, versao: os.versao });

    expect((await outro.chamar('GET', `/api/ordens-servico/${os.id}`)).statusCode).toBe(404);
    expect((await atribuir([financeiro.id])).statusCode).toBe(400);
    os = (await atribuir([mecanico.id, outro.id])).json();
    expect(os.itens[0]!.mecanicos.map((m) => m.id).sort()).toEqual([mecanico.id, outro.id].sort());
    // O segundo mecânico passou a estar vinculado (e vê a O.S.).
    expect((await outro.chamar('GET', `/api/ordens-servico/${os.id}`)).statusCode).toBe(200);
    expect((os.mecanicosVinculados as { id: string }[]).map((m) => m.id).sort()).toEqual(
      [mecanico.id, outro.id].sort(),
    );

    os = (await salvarItens(c.chamar, os, reenviar(os))).json();
    expect(os.itens[0]!.mecanicos).toHaveLength(2);

    os = (await c.chamar('DELETE', `/api/ordens-servico/${os.id}/mecanicos/${outro.id}?versao=${os.versao}`)).json();
    expect(os.itens[0]!.mecanicos.map((m) => m.id)).toEqual([mecanico.id]);
    expect(
      (
        await c.chamar('PUT', `/api/ordens-servico/${os.id}/itens/${os.itens[1]!.id}/mecanicos`, {
          usuarioIds: [],
          versao: os.versao,
        })
      ).statusCode,
    ).toBe(400);

    // Lista: solicitações pendentes e o filtro das O.S. com peça pedida.
    os = (await solicitar(mecanico.chamar, os)).json();
    const lista = (await c.chamar('GET', '/api/ordens-servico?pecaPendente=true')).json();
    expect(lista.total).toBe(1);
    expect(lista.itens[0]).toMatchObject({ id: os.id, pecasSolicitadas: 1 });
  });
});
