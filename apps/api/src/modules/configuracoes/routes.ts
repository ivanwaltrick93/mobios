import { temaInputSchema, temaSchema } from '@mobios/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { withTenant } from '../../db/client.js';
import { tenantLogos } from '../../db/schema.js';
import { aceitarUploadDeImagem, lerImagemEnviada } from '../../lib/imagem.js';
import { enviarLogo, lerTema, salvarTema } from '../../lib/marca.js';

export const configuracoesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);

  aceitarUploadDeImagem(app);

  app.get('/aparencia', { schema: { response: { 200: temaSchema } } }, async (req) =>
    withTenant(req.user.tid, lerTema),
  );

  app.put(
    '/aparencia',
    { onRequest: app.exigirAdmin, schema: { body: temaInputSchema, response: { 200: temaSchema } } },
    async (req) => withTenant(req.user.tid, (tx) => salvarTema(tx, req.body)),
  );

  // ---------- Logo (guardado no banco, tabela tenant_logos) ----------

  app.get('/logo', async (req, reply) => withTenant(req.user.tid, (tx) => enviarLogo(tx, req, reply)));
  app.put('/logo', { onRequest: app.exigirAdmin }, async (req, reply) => {
    const valores = lerImagemEnviada(req.body);
    await withTenant(req.user.tid, (tx) =>
      tx.insert(tenantLogos).values(valores).onConflictDoUpdate({ target: tenantLogos.tenantId, set: valores }),
    );
    return reply.code(204).send();
  });

  app.delete('/logo', { onRequest: app.exigirAdmin }, async (req, reply) => {
    // Sem `where` de propósito: o RLS restringe ao logo da oficina logada (no máximo uma linha).
    await withTenant(req.user.tid, (tx) => tx.delete(tenantLogos));
    return reply.code(204).send();
  });
};
