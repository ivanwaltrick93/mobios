import {
  COLUNAS_IMPORTACAO_SERVICOS,
  idParamSchema,
  resultadoImportacaoSchema,
  servicoFiltroSchema,
  servicoInputSchema,
  servicoResumoSchema,
  servicoSchema,
  statusInputSchema,
  type Servico,
  type ServicoDados,
} from '@mobios/shared';
import { and, asc, count, eq, inArray, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { classificacoesServico, servicos } from '../../db/schema.js';
import {
  alterarAtivo,
  atualizarVersionado,
  buscaDeServico,
  excluirSeNaoUsado,
  exigirVersao,
  nomeUsuario,
  validarReferencia,
} from '../../lib/cadastro.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import {
  aceitarUploadDeCsv,
  colunaDoCampo,
  comparavel,
  exigirPrimeiraVez,
  importarLinhas,
  lerPlanilhaEnviada,
  lerSimNao,
  validarLinha,
} from '../../lib/importacao.js';

const colunasResumo = {
  id: servicos.id,
  codigo: servicos.codigo,
  nome: servicos.nome,
  formaPreco: servicos.formaPreco,
  classificacaoNome: classificacoesServico.nome,
  ativo: servicos.ativo,
};

async function carregar(tx: Tx, id: string): Promise<Servico> {
  const [servico] = await tx
    .select({
      ...colunasResumo,
      descricao: servicos.descricao,
      tempoMinutos: servicos.tempoMinutos,
      observacao: servicos.observacao,
      classificacaoId: servicos.classificacaoId,
      garantiaDias: servicos.garantiaDias,
      garantiaKm: servicos.garantiaKm,
      criadoEm: servicos.criadoEm,
      atualizadoEm: servicos.atualizadoEm,
      criadoPor: nomeUsuario('servicos', 'criado_por'),
      atualizadoPor: nomeUsuario('servicos', 'atualizado_por'),
      versao: servicos.versao,
    })
    .from(servicos)
    .leftJoin(classificacoesServico, eq(classificacoesServico.id, servicos.classificacaoId))
    .where(eq(servicos.id, id));
  if (!servico) throw naoEncontrado('Serviço');
  return servico;
}

type DadosServico = Omit<ServicoDados, 'versao'>;

/** A classificação escolhida precisa existir na oficina e estar ativa (exceto a que o serviço já usa). */
const validarClassificacao = (tx: Tx, dados: DadosServico, atual?: Servico) =>
  validarReferencia(
    tx,
    classificacoesServico,
    classificacoesServico.ativa,
    dados.classificacaoId,
    atual?.classificacaoId,
    'Classificação de serviço',
  );

/** Novo serviço (mesmas regras na tela e na importação). O código é gerado pelo banco. */
async function criarServico(tx: Tx, dados: DadosServico, ativo: boolean, usuarioId: string) {
  await validarClassificacao(tx, dados);
  const [{ id }] = (await tx
    .insert(servicos)
    .values({ ...dados, ativo, criadoPor: usuarioId, atualizadoPor: usuarioId })
    .returning({ id: servicos.id })) as [{ id: string }];
  return id;
}

/** Alteração com concorrência otimista (409 se outra pessoa salvou antes). */
async function atualizarServico(
  tx: Tx,
  atual: Servico,
  versao: number,
  dados: DadosServico & { ativo?: boolean },
  usuarioId: string,
) {
  await validarClassificacao(tx, dados, atual);
  await atualizarVersionado(tx, servicos, atual.id, versao, { ...dados, atualizadoPor: usuarioId }, 'Serviço');
}

