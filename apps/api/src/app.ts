import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { env } from './env.js';
import { authPlugin } from './lib/auth.js';
import { registrarTratamentoDeErros } from './lib/erros.js';
import { authRoutes } from './modules/auth/routes.js';
import { categoriasRoutes } from './modules/categorias/routes.js';
import { estoqueRoutes } from './modules/estoque/routes.js';
import { depositosRoutes } from './modules/depositos/routes.js';
import { marcasRoutes } from './modules/marcas/routes.js';
import { materiaisRoutes } from './modules/materiais/routes.js';
import { precosRoutes } from './modules/precos/routes.js';
import { tabelasPrecoRoutes } from './modules/tabelas-preco/routes.js';
import { clientesRoutes } from './modules/clientes/routes.js';
import { configuracoesRoutes } from './modules/configuracoes/routes.js';
import { fotosRoutes } from './modules/fotos/routes.js';
import { funcoesRoutes } from './modules/funcoes/routes.js';
import { opcoesRoutes } from './modules/opcoes/routes.js';
import { painelRoutes } from './modules/painel/routes.js';
import { publicoRoutes } from './modules/publico/routes.js';
import { relatoriosRoutes } from './modules/relatorios/routes.js';
import { usuariosRoutes } from './modules/usuarios/routes.js';
import { veiculosRoutes } from './modules/veiculos/routes.js';
import { vendedoresRoutes } from './modules/vendedores/routes.js';

export async function criarApp() {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: env.TRUST_PROXY || false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registrarTratamentoDeErros(app);

  await app.register(helmet);
  await app.register(authPlugin);

  app.get('/api/saude', async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(publicoRoutes, { prefix: '/api/publico' });
  await app.register(usuariosRoutes, { prefix: '/api/usuarios' });
  await app.register(funcoesRoutes, { prefix: '/api/funcoes' });
  await app.register(fotosRoutes, { prefix: '/api/fotos' });
  await app.register(clientesRoutes, { prefix: '/api/clientes' });
  await app.register(veiculosRoutes, { prefix: '/api/veiculos' });
  await app.register(opcoesRoutes, { prefix: '/api/opcoes' });
  await app.register(materiaisRoutes, { prefix: '/api/materiais' });
  await app.register(categoriasRoutes, { prefix: '/api/categorias' });
  await app.register(marcasRoutes, { prefix: '/api/marcas' });
  await app.register(depositosRoutes, { prefix: '/api/depositos' });
  await app.register(tabelasPrecoRoutes, { prefix: '/api/tabelas-preco' });
  await app.register(precosRoutes, { prefix: '/api/precos' });
  await app.register(estoqueRoutes, { prefix: '/api/estoque' });
  await app.register(configuracoesRoutes, { prefix: '/api/configuracoes' });
  await app.register(relatoriosRoutes, { prefix: '/api/relatorios' });
  await app.register(painelRoutes, { prefix: '/api/painel' });
  await app.register(vendedoresRoutes, { prefix: '/api/vendedores' });

  return app;
}
