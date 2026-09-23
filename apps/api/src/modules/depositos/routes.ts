import { depositoInputSchema, depositoSchema, idParamSchema, statusInputSchema, type Deposito } from '@mobios/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { depositos, tiposDeposito } from '../../db/schema.js';
import {
  alterarAtivo,
  atualizarVersionado,
  excluirSeNaoUsado,
  exigirVersao,
  nomeUsuario,
  validarReferencia,
} from '../../lib/cadastro.js';
import { naoEncontrado } from '../../lib/erros.js';

const colunas = {
  id: depositos.id,
  codigo: depositos.codigo,
  nome: depositos.nome,
  descricao: depositos.descricao,
  tipoId: depositos.tipoId,
  tipoNome: tiposDeposito.nome,
  permiteVenda: depositos.permiteVenda,
  permiteUsoOs: depositos.permiteUsoOs,
  permiteTransferencia: depositos.permiteTransferencia,
  ativo: depositos.ativo,
  criadoEm: depositos.criadoEm,
  atualizadoEm: depositos.atualizadoEm,
  criadoPor: nomeUsuario('depositos', 'criado_por'),
  atualizadoPor: nomeUsuario('depositos', 'atualizado_por'),
  versao: depositos.versao,
};

const consulta = (tx: Tx) =>
  tx.select(colunas).from(depositos).innerJoin(tiposDeposito, eq(tiposDeposito.id, depositos.tipoId));

async function carregar(tx: Tx, id: string): Promise<Deposito> {
  const [d] = await consulta(tx).where(eq(depositos.id, id));
  if (!d) throw naoEncontrado('Depósito');
  return d;
}

/** Depósito: só o cadastro mestre do local. Saldo, reserva e movimentação são do módulo de estoque. */
export const depositosRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('materiais'));
  const editar = { onRequest: app.exigirAcesso('materiais', 'editar') };

  app.get('/', { schema: { response: { 200: z.array(depositoSchema) } } }, async (req) =>
    withTenant(req.user.tid, (tx) => consulta(tx).orderBy(asc(depositos.nome))),
  );
  app.get('/:id', { schema: { params: idParamSchema, response: { 200: depositoSchema } } }, async (req) =>
    withTenant(req.user.tid, (tx) => carregar(tx, req.params.id)),
  );

  app.post(
    '/',
    { ...editar, schema: { body: depositoInputSchema, response: { 201: depositoSchema } } },
    async (req, reply) => {
      const { versao: _v, ...dados } = req.body;
      const deposito = await withTenant(req.user.tid, async (tx) => {
        await validarReferencia(tx, tiposDeposito, tiposDeposito.ativa, dados.tipoId, null, 'Tipo de depósito');
        const [{ id }] = (await tx
          .insert(depositos)
          .values({ ...dados, criadoPor: req.user.sub, atualizadoPor: req.user.sub })
          .returning({ id: depositos.id })) as [{ id: string }];
        return carregar(tx, id);
      });
      return reply.code(201).send(deposito);
    },
  );

  app.put(
    '/:id',
    { ...editar, schema: { params: idParamSchema, body: depositoInputSchema, response: { 200: depositoSchema } } },
    async (req) => {
      const { versao, ...dados } = req.body;
      return withTenant(req.user.tid, async (tx) => {
        const atual = await carregar(tx, req.params.id);
        await validarReferencia(tx, tiposDeposito, tiposDeposito.ativa, dados.tipoId, atual.tipoId, 'Tipo de depósito');
        await atualizarVersionado(
          tx,
          depositos,
          req.params.id,
          exigirVersao(versao),
          { ...dados, atualizadoPor: req.user.sub },
          'Depósito',
        );
        return carregar(tx, req.params.id);
      });
    },
  );

  app.patch(
    '/:id/status',
    { ...editar, schema: { params: idParamSchema, body: statusInputSchema, response: { 200: depositoSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        await alterarAtivo(tx, depositos, depositos.ativo, req.params.id, req.body.ativo, req.user.sub, 'Depósito');
        return carregar(tx, req.params.id);
      }),
  );

  // Nada referencia depósito ainda; quando o estoque existir, as FKs dele impedirão excluir depósito em uso.
  app.delete('/:id', { ...editar, schema: { params: idParamSchema } }, async (req, reply) => {
    await withTenant(req.user.tid, (tx) =>
      excluirSeNaoUsado(
        tx,
        depositos,
        req.params.id,
        'Depósito',
        'Este depósito está em uso e não pode ser excluído. Inative-o.',
      ),
    );
    return reply.code(204).send();
  });
};
