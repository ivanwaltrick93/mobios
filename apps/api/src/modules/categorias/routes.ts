import {
  categoriaInputSchema,
  categoriaSchema,
  COLUNAS_IMPORTACAO_CATEGORIAS,
  idParamSchema,
  resultadoImportacaoSchema,
  statusInputSchema,
} from '@mobios/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { categorias } from '../../db/schema.js';
import {
  alterarAtivo,
  atualizarVersionado,
  excluirSeNaoUsado,
  exigirVersao,
  MapaDeCategorias,
  validarReferencia,
} from '../../lib/cadastro.js';
import { naoEncontrado } from '../../lib/erros.js';
import {
  aceitarUploadDeCsv,
  colunaDoCampo,
  comparavel,
  exigirPrimeiraVez,
  importarLinhas,
  lerPlanilhaEnviada,
  validarLinha,
} from '../../lib/importacao.js';

// Correlação escrita à mão (o Drizzle não qualifica colunas dentro da subconsulta).
const colunas = {
  id: categorias.id,
  codigo: categorias.codigo,
  nome: categorias.nome,
  descricao: categorias.descricao,
  categoriaPaiId: categorias.categoriaPaiId,
  ativa: categorias.ativa,
  materiais: sql<number>`(select count(*) from materiais m where m.categoria_id = "categorias"."id")`.mapWith(Number),
  versao: categorias.versao,
};

async function carregar(tx: Tx, id: string) {
  const [c] = await tx.select(colunas).from(categorias).where(eq(categorias.id, id));
  if (!c) throw naoEncontrado('Categoria');
  return c;
}

type DadosCategoria = Omit<z.output<typeof categoriaInputSchema>, 'versao'>;

/** Nova categoria: o pai precisa existir e estar ativo. Mesmas regras na tela e na importação. */
async function criarCategoria(tx: Tx, dados: DadosCategoria, usuarioId: string) {
  await validarReferencia(tx, categorias, categorias.ativa, dados.categoriaPaiId, null, 'Categoria pai');
  const [{ id }] = (await tx
    .insert(categorias)
    .values({ ...dados, criadoPor: usuarioId, atualizadoPor: usuarioId })
    .returning({ id: categorias.id })) as [{ id: string }];
  return id;
}

/** Alteração com concorrência otimista; manter o pai atual é permitido mesmo se ele foi inativado depois. */
async function atualizarCategoria(tx: Tx, id: string, versao: number, dados: DadosCategoria, usuarioId: string) {
  const atual = await carregar(tx, id);
  await validarReferencia(
    tx,
    categorias,
    categorias.ativa,
    dados.categoriaPaiId,
    atual.categoriaPaiId,
    'Categoria pai',
  );
  await atualizarVersionado(tx, categorias, id, versao, { ...dados, atualizadoPor: usuarioId }, 'Categoria');
}

/**
 * Categorias hierárquicas. A árvore vem "achatada" (cada item com o pai); a tela monta a hierarquia.
 * Ciclos são barrados no banco (trigger categorias_sem_ciclo); aqui só validamos que o pai existe e está ativo.
 */
