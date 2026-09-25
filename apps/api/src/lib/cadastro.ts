import { and, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Tx } from '../db/client.js';
import { categorias, materiais, servicos } from '../db/schema.js';
import { ErroHttp, naoEncontrado } from './erros.js';
import { comparavel } from './importacao.js';

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

/** Busca de serviço: código exato (com ou sem zeros à esquerda) ou trecho do nome (índice trigram). */
export function buscaDeServico(q: string): SQL {
  const codigo = /^\d{1,9}$/.test(q) ? Number(q) : null;
  return or(ilike(servicos.nome, `%${q}%`), ...(codigo ? [eq(servicos.codigo, codigo)] : []))!;
}

// ---------- Categoria pela planilha (importações) ----------

export type CategoriaDaPlanilha = {
  id: string;
  nome: string;
  codigo: string | null;
  paiId: string | null;
  caminho: string;
};

/** Categorias da oficina localizáveis pelo código, pelo caminho ("peças > motor") ou pelo nome, se único. */
export class MapaDeCategorias {
  private porId = new Map<string, CategoriaDaPlanilha>();

  static async carregar(tx: Tx) {
    const mapa = new MapaDeCategorias();
    const todas = await tx
      .select({ id: categorias.id, nome: categorias.nome, codigo: categorias.codigo, paiId: categorias.categoriaPaiId })
      .from(categorias);
    const porId = new Map(todas.map((c) => [c.id, c]));
    const caminho = (c: (typeof todas)[number]): string => {
      const pai = c.paiId ? porId.get(c.paiId) : undefined;
      return pai ? `${caminho(pai)} > ${c.nome}` : c.nome;
    };
    for (const c of todas) mapa.guardar({ ...c, caminho: caminho(c) });
    return mapa;
  }

  /** Inclui ou atualiza (categoria gravada durante a importação vira referência para as linhas seguintes). */
  guardar(categoria: CategoriaDaPlanilha) {
    this.porId.set(categoria.id, categoria);
  }

  caminhoDe(id: string) {
    return this.porId.get(id)?.caminho;
  }

  /** Categoria com este caminho exato (nome sob o pai), se existir. */
  porCaminho(caminho: string) {
    return [...this.porId.values()].find((c) => normalizarCaminho(c.caminho) === normalizarCaminho(caminho));
  }

  porCodigo(codigo: string) {
    return [...this.porId.values()].find((c) => c.codigo === codigo.trim().toUpperCase());
  }

  /** Código, caminho completo ou nome (só se não houver outra categoria com o mesmo nome). */
  achar(texto: string, coluna: string): CategoriaDaPlanilha {
    const achada = this.porCodigo(texto) ?? this.porCaminho(texto);
    if (achada) return achada;
    const mesmoNome = [...this.porId.values()].filter((c) => comparavel(c.nome) === comparavel(texto));
    if (mesmoNome.length === 1) return mesmoNome[0]!;
    if (mesmoNome.length > 1) {
      throw new ErroHttp(
        400,
        `${coluna}: há mais de uma categoria "${texto}" (${mesmoNome
          .map((c) => c.caminho)
          .sort()
          .join('; ')}). ` + 'Informe o código ou o caminho completo.',
      );
    }
    throw new ErroHttp(400, `${coluna}: categoria "${texto}" não encontrada.`);
  }
}

/** "Peças › Motor" e "peças > motor" são o mesmo caminho. */
const normalizarCaminho = (caminho: string) => caminho.split(/[>›]/).map(comparavel).filter(Boolean).join(' > ');
