import {
  ACESSO_TOTAL,
  PARAMETRO_MECANICO,
  combinarAcessos,
  type Acessos,
  type FuncaoResumo,
  type ModuloId,
  type Nivel,
} from '@mobios/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { funcaoPermissoes, funcoes, usuarioFuncoes } from '../db/schema.js';

export type AcessoUsuario = {
  ativo: boolean;
  admin: boolean;
  funcoes: FuncaoResumo[];
  /** Nível efetivo por módulo: maior entre as funções ATIVAS; tudo, para o admin. */
  acessos: Acessos;
  /**
   * Cadastro de vendedor ATIVO do usuário, se ele não for Administrador: os orçamentos ficam no nome dele e ele
   * só vê e altera os próprios (docs/modulos/ORCAMENTOS.md §5). null = não atua como vendedor.
   */
  vendedorId: string | null;
  /**
   * Mecânico: função ativa com o parâmetro MECÂNICO, sem ser Administrador nem vendedor. Só vê as O.S. vinculadas a
   * ele (docs/modulos/ORDENS_SERVICO.md §7).
   */
  mecanico: boolean;
};

/**
 * Calcula o acesso do usuário a partir das funções dele (sempre dentro de withTenant). Uma consulta só: roda em toda
 * requisição autenticada (lib/auth.ts), e cada ida ao banco conta (docs/performance/DATABASE.md §Autenticação).
 */
export async function carregarAcesso(tx: Tx, usuarioId: string): Promise<AcessoUsuario | undefined> {
  const [linha] = (await tx.execute(sql`
    select u.ativo,
      coalesce((select json_agg(json_build_object('id', f.id, 'nome', f.nome, 'admin', f.admin) order by f.nome)
        from usuario_funcoes uf join funcoes f on f.id = uf.funcao_id
        where uf.usuario_id = u.id and f.ativa), '[]'::json) as funcoes,
      coalesce((select json_agg(json_build_object('modulo', p.modulo, 'nivel', p.nivel))
        from usuario_funcoes uf join funcoes f on f.id = uf.funcao_id join funcao_permissoes p on p.funcao_id = f.id
        where uf.usuario_id = u.id and f.ativa), '[]'::json) as niveis,
      (select v.id from vendedores v where v.usuario_id = u.id and v.ativo) as "vendedorId",
      exists (select 1 from usuario_funcoes uf join funcoes f on f.id = uf.funcao_id
        join funcao_parametros fp on fp.funcao_id = f.id join parametros_funcao p on p.id = fp.parametro_id
        where uf.usuario_id = u.id and f.ativa and p.codigo = ${PARAMETRO_MECANICO}) as "temMecanico"
    from users u
    where u.id = ${usuarioId}`)) as unknown as {
    ativo: boolean;
    funcoes: FuncaoResumo[];
    niveis: { modulo: ModuloId; nivel: Nivel }[];
    vendedorId: string | null;
    temMecanico: boolean;
  }[];
  if (!linha) return undefined;

  // Só as funções ATIVAS valem; desativadas também somem do perfil do usuário.
  const admin = linha.funcoes.some((f) => f.admin);
  return {
    ativo: linha.ativo,
    admin,
    funcoes: linha.funcoes,
    acessos: admin
      ? ACESSO_TOTAL
      : combinarAcessos(linha.niveis.map((n) => ({ [n.modulo]: n.nivel }) as Partial<Acessos>)),
    vendedorId: admin ? null : linha.vendedorId,
    mecanico: !admin && !linha.vendedorId && linha.temMecanico,
  };
}

/** Grava os níveis de uma função (substitui os anteriores). */
export async function gravarAcessos(tx: Tx, funcaoId: string, acessos: Partial<Record<ModuloId, Nivel | null>>) {
  await tx.delete(funcaoPermissoes).where(eq(funcaoPermissoes.funcaoId, funcaoId));
  const linhas = Object.entries(acessos)
    .filter(([, nivel]) => nivel)
    .map(([modulo, nivel]) => ({ funcaoId, modulo: modulo as ModuloId, nivel: nivel! }));
  if (linhas.length) await tx.insert(funcaoPermissoes).values(linhas);
}

/** Troca as funções de um usuário. */
export async function gravarFuncoesDoUsuario(tx: Tx, usuarioId: string, funcaoIds: string[]) {
  await tx.delete(usuarioFuncoes).where(eq(usuarioFuncoes.usuarioId, usuarioId));
  if (funcaoIds.length) await tx.insert(usuarioFuncoes).values(funcaoIds.map((funcaoId) => ({ usuarioId, funcaoId })));
}

/** Confere se os ids são de funções ATIVAS desta oficina (o RLS esconde as de outras). */
export async function funcoesAtivasValidas(tx: Tx, ids: string[]) {
  const encontradas = await tx
    .select({ id: funcoes.id, admin: funcoes.admin })
    .from(funcoes)
    .where(and(inArray(funcoes.id, ids), eq(funcoes.ativa, true)));
  return { validas: encontradas.length === ids.length, incluiAdmin: encontradas.some((f) => f.admin) };
}