export const categoriasRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('materiais'));
  const editar = { onRequest: app.exigirAcesso('materiais', 'editar') };
  aceitarUploadDeCsv(app);

  app.get('/', { schema: { response: { 200: z.array(categoriaSchema) } } }, async (req) =>
    withTenant(req.user.tid, (tx) => tx.select(colunas).from(categorias).orderBy(asc(categorias.nome))),
  );

  app.post(
    '/',
    { ...editar, schema: { body: categoriaInputSchema, response: { 201: categoriaSchema } } },
    async (req, reply) => {
      const { versao: _v, ...dados } = req.body;
      const categoria = await withTenant(req.user.tid, async (tx) =>
        carregar(tx, await criarCategoria(tx, dados, req.user.sub)),
      );
      return reply.code(201).send(categoria);
    },
  );

  app.put(
    '/:id',
    { ...editar, schema: { params: idParamSchema, body: categoriaInputSchema, response: { 200: categoriaSchema } } },
    async (req) => {
      const { versao, ...dados } = req.body;
      return withTenant(req.user.tid, async (tx) => {
        await atualizarCategoria(tx, req.params.id, exigirVersao(versao), dados, req.user.sub);
        return carregar(tx, req.params.id);
      });
    },
  );

  /**
   * Categorias em massa por CSV (colunas em COLUNAS_IMPORTACAO_CATEGORIAS), na ordem do arquivo: o pai pode
   * vir numa linha anterior. Mesmo código, ou mesmo nome sob o mesmo pai, atualiza a existente; colunas
   * ausentes do arquivo não mudam a existente. Grava as válidas e relata as demais.
   */
  app.post('/importar', { ...editar, schema: { response: { 200: resultadoImportacaoSchema } } }, async (req) => {
    const linhas = lerPlanilhaEnviada(req.body, COLUNAS_IMPORTACAO_CATEGORIAS);
    return withTenant(req.user.tid, async (tx) => {
      const mapa = await MapaDeCategorias.carregar(tx);
      const vistos = new Map<string, number>();
      return importarLinhas(tx, linhas, async (savepoint, { numero, valores }) => {
        const valor = (coluna: string) => valores[coluna] ?? '';
        const temColuna = (coluna: string) => coluna in valores;
        const pai = valor('pai') ? mapa.achar(valor('pai'), 'pai') : null;
        const caminho = pai ? `${pai.caminho} > ${valor('nome')}` : valor('nome');
        exigirPrimeiraVez(vistos, comparavel(caminho), numero, 'Categoria');

        const existente = (valor('codigo') && mapa.porCodigo(valor('codigo'))) || mapa.porCaminho(caminho);
        const atual = existente ? await carregar(savepoint, existente.id) : undefined;
        const { versao: _v, ...dados } = validarLinha(
          categoriaInputSchema,
          {
            nome: valor('nome'),
            codigo: temColuna('codigo') ? valor('codigo') : (atual?.codigo ?? ''),
            descricao: temColuna('descricao') ? valor('descricao') : (atual?.descricao ?? ''),
            categoriaPaiId: temColuna('pai') ? (pai?.id ?? null) : (atual?.categoriaPaiId ?? null),
          },
          ([campo]) => (campo === 'categoriaPaiId' ? 'pai' : colunaDoCampo(campo!)),
        );
        let id: string;
        if (atual) {
          await atualizarCategoria(savepoint, atual.id, atual.versao, dados, req.user.sub);
          id = atual.id;
        } else {
          id = await criarCategoria(savepoint, dados, req.user.sub);
        }
        // A categoria gravada já serve de pai para as próximas linhas.
        const caminhoPai = dados.categoriaPaiId ? mapa.caminhoDe(dados.categoriaPaiId) : undefined;
        mapa.guardar({
          id,
          nome: dados.nome,
          codigo: dados.codigo ?? null,
          paiId: dados.categoriaPaiId,
          caminho: caminhoPai ? `${caminhoPai} > ${dados.nome}` : dados.nome,
        });
        return 'importada';
      });
    });
  });

  app.patch(
    '/:id/status',
    { ...editar, schema: { params: idParamSchema, body: statusInputSchema, response: { 200: categoriaSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        await alterarAtivo(tx, categorias, categorias.ativa, req.params.id, req.body.ativo, req.user.sub, 'Categoria');
        return carregar(tx, req.params.id);
      }),
  );

  app.delete('/:id', { ...editar, schema: { params: idParamSchema } }, async (req, reply) => {
    await withTenant(req.user.tid, (tx) =>
      excluirSeNaoUsado(
        tx,
        categorias,
        req.params.id,
        'Categoria',
        'Esta categoria tem subcategorias ou materiais e não pode ser excluída. Inative-a.',
      ),
    );
    return reply.code(204).send();
  });
};
