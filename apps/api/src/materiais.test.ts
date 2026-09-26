import { randomUUID } from 'node:crypto';
import { hojeIso } from '@mobios/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from './app.js';
import { db, sqlClient, withTenant } from './db/client.js';
import { criarOficinaComAdmin } from './db/admin-inicial.js';
import { COOKIE_SESSAO } from './lib/auth.js';

// Módulo Materiais e Preços (docs/modulos/MATERIAIS_E_PRECOS.md). Mesmo esquema de app.test.ts.
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
  return (method: Metodo, url: string, payload?: object | string, headers?: Record<string, string>) =>
    app.inject({ method, url, payload, headers, cookies: { [COOKIE_SESSAO]: token } });
}

async function novaOficina(nome: string) {
  const email = `${randomUUID()}@teste.dev`;
  const { tenant } = await criarOficinaComAdmin(db, { oficina: nome, nome: 'Admin Teste', email, senha: SENHA });
  const chamar = await entrar(email);
  const tipo = async (lista: 'tiposMaterial' | 'tiposDeposito', n: string) =>
    ((await chamar('GET', `/api/opcoes/${lista}`)).json() as { id: string; nome: string }[]).find((o) => o.nome === n)!
      .id;
  /** Usuário da oficina com uma função padrão. */
  const pessoa = async (funcao: string) => {
    const funcoes = (await chamar('GET', '/api/funcoes')).json() as { id: string; nome: string }[];
    const e = `${randomUUID()}@teste.dev`;
    await chamar('POST', '/api/usuarios', {
      nome: funcao,
      email: e,
      funcoes: [funcoes.find((f) => f.nome === funcao)!.id],
      senha: SENHA,
    });
    return entrar(e);
  };
  return { chamar, tid: tenant.id, tipo, pessoa };
}

