import { z } from 'zod';
import { dataPassadaOpcional, telefoneSchema } from './schemas.js';

/*
 * Vendedores (docs/ENTREGAVEIS.md, CAD-18). O vendedor é sempre um usuário da oficina com uma função ativa
 * que tenha o parâmetro VENDEDOR; nome e e-mail vêm do usuário. Só o Administrador gerencia.
 */

export const SITUACOES_VENDEDOR = { ativos: 'Ativos', inativos: 'Inativos', todos: 'Todos' } as const;

export const vendedorFiltroSchema = z.object({
  /** Código, nome ou matrícula. */
  q: z.string().trim().optional(),
  situacao: z.enum(['ativos', 'inativos', 'todos']).default('ativos'),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});

export const vendedorResumoSchema = z.object({
  id: z.uuid(),
  codigo: z.number().int(),
  nome: z.string(),
  matricula: z.string().nullable(),
  ativo: z.boolean(),
});
export type VendedorResumo = z.infer<typeof vendedorResumoSchema>;

/** Usuário vinculado, mostrado só para consulta (janela do vendedor). */
export const usuarioDoVendedorSchema = z.object({
  id: z.uuid(),
  codigo: z.number().int(),
  nome: z.string(),
  email: z.string(),
  ativo: z.boolean(),
  criadoEm: z.coerce.date(),
  /** Nomes das funções ativas do usuário. */
  funcoes: z.array(z.string()),
});
export type UsuarioDoVendedor = z.infer<typeof usuarioDoVendedorSchema>;

export const vendedorSchema = z.object({
  id: z.uuid(),
  codigo: z.number().int(),
  matricula: z.string().nullable(),
  whatsapp: z.string(),
  funcionarioDesde: z.string().nullable(),
  ativo: z.boolean(),
  usuario: usuarioDoVendedorSchema,
  criadoEm: z.coerce.date(),
  atualizadoEm: z.coerce.date(),
  criadoPor: z.string().nullable(),
  atualizadoPor: z.string().nullable(),
});
export type Vendedor = z.infer<typeof vendedorSchema>;

export const vendedorInputSchema = z.object({
  usuarioId: z.uuid('Escolha o usuário'),
  matricula: z
    .string()
    .trim()
    .max(30, 'Matrícula longa demais (até 30 caracteres)')
    .nullish()
    .transform((v) => v || null),
  whatsapp: telefoneSchema('WhatsApp'),
  funcionarioDesde: dataPassadaOpcional,
});
export type VendedorInput = z.input<typeof vendedorInputSchema>;

/** Usuário que pode ser escolhido para um vendedor: ativo, com o parâmetro VENDEDOR e ainda sem vendedor. */
export const usuarioElegivelSchema = z.object({
  id: z.uuid(),
  codigo: z.number().int(),
  nome: z.string(),
  email: z.string(),
});
export type UsuarioElegivel = z.infer<typeof usuarioElegivelSchema>;

export const usuariosElegiveisQuerySchema = z.object({
  /** Na edição: o usuário atual deste vendedor também aparece. */
  vendedorId: z.uuid().optional(),
});

export const EVENTOS_VENDEDOR = {
  criado: 'Cadastro',
  alterado: 'Alteração',
  inativado: 'Inativação',
  reativado: 'Reativação',
} as const;
export const ORIGENS_EVENTO_VENDEDOR = {
  cadastro: 'Tela',
  importacao: 'Planilha',
  automatica: 'Automática',
} as const;

const chaves = <T extends Record<string, unknown>>(o: T) =>
  Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

export const alteracaoVendedorSchema = z.object({
  campo: z.string(),
  antes: z.string().nullable(),
  depois: z.string().nullable(),
});
export type AlteracaoVendedor = z.infer<typeof alteracaoVendedorSchema>;

export const vendedorEventoSchema = z.object({
  id: z.uuid(),
  evento: z.enum(chaves(EVENTOS_VENDEDOR)),
  origem: z.enum(chaves(ORIGENS_EVENTO_VENDEDOR)),
  /** Por que uma alteração automática aconteceu (ex.: usuário desativado). */
  motivo: z.string().nullable(),
  alteracoes: z.array(alteracaoVendedorSchema),
  usuario: z.string().nullable(),
  criadoEm: z.coerce.date(),
});
export type VendedorEvento = z.infer<typeof vendedorEventoSchema>;