/** Serviços (mão de obra), no menu Ofertas. Consultar: módulo Serviços; alterar: Serviços com Editar. */
export const servicosRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('servicos'));
  const editar = { onRequest: app.exigirAcesso('servicos', 'editar') };
  aceitarUploadDeCsv(app);

  /** Busca por código (exato) ou trecho do nome; filtros de classificação e situação. Ordem: código. */
  app.get(
    '/',
    {
      schema: {
        querystring: servicoFiltroSchema,
        response: { 200: z.object({ itens: z.array(servicoResumoSchema), total: z.number() }) },
      },
    },
    async (req) => {
      const { q, classificacaoId, ativo, pagina, porPagina } = req.query;
      const filtros: (SQL | undefined)[] = [
        q ? buscaDeServico(q) : undefined,
        classificacaoId ? eq(servicos.classificacaoId, classificacaoId) : undefined,
        ativo ? eq(servicos.ativo, ativo === 'true') : undefined,
      ];
      const onde = and(...filtros);
      return withTenant(req.user.tid, async (tx) => {
        const itens = await tx
          .select(colunasResumo)
          .from(servicos)
          .leftJoin(classificacoesServico, eq(classificacoesServico.id, servicos.classificacaoId))
          .where(onde)
          .orderBy(asc(servicos.codigo))
          .limit(porPagina)
          .offset((pagina - 1) * porPagina);
        const [{ total }] = (await tx.select({ total: count() }).from(servicos).where(onde)) as [{ total: number }];
        return { itens, total };
      });
    },
  );

  app.get('/:id', { schema: { params: idParamSchema, response: { 200: servicoSchema } } }, async (req) =>
    withTenant(req.user.tid, (tx) => carregar(tx, req.params.id)),
  );

  app.post(
    '/',
    { ...editar, schema: { body: servicoInputSchema, response: { 201: servicoSchema } } },
    async (req, reply) => {
      const { versao: _v, ...dados } = req.body;
      const servico = await withTenant(req.user.tid, async (tx) =>
        carregar(tx, await criarServico(tx, dados, true, req.user.sub)),
      );
      return reply.code(201).send(servico);
    },
  );

  app.put(
    '/:id',
    { ...editar, schema: { params: idParamSchema, body: servicoInputSchema, response: { 200: servicoSchema } } },
    async (req) => {
      const { versao, ...dados } = req.body;
      return withTenant(req.user.tid, async (tx) => {
        const atual = await carregar(tx, req.params.id);
        await atualizarServico(tx, atual, exigirVersao(versao), dados, req.user.sub);
        return carregar(tx, req.params.id);
      });
    },
  );

  app.patch(
    '/:id/status',
    { ...editar, schema: { params: idParamSchema, body: statusInputSchema, response: { 200: servicoSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        await alterarAtivo(tx, servicos, servicos.ativo, req.params.id, req.body.ativo, req.user.sub, 'Serviço');
        return carregar(tx, req.params.id);
      }),
  );

  /** Só serviço nunca precificado pode ser excluído (o histórico de preço não se perde). */
  app.delete('/:id', { ...editar, schema: { params: idParamSchema } }, async (req, reply) => {
    await withTenant(req.user.tid, (tx) =>
      excluirSeNaoUsado(
        tx,
        servicos,
        req.params.id,
        'Serviço',
        'Este serviço já tem preços e não pode ser excluído (o histórico é mantido). Inative-o.',
      ),
    );
    return reply.code(204).send();
  });

  /**
   * Serviços em massa por CSV (COLUNAS_IMPORTACAO_SERVICOS). Sem código = cadastra; código existente =
   * atualiza; colunas opcionais ausentes não mudam o serviço. Grava as linhas válidas e relata as demais.
   */
  app.post('/importar', { ...editar, schema: { response: { 200: resultadoImportacaoSchema } } }, async (req) => {
    const linhas = lerPlanilhaEnviada(req.body, COLUNAS_IMPORTACAO_SERVICOS);
    return withTenant(req.user.tid, async (tx) => {
      // Referências lidas uma vez (não uma consulta por linha).
      const classificacoes = new Map(
        (
          await tx
            .select({ id: classificacoesServico.id, nome: classificacoesServico.nome })
            .from(classificacoesServico)
        ).map((c) => [comparavel(c.nome), c.id]),
      );
      const codigos = [
        ...new Set(
          linhas.map((l) => Number((l.valores.codigo ?? '').trim())).filter((n) => Number.isInteger(n) && n > 0),
        ),
      ];
      const existentes = new Map(
        codigos.length
          ? (
              await tx
                .select({ id: servicos.id, codigo: servicos.codigo })
                .from(servicos)
                .where(inArray(servicos.codigo, codigos))
            ).map((sv) => [sv.codigo, sv.id])
          : [],
      );
      const vistos = new Map<string, number>();

      return importarLinhas(tx, linhas, async (savepoint, { numero, valores }) => {
        const valor = (coluna: string) => (valores[coluna] ?? '').trim();
        const temColuna = (coluna: string) => coluna in valores;

        let atual: Servico | undefined;
        if (valor('codigo')) {
          if (!/^\d{1,9}$/.test(valor('codigo')))
            throw new ErroHttp(400, `codigo: use só números (recebido "${valor('codigo')}").`);
          const codigo = Number(valor('codigo'));
          exigirPrimeiraVez(vistos, String(codigo), numero, `Código ${valor('codigo')}`);
          const id = existentes.get(codigo);
          if (!id)
            throw new ErroHttp(
              400,
              `codigo: serviço ${valor('codigo')} não encontrado. Deixe vazio para cadastrar um novo.`,
            );
          atual = await carregar(savepoint, id);
        }

        let classificacaoId = atual?.classificacaoId ?? null;
        if (temColuna('classificacao')) {
          classificacaoId = valor('classificacao')
            ? (classificacoes.get(comparavel(valor('classificacao'))) ?? null)
            : null;
          if (valor('classificacao') && !classificacaoId)
            throw new ErroHttp(
              400,
              `classificacao: "${valor('classificacao')}" não está na lista (Configurações → Classificação de serviço).`,
            );
        }
        /** Coluna presente = valor da planilha (vazio limpa); ausente = mantém o do serviço existente. */
        const texto = (coluna: string, atualValor: string | number | null | undefined) =>
          temColuna(coluna) ? valor(coluna) : atualValor == null ? '' : String(atualValor);

        const { versao: _v, ...dados } = validarLinha(
          servicoInputSchema,
          {
            nome: valor('nome'),
            descricao: texto('descricao', atual?.descricao),
            formaPreco: temColuna('forma_preco') ? valor('forma_preco').toLowerCase() || undefined : atual?.formaPreco,
            tempoMinutos: temColuna('horas') ? valor('horas') : atual?.tempoMinutos,
            observacao: texto('observacao', atual?.observacao),
            classificacaoId,
            garantiaDias: texto('garantia_dias', atual?.garantiaDias),
            garantiaKm: texto('garantia_km', atual?.garantiaKm),
          },
          ([campo]) =>
            campo === 'tempoMinutos' ? 'horas' : campo === 'classificacaoId' ? 'classificacao' : colunaDoCampo(campo!),
        );
        const ativo = lerSimNao(valor('ativo'), 'ativo');
        if (atual) {
          await atualizarServico(
            savepoint,
            atual,
            atual.versao,
            { ...dados, ativo: ativo ?? atual.ativo },
            req.user.sub,
          );
        } else {
          await criarServico(savepoint, dados, ativo ?? true, req.user.sub);
        }
        return 'importada';
      });
    });
  });
};
