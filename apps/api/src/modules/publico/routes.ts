import { aparenciaPublicaSchema, TEMA_VAZIO } from '@mobios/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db, withTenant } from '../../db/client.js';
import { tenants } from '../../db/schema.js';
import { enviarLogo, lerTema, lerVersaoLogo } from '../../lib/marca.js';

/**
 * Rotas sem login: só a marca da oficina (nome, cores e logo) para a tela de entrada.
 * Qual oficina: `?oficina=<id>` (link próprio de cada oficina no SaaS) ou, sem parâmetro,
 * a única oficina da instalação. Com várias oficinas e sem parâmetro, usa o tema padrão.
 */
async function resolverOficina(oficina?: string) {
  if (oficina) {
    const [t] = await db.select({ id: tenants.id, nome: tenants.nome }).from(tenants).where(eq(tenants.id, oficina));
    return t;
  }
  const encontradas = await db.select({ id: tenants.id, nome: tenants.nome }).from(tenants).limit(2);
  return encontradas.length === 1 ? encontradas[0] : undefined;
}

const querySchema = z.object({ oficina: z.uuid().optional().catch(undefined) });

export const publicoRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/aparencia',
    { schema: { querystring: querySchema, response: { 200: aparenciaPublicaSchema } } },
    async (req) => {
      const oficina = await resolverOficina(req.query.oficina);
      if (!oficina) return { oficinaId: null, nome: null, tema: TEMA_VAZIO, logoVersao: null };
      return withTenant(oficina.id, async (tx) => ({
        oficinaId: oficina.id,
        nome: oficina.nome,
        tema: await lerTema(tx),
        logoVersao: await lerVersaoLogo(tx),
      }));
    },
  );

  app.get('/logo', { schema: { querystring: querySchema } }, async (req, reply) => {
    const oficina = await resolverOficina(req.query.oficina);
    if (!oficina) return reply.code(404).send({ erro: 'Nenhum logo cadastrado' });
    return withTenant(oficina.id, (tx) => enviarLogo(tx, req, reply));
  });
};
