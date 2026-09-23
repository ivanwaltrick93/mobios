import { LOGO_TAMANHO_MAXIMO, LOGO_TIPOS, temaInputSchema, temaSchema } from '@mobios/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { db, withTenant } from '../../db/client.js';
import { tenantLogos, tenants } from '../../db/schema.js';
import { ErroHttp } from '../../lib/erros.js';
import { detectarTipoImagem } from '../../lib/imagem.js';

// `tenants` não tem RLS (é a própria oficina): o filtro por id do token é obrigatório aqui.
const tema = { corPrimaria: tenants.corPrimaria, corMenu: tenants.corMenu };

export const configuracoesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);

  // O upload do logo chega como o próprio arquivo no corpo (sem multipart).
  app.addContentTypeParser([...LOGO_TIPOS], { parseAs: 'buffer', bodyLimit: LOGO_TAMANHO_MAXIMO }, (_req, corpo, feito) => feito(null, corpo));

  app.get('/aparencia', { schema: { response: { 200: temaSchema } } }, async (req) => {
    const [linha] = await db.select(tema).from(tenants).where(eq(tenants.id, req.user.tid));
    return linha!;
  });

  app.put(
    '/aparencia',
    { onRequest: app.exigirPapel('admin'), schema: { body: temaInputSchema, response: { 200: temaSchema } } },
    async (req) => {
      const [linha] = await db.update(tenants).set(req.body).where(eq(tenants.id, req.user.tid)).returning(tema);
      return linha!;
    },
  );

  // ---------- Logo (guardado no banco, tabela tenant_logos) ----------

  app.get('/logo', async (req, reply) => {
    const [logo] = await withTenant(req.user.tid, (tx) =>
      tx.select({ conteudo: tenantLogos.conteudo, tipo: tenantLogos.tipo, atualizadoEm: tenantLogos.atualizadoEm }).from(tenantLogos),
    );
    if (!logo) throw new ErroHttp(404, 'Nenhum logo cadastrado');
    const etag = `"${logo.atualizadoEm.getTime()}"`;
    reply.header('ETag', etag).header('Cache-Control', 'private, max-age=31536000, immutable');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.type(logo.tipo).send(logo.conteudo);
  });

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
