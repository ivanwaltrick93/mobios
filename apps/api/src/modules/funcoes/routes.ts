import {
  ACESSO_TOTAL,
  combinarAcessos,
  funcaoInputSchema,
  funcaoSchema,
  idParamSchema,
  parametroFuncaoSchema,
  type Acessos,
  type Funcao,
} from '@mobios/shared';
import { asc, count, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { funcaoParametros, funcaoPermissoes, funcoes, parametrosFuncao, usuarioFuncoes } from '../../db/schema.js';
import { gravarAcessos } from '../../lib/acessos.js';
import { excluirSeNaoUsado } from '../../lib/cadastro.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import { inativarVendedoresSemCondicao } from '../vendedores/regras.js';

async function listar(tx: Tx, id?: string): Promise<Funcao[]> {
  const lista = await tx
    .select({
      id: funcoes.id,
      codigo: funcoes.codigo,
      nome: funcoes.nome,
      descricao: funcoes.descricao,
      admin: funcoes.admin,
      ativa: funcoes.ativa,
      usuarios: count(usuarioFuncoes.usuarioId),
    })
    .from(funcoes)
    .leftJoin(usuarioFuncoes, eq(usuarioFuncoes.funcaoId, funcoes.id))
    .where(id ? eq(funcoes.id, id) : undefined)
    .groupBy(funcoes.id)
    .orderBy(asc(funcoes.nome));
  const niveis = await tx.select().from(funcaoPermissoes);
  const parametros = await tx
    .select({ funcaoId: funcaoParametros.funcaoId, codigo: parametrosFuncao.codigo })
    .from(funcaoParametros)
    .innerJoin(parametrosFuncao, eq(parametrosFuncao.id, funcaoParametros.parametroId))
    .orderBy(asc(parametrosFuncao.codigo));
  // Administrador primeiro; as demais por nome.
  return lista
    .sort((a, b) => Number(b.admin) - Number(a.admin))
    .map((f) => ({
      ...f,
      parametros: parametros.filter((p) => p.funcaoId === f.id).map((p) => p.codigo),
      // O Administrador não guarda níveis: tem acesso total por regra.
      acessos: f.admin
        ? ACESSO_TOTAL
        : combinarAcessos(
            niveis.filter((n) => n.funcaoId === f.id).map((n) => ({ [n.modulo]: n.nivel }) as Partial<Acessos>),
          ),
    }));
}

/** Troca os parâmetros marcados na função (códigos do catálogo global `parametros_funcao`). */
async function gravarParametros(tx: Tx, funcaoId: string, codigos: string[]) {
  const encontrados = codigos.length
    ? await tx
        .select({ id: parametrosFuncao.id })
        .from(parametrosFuncao)
        .where(inArray(parametrosFuncao.codigo, codigos))
    : [];
  if (encontrados.length !== codigos.length) throw new ErroHttp(400, 'Escolha apenas parâmetros da lista.');
  await tx.delete(funcaoParametros).where(eq(funcaoParametros.funcaoId, funcaoId));
  if (encontrados.length)
    await tx.insert(funcaoParametros).values(encontrados.map((p) => ({ funcaoId, parametroId: p.id })));
}

/** Funções e permissões por módulo: exclusivo do Administrador. Exclusão só sem usuários; com usuários, desativar. */
export const funcoesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAdmin);

  app.get('/', { schema: { response: { 200: z.array(funcaoSchema) } } }, async (req) =>
    withTenant(req.user.tid, (tx) => listar(tx)),
  );

  /** Parâmetros que podem ser marcados numa função (ex.: Vendedor). */
  app.get('/parametros', { schema: { response: { 200: z.array(parametroFuncaoSchema) } } }, async (req) =>
    withTenant(req.user.tid, (tx) =>
      tx
        .select({ codigo: parametrosFuncao.codigo, nome: parametrosFuncao.nome, descricao: parametrosFuncao.descricao })
        .from(parametrosFuncao)
        .orderBy(asc(parametrosFuncao.nome)),
    ),
  );

  app.post('/', { schema: { body: funcaoInputSchema, response: { 201: funcaoSchema } } }, async (req, reply) => {
    const funcao = await withTenant(req.user.tid, async (tx) => {
      const [criada] = await tx
        .insert(funcoes)
        .values({ nome: req.body.nome, descricao: req.body.descricao, ativa: req.body.ativa })
        .returning({ id: funcoes.id });
      await gravarAcessos(tx, criada!.id, req.body.acessos);
      await gravarParametros(tx, criada!.id, req.body.parametros);
      return (await listar(tx, criada!.id))[0]!;
    });
    return reply.code(201).send(funcao);
  });

  app.put(
    '/:id',
    { schema: { params: idParamSchema, body: funcaoInputSchema, response: { 200: funcaoSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const [atual] = await tx.select({ admin: funcoes.admin }).from(funcoes).where(eq(funcoes.id, req.params.id));
        if (!atual) throw naoEncontrado('Função');
        if (atual.admin)
          throw new ErroHttp(400, 'A função Administrador é fixa: tem acesso total e não pode ser alterada.');
        // Desativar retira na hora o acesso que vinha desta função (decisão do produto).
        await tx
          .update(funcoes)
          .set({ nome: req.body.nome, descricao: req.body.descricao, ativa: req.body.ativa, atualizadoEm: new Date() })
          .where(eq(funcoes.id, req.params.id));
        await gravarAcessos(tx, req.params.id, req.body.acessos);
        await gravarParametros(tx, req.params.id, req.body.parametros);
        // Quem deixou de ter função de vendedor tem o vendedor inativado junto (decisão do produto).
        await inativarVendedoresSemCondicao(tx, req.user.sub);
        return (await listar(tx, req.params.id))[0]!;
      }),
  );

  /** Exclui só a função sem nenhum usuário (níveis e parâmetros saem junto); com usuário, apenas inativar. */
  app.delete('/:id', { schema: { params: idParamSchema } }, async (req, reply) => {
    await withTenant(req.user.tid, async (tx) => {
      const [atual] = await tx.select({ admin: funcoes.admin }).from(funcoes).where(eq(funcoes.id, req.params.id));
      if (!atual) throw naoEncontrado('Função');
      if (atual.admin) throw new ErroHttp(400, 'A função Administrador é fixa e não pode ser excluída.');
      await excluirSeNaoUsado(
        tx,
        funcoes,
        req.params.id,
        'Função',
        'Esta função está ligada a usuários (ativos ou desativados) ou tem histórico de alçada. Ela pode apenas ser inativada.',
      );
    });
    return reply.code(204).send();
  });
};
