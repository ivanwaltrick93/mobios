import { LOGO_TAMANHO_MAXIMO, LOGO_TIPOS, temaInputSchema, temaSchema } from '@mobios/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { withTenant } from '../../db/client.js';
import { tenantLogos } from '../../db/schema.js';
import { ErroHttp } from '../../lib/erros.js';
import { detectarTipoImagem } from '../../lib/imagem.js';
import { enviarLogo, lerTema, salvarTema } from '../../lib/marca.js';

export const configuracoesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);

  // O upload do logo chega como o próprio arquivo no corpo (sem multipart).
  app.addContentTypeParser([...LOGO_TIPOS], { parseAs: 'buffer', bodyLimit: LOGO_TAMANHO_MAXIMO }, (_req, corpo, feito) => feito(null, corpo));

  app.get('/aparencia', { schema: { response: { 200: temaSchema } } }, async (req) => withTenant(req.user.tid, lerTema));

  app.put(
    '/aparencia',
    { onRequest: app.exigirPapel('admin'), schema: { body: temaInputSchema, response: { 200: temaSchema } } },
    async (req) => withTenant(req.user.tid, (tx) => salvarTema(tx, req.body)),
  );

  // ---------- Logo (guardado no banco, tabela tenant_logos) ----------

  app.get('/logo', async (req, reply) => withTenant(req.user.tid, (tx) => enviarLogo(tx, req, reply)));
  app.put('/logo', { onRequest: app.exigirPapel('admin') }, async (req, reply) => {
    const conteudo = req.body;
    if (!Buffer.isBuffer(conteudo) || conteudo.length === 0) throw new ErroHttp(400, 'Envie um arquivo de imagem.');
    const tipo = detectarTipoImagem(conteudo);
    if (!tipo) throw new ErroHttp(415, 'Formato não suportado. Use PNG, JPEG ou WebP.');

    const valores = { conteudo, tipo, tamanho: conteudo.length, atualizadoEm: new Date() };
    await withTenant(req.user.tid, (tx) =>
      tx.insert(tenantLogos).values(valores).onConflictDoUpdate({ target: tenantLogos.tenantId, set: valores }),
    );
    return reply.code(204).send();
  });

  app.delete('/logo', { onRequest: app.exigirPapel('admin') }, async (req, reply) => {
    // Sem `where` de propósito: o RLS restringe ao logo da oficina logada (no máximo uma linha).
    await withTenant(req.user.tid, (tx) => tx.delete(tenantLogos));
    return reply.code(204).send();
  });
};
