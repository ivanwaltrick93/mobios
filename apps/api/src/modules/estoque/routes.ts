import {
  ajusteEstoqueSchema,
  COLUNAS_IMPORTACAO_ESTOQUE,
  estoqueAjusteSchema,
  estoqueFiltroSchema,
  lancamentoEstoqueSchema,
  resultadoImportacaoSchema,
  saldoSchema,
  UNIDADES,
  type Saldo,
  type Unidade,
} from '@mobios/shared';
import { and, asc, count, desc, eq, gt, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { depositos, estoqueAjustes, estoques, materiais } from '../../db/schema.js';
import { buscaDeMaterial, nomeUsuario } from '../../lib/cadastro.js';
import { lerNumero } from '../../lib/csv.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import { aceitarUploadDeCsv, importarLinhas, lerPlanilhaEnviada } from '../../lib/importacao.js';

const chaveParams = z.object({ materialId: z.uuid(), depositoId: z.uuid() });

const colunas = {
  materialId: materiais.id,
  sku: materiais.sku,
  descricao: materiais.descricao,
  unidade: materiais.unidade,
  materialAtivo: materiais.ativo,
  depositoId: depositos.id,
  depositoCodigo: depositos.codigo,
  depositoNome: depositos.nome,
  depositoAtivo: depositos.ativo,
  // Sem linha de saldo = zero.
  disponivel: sql<number>`coalesce(${estoques.disponivel}, 0)`.mapWith(Number),
  reservado: sql<number>`coalesce(${estoques.reservado}, 0)`.mapWith(Number),
  total: sql<number>`coalesce(${estoques.disponivel}, 0) + coalesce(${estoques.reservado}, 0)`.mapWith(Number),
  atualizadoEm: estoques.atualizadoEm,
  atualizadoPor: nomeUsuario('estoques', 'atualizado_por'),
  versao: estoques.versao,
};

async function carregar(tx: Tx, materialId: string, depositoId: string): Promise<Saldo> {
  const [s] = await tx
    .select(colunas)
    .from(materiais)
    .innerJoin(depositos, eq(depositos.id, depositoId))
    .leftJoin(estoques, and(eq(estoques.materialId, materiais.id), eq(estoques.depositoId, depositos.id)))
    .where(eq(materiais.id, materialId));
  if (!s) throw naoEncontrado('Material ou depósito');
  return s;
}

const colunasMaterial = {
  id: materiais.id,
  sku: materiais.sku,
  ativo: materiais.ativo,
  controlaEstoque: materiais.controlaEstoque,
  unidade: materiais.unidade,
};
type MaterialDoSaldo = { id: string; ativo: boolean; controlaEstoque: boolean; unidade: Unidade };
type DepositoDoSaldo = { id: string; ativo: boolean };

const buscarMateriais = (tx: Tx, filtro: SQL) => tx.select(colunasMaterial).from(materiais).where(filtro);
const buscarMaterial = async (tx: Tx, filtro: SQL) => (await buscarMateriais(tx, filtro))[0];
const buscarDepositos = (tx: Tx, filtro?: SQL) =>
  tx.select({ id: depositos.id, codigo: depositos.codigo, ativo: depositos.ativo }).from(depositos).where(filtro);
const buscarDeposito = async (tx: Tx, filtro: SQL) => (await buscarDepositos(tx, filtro))[0];

/** Quantidade de planilha (vírgula ou ponto decimal, até 3 casas, não negativa). */
function lerQuantidade(texto: string, rotulo: string): number {
  const valor = lerNumero(texto);
  if (valor == null || valor < 0 || Math.abs(Math.round(valor * 1000) - valor * 1000) > 1e-6) {
    throw new ErroHttp(400, `${rotulo} "${texto}" inválido: use um número não negativo com até 3 casas decimais.`);
  }
  return valor;
}

/**
 * Grava o saldo final de um material num depósito, com o antes/depois em estoque_ajustes.
 * Regras: material ativo e que controla estoque; unidade inteira não aceita fração; depósito ativo.
 * A linha é travada (FOR UPDATE). `conferirVersao`: a versão lida precisa bater (ajuste pela tabela);
 * no lançamento por código e na importação o valor informado é o saldo final e prevalece.
 * `reservado: null` mantém o reservado atual. Mesmos valores = nada a gravar.
 */
async function ajustarSaldo(
  tx: Tx,
  dados: {
    material: MaterialDoSaldo;
    deposito: DepositoDoSaldo;
    disponivel: number;
    reservado: number | null;
    motivo: string;
    versao?: number;
    conferirVersao?: boolean;
  },
  usuarioId: string,
): Promise<'alterado' | 'sem_alteracao'> {
  const { material, deposito, disponivel, motivo, versao, conferirVersao = false } = dados;
  if (!material.controlaEstoque)
    throw new ErroHttp(400, 'Este material não controla estoque (veja os controles do cadastro).');
  if (!material.ativo) throw new ErroHttp(400, 'Material inativo não recebe ajuste de estoque. Reative-o primeiro.');
  if (!deposito.ativo) throw new ErroHttp(400, 'Depósito inativo não recebe ajuste de estoque.');

  const chave = and(eq(estoques.materialId, material.id), eq(estoques.depositoId, deposito.id));
  const [atual] = await tx.select().from(estoques).where(chave).for('update');
  const reservado = dados.reservado ?? atual?.reservado ?? 0;
  if (!UNIDADES[material.unidade].fracionada && (!Number.isInteger(disponivel) || !Number.isInteger(reservado))) {
    throw new ErroHttp(400, `A unidade ${material.unidade} não aceita quantidade fracionada.`);
  }
  // Sem versão com a linha já existente = a tela leu o saldo zerado e alguém gravou antes: também é conflito.
  if (conferirVersao && atual && versao !== atual.versao) {
    throw new ErroHttp(
      409,
      'O saldo foi alterado por outra pessoa enquanto você editava. Recarregue e refaça o ajuste.',
    );
  }
  if ((atual?.disponivel ?? 0) === disponivel && (atual?.reservado ?? 0) === reservado) return 'sem_alteracao';

  if (atual) {
    await tx
      .update(estoques)
      .set({ disponivel, reservado, atualizadoPor: usuarioId, versao: atual.versao + 1 })
      .where(chave);
  } else {
    await tx
      .insert(estoques)
      .values({ materialId: material.id, depositoId: deposito.id, disponivel, reservado, atualizadoPor: usuarioId });
  }
  await tx.insert(estoqueAjustes).values({
    materialId: material.id,
    depositoId: deposito.id,
    disponivelAntes: atual?.disponivel ?? 0,
    disponivelDepois: disponivel,
    reservadoAntes: atual?.reservado ?? 0,
    reservadoDepois: reservado,
    motivo,
    usuarioId,
  });
  return 'alterado';
}

/**
 * Estoque por material + depósito. Consultar = ver saldos; Editar = ajuste manual com motivo.
 * Cada alteração grava o antes/depois em estoque_ajustes; o saldo nunca fica negativo (CHECK no banco).
 */
export const estoqueRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('estoque'));
  const editar = { onRequest: app.exigirAcesso('estoque', 'editar') };
  aceitarUploadDeCsv(app);

  /**
   * Tabela de estoque: uma linha por SKU + depósito. Parte do produto cartesiano material × depósito
   * (só ativos e que controlam estoque) com o saldo gravado; combinações sem saldo aparecem zeradas.
   */
  app.get(
    '/',
    {
      schema: {
        querystring: estoqueFiltroSchema,
        response: { 200: z.object({ itens: z.array(saldoSchema), total: z.number() }) },
      },
    },
    async (req) => {
      const { q, depositoId, materialId, comSaldo, pagina, porPagina } = req.query;
      const filtros: (SQL | undefined)[] = [
        // Linha existe se já tem saldo gravado, ou se material e depósito estão ativos e o material controla estoque.
        or(
          sql`${estoques.materialId} is not null`,
          and(eq(materiais.ativo, true), eq(materiais.controlaEstoque, true), eq(depositos.ativo, true)),
        ),
        q ? buscaDeMaterial(q) : undefined,
        depositoId ? eq(depositos.id, depositoId) : undefined,
        materialId ? eq(materiais.id, materialId) : undefined,
        comSaldo === 'true' ? or(gt(estoques.disponivel, 0), gt(estoques.reservado, 0)) : undefined,
      ];
      const where = and(...filtros);
      return withTenant(req.user.tid, async (tx) => {
        const itens = await tx
          .select(colunas)
          .from(materiais)
          .innerJoin(depositos, sql`true`)
          .leftJoin(estoques, and(eq(estoques.materialId, materiais.id), eq(estoques.depositoId, depositos.id)))
          .where(where)
          .orderBy(asc(materiais.sku), asc(depositos.codigo))
          .limit(porPagina)
          .offset((pagina - 1) * porPagina);
        const [{ total }] = (await tx
          .select({ total: count() })
          .from(materiais)
          .innerJoin(depositos, sql`true`)
          .leftJoin(estoques, and(eq(estoques.materialId, materiais.id), eq(estoques.depositoId, depositos.id)))
          .where(where)) as [{ total: number }];
        return { itens, total };
      });
    },
  );

  /** Saldo do material em cada depósito ativo (zerado onde ainda não há saldo) e nos inativos que têm saldo. */
  app.get(
    '/material/:materialId',
    { schema: { params: z.object({ materialId: z.uuid() }), response: { 200: z.array(saldoSchema) } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const lista = await tx
          .select(colunas)
          .from(materiais)
          .innerJoin(depositos, sql`true`)
          .leftJoin(estoques, and(eq(estoques.materialId, materiais.id), eq(estoques.depositoId, depositos.id)))
          .where(
            and(
              eq(materiais.id, req.params.materialId),
              or(eq(depositos.ativo, true), sql`${estoques.materialId} is not null`),
            ),
          )
          .orderBy(asc(depositos.codigo));
        if (!lista.length) {
          const [existe] = await tx
            .select({ id: materiais.id })
            .from(materiais)
            .where(eq(materiais.id, req.params.materialId));
          if (!existe) throw naoEncontrado('Material');
        }
        return lista;
      }),
  );

  /** Ajuste manual pela linha da tabela: exige a versão lida do saldo (um ajuste não apaga outro). */
  app.put(
    '/:materialId/:depositoId',
    { ...editar, schema: { params: chaveParams, body: estoqueAjusteSchema, response: { 200: saldoSchema } } },
    async (req) => {
      const { materialId, depositoId } = req.params;
      return withTenant(req.user.tid, async (tx) => {
        const material = await buscarMaterial(tx, eq(materiais.id, materialId));
        if (!material) throw naoEncontrado('Material');
        const deposito = await buscarDeposito(tx, eq(depositos.id, depositoId));
        if (!deposito) throw naoEncontrado('Depósito');
        const situacao = await ajustarSaldo(
          tx,
          { ...req.body, material, deposito, conferirVersao: true },
          req.user.sub,
        );
        if (situacao === 'sem_alteracao') throw new ErroHttp(400, 'Nenhuma quantidade foi alterada.');
        return carregar(tx, materialId, depositoId);
      });
    },
  );

  /** Lançamento de saldo final pelos códigos digitados: SKU e depósito precisam existir (erro no campo). */
  app.post(
    '/lancamento',
    { ...editar, schema: { body: lancamentoEstoqueSchema, response: { 200: saldoSchema } } },
    async (req) => {
      const { sku, deposito: codigoDeposito, ...quantidades } = req.body;
      return withTenant(req.user.tid, async (tx) => {
        const material = await buscarMaterial(tx, eq(materiais.sku, sku));
        const deposito = await buscarDeposito(tx, eq(depositos.codigo, codigoDeposito));
        if (!material || !deposito) {
          throw new ErroHttp(400, 'Confira o SKU e o depósito informados.', {
            ...(!material && { sku: `SKU ${sku} não encontrado` }),
            ...(!deposito && { deposito: `Depósito ${codigoDeposito} não encontrado` }),
          });
        }
        const situacao = await ajustarSaldo(tx, { ...quantidades, material, deposito }, req.user.sub);
        if (situacao === 'sem_alteracao') throw new ErroHttp(400, 'Nenhuma quantidade foi alterada.');
        return carregar(tx, material.id, deposito.id);
      });
    },
  );

  /**
   * Saldos em massa por CSV (colunas em COLUNAS_IMPORTACAO_ESTOQUE; a 1ª linha é o cabeçalho).
   * Cada linha informa o saldo final. Grava as válidas e devolve o erro de cada uma das outras.
   */
  app.post('/importar', { ...editar, schema: { response: { 200: resultadoImportacaoSchema } } }, async (req) => {
    const linhas = lerPlanilhaEnviada(req.body, COLUNAS_IMPORTACAO_ESTOQUE);
    return withTenant(req.user.tid, async (tx) => {
      // Materiais e depósitos da planilha lidos de uma vez, não uma consulta por linha.
      const skus = [...new Set(linhas.map((l) => (l.valores.sku ?? '').toUpperCase()).filter(Boolean))];
      const encontrados = skus.length ? await buscarMateriais(tx, inArray(materiais.sku, skus)) : [];
      const porSku = new Map(encontrados.map((m) => [m.sku, m]));
      const porCodigo = new Map((await buscarDepositos(tx)).map((d) => [d.codigo, d]));

      return importarLinhas(tx, linhas, async (savepoint, { valores }) => {
        const valor = (coluna: string) => valores[coluna] ?? '';
        const material = porSku.get(valor('sku').toUpperCase());
        if (!material) throw new ErroHttp(400, `SKU "${valor('sku')}" não encontrado.`);
        const deposito = porCodigo.get(valor('deposito').toUpperCase());
        if (!deposito) throw new ErroHttp(400, `Depósito "${valor('deposito')}" não encontrado.`);
        const disponivel = lerQuantidade(valor('disponivel'), 'Disponível');
        const reservado = valor('reservado') ? lerQuantidade(valor('reservado'), 'Reservado') : null;
        const motivo = valor('motivo') || 'Importação de planilha';
        const situacao = await ajustarSaldo(
          savepoint,
          { material, deposito, disponivel, reservado, motivo },
          req.user.sub,
        );
        return situacao === 'sem_alteracao' ? 'ignorada' : 'importada';
      });
    });
  });

  /** Histórico de ajustes de um material num depósito (mais recente primeiro). */
  app.get(
    '/:materialId/:depositoId/ajustes',
    { schema: { params: chaveParams, response: { 200: z.array(ajusteEstoqueSchema) } } },
    async (req) =>
      withTenant(req.user.tid, (tx) =>
        tx
          .select({
            id: estoqueAjustes.id,
            disponivelAntes: estoqueAjustes.disponivelAntes,
            disponivelDepois: estoqueAjustes.disponivelDepois,
            reservadoAntes: estoqueAjustes.reservadoAntes,
            reservadoDepois: estoqueAjustes.reservadoDepois,
            motivo: estoqueAjustes.motivo,
            usuario: nomeUsuario('estoque_ajustes', 'usuario_id'),
            criadoEm: estoqueAjustes.criadoEm,
          })
          .from(estoqueAjustes)
          .where(
            and(
              eq(estoqueAjustes.materialId, req.params.materialId),
              eq(estoqueAjustes.depositoId, req.params.depositoId),
            ),
          )
          .orderBy(desc(estoqueAjustes.criadoEm))
          .limit(100),
      ),
  );
};
