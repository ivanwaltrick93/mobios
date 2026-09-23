import { ACESSO_TOTAL, combinarAcessos, type Acessos, type FuncaoResumo, type ModuloId, type Nivel } from '@mobios/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { funcaoPermissoes, funcoes, usuarioFuncoes, users } from '../db/schema.js';

export type AcessoUsuario = {
  ativo: boolean;
  admin: boolean;
  funcoes: FuncaoResumo[];
  /** Nível efetivo por módulo: maior entre as funções ATIVAS; tudo, para o admin. */
  acessos: Acessos;
};

/** Calcula o acesso do usuário a partir das funções dele (sempre dentro de withTenant). */
export async function carregarAcesso(tx: Tx, usuarioId: string): Promise<AcessoUsuario | undefined> {
  const [usuario] = await tx.select({ ativo: users.ativo }).from(users).where(eq(users.id, usuarioId));
  if (!usuario) return undefined;

  const lista = await tx
    .select({ id: funcoes.id, nome: funcoes.nome, admin: funcoes.admin, ativa: funcoes.ativa })
    .from(usuarioFuncoes)
    .innerJoin(funcoes, eq(funcoes.id, usuarioFuncoes.funcaoId))
    .where(eq(usuarioFuncoes.usuarioId, usuarioId))
    .orderBy(asc(funcoes.nome));
  const ativas = lista.filter((f) => f.ativa);
  const admin = ativas.some((f) => f.admin);

  let acessos = ACESSO_TOTAL;
  if (!admin) {
    const niveis = ativas.length
      ? await tx.select({ funcaoId: funcaoPermissoes.funcaoId, modulo: funcaoPermissoes.modulo, nivel: funcaoPermissoes.nivel }).from(funcaoPermissoes).where(inArray(funcaoPermissoes.funcaoId, ativas.map((f) => f.id)))
      : [];
    acessos = combinarAcessos(niveis.map((n) => ({ [n.modulo]: n.nivel }) as Partial<Acessos>));
  }
  // Funções desativadas deixam de valer e também somem do perfil do usuário.
  return { ativo: usuario.ativo, admin, funcoes: ativas.map(({ id, nome, admin }) => ({ id, nome, admin })), acessos };
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
  const encontradas = await tx.select({ id: funcoes.id, admin: funcoes.admin }).from(funcoes).where(and(inArray(funcoes.id, ids), eq(funcoes.ativa, true)));
  return { validas: encontradas.length === ids.length, incluiAdmin: encontradas.some((f) => f.admin) };
}
