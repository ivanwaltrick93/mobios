import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { env } from './env.js';
import { authPlugin } from './lib/auth.js';
import { registrarTratamentoDeErros } from './lib/erros.js';
import { authRoutes } from './modules/auth/routes.js';
import { clientesRoutes } from './modules/clientes/routes.js';
import { configuracoesRoutes } from './modules/configuracoes/routes.js';
import { relatoriosRoutes } from './modules/relatorios/routes.js';
import { usuariosRoutes } from './modules/usuarios/routes.js';
import { veiculosRoutes } from './modules/veiculos/routes.js';

export async function criarApp() {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registrarTratamentoDeErros(app);

  await app.register(helmet);
  await app.register(authPlugin);

  app.get('/api/saude', async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(usuariosRoutes, { prefix: '/api/usuarios' });
  await app.register(clientesRoutes, { prefix: '/api/clientes' });
  await app.register(veiculosRoutes, { prefix: '/api/veiculos' });
  await app.register(configuracoesRoutes, { prefix: '/api/configuracoes' });
  await app.register(relatoriosRoutes, { prefix: '/api/relatorios' });

  return app;
}
