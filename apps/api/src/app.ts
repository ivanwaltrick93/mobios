import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { sqlClient } from './db/client.js';
import { env } from './env.js';
import { authPlugin } from './lib/auth.js';
import { registrarCache } from './lib/cache.js';
import { ErroHttp, registrarTratamentoDeErros } from './lib/erros.js';
import { authRoutes } from './modules/auth/routes.js';
import { categoriasRoutes } from './modules/categorias/routes.js';
import { estoqueRoutes } from './modules/estoque/routes.js';
import { depositosRoutes } from './modules/depositos/routes.js';
import { marcasRoutes } from './modules/marcas/routes.js';
import { materiaisRoutes } from './modules/materiais/routes.js';
import { orcamentosRoutes } from './modules/orcamentos/routes.js';
import { precosRoutes } from './modules/precos/routes.js';
import { servicosRoutes } from './modules/servicos/routes.js';
import { tabelasPrecoRoutes } from './modules/tabelas-preco/routes.js';
import { clientesRoutes } from './modules/clientes/routes.js';
import { configuracoesRoutes } from './modules/configuracoes/routes.js';
import { fotosRoutes } from './modules/fotos/routes.js';
import { funcoesRoutes } from './modules/funcoes/routes.js';
import { opcoesRoutes } from './modules/opcoes/routes.js';
import { painelRoutes } from './modules/painel/routes.js';
import { publicoRoutes } from './modules/publico/routes.js';
import { alcadasRoutes } from './modules/alcadas/routes.js';
import { aprovacoesComerciaisRoutes } from './modules/aprovacoes-comerciais/routes.js';
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
  registrarCache(app);

  // Vida (liveness): o processo responde. Não consulta o banco nem o Redis: numa queda do banco, o Kubernetes não deve
  // reiniciar as réplicas (elas voltam sozinhas); só tirá-las de rotação pela prontidão, abaixo (ARQUITETURA §9).
  app.get('/api/vivo', async () => ({ ok: true }));

  // Prontidão: a instância só está pronta com o banco respondendo (o healthcheck do Docker e um balanceador de carga
  // tiram de rotação a instância sem banco). Sem autenticação e sem tenant: só "select 1".
  app.get('/api/saude', async (req) => {
    try {
      await sqlClient`select 1`;
    } catch (erro) {
      req.log.error({ err: erro }, 'Banco de dados indisponível no healthcheck');
      throw new ErroHttp(503, 'Banco de dados indisponível.');
    }
    return { ok: true };
  });
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
  await app.register(servicosRoutes, { prefix: '/api/servicos' });
  await app.register(orcamentosRoutes, { prefix: '/api/orcamentos' });
  await app.register(aprovacoesComerciaisRoutes, { prefix: '/api/aprovacoes-comerciais' });
  await app.register(alcadasRoutes, { prefix: '/api/alcadas' });

  return app;
}
