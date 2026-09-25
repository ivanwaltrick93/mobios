import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from './app.js';
import { db, sqlClient, withTenant } from './db/client.js';
import { criarOficinaComAdmin } from './db/admin-inicial.js';
import { COOKIE_SESSAO } from './lib/auth.js';

// Vendedores (CAD-18), códigos de usuário e função, parâmetros de função e as tabelas parametrizáveis de
// Configurações (código, nome, descrição, status; excluir só sem uso). Mesmo esquema de app.test.ts.
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
type Funcao = { id: string; codigo: number; nome: string; ativa: boolean; parametros: string[]; acessos: object };

async function entrar(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha: SENHA } });
  const token = res.cookies.find((c) => c.name === COOKIE_SESSAO)!.value;
  return (method: Metodo, url: string, payload?: object | string, headers?: Record<string, string>) =>
    app.inject({ method, url, payload, headers, cookies: { [COOKIE_SESSAO]: token } });
}

async function novaOficina(nome: string) {
  const email = `${randomUUID()}@teste.dev`;
  const { tenant, user } = await criarOficinaComAdmin(db, { oficina: nome, nome: 'Admin Teste', email, senha: SENHA });
  const chamar = await entrar(email);
  const funcoes = async () => (await chamar('GET', '/api/funcoes')).json() as Funcao[];
  const funcao = async (nomeFuncao: string) => (await funcoes()).find((f) => f.nome === nomeFuncao)!;
  /** Usuário da oficina com as funções padrão indicadas. */
  const usuario = async (nomeUsuario: string, ...nomesFuncoes: string[]) => {
    const todas = await funcoes();
    const res = await chamar('POST', '/api/usuarios', {
      nome: nomeUsuario,
      email: `${randomUUID()}@teste.dev`,
      funcoes: nomesFuncoes.map((n) => todas.find((f) => f.nome === n)!.id),
      senha: SENHA,
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; codigo: number; nome: string; email: string };
  };
  const vendedor = (usuarioId: string, extra: object = {}) =>
    chamar('POST', '/api/vendedores', { usuarioId, whatsapp: '(48) 99999-0000', ...extra });
  return { chamar, tid: tenant.id, adminId: user.id, funcoes, funcao, usuario, vendedor };
}

type Oficina = Awaited<ReturnType<typeof novaOficina>>;
const eventos = async (o: Oficina, id: string) =>
  (await o.chamar('GET', `/api/vendedores/${id}/eventos`)).json() as {
    evento: string;
    origem: string;
    motivo: string | null;
    alteracoes: { campo: string; antes: string | null; depois: string | null }[];
  }[];

describe('códigos de usuário e de função', () => {
  it('são sequenciais por oficina, gerados pelo banco e não podem ser alterados', async () => {
    const a = await novaOficina('Oficina Códigos A');
    const b = await novaOficina('Oficina Códigos B');
    const usuariosA = (await a.chamar('GET', '/api/usuarios')).json() as { codigo: number }[];
    expect(usuariosA.map((u) => u.codigo)).toEqual([1]);
    expect((await a.usuario('Ana', 'Atendente')).codigo).toBe(2);
    // Cada oficina tem a própria sequência.
    expect((await b.usuario('Bia', 'Atendente')).codigo).toBe(2);

    const funcoes = await a.funcoes();
    expect(funcoes.find((f) => f.nome === 'Administrador')!.codigo).toBe(1);
    expect(new Set(funcoes.map((f) => f.codigo)).size).toBe(funcoes.length);
    const nova = (
      await a.chamar('POST', '/api/funcoes', {
        nome: 'Gerente',
        ativa: true,
        acessos: funcoes.find((f) => f.nome === 'Atendente')!.acessos,
        descricao: 'Gestão',
      })
    ).json() as Funcao & { descricao: string };
    expect(nova.codigo).toBe(funcoes.length + 1);
    expect(nova.descricao).toBe('Gestão');

    await expect(
      withTenant(a.tid, (tx) => tx.execute(sql`update users set codigo = 99 where tenant_id = ${a.tid}`)),
    ).rejects.toMatchObject({ cause: { constraint_name: 'users_codigo_imutavel' } });
  });
});

describe('parâmetros de função', () => {
  it('Atendente já vem com o parâmetro Vendedor; o admin marca e desmarca em outras funções', async () => {
    const o = await novaOficina('Oficina Parâmetros');
    expect((await o.chamar('GET', '/api/funcoes/parametros')).json()).toEqual([
      expect.objectContaining({ codigo: 'VENDEDOR', nome: 'Vendedor' }),
    ]);
    expect((await o.funcao('Atendente')).parametros).toEqual(['VENDEDOR']);
    expect((await o.funcao('Mecânico')).parametros).toEqual([]);

    const mecanico = await o.funcao('Mecânico');
    const marcar = await o.chamar('PUT', `/api/funcoes/${mecanico.id}`, {
      nome: mecanico.nome,
      ativa: true,
      acessos: mecanico.acessos,
      parametros: ['VENDEDOR'],
    });
    expect(marcar.json().parametros).toEqual(['VENDEDOR']);
    const invalido = await o.chamar('PUT', `/api/funcoes/${mecanico.id}`, {
      nome: mecanico.nome,
      ativa: true,
      acessos: mecanico.acessos,
      parametros: ['INEXISTENTE'],
    });
    expect(invalido.statusCode).toBe(400);
  });
});

describe('vendedores', () => {
  it('cadastro: só usuário ativo com função de vendedor, um vendedor por usuário, matrícula única', async () => {
    const o = await novaOficina('Oficina Vendedores');
    const ana = await o.usuario('Ana Souza', 'Atendente');
    const beto = await o.usuario('Beto', 'Atendente');
    const mecanico = await o.usuario('Carlos', 'Mecânico');

    const elegiveis = (await o.chamar('GET', '/api/vendedores/usuarios-elegiveis')).json() as { id: string }[];
    expect(elegiveis.map((u) => u.id).sort()).toEqual([ana.id, beto.id].sort());

    const criado = await o.vendedor(ana.id, { matricula: 'm-01', funcionarioDesde: '2024-03-01' });
    expect(criado.statusCode).toBe(201);
    expect(criado.json()).toMatchObject({
      codigo: 1,
      matricula: 'm-01',
      whatsapp: '48999990000',
      ativo: true,
      usuario: { id: ana.id, codigo: ana.codigo, nome: 'Ana Souza', email: ana.email, funcoes: ['Atendente'] },
    });

    // Usuário sem função de vendedor, usuário já vinculado e matrícula repetida (sem diferenciar maiúsculas).
    const semParametro = await o.vendedor(mecanico.id);
    expect(semParametro.statusCode).toBe(400);
    expect(semParametro.json().campos.usuarioId).toMatch(/parâmetro Vendedor/);
    expect((await o.vendedor(ana.id)).statusCode).toBe(409);
    expect((await o.vendedor(beto.id, { matricula: 'M-01' })).json()).toMatchObject({
      erro: 'Já existe um vendedor com esta matrícula',
    });
    expect((await o.vendedor(beto.id, { whatsapp: '123' })).statusCode).toBe(400);

    // As falhas acima não consumiram código: o próximo é o 2.
    const segundo = (await o.vendedor(beto.id)).json();
    expect(segundo.codigo).toBe(2);
    expect((await o.chamar('GET', '/api/vendedores/usuarios-elegiveis')).json()).toEqual([]);
    // Na edição, o usuário do próprio vendedor aparece.
    const naEdicao = (await o.chamar('GET', `/api/vendedores/usuarios-elegiveis?vendedorId=${segundo.id}`)).json() as {
      id: string;
    }[];
    expect(naEdicao.map((u) => u.id)).toEqual([beto.id]);

    // O código não muda nem por SQL direto.
    await expect(
      withTenant(o.tid, (tx) => tx.execute(sql`update vendedores set codigo = 50 where id = ${segundo.id}`)),
    ).rejects.toMatchObject({ cause: { constraint_name: 'vendedores_codigo_imutavel' } });
    // Não há exclusão.
    expect((await o.chamar('DELETE', `/api/vendedores/${segundo.id}`)).statusCode).toBe(404);
  });

  it('edição e troca de usuário ficam no log (campo, antes e depois); sem mudança não registra', async () => {
    const o = await novaOficina('Oficina Log');
    const ana = await o.usuario('Ana', 'Atendente');
    const beto = await o.usuario('Beto', 'Atendente');
    const v = (await o.vendedor(ana.id)).json();

    const editado = await o.chamar('PUT', `/api/vendedores/${v.id}`, {
      usuarioId: beto.id,
      whatsapp: '(48) 98888-7777',
      matricula: 'X9',
      funcionarioDesde: '',
    });
    expect(editado.statusCode).toBe(200);
    expect(editado.json().usuario.id).toBe(beto.id);
    // Mesmos dados de novo: nada a registrar.
    await o.chamar('PUT', `/api/vendedores/${v.id}`, { usuarioId: beto.id, whatsapp: '48988887777', matricula: 'X9' });

    const log = await eventos(o, v.id);
    expect(log.map((e) => e.evento)).toEqual(['alterado', 'criado']);
    expect(log[0]!.alteracoes).toEqual([
      { campo: 'Usuário', antes: `${ana.codigo} — Ana`, depois: `${beto.codigo} — Beto` },
      { campo: 'Matrícula', antes: null, depois: 'X9' },
      { campo: 'WhatsApp', antes: '(48) 99999-0000', depois: '(48) 98888-7777' },
    ]);
    expect(log[1]).toMatchObject({ evento: 'criado', origem: 'cadastro' });
  });

  it('desativar o usuário ou tirar dele a função de vendedor inativa o vendedor; reativar exige usuário apto', async () => {
    const o = await novaOficina('Oficina Inativação');
    const ana = await o.usuario('Ana', 'Atendente');
    const beto = await o.usuario('Beto', 'Atendente', 'Mecânico');
    const vAna = (await o.vendedor(ana.id)).json();
    const vBeto = (await o.vendedor(beto.id)).json();
    const atendente = await o.funcao('Atendente');
    const mecanico = await o.funcao('Mecânico');

    // Usuário desativado.
    await o.chamar('PUT', `/api/usuarios/${ana.id}`, { nome: 'Ana', funcoes: [atendente.id], ativo: false });
    expect((await o.chamar('GET', `/api/vendedores/${vAna.id}`)).json().ativo).toBe(false);
    expect((await eventos(o, vAna.id))[0]).toMatchObject({
      evento: 'inativado',
      origem: 'automatica',
      motivo: 'O usuário foi desativado.',
    });
    const reativar = await o.chamar('PATCH', `/api/vendedores/${vAna.id}/status`, { ativo: true });
    expect(reativar.statusCode).toBe(400);
    expect(reativar.json().erro).toMatch(/desativado/);
    // Reativar o usuário não reativa o vendedor sozinho; depois disso o admin consegue reativar.
    await o.chamar('PUT', `/api/usuarios/${ana.id}`, { nome: 'Ana', funcoes: [atendente.id], ativo: true });
    expect((await o.chamar('GET', `/api/vendedores/${vAna.id}`)).json().ativo).toBe(false);
    const reativado = await o.chamar('PATCH', `/api/vendedores/${vAna.id}/status`, { ativo: true });
    expect(reativado.json().ativo).toBe(true);
    expect((await eventos(o, vAna.id))[0]).toMatchObject({ evento: 'reativado', origem: 'cadastro' });

    // Beto perde a função Atendente (fica só Mecânico).
    await o.chamar('PUT', `/api/usuarios/${beto.id}`, { nome: 'Beto', funcoes: [mecanico.id], ativo: true });
    expect((await o.chamar('GET', `/api/vendedores/${vBeto.id}`)).json().ativo).toBe(false);

    // Desmarcar o parâmetro na função Atendente inativa quem dependia dela.
    await o.chamar('PUT', `/api/funcoes/${atendente.id}`, {
      nome: atendente.nome,
      ativa: true,
      acessos: atendente.acessos,
      parametros: [],
    });
    expect((await o.chamar('GET', `/api/vendedores/${vAna.id}`)).json().ativo).toBe(false);
    expect((await eventos(o, vAna.id))[0]!.motivo).toMatch(/parâmetro Vendedor/);
  });

  it('lista paginada (20 por página), busca por código, nome ou matrícula e filtro de situação', async () => {
    const o = await novaOficina('Oficina Lista Vendedores');
    const ids: string[] = [];
    for (let i = 1; i <= 21; i++) {
      const u = await o.usuario(`Vendedor ${String(i).padStart(2, '0')}`, 'Atendente');
      ids.push((await o.vendedor(u.id, { matricula: `MAT-${i}` })).json().id);
    }
    await o.chamar('PATCH', `/api/vendedores/${ids[20]}/status`, { ativo: false });

    const pagina1 = (await o.chamar('GET', '/api/vendedores?situacao=todos')).json();
    expect(pagina1.total).toBe(21);
    expect(pagina1.itens).toHaveLength(20);
    expect(pagina1.itens[0]).toEqual({ id: ids[0], codigo: 1, nome: 'Vendedor 01', matricula: 'MAT-1', ativo: true });
    const pagina2 = (await o.chamar('GET', '/api/vendedores?situacao=todos&pagina=2')).json();
    expect(pagina2.itens.map((v: { codigo: number }) => v.codigo)).toEqual([21]);

    expect((await o.chamar('GET', '/api/vendedores')).json().total).toBe(20); // padrão: ativos
    expect((await o.chamar('GET', '/api/vendedores?situacao=inativos')).json().itens[0].codigo).toBe(21);
    const porCodigo = (await o.chamar('GET', '/api/vendedores?situacao=todos&q=7')).json();
    expect(porCodigo.itens.map((v: { codigo: number }) => v.codigo)).toEqual([7, 17]); // código 7 ou nome/matrícula com 7
    expect((await o.chamar('GET', '/api/vendedores?q=mat-12')).json().itens[0].codigo).toBe(12);
    expect((await o.chamar('GET', '/api/vendedores?q=dor 05')).json().itens[0].codigo).toBe(5);
  });

  it('só o Administrador acessa; outra oficina não enxerga nem vincula', async () => {
    const a = await novaOficina('Oficina Vendedores A');
    const b = await novaOficina('Oficina Vendedores B');
    const ana = await a.usuario('Ana', 'Atendente');
    const v = (await a.vendedor(ana.id)).json();

    const atendente = await entrar(ana.email);
    expect((await atendente('GET', '/api/vendedores')).statusCode).toBe(403);
    expect(
      (await atendente('POST', '/api/vendedores', { usuarioId: ana.id, whatsapp: '48999990000' })).statusCode,
    ).toBe(403);

    expect((await b.chamar('GET', `/api/vendedores/${v.id}`)).statusCode).toBe(404);
    expect((await b.chamar('GET', `/api/vendedores/${v.id}/eventos`)).statusCode).toBe(404);
    expect((await b.chamar('GET', '/api/vendedores?situacao=todos')).json().total).toBe(0);
    const cruzado = await b.vendedor(ana.id);
    expect(cruzado.statusCode).toBe(400);
    expect(cruzado.json().erro).toBe('Usuário não encontrado nesta oficina.');
  });

  it('importação: sem código cadastra, com código atualiza, erros por linha sem perder as válidas', async () => {
    const o = await novaOficina('Oficina Importa Vendedores');
    const ana = await o.usuario('Ana', 'Atendente');
    const beto = await o.usuario('Beto', 'Atendente');
    const carla = await o.usuario('Carla', 'Atendente');
    const mecanico = await o.usuario('Dino', 'Mecânico');
    const existente = (await o.vendedor(ana.id, { matricula: 'A1' })).json();
    const importar = (texto: string) =>
      o.chamar('POST', '/api/vendedores/importar', texto, { 'content-type': 'text/csv' });

    const res = await importar(
      [
        'codigo;usuario_email;whatsapp;matricula;funcionario_desde;ativo',
        `1;${ana.email};(48) 97777-1111;A1;01/02/2023;`,
        `;${beto.email};48966665555;B2;;`,
        `;${carla.email};48955554444;;;não`,
        `;${mecanico.email};48944443333;;;`,
        `99;${ana.email};48933332222;;;`,
        `;naoexiste@teste.dev;48922221111;;;`,
        `;${beto.email};48911110000;;;`,
        `;${ana.email};48900009999;A1;;`,
      ].join('\n'),
    );
    expect(res.statusCode).toBe(200);
    const resultado = res.json();
    expect(resultado).toMatchObject({ linhas: 8, importadas: 3, ignoradas: 0 });
    expect(resultado.erros.map((e: { linha: number }) => e.linha)).toEqual([5, 6, 7, 8, 9]);
    expect(resultado.erros[0].mensagem).toMatch(/parâmetro Vendedor/);
    expect(resultado.erros[1].mensagem).toMatch(/vendedor 99 não encontrado/);
    expect(resultado.erros[2].mensagem).toMatch(/nenhum usuário/);
    expect(resultado.erros[3].mensagem).toMatch(/repetido na planilha/);
    expect(resultado.erros[4].mensagem).toMatch(/repetido na planilha/);

    const atualizado = (await o.chamar('GET', `/api/vendedores/${existente.id}`)).json();
    expect(atualizado).toMatchObject({ whatsapp: '48977771111', funcionarioDesde: '2023-02-01', matricula: 'A1' });
    expect((await eventos(o, existente.id))[0]).toMatchObject({ evento: 'alterado', origem: 'importacao' });
    const lista = (await o.chamar('GET', '/api/vendedores?situacao=todos')).json().itens as {
      codigo: number;
      nome: string;
      ativo: boolean;
    }[];
    expect(lista.map((v) => [v.codigo, v.nome, v.ativo])).toEqual([
      [1, 'Ana', true],
      [2, 'Beto', true],
      [3, 'Carla', false],
    ]);

    // Coluna opcional ausente não muda o vendedor; mesmo dado de novo = sem alteração.
    const semMatricula = (
      await importar(['codigo;usuario_email;whatsapp', `2;${beto.email};48966665555`].join('\n'))
    ).json();
    expect(semMatricula).toMatchObject({ importadas: 0, ignoradas: 1, erros: [] });
    expect((await importar('codigo;whatsapp\n1;48999990000')).statusCode).toBe(400);
  });
});

describe('tabelas de Configurações', () => {
  type Item = { id: string; codigo: number; nome: string; descricao: string | null; ativa: boolean; usos: number };

  it('listas: código automático por lista, descrição opcional e exclusão só do item sem uso', async () => {
    const o = await novaOficina('Oficina Listas');
    const tipos = (await o.chamar('GET', '/api/opcoes/tiposDeposito')).json() as Item[];
    // Itens padrão numerados de 1 em diante, sem repetir.
    expect(tipos.map((t) => t.codigo).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);

    const criado = await o.chamar('POST', '/api/opcoes/tiposDeposito', {
      nome: 'Consignado',
      descricao: 'Peças de terceiros',
      ativa: true,
    });
    expect(criado.statusCode).toBe(201);
    expect(criado.json()).toMatchObject({ codigo: 7, nome: 'Consignado', descricao: 'Peças de terceiros', usos: 0 });
    // Cada lista tem a própria sequência.
    const origem = (await o.chamar('POST', '/api/opcoes/origens', { nome: 'Rádio', ativa: true })).json() as Item;
    expect(origem).toMatchObject({ codigo: 6, descricao: null });

    const editado = await o.chamar('PUT', `/api/opcoes/tiposDeposito/${criado.json().id}`, {
      nome: 'Consignado',
      descricao: '',
      ativa: false,
    });
    expect(editado.json()).toMatchObject({ codigo: 7, descricao: null, ativa: false });
    await expect(
      withTenant(o.tid, (tx) => tx.execute(sql`update tipos_deposito set codigo = 99 where id = ${criado.json().id}`)),
    ).rejects.toMatchObject({ cause: { constraint_name: 'tipos_deposito_codigo_imutavel' } });

    // Em uso por um depósito: não exclui (só inativar). Sem uso: exclui.
    const loja = tipos.find((t) => t.nome === 'Loja')!;
    await o.chamar('POST', '/api/depositos', { codigo: 'LOJA', nome: 'Loja', tipoId: loja.id });
    const emUso = await o.chamar('DELETE', `/api/opcoes/tiposDeposito/${loja.id}`);
    expect(emUso.statusCode).toBe(409);
    expect(emUso.json().erro).toMatch(/pode apenas ser inativado/);
    expect((await o.chamar('DELETE', `/api/opcoes/tiposDeposito/${criado.json().id}`)).statusCode).toBe(204);
    expect((await o.chamar('DELETE', `/api/opcoes/tiposDeposito/${criado.json().id}`)).statusCode).toBe(404);

    // Só o admin altera; outra oficina não exclui.
    const outra = await novaOficina('Oficina Listas B');
    expect((await outra.chamar('DELETE', `/api/opcoes/origens/${origem.id}`)).statusCode).toBe(404);
    const atendente = await entrar((await o.usuario('Ana', 'Atendente')).email);
    expect((await atendente('DELETE', `/api/opcoes/origens/${origem.id}`)).statusCode).toBe(403);
  });

  it('funções: excluir só sem usuário ligado; o Administrador nunca', async () => {
    const o = await novaOficina('Oficina Excluir Funções');
    const almoxarife = await o.funcao('Almoxarife');
    const financeiro = await o.funcao('Financeiro');
    await o.usuario('Fábio', 'Financeiro');

    const comUsuario = await o.chamar('DELETE', `/api/funcoes/${financeiro.id}`);
    expect(comUsuario.statusCode).toBe(409);
    expect(comUsuario.json().erro).toMatch(/apenas ser inativada/);
    expect((await o.chamar('DELETE', `/api/funcoes/${(await o.funcao('Administrador')).id}`)).statusCode).toBe(400);

    expect((await o.chamar('DELETE', `/api/funcoes/${almoxarife.id}`)).statusCode).toBe(204);
    expect((await o.funcoes()).some((f) => f.id === almoxarife.id)).toBe(false);
    // Os níveis da função saíram junto.
    const niveis = await withTenant(o.tid, (tx) =>
      tx.execute(sql`select 1 from funcao_permissoes where funcao_id = ${almoxarife.id}`),
    );
    expect(niveis).toHaveLength(0);
  });
});
