import { and, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Tx } from '../db/client.js';
import { materiais } from '../db/schema.js';
import { ErroHttp, naoEncontrado } from './erros.js';

type TabelaComId = PgTable & { id: AnyPgColumn };
type TabelaVersionada = TabelaComId & { versao: AnyPgColumn };

/** Nome de quem criou/alterou. Correlação escrita à mão (o Drizzle não qualifica colunas na subconsulta). */
export const nomeUsuario = (tabela: string, coluna: string) =>
  sql<string | null>`(select u.nome from users u where u.id = ${sql.identifier(tabela)}.${sql.identifier(coluna)})`;

/** A edição precisa dizer qual versão leu (evita que uma alteração apague a de outra pessoa sem perceber). */
export function exigirVersao(versao: number | undefined): number {
  if (versao == null) throw new ErroHttp(400, 'Informe a versão do registro (campo "versao").');
  return versao;
}

/**
 * UPDATE com concorrência otimista: só grava se a versão ainda for a lida, e incrementa a versão.
 * Nenhuma linha afetada: o registro não existe (404) ou outra pessoa salvou antes (409).
 */
export async function atualizarVersionado(
  tx: Tx,
  tabela: TabelaVersionada,
  id: string,
  versao: number,
  valores: Record<string, unknown>,
  rotulo: string,
) {
  const [linha] = await tx
    .update(tabela)
    .set({ ...valores, versao: sql`${tabela.versao} + 1` } as never)
    .where(and(eq(tabela.id, id), eq(tabela.versao, versao)))
    .returning({ id: tabela.id });
  if (linha) return;
  const [existe] = await tx
    .select({ id: tabela.id })
    .from(tabela as PgTable)
    .where(eq(tabela.id, id));
  if (!existe) throw naoEncontrado(rotulo);
  throw new ErroHttp(
    409,
    'Este registro foi alterado por outra pessoa enquanto você editava. Recarregue a página e refaça a alteração.',
  );
}

/** Ativar/inativar (desativação lógica). */
export async function alterarAtivo(
  tx: Tx,
  tabela: TabelaVersionada,
  coluna: AnyPgColumn,
  id: string,
  ativo: boolean,
  usuario: string,
  rotulo: string,
) {
  const [linha] = await tx
    .update(tabela)
    .set({
      [coluna.name === 'ativa' ? 'ativa' : 'ativo']: ativo,
      atualizadoPor: usuario,
      versao: sql`${tabela.versao} + 1`,
    } as never)
    .where(eq(tabela.id, id))
    .returning({ id: tabela.id });
  if (!linha) throw naoEncontrado(rotulo);
}

/**
 * Referência válida para cadastro/alteração: precisa existir na oficina (o RLS garante) e estar ativa.
 * Na edição, manter a referência atual é permitido mesmo se ela foi inativada depois.
 */
export async function validarReferencia(
  tx: Tx,
  tabela: TabelaComId,
  ativo: AnyPgColumn,
  id: string | null,
  atual: string | null | undefined,
  rotulo: string,
) {
  if (!id || id === atual) return;
  const [ref] = await tx
    .select({ ativo })
    .from(tabela as PgTable)
    .where(eq(tabela.id, id));
  // Mensagem sem concordância de gênero: o rótulo pode ser "Categoria pai", "Função do responsável"...
  if (!ref) throw new ErroHttp(400, `${rotulo}: o item escolhido não foi encontrado.`);
  if (!ref.ativo) throw new ErroHttp(400, `${rotulo}: o item escolhido está inativo. Escolha outro ou reative-o.`);
}

/**
 * Exclusão física só do que nunca foi usado (as FKs são RESTRICT). Em uso: 409 com a orientação de inativar.
 */
export async function excluirSeNaoUsado(tx: Tx, tabela: TabelaComId, id: string, rotulo: string, emUso: string) {
  try {
    const [linha] = await tx.delete(tabela).where(eq(tabela.id, id)).returning({ id: tabela.id });
    if (!linha) throw naoEncontrado(rotulo);
  } catch (e) {
    const codigo = ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string }))?.code;
    if (codigo === '23503') throw new ErroHttp(409, emUso);
    throw e;
  }
}

/** Filtro "igual ou abaixo" na hierarquia de categorias. */
export const naCategoriaOuAbaixo = (coluna: AnyPgColumn, categoriaId: string): SQL =>
  sql`${coluna} in (
    with recursive sub(id) as (
      select ${categoriaId}::uuid
      union select c.id from categorias c join sub on c.categoria_pai_id = sub.id
    )
    select id from sub
  )`;

/**
 * Busca de material usada em todas as listagens (materiais, estoque, lista de preços):
 * SKU e código do fabricante por prefixo, código de barras exato (só os dígitos) e descrição por trecho.
 * Usa as colunas de `materiais` sem apelido: a consulta precisa ter a tabela com esse nome no FROM.
 */
export function buscaDeMaterial(q: string): SQL {
  const prefixo = `${q.toUpperCase()}%`;
  return or(
    ilike(materiais.sku, prefixo),
    ilike(materiais.codigoFabricante, prefixo),
    eq(materiais.codigoBarras, q.replace(/\D/g, '') || q),
    ilike(materiais.descricao, `%${q}%`),
  )!;
}
