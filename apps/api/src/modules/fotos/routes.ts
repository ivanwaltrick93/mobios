import { idParamSchema } from '@mobios/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { withTenant } from '../../db/client.js';
import { users, usuarioFotos } from '../../db/schema.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import { aceitarUploadDeImagem, lerImagemEnviada, responderImagem } from '../../lib/imagem.js';

/** Versão usada na URL da foto (muda a cada troca); null = sem foto. */
export const versaoFoto = (atualizadoEm: Date | null) => (atualizadoEm ? String(atualizadoEm.getTime()) : null);

/**
 * Fotos da equipe, guardadas no banco. Toda a oficina vê (ex.: mecânico responsável na O.S.);
 * só o Administrador ou o próprio usuário trocam ou removem.
 */
export const fotosRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  aceitarUploadDeImagem(app);

  const exigirAdminOuProprio = async (req: { user: { admin: boolean; sub: string }; params: { id: string } }) => {
    if (!req.user.admin && req.user.sub !== req.params.id)
      throw new ErroHttp(403, 'Só o Administrador ou o próprio usuário podem trocar esta foto.');
  };

  app.get('/usuario/:id', { schema: { params: idParamSchema } }, async (req, reply) => {
    const [foto] = await withTenant(req.user.tid, (tx) =>
      tx
        .select({ conteudo: usuarioFotos.conteudo, tipo: usuarioFotos.tipo, atualizadoEm: usuarioFotos.atualizadoEm })
        .from(usuarioFotos)
        .where(eq(usuarioFotos.usuarioId, req.params.id)),
    );
    return responderImagem(req, reply, foto, 'Usuário sem foto');
  });

  app.put('/usuario/:id', { schema: { params: idParamSchema } }, async (req, reply) => {
    await exigirAdminOuProprio(req);
    const valores = lerImagemEnviada(req.body);
    await withTenant(req.user.tid, async (tx) => {
      const [usuario] = await tx.select({ id: users.id }).from(users).where(eq(users.id, req.params.id));
      if (!usuario) throw naoEncontrado('Usuário');
      await tx
        .insert(usuarioFotos)
        .values({ usuarioId: usuario.id, ...valores })
        .onConflictDoUpdate({ target: usuarioFotos.usuarioId, set: valores });
    });
    return reply.code(204).send();
  });

  app.delete('/usuario/:id', { schema: { params: idParamSchema } }, async (req, reply) => {
    await exigirAdminOuProprio(req);
    await withTenant(req.user.tid, (tx) => tx.delete(usuarioFotos).where(eq(usuarioFotos.usuarioId, req.params.id)));
    return reply.code(204).send();
  });
};
