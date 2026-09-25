import { formatarDataIso, formatarTelefone, PARAMETRO_VENDEDOR, type AlteracaoVendedor } from '@mobios/shared';
import { and, eq, notInArray, or } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import {
  funcaoParametros,
  funcoes,
  parametrosFuncao,
  usuarioFuncoes,
  users,
  vendedores,
  vendedoresEventos,
} from '../../db/schema.js';
import { ErroHttp } from '../../lib/erros.js';

// Regras do vendedor usadas também por Usuários e Funções (que podem tirar de alguém a condição de vendedor).

/** Usuários com ao menos uma função ATIVA marcada com o parâmetro VENDEDOR (usar como subconsulta). */
export const usuariosHabilitados = (tx: Tx) =>
  tx
    .select({ id: usuarioFuncoes.usuarioId })
    .from(usuarioFuncoes)
    .innerJoin(funcoes, and(eq(funcoes.id, usuarioFuncoes.funcaoId), eq(funcoes.ativa, true)))
    .innerJoin(funcaoParametros, eq(funcaoParametros.funcaoId, funcoes.id))
    .innerJoin(
      parametrosFuncao,
      and(eq(parametrosFuncao.id, funcaoParametros.parametroId), eq(parametrosFuncao.codigo, PARAMETRO_VENDEDOR)),
    );

const erroUsuario = (mensagem: string) => new ErroHttp(400, mensagem, { usuarioId: mensagem });

/** O usuário escolhido para um vendedor precisa ser da oficina, estar ativo e ter uma função de vendedor. */
export async function exigirUsuarioVendedor(tx: Tx, usuarioId: string) {
  const [usuario] = await tx
    .select({ id: users.id, codigo: users.codigo, nome: users.nome, ativo: users.ativo })
    .from(users)
    .where(eq(users.id, usuarioId));
  if (!usuario) throw erroUsuario('Usuário não encontrado nesta oficina.');
  if (!usuario.ativo) throw erroUsuario('O usuário está desativado. Reative-o em Equipe → Usuários ou escolha outro.');
  const [habilitado] = await usuariosHabilitados(tx).where(eq(usuarioFuncoes.usuarioId, usuarioId)).limit(1);
  if (!habilitado)
    throw erroUsuario(
      'O usuário não tem uma função ativa com o parâmetro Vendedor. Ajuste em Configurações → Funções e permissões.',
    );
  return usuario;
}

export const rotuloUsuario = (u: { codigo: number; nome: string }) => `${u.codigo} — ${u.nome}`;

/** Dados do vendedor como aparecem no log. */
export type RetratoVendedor = {
  usuario: string;
  matricula: string | null;
  whatsapp: string;
  funcionarioDesde: string | null;
  ativo: boolean;
};

const campos: { campo: string; valor: (v: RetratoVendedor) => string | null }[] = [
  { campo: 'Usuário', valor: (v) => v.usuario },
  { campo: 'Matrícula', valor: (v) => v.matricula },
  { campo: 'WhatsApp', valor: (v) => formatarTelefone(v.whatsapp) },
  { campo: 'Funcionário desde', valor: (v) => (v.funcionarioDesde ? formatarDataIso(v.funcionarioDesde) : null) },
  { campo: 'Situação', valor: (v) => (v.ativo ? 'Ativo' : 'Inativo') },
];

/** Campos que mudaram (no cadastro, `antes` é null e entram os campos preenchidos). */
export function compararVendedor(antes: RetratoVendedor | null, depois: RetratoVendedor): AlteracaoVendedor[] {
  return campos
    .map(({ campo, valor }) => ({ campo, antes: antes ? valor(antes) : null, depois: valor(depois) }))
    .filter((a) => a.antes !== a.depois);
}

export async function registrarEvento(
  tx: Tx,
  evento: Omit<typeof vendedoresEventos.$inferInsert, 'id' | 'tenantId' | 'criadoEm'>,
) {
  await tx.insert(vendedoresEventos).values(evento);
}

/**
 * Inativa, na mesma transação, os vendedores cujo usuário foi desativado ou não tem mais função ativa com o
 * parâmetro VENDEDOR (decisão do produto). Chamar depois de alterar usuários ou funções. Uma única consulta.
 */
export async function inativarVendedoresSemCondicao(tx: Tx, responsavelId: string) {
  const afetados = await tx
    .update(vendedores)
    .set({ ativo: false, atualizadoPor: responsavelId })
    .from(users)
    .where(
      and(
        eq(users.id, vendedores.usuarioId),
        eq(vendedores.ativo, true),
        or(eq(users.ativo, false), notInArray(vendedores.usuarioId, usuariosHabilitados(tx))),
      ),
    )
    .returning({ id: vendedores.id, usuarioAtivo: users.ativo });
  if (afetados.length === 0) return;
  await tx.insert(vendedoresEventos).values(
    afetados.map((a) => ({
      vendedorId: a.id,
      evento: 'inativado' as const,
      origem: 'automatica' as const,
      motivo: a.usuarioAtivo
        ? 'O usuário deixou de ter uma função ativa com o parâmetro Vendedor.'
        : 'O usuário foi desativado.',
      alteracoes: [{ campo: 'Situação', antes: 'Ativo', depois: 'Inativo' }],
      usuarioId: responsavelId,
    })),
  );
}