/** Data AAAA-MM-DD somando dias a hoje (Brasília). */
const dia = (n: number) => new Date(Date.parse(`${hojeIso()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function catalogoBasico(o: Awaited<ReturnType<typeof novaOficina>>) {
  const pecas = (await o.chamar('POST', '/api/categorias', { nome: 'Peças', codigo: 'pec' })).json();
  const filtros = (await o.chamar('POST', '/api/categorias', { nome: 'Filtros', categoriaPaiId: pecas.id })).json();
  const marca = (await o.chamar('POST', '/api/marcas', { nome: 'Mann Filter' })).json();
  const material = (
    await o.chamar('POST', '/api/materiais', {
      sku: 'fil-001',
      descricao: 'Filtro de óleo W712',
      tipoId: await o.tipo('tiposMaterial', 'Peça'),
      categoriaId: filtros.id,
      marcaId: marca.id,
      unidade: 'UN',
      codigoBarras: '7891000315507',
    })
  ).json();
  const tabela = (await o.chamar('POST', '/api/tabelas-preco', { codigo: 'varejo', nome: 'Varejo' })).json();
  return { pecas, filtros, marca, material, tabela };
}

describe('categorias e marcas', () => {
  it('hierarquia sem duplicidade no mesmo nível, sem ciclo e sem excluir o que está em uso', async () => {
    const o = await novaOficina('Oficina Categorias');
    const { pecas, filtros, material } = await catalogoBasico(o);
    const motor = (await o.chamar('POST', '/api/categorias', { nome: 'Motor', categoriaPaiId: pecas.id })).json();

    // Mesmo nome é permitido em níveis diferentes; no mesmo nível, não (sem diferenciar maiúsculas).
    expect((await o.chamar('POST', '/api/categorias', { nome: 'Filtros', categoriaPaiId: motor.id })).statusCode).toBe(
      201,
    );
    expect((await o.chamar('POST', '/api/categorias', { nome: 'filtros', categoriaPaiId: pecas.id })).json().erro).toBe(
      'Já existe uma categoria com este nome neste nível',
    );
    expect((await o.chamar('POST', '/api/categorias', { nome: 'Outra', codigo: 'PEC' })).json().erro).toBe(
      'Já existe uma categoria com este código',
    );

    // Ciclo: Peças abaixo de Motor (que está abaixo de Peças) e categoria pai dela mesma.
    const ciclo = await o.chamar('PUT', `/api/categorias/${pecas.id}`, {
      nome: 'Peças',
      codigo: 'PEC',
      categoriaPaiId: motor.id,
      versao: pecas.versao,
    });
    expect(ciclo.statusCode).toBe(400);
    expect(ciclo.json().erro).toMatch(/abaixo dela mesma/);
    expect(
      (
        await o.chamar('PUT', `/api/categorias/${motor.id}`, {
          nome: 'Motor',
          categoriaPaiId: motor.id,
          versao: motor.versao,
        })
      ).statusCode,
    ).toBe(400);

    // Em uso: não exclui (subcategorias ou materiais); vazia exclui.
    expect((await o.chamar('DELETE', `/api/categorias/${pecas.id}`)).statusCode).toBe(409);
    expect((await o.chamar('DELETE', `/api/categorias/${filtros.id}`)).statusCode).toBe(409);
    const vazia = (await o.chamar('POST', '/api/categorias', { nome: 'Vazia' })).json();
    expect((await o.chamar('DELETE', `/api/categorias/${vazia.id}`)).statusCode).toBe(204);

    // Inativa: continua no material, mas não pode ser escolhida de novo.
    await o.chamar('PATCH', `/api/categorias/${motor.id}/status`, { ativo: false });
    const novo = await o.chamar('POST', '/api/materiais', {
      sku: 'X1',
      descricao: 'Teste',
      tipoId: material.tipoId,
      categoriaId: motor.id,
      unidade: 'UN',
    });
    expect(novo.json().erro).toBe('Categoria: o item escolhido está inativo. Escolha outro ou reative-o.');
    const subDeInativa = await o.chamar('POST', '/api/categorias', { nome: 'Velas', categoriaPaiId: motor.id });
    expect(subDeInativa.json().erro).toBe('Categoria pai: o item escolhido está inativo. Escolha outro ou reative-o.');
    expect(
      (await o.chamar('GET', '/api/categorias')).json().find((c: { id: string }) => c.id === filtros.id).materiais,
    ).toBe(1);

    const dupMarca = await o.chamar('POST', '/api/marcas', { nome: 'MANN FILTER' });
    expect(dupMarca.json().erro).toBe('Já existe uma marca com este nome');
  });
});

describe('materiais', () => {
  it('SKU e código de barras únicos, busca e filtros, auditoria e concorrência otimista', async () => {
    const o = await novaOficina('Oficina Materiais');
    const { pecas, filtros, marca, material } = await catalogoBasico(o);
    expect(material).toMatchObject({
      sku: 'FIL-001',
      categoriaCaminho: 'Peças › Filtros',
      marcaNome: 'Mann Filter',
      criadoPor: 'Admin Teste',
      versao: 1,
      ativo: true,
      multiplo: 1, // sem informar: padrões de suprimento
      leadtimeDias: 30,
    });

    const base = { descricao: 'Outro', tipoId: material.tipoId, categoriaId: filtros.id, unidade: 'UN' };
    expect((await o.chamar('POST', '/api/materiais', { ...base, sku: 'Fil-001' })).json().erro).toBe(
      'Já existe um material com este SKU',
    );
    expect(
      (await o.chamar('POST', '/api/materiais', { ...base, sku: 'FIL-002', codigoBarras: '7891000315507' })).json()
        .erro,
    ).toBe('Já existe um material com este código de barras');
    expect(
      (await o.chamar('POST', '/api/materiais', { ...base, sku: 'FIL-002', codigoBarras: '7891000315508' })).json()
        .campos.codigoBarras,
    ).toBeDefined();
    const vela = (
      await o.chamar('POST', '/api/materiais', {
        ...base,
        sku: 'VEL-1',
        descricao: 'Vela de ignição',
        codigoFabricante: 'bkr6e',
      })
    ).json();

    const busca = async (q: string) =>
      (await o.chamar('GET', `/api/materiais?${q}`)).json().itens.map((m: { sku: string }) => m.sku);
    expect(await busca('q=fil')).toEqual(['FIL-001']); // prefixo do SKU
    expect(await busca('q=igni')).toEqual(['VEL-1']); // trecho da descrição
    expect(await busca('q=BKR6')).toEqual(['VEL-1']); // código do fabricante
    expect(await busca('q=7891000315507')).toEqual(['FIL-001']); // código de barras
    expect(await busca(`categoriaId=${pecas.id}`)).toEqual(['FIL-001', 'VEL-1']); // inclui subcategorias
    expect(await busca(`marcaId=${marca.id}`)).toEqual(['FIL-001']);

    // Concorrência otimista: quem salva com versão antiga recebe 409 (não sobrescreve a alteração do outro).
    const dados = { ...base, sku: 'VEL-1', descricao: 'Vela de ignição', codigoFabricante: 'BKR6E' };
    const primeira = await o.chamar('PUT', `/api/materiais/${vela.id}`, {
      ...dados,
      descricaoCurta: 'Vela',
      versao: 1,
    });
    expect(primeira.json()).toMatchObject({ versao: 2, descricaoCurta: 'Vela', atualizadoPor: 'Admin Teste' });
    const caixa = await o.chamar('PUT', `/api/materiais/${vela.id}`, {
      ...dados,
      multiplo: 4,
      leadtimeDias: 15,
      versao: 2,
    });
    expect(caixa.json()).toMatchObject({ multiplo: 4, leadtimeDias: 15, versao: 3 });
    expect(
      (await o.chamar('PUT', `/api/materiais/${vela.id}`, { ...dados, multiplo: 0, versao: 3 })).json().campos.multiplo,
    ).toBe('Múltiplo: número inteiro de 1 a 999.999');
    expect((await o.chamar('PUT', `/api/materiais/${vela.id}`, { ...dados, versao: 1 })).statusCode).toBe(409);
    expect((await o.chamar('PUT', `/api/materiais/${vela.id}`, dados)).statusCode).toBe(400); // sem versão

    await o.chamar('PATCH', `/api/materiais/${vela.id}/status`, { ativo: false });
    expect(await busca('ativo=false')).toEqual(['VEL-1']);
    expect((await o.chamar('DELETE', `/api/materiais/${vela.id}`)).statusCode).toBe(204); // nunca precificado
  });
});

describe('depósitos e tabelas de preço', () => {
  it('código único, tipos da oficina, ativação e exclusão', async () => {
    const o = await novaOficina('Oficina Depósitos');
    const loja = await o.tipo('tiposDeposito', 'Loja');
    const dep = await o.chamar('POST', '/api/depositos', {
      codigo: 'loja-01',
      nome: 'Loja principal',
      tipoId: loja,
      permiteTransferencia: false,
    });
    expect(dep.json()).toMatchObject({
      codigo: 'LOJA-01',
      tipoNome: 'Loja',
      permiteVenda: true,
      permiteTransferencia: false,
      ativo: true,
    });
    expect(
      (await o.chamar('POST', '/api/depositos', { codigo: 'LOJA-01', nome: 'Outro', tipoId: loja })).json().erro,
    ).toBe('Já existe um depósito com este código');
    expect((await o.chamar('PATCH', `/api/depositos/${dep.json().id}/status`, { ativo: false })).json().ativo).toBe(
      false,
    );
    expect((await o.chamar('DELETE', `/api/depositos/${dep.json().id}`)).statusCode).toBe(204);

    const tabela = await o.chamar('POST', '/api/tabelas-preco', { codigo: 'oficina', nome: 'Oficina' });
    expect(tabela.json()).toMatchObject({ codigo: 'OFICINA', moeda: 'BRL', ativa: true, materiaisComPreco: 0 });
    expect(
      (await o.chamar('POST', '/api/tabelas-preco', { codigo: 'USD', nome: 'Dólar', moeda: 'USD' })).statusCode,
    ).toBe(400);
  });
});

describe('preços por vigência', () => {
  it('nova vigência encerra a atual, respeita as futuras e nunca reescreve o passado', async () => {
    const o = await novaOficina('Oficina Preços');
    const { material, tabela } = await catalogoBasico(o);
    const precos = async () =>
      (await o.chamar('GET', `/api/precos?materialId=${material.id}`))
        .json()
        .map((p: { precoCentavos: number; dataInicio: string; dataFim: string | null; situacao: string }) => [
          p.precoCentavos,
          p.dataInicio,
          p.dataFim,
          p.situacao,
        ]);
    const novo = (precoCentavos: number, dataInicio: string, dataFim?: string) =>
      o.chamar('POST', '/api/precos', {
        materialId: material.id,
        tabelaPrecoId: tabela.id,
        precoCentavos,
        dataInicio,
        dataFim,
      });
    const vigente = async (data: string) =>
      (await o.chamar('GET', `/api/precos/vigente?sku=fil-001&tabela=varejo&data=${data}`)).json().preco
        ?.precoCentavos ?? null;

    expect((await novo(9000, dia(-1))).statusCode).toBe(400); // passado
    const p1 = (await novo(10000, dia(0))).json();
    const p2 = (await novo(11000, dia(10))).json(); // encerra p1 na véspera
    expect(await precos()).toEqual([
      [11000, dia(10), null, 'futuro'],
      [10000, dia(0), dia(9), 'vigente'],
    ]);
    expect([
      await vigente(dia(-1)),
      await vigente(dia(0)),
      await vigente(dia(9)),
      await vigente(dia(10)),
      await vigente(dia(999)),
    ]).toEqual([null, 10000, 10000, 11000, 11000]);

    // Terminar no meio da vigência atual partiria o preço em dois: recusado (sobreposição).
    expect((await novo(9500, dia(5), dia(7))).statusCode).toBe(409);
    expect((await novo(9500, dia(10))).json().erro).toMatch(/começando nesta data/);
    // Invadir um preço futuro com fim informado: recusado.
    expect((await novo(9500, dia(5), dia(12))).statusCode).toBe(409);

    // Sem fim, entre p1 e p2: p1 fecha na véspera e a nova termina antes de p2.
    const p3 = (await novo(10500, dia(5))).json();
    expect(await precos()).toEqual([
      [11000, dia(10), null, 'futuro'],
      [10500, dia(5), dia(9), 'futuro'],
      [10000, dia(0), dia(4), 'vigente'],
    ]);

    // Cancelar p3 (futuro) devolve a p1 o fim que ela tinha.
    const cancelado = await o.chamar('POST', `/api/precos/${p3.id}/cancelar`, { motivo: 'Digitado errado' });
    expect(cancelado.json()).toMatchObject({
      situacao: 'cancelado',
      motivoCancelamento: 'Digitado errado',
      canceladoPor: 'Admin Teste',
    });
    expect((await precos()).filter((p: string[]) => p[3] !== 'cancelado')).toEqual([
      [11000, dia(10), null, 'futuro'],
      [10000, dia(0), dia(9), 'vigente'],
    ]);

    // Preço em vigor não é editado nem cancelado; futuro pode ser corrigido.
    expect((await o.chamar('PUT', `/api/precos/${p1.id}`, { precoCentavos: 1, dataFim: dia(9) })).statusCode).toBe(409);
    expect((await o.chamar('POST', `/api/precos/${p1.id}/cancelar`, { motivo: 'Não pode' })).statusCode).toBe(409);
    expect(
      (await o.chamar('PUT', `/api/precos/${p2.id}`, { precoCentavos: 11500, dataFim: null })).json(),
    ).toMatchObject({ precoCentavos: 11500 });

    // Encerrar a vigência atual: não pode ser no passado nem ampliar sobre a próxima.
    expect((await o.chamar('POST', `/api/precos/${p1.id}/encerrar`, { dataFim: dia(-1) })).statusCode).toBe(400);
    expect((await o.chamar('POST', `/api/precos/${p1.id}/encerrar`, { dataFim: dia(15) })).statusCode).toBe(409);
    expect((await o.chamar('POST', `/api/precos/${p1.id}/encerrar`, { dataFim: dia(3) })).json()).toMatchObject({
      dataFim: dia(3),
      situacao: 'vigente',
    });
    expect(await vigente(dia(5))).toBeNull(); // intervalo sem preço

    // Trilha de auditoria.
    const eventos = (await o.chamar('GET', `/api/precos/${p1.id}/eventos`))
      .json()
      .map((e: { evento: string }) => e.evento);
    expect(eventos).toEqual(['criado', 'encerrado', 'encerrado', 'reaberto', 'encerrado']);
    expect((await o.chamar('GET', `/api/tabelas-preco/${tabela.id}`)).json().materiaisComPreco).toBe(1);

    // Material/tabela inativos: não recebem preço novo, mas o histórico e a consulta continuam. A tabela padrão
    // não pode ser inativada: outra passa a ser a padrão antes.
    const outra = (await o.chamar('POST', '/api/tabelas-preco', { codigo: 'outra', nome: 'Outra' })).json();
    await o.chamar('PATCH', `/api/tabelas-preco/${outra.id}/padrao`);
    await o.chamar('PATCH', `/api/tabelas-preco/${tabela.id}/status`, { ativo: false });
    expect((await novo(1, dia(20))).json().erro).toMatch(/inativa/);
    const consulta = (
      await o.chamar('GET', `/api/precos/vigente?materialId=${material.id}&tabelaPrecoId=${tabela.id}`)
    ).json();
    expect(consulta).toMatchObject({ tabela: { ativa: false }, preco: { precoCentavos: 10000 } });
    expect((await o.chamar('DELETE', `/api/tabelas-preco/${tabela.id}`)).statusCode).toBe(409);
    expect((await o.chamar('DELETE', `/api/materiais/${material.id}`)).statusCode).toBe(409);
  });

  it('o banco barra sobreposição mesmo por fora da API, e inclusões simultâneas não conflitam', async () => {
    const o = await novaOficina('Oficina Concorrência');
    const { material, tabela } = await catalogoBasico(o);
    const inserir = (inicio: string, fim: string | null) =>
      withTenant(o.tid, (tx) =>
        tx.execute(
          sql`insert into materiais_precos (material_id, tabela_preco_id, preco_centavos, data_inicio, data_fim)
            values (${material.id}, ${tabela.id}, 100, ${inicio}, ${fim})`,
        ),
      );
    await inserir('2027-01-01', '2027-12-31');
    await expect(inserir('2027-06-01', '2027-09-30')).rejects.toMatchObject({ cause: { code: '23P01' } });
    await expect(inserir('2026-12-01', null)).rejects.toMatchObject({ cause: { code: '23P01' } });
    await inserir('2028-01-01', null); // encostado no anterior: ok

    // Duas pessoas cadastrando a mesma vigência ao mesmo tempo: uma entra, a outra recebe conflito.
    const corpo = { materialId: material.id, tabelaPrecoId: tabela.id, precoCentavos: 500, dataInicio: dia(1) };
    const outraTabela = (await o.chamar('POST', '/api/tabelas-preco', { codigo: 'OFI', nome: 'Oficina' })).json();
    const respostas = await Promise.all(
      [1, 2, 3].map(() => o.chamar('POST', '/api/precos', { ...corpo, tabelaPrecoId: outraTabela.id })),
    );
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
  });

  it('permissões: almoxarife cadastra materiais mas não preços; atendente só consulta', async () => {
    const o = await novaOficina('Oficina Permissões Materiais');
    const { material, tabela, filtros } = await catalogoBasico(o);
    const almoxarife = await o.pessoa('Almoxarife');
    const atendente = await o.pessoa('Atendente');
    const mecanico = await o.pessoa('Mecânico');

    expect(
      (
        await almoxarife('POST', '/api/materiais', {
          sku: 'ALM-1',
          descricao: 'Pastilha',
          tipoId: material.tipoId,
          categoriaId: filtros.id,
          unidade: 'JG',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await almoxarife('POST', '/api/precos', {
          materialId: material.id,
          tabelaPrecoId: tabela.id,
          precoCentavos: 1,
          dataInicio: dia(1),
        })
      ).statusCode,
    ).toBe(403);
    expect((await almoxarife('GET', '/api/opcoes/tiposMaterial')).statusCode).toBe(200);
    expect((await atendente('POST', '/api/categorias', { nome: 'Não pode' })).statusCode).toBe(403);
    expect((await atendente('GET', `/api/precos/vigente?sku=FIL-001&tabela=VAREJO`)).statusCode).toBe(200);
    expect((await mecanico('GET', '/api/materiais')).statusCode).toBe(200);
    expect((await mecanico('GET', '/api/precos/vigente?sku=FIL-001&tabela=VAREJO')).statusCode).toBe(403);
    expect((await mecanico('GET', '/api/opcoes/origens')).statusCode).toBe(200);

    // Outra oficina não enxerga nada.
    const outra = await novaOficina('Outra Oficina Materiais');
    expect((await outra.chamar('GET', `/api/materiais/${material.id}`)).statusCode).toBe(404);
    expect((await outra.chamar('GET', `/api/precos?materialId=${material.id}`)).json()).toEqual([]);
  });
});

describe('estoque por material + depósito', () => {
  it('ajuste manual com motivo, histórico, versão e unidade inteira/fracionada', async () => {
    const o = await novaOficina('Oficina Estoque');
    const { material, filtros } = await catalogoBasico(o);
    const loja = (
      await o.chamar('POST', '/api/depositos', {
        codigo: 'LOJA',
        nome: 'Loja',
        tipoId: await o.tipo('tiposDeposito', 'Loja'),
      })
    ).json();
    const oficina = (
      await o.chamar('POST', '/api/depositos', {
        codigo: 'OFI',
        nome: 'Oficina',
        tipoId: await o.tipo('tiposDeposito', 'Oficina'),
      })
    ).json();
    const ajustar = (depositoId: string, corpo: object, m = material.id) =>
      o.chamar('PUT', `/api/estoque/${m}/${depositoId}`, corpo);

    // Por material: todos os depósitos ativos aparecem, zerados.
    expect(
      (await o.chamar('GET', `/api/estoque/material/${material.id}`))
        .json()
        .map((s: { depositoCodigo: string; disponivel: number; versao: number | null }) => [
          s.depositoCodigo,
          s.disponivel,
          s.versao,
        ]),
    ).toEqual([
      ['LOJA', 0, null],
      ['OFI', 0, null],
    ]);

    expect((await ajustar(loja.id, { disponivel: 10, reservado: 2, motivo: '' })).statusCode).toBe(400);
    expect((await ajustar(loja.id, { disponivel: 1.5, reservado: 0, motivo: 'Inventário' })).json().erro).toBe(
      'A unidade UN não aceita quantidade fracionada.',
    );
    const primeiro = (await ajustar(loja.id, { disponivel: 10, reservado: 2, motivo: 'Inventário inicial' })).json();
    expect(primeiro).toMatchObject({
      sku: 'FIL-001',
      depositoCodigo: 'LOJA',
      disponivel: 10,
      reservado: 2,
      saldo: 8,
      versao: 1,
      atualizadoPor: 'Admin Teste',
    });

    // Versão: sem versão (a tela leu o saldo zerado e alguém gravou antes) ou com versão antiga não sobrescreve.
    expect((await ajustar(loja.id, { disponivel: 8, reservado: 2, motivo: 'Venda' })).statusCode).toBe(409);
    expect((await ajustar(loja.id, { disponivel: 8, reservado: 2, motivo: 'Venda', versao: 1 })).json()).toMatchObject({
      disponivel: 8,
      versao: 2,
    });
    expect((await ajustar(loja.id, { disponivel: 7, reservado: 2, motivo: 'Venda', versao: 1 })).statusCode).toBe(409);
    expect((await ajustar(loja.id, { disponivel: -1, reservado: 0, motivo: 'Erro', versao: 2 })).statusCode).toBe(400);
    // O reservado é parte do disponível: nunca maior que ele (saldo negativo).
    const reservaDemais = await ajustar(loja.id, { disponivel: 3, reservado: 4, motivo: 'Erro', versao: 2 });
    expect(reservaDemais.statusCode).toBe(400);
    expect(reservaDemais.json().campos.reservado).toBe('O reservado não pode ser maior que o disponível');

    const historico = (await o.chamar('GET', `/api/estoque/${material.id}/${loja.id}/ajustes`)).json();
    expect(
      historico.map((a: { disponivelAntes: number; disponivelDepois: number; motivo: string }) => [
        a.disponivelAntes,
        a.disponivelDepois,
        a.motivo,
      ]),
    ).toEqual([
      [10, 8, 'Venda'],
      [0, 10, 'Inventário inicial'],
    ]);

    // Fracionado (litro) aceita até 3 casas.
    const oleo = (
      await o.chamar('POST', '/api/materiais', {
        sku: 'OLE-1',
        descricao: 'Óleo 5W30',
        tipoId: material.tipoId,
        categoriaId: filtros.id,
        unidade: 'L',
      })
    ).json();
    expect(
      (await ajustar(oficina.id, { disponivel: 20.5, reservado: 0.25, motivo: 'Tambor aberto' }, oleo.id)).json(),
    ).toMatchObject({ disponivel: 20.5, reservado: 0.25, saldo: 20.25 });

    // Tabela de estoque (SKU + depósito), com busca e filtro.
    const linhas = async (filtro = '') =>
      (await o.chamar('GET', `/api/estoque?${filtro}`))
        .json()
        .itens.map((s: { sku: string; depositoCodigo: string; disponivel: number; reservado: number }) => [
          s.sku,
          s.depositoCodigo,
          s.disponivel,
          s.reservado,
        ]);
    // Padrão: todo material ativo × depósito ativo, zerado onde não há saldo.
    expect(await linhas()).toEqual([
      ['FIL-001', 'LOJA', 8, 2],
      ['FIL-001', 'OFI', 0, 0],
      ['OLE-1', 'LOJA', 0, 0],
      ['OLE-1', 'OFI', 20.5, 0.25],
    ]);
    expect(await linhas('comSaldo=true')).toEqual([
      ['FIL-001', 'LOJA', 8, 2],
      ['OLE-1', 'OFI', 20.5, 0.25],
    ]);
    expect(await linhas(`depositoId=${oficina.id}&comSaldo=true`)).toEqual([['OLE-1', 'OFI', 20.5, 0.25]]);
    expect(await linhas('q=fil')).toHaveLength(2);
    // Mesma busca das outras listagens: código de barras pelos dígitos, mesmo digitado com espaços.
    expect(await linhas(`q=${encodeURIComponent('7891 0003 15507')}`)).toHaveLength(2);

    // Material com saldo não pode ser excluído (a mensagem cita o estoque, não só preços).
    const exclusao = await o.chamar('DELETE', `/api/materiais/${material.id}`);
    expect(exclusao.statusCode).toBe(409);
    expect(exclusao.json().erro).toContain('saldo de estoque');

    // Material que não controla estoque, ou inativo: sem ajuste.
    await o.chamar('PATCH', `/api/materiais/${oleo.id}/status`, { ativo: false });
    expect(
      (await ajustar(oficina.id, { disponivel: 1, reservado: 0, motivo: 'Teste', versao: 1 }, oleo.id)).statusCode,
    ).toBe(400);
    expect((await linhas('q=OLE')).map((l: unknown[]) => l.slice(0, 2))).toEqual([['OLE-1', 'OFI']]); // inativo: só onde já tem saldo

    // Permissões: mecânico consulta; almoxarife também só consulta; financeiro não vê estoque.
    const mecanico = await o.pessoa('Mecânico');
    const financeiro = await o.pessoa('Financeiro');
    expect((await mecanico('GET', '/api/estoque')).statusCode).toBe(200);
    expect(
      (
        await mecanico('PUT', `/api/estoque/${material.id}/${loja.id}`, {
          disponivel: 1,
          reservado: 0,
          motivo: 'X',
          versao: 2,
        })
      ).statusCode,
    ).toBe(403);
    expect((await financeiro('GET', '/api/estoque')).statusCode).toBe(403);
  });
});

describe('linhas de preço', () => {
  it('uma linha por vigência (com início, fim e situação) e outra para o preço padrão, filtradas por situação', async () => {
    const o = await novaOficina('Oficina Linhas');
    const { material, tabela, filtros } = await catalogoBasico(o);
    await o.chamar('POST', '/api/materiais', {
      sku: 'SEM-PRECO',
      descricao: 'Arruela',
      tipoId: material.tipoId,
      categoriaId: filtros.id,
      unidade: 'UN',
    });
    const vigencia = async (precoCentavos: number, dataInicio: string) =>
      (
        await o.chamar('POST', '/api/precos', {
          materialId: material.id,
          tabelaPrecoId: tabela.id,
          precoCentavos,
          dataInicio,
        })
      ).json();
    // Uma vigência já encerrada (o passado não se cadastra pela API).
    await withTenant(o.tid, (tx) =>
      tx.execute(
        sql`insert into materiais_precos (material_id, tabela_preco_id, preco_centavos, data_inicio, data_fim)
          values (${material.id}, ${tabela.id}, 3990, ${dia(-30)}, ${dia(-1)})`,
      ),
    );
    const atual = await vigencia(4990, dia(0));
    const futura = await vigencia(5290, dia(30));
    const cancelada = await vigencia(5590, dia(60));
    await o.chamar('POST', `/api/precos/${cancelada.id}/cancelar`, { motivo: 'Reajuste adiado' });
    await o.chamar('PUT', '/api/precos/padrao', {
      materialId: material.id,
      tabelaPrecoId: tabela.id,
      precoCentavos: 4500,
    });

    const linhas = async (filtro = '') =>
      (await o.chamar('GET', `/api/precos/linhas?tabelaPrecoId=${tabela.id}${filtro}`)).json();
    const base = {
      tipo: 'material',
      itemId: material.id,
      codigo: 'FIL-001',
      descricao: 'Filtro de óleo W712',
      formaPreco: null,
    };

    // Padrão: vigentes, futuras e o padrão; o material sem preço não aparece; nada de estoque.
    expect(await linhas()).toEqual({
      total: 3,
      itens: [
        { ...base, id: atual.id, precoCentavos: 4990, dataInicio: dia(0), dataFim: dia(29), situacao: 'vigente' },
        { ...base, id: futura.id, precoCentavos: 5290, dataInicio: dia(30), dataFim: null, situacao: 'futuro' },
        {
          ...base,
          id: `padrao:${material.id}`,
          precoCentavos: 4500,
          dataInicio: null,
          dataFim: null,
          situacao: 'padrao',
        },
      ],
    });
    const situacoes = async (filtro: string) =>
      (await linhas(`&situacao=${filtro}`)).itens.map((l: { situacao: string; precoCentavos: number }) => [
        l.situacao,
        l.precoCentavos,
      ]);
    expect(await situacoes('todas')).toEqual([
      ['encerrado', 3990],
      ['vigente', 4990],
      ['futuro', 5290],
      ['cancelado', 5590],
      ['padrao', 4500],
    ]);
    expect(await situacoes('encerrado')).toEqual([['encerrado', 3990]]);
    expect(await situacoes('cancelado')).toEqual([['cancelado', 5590]]);
    expect(await situacoes('futuro')).toEqual([['futuro', 5290]]);
    expect(await situacoes('padrao')).toEqual([['padrao', 4500]]);

    // Busca igual à de Materiais (SKU em minúsculas, código de barras) e paginação.
    expect((await linhas('&q=fil-0')).total).toBe(3);
    expect((await linhas('&q=7891000315507')).total).toBe(3);
    expect((await linhas('&q=arruela')).total).toBe(0);
    expect((await linhas('&situacao=todas&porPagina=2&pagina=3')).itens).toHaveLength(1);

    expect(
      (await (await o.pessoa('Mecânico'))('GET', `/api/precos/linhas?tabelaPrecoId=${tabela.id}`)).statusCode,
    ).toBe(403);
  });
});

/** Planilha CSV como o Excel pt-BR salva (";" e CRLF), com o cabeçalho na 1ª linha. */
const planilha = (...linhas: string[]) => `\uFEFF${linhas.join('\r\n')}\r\n`;
const brasil = (iso: string) => iso.split('-').reverse().join('/');

async function doisDepositos(o: Awaited<ReturnType<typeof novaOficina>>) {
  const criar = async (codigo: string, nome: string, tipo: string) =>
    (await o.chamar('POST', '/api/depositos', { codigo, nome, tipoId: await o.tipo('tiposDeposito', tipo) })).json();
  return { loja: await criar('LOJA', 'Loja', 'Loja'), oficina: await criar('OFI', 'Oficina', 'Oficina') };
}

describe('preço padrão (sem vigência)', () => {
  it('vale quando nenhuma vigência cobre o dia; alteração com versão e trilha; cadastro pelo SKU', async () => {
    const o = await novaOficina('Oficina Preço Padrão');
    const { material, tabela } = await catalogoBasico(o);
    const vigente = async (data = dia(0)) =>
      (
        await o.chamar('GET', `/api/precos/vigente?materialId=${material.id}&tabelaPrecoId=${tabela.id}&data=${data}`)
      ).json();

    // SKU digitado precisa existir (erro no campo, nada gravado).
    const inexistente = await o.chamar('PUT', '/api/precos/padrao', {
      sku: 'nao-existe',
      tabelaPrecoId: tabela.id,
      precoCentavos: 100,
    });
    expect(inexistente.statusCode).toBe(400);
    expect(inexistente.json()).toMatchObject({
      erro: 'SKU NAO-EXISTE não encontrado.',
      campos: { sku: 'SKU não encontrado' },
    });

    const definido = await o.chamar('PUT', '/api/precos/padrao', {
      sku: 'fil-001',
      tabelaPrecoId: tabela.id,
      precoCentavos: 4500,
    });
    expect(definido.json()).toMatchObject({ precoCentavos: 4500, versao: 1, tabelaCodigo: 'VAREJO' });
    expect(await vigente()).toMatchObject({ preco: null, valorCentavos: 4500, origem: 'padrao' });

    // Vigência cobre o dia: ela vale; nos dias sem vigência volta o padrão.
    await o.chamar('POST', '/api/precos', {
      sku: 'FIL-001',
      tabelaPrecoId: tabela.id,
      precoCentavos: 4990,
      dataInicio: dia(10),
      dataFim: dia(20),
    });
    expect(await vigente(dia(15))).toMatchObject({ valorCentavos: 4990, origem: 'vigencia' });
    expect(await vigente(dia(25))).toMatchObject({ valorCentavos: 4500, origem: 'padrao' });

    // Edição pela tela: versão antiga não sobrescreve.
    const alterar = (precoCentavos: number, versao: number) =>
      o.chamar('PUT', '/api/precos/padrao', {
        materialId: material.id,
        tabelaPrecoId: tabela.id,
        precoCentavos,
        versao,
      });
    expect((await alterar(4700, 1)).json()).toMatchObject({ precoCentavos: 4700, versao: 2 });
    expect((await alterar(4800, 1)).statusCode).toBe(409);

    expect((await o.chamar('GET', `/api/precos/padrao?materialId=${material.id}`)).json()).toHaveLength(1);
    expect(
      (await o.chamar('DELETE', `/api/precos/padrao?materialId=${material.id}&tabelaPrecoId=${tabela.id}`)).statusCode,
    ).toBe(204);
    expect(await vigente()).toMatchObject({ valorCentavos: null, origem: null });
    const eventos = (
      await o.chamar('GET', `/api/precos/padrao/eventos?materialId=${material.id}&tabelaPrecoId=${tabela.id}`)
    ).json();
    expect(
      eventos.map((e: { evento: string; precoAntes: number | null; precoDepois: number | null }) => [
        e.evento,
        e.precoAntes,
        e.precoDepois,
      ]),
    ).toEqual([
      ['removido', 4700, null],
      ['alterado', 4500, 4700],
      ['definido', null, 4500],
    ]);
    // Material com preço padrão no histórico não pode ser excluído.
    expect((await o.chamar('DELETE', `/api/materiais/${material.id}`)).statusCode).toBe(409);
  });
});

describe('importação de preços por planilha', () => {
  it('grava as linhas válidas (vigência ou padrão) e relata as demais com o número da linha', async () => {
    const o = await novaOficina('Oficina Importa Preços');
    const { material, tabela } = await catalogoBasico(o);
    const importar = (texto: string) => o.chamar('POST', '/api/precos/importar', texto, { 'content-type': 'text/csv' });

    const resultado = await importar(
      planilha(
        'Tabela;SKU;Preço;Início;Fim',
        'varejo;fil-001;45,00;;',
        `VAREJO;FIL-001;49,90;${brasil(dia(5))};`,
        'VAREJO;NAO-EXISTE;10,00;;',
        'ATACADO;FIL-001;10,00;;',
        'VAREJO;FIL-001;1.234,56;;',
        `VAREJO;FIL-001;50,00;${brasil(dia(-1))};`,
        'VAREJO;FIL-001;50,00;31/02/2027;',
        'VAREJO;FIL-001;45,00;;',
      ),
    );
    expect(resultado.statusCode).toBe(200);
    expect(resultado.json()).toEqual({
      linhas: 8,
      importadas: 2,
      ignoradas: 1,
      erros: [
        { linha: 4, mensagem: 'SKU "NAO-EXISTE" não encontrado.' },
        { linha: 5, mensagem: 'Tabela de preço "ATACADO" não encontrada.' },
        { linha: 6, mensagem: 'Preço "1.234,56" inválido: use reais com vírgula decimal (ex.: 150,00).' },
        { linha: 7, mensagem: 'A vigência não pode começar no passado: o histórico de preços não é reescrito.' },
        { linha: 8, mensagem: 'Início "31/02/2027" inválido: use dd/mm/aaaa.' },
      ],
    });
    const vigente = async (data: string) =>
      (
        await o.chamar('GET', `/api/precos/vigente?materialId=${material.id}&tabelaPrecoId=${tabela.id}&data=${data}`)
      ).json();
    expect(await vigente(dia(0))).toMatchObject({ valorCentavos: 4500, origem: 'padrao' });
    expect(await vigente(dia(6))).toMatchObject({ valorCentavos: 4990, origem: 'vigencia' });

    // Arquivo sem as colunas obrigatórias, formato errado e permissão.
    expect((await importar(planilha('codigo;valor', 'A;1'))).json().erro).toBe(
      'Colunas obrigatórias ausentes no cabeçalho (1ª linha): tabela, preco.',
    );
    expect((await o.chamar('POST', '/api/precos/importar', { a: 1 })).statusCode).toBe(415);
    const atendente = await o.pessoa('Atendente');
    expect(
      (
        await atendente('POST', '/api/precos/importar', planilha('tabela;sku;preco', 'VAREJO;FIL-001;1'), {
          'content-type': 'text/csv',
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('lançamento e importação de estoque', () => {
  it('lançamento confere SKU e depósito digitados; importação grava o saldo final das linhas válidas', async () => {
    const o = await novaOficina('Oficina Importa Estoque');
    const { material } = await catalogoBasico(o);
    const { loja } = await doisDepositos(o);

    const lancar = (corpo: object) => o.chamar('POST', '/api/estoque/lancamento', corpo);
    const errado = await lancar({ sku: 'X-1', deposito: 'nada', disponivel: 1, reservado: 0, motivo: 'Teste' });
    expect(errado.statusCode).toBe(400);
    expect(errado.json().campos).toEqual({ sku: 'SKU X-1 não encontrado', deposito: 'Depósito NADA não encontrado' });
    expect(
      (await lancar({ sku: 'fil-001', deposito: 'loja', disponivel: 5, reservado: 1, motivo: 'Inventário' })).json(),
    ).toMatchObject({ sku: 'FIL-001', depositoCodigo: 'LOJA', disponivel: 5, reservado: 1, saldo: 4, versao: 1 });
    expect(
      (await lancar({ sku: 'FIL-001', deposito: 'LOJA', disponivel: 1, reservado: 2, motivo: 'Erro' })).statusCode,
    ).toBe(400);

    const importar = (texto: string) =>
      o.chamar('POST', '/api/estoque/importar', texto, { 'content-type': 'text/csv' });
    const resultado = (
      await importar(
        planilha(
          'SKU;Depósito;Disponível;Reservado;Motivo',
          'FIL-001;LOJA;8;;Contagem', // reservado vazio: mantém o 1
          'FIL-001;OFI;2,5;0;', // UN não aceita fração
          'FIL-001;LOJA;8;1;', // igual ao que acabou de ser gravado: ignorada
          'NAO-EXISTE;LOJA;1;0;',
          'FIL-001;LOJA;-1;0;',
          'FIL-001;OFI;3;0;',
          'FIL-001;LOJA;0;;', // mantém o reservado 1, maior que o novo disponível
        ),
      )
    ).json();
    expect(resultado).toEqual({
      linhas: 7,
      importadas: 2,
      ignoradas: 1,
      erros: [
        { linha: 3, mensagem: 'A unidade UN não aceita quantidade fracionada.' },
        { linha: 5, mensagem: 'SKU "NAO-EXISTE" não encontrado.' },
        {
          linha: 6,
          mensagem: 'Disponível "-1" inválido: use um número não negativo com até 3 casas decimais.',
        },
        { linha: 8, mensagem: 'O reservado não pode ser maior que o disponível.' },
      ],
    });
    const saldos = (await o.chamar('GET', `/api/estoque/material/${material.id}`)).json();
    expect(
      saldos.map((s: { depositoCodigo: string; disponivel: number; reservado: number }) => [
        s.depositoCodigo,
        s.disponivel,
        s.reservado,
      ]),
    ).toEqual([
      ['LOJA', 8, 1],
      ['OFI', 3, 0],
    ]);
    const historico = (await o.chamar('GET', `/api/estoque/${material.id}/${loja.id}/ajustes`)).json();
    expect(historico[0]).toMatchObject({ motivo: 'Contagem', disponivelAntes: 5, disponivelDepois: 8 });

    const mecanico = await o.pessoa('Mecânico');
    expect(
      (
        await mecanico('POST', '/api/estoque/importar', planilha('sku;deposito;disponivel', 'FIL-001;LOJA;1'), {
          'content-type': 'text/csv',
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('importação de categorias e materiais por planilha', () => {
  const importar = (o: Awaited<ReturnType<typeof novaOficina>>, url: string, texto: string) =>
    o.chamar('POST', url, texto, { 'content-type': 'text/csv' });

  it('categorias: hierarquia na ordem do arquivo, atualiza pelo código e relata pai inexistente ou repetido', async () => {
    const o = await novaOficina('Oficina Importa Categorias');
    const resultado = (
      await importar(
        o,
        '/api/categorias/importar',
        planilha(
          'nome;codigo;pai;descricao',
          'Peças;PEC;;',
          'Motor;;PEC;Partes do motor',
          'Filtros;FIL;Peças > Motor;',
          'Filtros;;Peças > Motor;',
          'Velas;;Elétrica;',
          'Peças Novas;PEC;;Renomeada pelo código',
        ),
      )
    ).json();
    expect(resultado).toEqual({
      linhas: 6,
      importadas: 4,
      ignoradas: 0,
      erros: [
        { linha: 5, mensagem: 'Categoria repetido na planilha (já aparece na linha 4).' },
        { linha: 6, mensagem: 'pai: categoria "Elétrica" não encontrada.' },
      ],
    });
    const lista = (await o.chamar('GET', '/api/categorias')).json() as { nome: string; codigo: string | null }[];
    expect(lista.map((c) => [c.nome, c.codigo])).toEqual([
      ['Filtros', 'FIL'],
      ['Motor', null],
      ['Peças Novas', 'PEC'],
    ]);
  });

  it('materiais: cria e atualiza pelo SKU, resolve tipo, categoria e marca e relata referências inválidas', async () => {
    const o = await novaOficina('Oficina Importa Materiais');
    const { material } = await catalogoBasico(o); // FIL-001 em Peças > Filtros, marca Mann Filter
    // Outro "Filtros" (em Motor): só pelo nome, a categoria fica ambígua.
    const motor = (await o.chamar('POST', '/api/categorias', { nome: 'Motor' })).json();
    await o.chamar('POST', '/api/categorias', { nome: 'Filtros', categoriaPaiId: motor.id });

    const resultado = (
      await importar(
        o,
        '/api/materiais/importar',
        planilha(
          'sku;descricao;tipo;categoria;unidade;marca;ncm;controla_estoque',
          'fil-001;Filtro de óleo W712 (novo nome);peça;PEC;un;;;',
          'OLE-5W30;Óleo 5W30;Peça;Peças > Filtros;l;mann filter;27101932;sim',
          'X-1;Item;Serviço inexistente;PEC;UN;;;',
          'X-2;Item;Peça;Filtros;UN;;;',
          'X-3;Item;Peça;PEC;UN;Marca Nenhuma;;',
          'X-4;Item;Peça;PEC;CAIXOTE;;123;talvez',
          'OLE-5W30;Repetido;Peça;PEC;UN;;;',
        ),
      )
    ).json();
    expect(resultado).toMatchObject({ linhas: 7, importadas: 2 });
    expect(resultado.erros).toEqual([
      { linha: 4, mensagem: 'tipo: "Serviço inexistente" não está na lista de tipos de material.' },
      {
        linha: 5,
        mensagem:
          'categoria: há mais de uma categoria "Filtros" (Motor > Filtros; Peças > Filtros). Informe o código ou o caminho completo.',
      },
      { linha: 6, mensagem: 'marca: "Marca Nenhuma" não encontrada.' },
      { linha: 7, mensagem: 'controla_estoque: use "sim" ou "não" (recebido "talvez").' },
      { linha: 8, mensagem: 'SKU OLE-5W30 repetido na planilha (já aparece na linha 3).' },
    ]);

    // Atualizado: descrição nova, marca limpa (coluna presente e vazia), código de barras mantido (coluna ausente).
    expect((await o.chamar('GET', `/api/materiais/${material.id}`)).json()).toMatchObject({
      descricao: 'Filtro de óleo W712 (novo nome)',
      marcaId: null,
      codigoBarras: '7891000315507',
      versao: 2,
    });
    const [oleo] = (await o.chamar('GET', '/api/materiais?q=OLE-5W30')).json().itens;
    expect(oleo).toMatchObject({ unidade: 'L', marcaNome: 'Mann Filter', categoriaNome: 'Filtros' });
    const suprimento = async () => {
      const m = (await o.chamar('GET', `/api/materiais/${oleo.id}`)).json();
      return [m.multiplo, m.leadtimeDias];
    };
    expect(await suprimento()).toEqual([1, 30]); // colunas ausentes: padrões

    // Múltiplo e leadtime: coluna presente e vazia = padrão; ausente = mantém; inválido = erro na linha.
    const comSuprimento = (
      await importar(
        o,
        '/api/materiais/importar',
        planilha(
          'sku;descricao;tipo;categoria;unidade;multiplo;leadtime_dias',
          'OLE-5W30;Óleo 5W30;Peça;PEC;L;12;',
          'X-9;Item;Peça;PEC;UN;0;10',
        ),
      )
    ).json();
    expect(comSuprimento.erros).toEqual([{ linha: 3, mensagem: 'multiplo: Múltiplo: número inteiro de 1 a 999.999' }]);
    expect(await suprimento()).toEqual([12, 30]);
    await importar(
      o,
      '/api/materiais/importar',
      planilha('sku;descricao;tipo;categoria;unidade', 'OLE-5W30;Óleo;Peça;PEC;L'),
    );
    expect(await suprimento()).toEqual([12, 30]);
  });

  it('linhas de preço: a tabela da tela vale quando a coluna tabela fica vazia', async () => {
    const o = await novaOficina('Oficina Importa Linhas');
    const { material, tabela } = await catalogoBasico(o);
    const resultado = (
      await importar(o, `/api/precos/importar?tabelaPrecoId=${tabela.id}`, planilha('sku;preco', 'FIL-001;39,90'))
    ).json();
    expect(resultado).toMatchObject({ importadas: 1, erros: [] });
    const vigente = (
      await o.chamar('GET', `/api/precos/vigente?materialId=${material.id}&tabelaPrecoId=${tabela.id}`)
    ).json();
    expect(vigente).toMatchObject({ valorCentavos: 3990, origem: 'padrao' });
    // Sem a tabela da tela, a coluna continua obrigatória.
    expect((await importar(o, '/api/precos/importar', planilha('sku;preco', 'FIL-001;1'))).json().erro).toContain(
      'tabela',
    );
  });
});

describe('serviços (menu Ofertas)', () => {
  type ServicoCriado = { id: string; codigo: number; nome: string; tempoMinutos: number | null; versao: number };
  const importarCsv = (o: Awaited<ReturnType<typeof novaOficina>>, url: string, texto: string) =>
    o.chamar('POST', url, planilha(...texto.split('\n')), { 'content-type': 'text/csv' });

  it('cadastro: código automático, preço fechado ou valor-hora (horas obrigatórias), nome repetível', async () => {
    const o = await novaOficina('Oficina Serviços');
    const classificacoes = (await o.chamar('GET', '/api/opcoes/classificacoesServico')).json() as {
      id: string;
      nome: string;
    }[];
    const mecanica = classificacoes.find((c) => c.nome === 'Mecânica')!;

    const troca = await o.chamar('POST', '/api/servicos', {
      nome: 'Troca de óleo',
      classificacaoId: mecanica.id,
      tempoMinutos: '0:45',
      garantiaDias: '90',
      garantiaKm: '',
    });
    expect(troca.statusCode).toBe(201);
    expect(troca.json()).toMatchObject({
      codigo: 1,
      formaPreco: 'fechado',
      tempoMinutos: 45,
      classificacaoNome: 'Mecânica',
      garantiaDias: 90,
      garantiaKm: null,
      criadoPor: 'Admin Teste',
      versao: 1,
    });
    // Preço fechado sem horas é válido; valor-hora exige as horas.
    const semHoras = (await o.chamar('POST', '/api/servicos', { nome: 'Troca de óleo' })).json() as ServicoCriado;
    expect(semHoras).toMatchObject({ codigo: 2, nome: 'Troca de óleo', tempoMinutos: null }); // nome pode repetir
    const horaSem = await o.chamar('POST', '/api/servicos', { nome: 'Mão de obra', formaPreco: 'hora' });
    expect(horaSem.statusCode).toBe(400);
    expect(horaSem.json().campos.tempoMinutos).toBe('No valor-hora, informe as horas de referência');
    expect((await o.chamar('POST', '/api/servicos', { nome: 'Lavagem', tempoMinutos: '1:75' })).statusCode).toBe(400);
    const hora = (
      await o.chamar('POST', '/api/servicos', { nome: 'Mão de obra', formaPreco: 'hora', tempoMinutos: '1:30' })
    ).json() as ServicoCriado;
    expect(hora).toMatchObject({ codigo: 3, formaPreco: 'hora', tempoMinutos: 90 });

    // Busca por código (com ou sem zeros) ou nome; paginação; edição com versão; código imutável.
    const busca = async (q: string) =>
      (await o.chamar('GET', `/api/servicos?${q}`)).json().itens.map((s: { codigo: number }) => s.codigo);
    expect(await busca('q=000003')).toEqual([3]);
    expect(await busca('q=óleo')).toEqual([1, 2]);
    expect(await busca(`classificacaoId=${mecanica.id}`)).toEqual([1]);
    const editado = await o.chamar('PUT', `/api/servicos/${hora.id}`, {
      nome: 'Mão de obra mecânica',
      formaPreco: 'hora',
      tempoMinutos: 60,
      versao: 1,
    });
    expect(editado.json()).toMatchObject({ nome: 'Mão de obra mecânica', tempoMinutos: 60, versao: 2 });
    expect(
      (
        await o.chamar('PUT', `/api/servicos/${hora.id}`, {
          nome: 'Outro nome',
          tempoMinutos: 60,
          formaPreco: 'hora',
          versao: 1,
        })
      ).statusCode,
    ).toBe(409);
    await expect(
      withTenant(o.tid, (tx) => tx.execute(sql`update servicos set codigo = 99 where id = ${hora.id}`)),
    ).rejects.toMatchObject({ cause: { constraint_name: 'servicos_codigo_imutavel' } });

    // Classificação inativa não entra em serviço novo.
    await o.chamar('PUT', `/api/opcoes/classificacoesServico/${mecanica.id}`, { nome: 'Mecânica', ativa: false });
    expect(
      (await o.chamar('POST', '/api/servicos', { nome: 'Pintura', classificacaoId: mecanica.id })).statusCode,
    ).toBe(400);

    // Sem preço, exclui; inativar/reativar.
    expect((await o.chamar('PATCH', `/api/servicos/${semHoras.id}/status`, { ativo: false })).json().ativo).toBe(false);
    expect((await o.chamar('DELETE', `/api/servicos/${semHoras.id}`)).statusCode).toBe(204);

    // Permissões: Financeiro edita; Mecânico só consulta; outra oficina não vê.
    const mecanico = await o.pessoa('Mecânico');
    expect((await mecanico('GET', '/api/servicos')).statusCode).toBe(200);
    expect((await mecanico('POST', '/api/servicos', { nome: 'Nada' })).statusCode).toBe(403);
    const financeiro = await o.pessoa('Financeiro');
    expect((await financeiro('POST', '/api/servicos', { nome: 'Revisão' })).statusCode).toBe(201);
    const outra = await novaOficina('Oficina Serviços B');
    expect((await outra.chamar('GET', `/api/servicos/${hora.id}`)).statusCode).toBe(404);
  });

  it('preços: mesmas tabelas, vigências e padrão dos materiais; Linhas de Preço com tipo', async () => {
    const o = await novaOficina('Oficina Preço Serviço');
    const { material, tabela } = await catalogoBasico(o);
    const servico = (
      await o.chamar('POST', '/api/servicos', { nome: 'Alinhamento', formaPreco: 'hora', tempoMinutos: '1:00' })
    ).json() as ServicoCriado;

    // Serviço pelo código digitado (com zeros) e material pelo SKU, na mesma tabela.
    const vigencia = await o.chamar('POST', '/api/precos', {
      servicoCodigo: '000001',
      tabelaPrecoId: tabela.id,
      precoCentavos: 12000,
      dataInicio: dia(0),
    });
    expect(vigencia.statusCode).toBe(201);
    expect(vigencia.json()).toMatchObject({ servicoId: servico.id, materialId: null, situacao: 'vigente' });
    await o.chamar('POST', '/api/precos', {
      sku: 'fil-001',
      tabelaPrecoId: tabela.id,
      precoCentavos: 4990,
      dataInicio: dia(0),
    });
    await o.chamar('PUT', '/api/precos/padrao', {
      servicoId: servico.id,
      tabelaPrecoId: tabela.id,
      precoCentavos: 10000,
    });
    // Só um item por preço; código inexistente aponta o campo.
    expect(
      (
        await o.chamar('POST', '/api/precos', {
          sku: 'FIL-001',
          servicoCodigo: 1,
          tabelaPrecoId: tabela.id,
          precoCentavos: 1,
          dataInicio: dia(1),
        })
      ).statusCode,
    ).toBe(400);
    const naoExiste = await o.chamar('POST', '/api/precos', {
      servicoCodigo: 99,
      tabelaPrecoId: tabela.id,
      precoCentavos: 1,
      dataInicio: dia(1),
    });
    expect(naoExiste.json().campos).toEqual({ servicoCodigo: 'Serviço não encontrado' });

    expect((await o.chamar('GET', `/api/precos?servicoId=${servico.id}`)).json()).toHaveLength(1);
    expect((await o.chamar('GET', `/api/precos/padrao?servicoId=${servico.id}`)).json()).toMatchObject([
      { servicoId: servico.id, precoCentavos: 10000 },
    ]);
    // O banco barra vigências sobrepostas do mesmo serviço, mesmo por fora da API.
    await expect(
      withTenant(o.tid, (tx) =>
        tx.execute(sql`insert into materiais_precos (servico_id, tabela_preco_id, preco_centavos, data_inicio)
          values (${servico.id}, ${tabela.id}, 1, ${dia(3)})`),
      ),
    ).rejects.toMatchObject({ cause: { constraint_name: 'materiais_precos_servico_sem_sobreposicao' } });

    const linhas = async (filtro = '') =>
      (await o.chamar('GET', `/api/precos/linhas?tabelaPrecoId=${tabela.id}${filtro}`)).json().itens as {
        tipo: string;
        codigo: string;
        formaPreco: string | null;
        situacao: string;
      }[];
    expect((await linhas()).map((l) => [l.tipo, l.codigo, l.situacao, l.formaPreco])).toEqual([
      ['servico', '000001', 'vigente', 'hora'],
      ['servico', '000001', 'padrao', 'hora'],
      ['material', 'FIL-001', 'vigente', null],
    ]);
    expect((await linhas('&tipo=material')).map((l) => l.codigo)).toEqual(['FIL-001']);
    // A contagem da tabela continua sendo só de materiais (serviço não conta como material).
    expect((await o.chamar('GET', `/api/tabelas-preco/${tabela.id}`)).json().materiaisComPreco).toBe(1);
    expect((await linhas('&tipo=servico&q=alinha')).map((l) => l.situacao)).toEqual(['vigente', 'padrao']);

    // Com preço, o serviço não é excluído (só inativado); o material segue com a própria trilha.
    expect((await o.chamar('DELETE', `/api/servicos/${servico.id}`)).statusCode).toBe(409);
    expect((await o.chamar('GET', `/api/precos?materialId=${material.id}`)).json()).toHaveLength(1);
  });

  it('importação: serviços pelo código (vazio = novo) e preços com as colunas tipo e codigo', async () => {
    const o = await novaOficina('Oficina Importa Serviços');
    const { tabela } = await catalogoBasico(o);
    const resultado = (
      await importarCsv(
        o,
        '/api/servicos/importar',
        [
          'codigo;nome;forma_preco;horas;classificacao;garantia_dias;ativo',
          ';Troca de óleo;fechado;0:30;mecânica;90;',
          ';Mão de obra;hora;1:00;;;',
          ';Hora sem tempo;hora;;;;',
          ';Classe errada;;;Voo;;',
          '99;Não existe;;;;;',
          ';Inativo;;;;;não',
        ].join('\n'),
      )
    ).json();
    expect(resultado).toMatchObject({ linhas: 6, importadas: 3 });
    expect(resultado.erros).toEqual([
      { linha: 4, mensagem: 'horas: No valor-hora, informe as horas de referência' },
      {
        linha: 5,
        mensagem: 'classificacao: "Voo" não está na lista (Configurações → Classificação de serviço).',
      },
      { linha: 6, mensagem: 'codigo: serviço 99 não encontrado. Deixe vazio para cadastrar um novo.' },
    ]);
    const lista = (await o.chamar('GET', '/api/servicos')).json().itens as {
      codigo: number;
      nome: string;
      classificacaoNome: string | null;
      ativo: boolean;
    }[];
    expect(lista.map((s) => [s.codigo, s.nome, s.classificacaoNome, s.ativo])).toEqual([
      [1, 'Troca de óleo', 'Mecânica', true],
      [2, 'Mão de obra', null, true],
      [3, 'Inativo', null, false],
    ]);

    // Atualiza pelo código; coluna ausente mantém (classificação e horas continuam).
    await importarCsv(o, '/api/servicos/importar', 'codigo;nome\n000001;Troca de óleo e filtro');
    const [primeiro] = (await o.chamar('GET', '/api/servicos?q=1')).json().itens;
    expect((await o.chamar('GET', `/api/servicos/${primeiro.id}`)).json()).toMatchObject({
      nome: 'Troca de óleo e filtro',
      tempoMinutos: 30,
      classificacaoNome: 'Mecânica',
      garantiaDias: 90,
    });

    // Preços: tipo + codigo (e a coluna antiga sku para material).
    const precos = (
      await importarCsv(
        o,
        '/api/precos/importar',
        [
          'tabela;tipo;codigo;sku;preco',
          'VAREJO;servico;000002;;80,00',
          'VAREJO;;;FIL-001;45,00',
          'VAREJO;servico;123;;10,00',
          'VAREJO;peça;X;;10,00',
        ].join('\n'),
      )
    ).json();
    expect(precos).toMatchObject({ linhas: 4, importadas: 2 });
    expect(precos.erros).toEqual([
      { linha: 4, mensagem: 'Serviço "123" não encontrado.' },
      { linha: 5, mensagem: 'tipo: use "material" ou "servico" (recebido "peça").' },
    ]);
    const linhas = (await o.chamar('GET', `/api/precos/linhas?tabelaPrecoId=${tabela.id}`)).json().itens as {
      codigo: string;
      precoCentavos: number;
    }[];
    expect(linhas.map((l) => [l.codigo, l.precoCentavos])).toEqual([
      ['FIL-001', 4500],
      ['000002', 8000],
    ]);
  });
});

describe('PMC do material (Custos e margem)', () => {
  it('só quem tem Custos e margem vê e altera; histórico imutável; fora do cadastro; importação', async () => {
    const o = await novaOficina('Oficina PMC');
    const { material } = await catalogoBasico(o);
    const url = `/api/materiais/${material.id}/pmc`;
    const importarPmc = (chamar: typeof o.chamar, pmc: string) =>
      chamar(
        'POST',
        '/api/materiais/importar',
        planilha('sku;descricao;tipo;categoria;unidade;pmc', `FIL-001;Filtro de óleo W712;Peça;PEC;UN;${pmc}`),
        { 'content-type': 'text/csv' },
      );

    // Sem PMC: não disponível (null), nunca zero.
    expect((await o.chamar('GET', url)).json()).toEqual({ pmcCentavos: null, historico: [] });
    expect((await o.chamar('PUT', url, { pmcCentavos: 8_000, anteriorCentavos: null })).statusCode).toBe(204);
    // A tela diz o que leu: outra pessoa mudou antes = 409.
    expect((await o.chamar('PUT', url, { pmcCentavos: 9_000, anteriorCentavos: null })).statusCode).toBe(409);
    expect((await o.chamar('PUT', url, { pmcCentavos: -1, anteriorCentavos: 8_000 })).statusCode).toBe(400);
    await o.chamar('PUT', url, { pmcCentavos: 9_000, anteriorCentavos: 8_000 });
    const pmc = (await o.chamar('GET', url)).json();
    expect(pmc.pmcCentavos).toBe(9_000);
    expect(
      pmc.historico.map((h: { antesCentavos: number | null; depoisCentavos: number | null }) => [
        h.antesCentavos,
        h.depoisCentavos,
      ]),
    ).toEqual([
      [8_000, 9_000],
      [null, 8_000],
    ]);
    // O cadastro do material (que quem tem Materiais vê) não traz o PMC.
    expect((await o.chamar('GET', `/api/materiais/${material.id}`)).json()).not.toHaveProperty('pmcCentavos');

    // Almoxarife (Materiais em Editar, sem Custos e margem): não vê, não altera, não importa PMC.
    const almoxarife = await o.pessoa('Almoxarife');
    expect((await almoxarife('GET', url)).statusCode).toBe(403);
    expect((await almoxarife('PUT', url, { pmcCentavos: 1, anteriorCentavos: 9_000 })).statusCode).toBe(403);
    const semPermissao = (await importarPmc(almoxarife, '50,00')).json();
    expect(semPermissao.erros[0].mensagem).toMatch(/^pmc: você não tem permissão/);

    // Administrador importa: valor grava; vazio = sem PMC; inválido = erro na linha.
    await importarPmc(o.chamar, '12,34');
    expect((await o.chamar('GET', url)).json().pmcCentavos).toBe(1_234);
    expect((await importarPmc(o.chamar, 'abc')).json().erros[0].mensagem).toMatch(/PMC "abc" inválido/);
    await importarPmc(o.chamar, '');
    expect((await o.chamar('GET', url)).json().pmcCentavos).toBeNull();

    // Histórico só de inclusão, mesmo por fora da API.
    await expect(
      withTenant(o.tid, (tx) => tx.execute(sql`update materiais_pmc_eventos set depois_centavos = 0`)),
    ).rejects.toThrow();
  });
});
