import { z } from 'zod';
import { cnpjValido, cpfValido, normalizarPlaca, placaValida, somenteDigitos } from './documentos.js';

// Mensagens padrão do Zod em português, no front e no back.
z.config(z.locales.pt());

const textoOpcional = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullish();

// ---------- Auth e usuários ----------

export const papelSchema = z.enum(['admin', 'atendente', 'mecanico', 'financeiro']);
export type Papel = z.infer<typeof papelSchema>;

export const nomesPapel: Record<Papel, string> = {
  admin: 'Administrador',
  atendente: 'Atendente',
  mecanico: 'Mecânico',
  financeiro: 'Financeiro',
};

// Normaliza antes de validar: e-mails colados costumam vir com espaços ou maiúsculas.
const emailSchema = z.string().trim().toLowerCase().pipe(z.email('E-mail inválido'));
// Limite superior evita que senhas gigantes sejam usadas para sobrecarregar o hash.
const senhaSchema = z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').max(128, 'Senha longa demais');

export const loginSchema = z.object({
  email: emailSchema,
  senha: z.string().min(1, 'Informe a senha').max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

// ---------- Aparência (cores parametrizáveis por oficina) ----------

const corHex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB')
  .transform((v) => v.toLowerCase());

/** Tema salvo. null = usar a cor padrão do style guide. Sem transformações: é usado em respostas. */
export const temaSchema = z.object({
  corPrimaria: z.string().nullable(),
  corMenu: z.string().nullable(),
});
export type Tema = z.infer<typeof temaSchema>;

/** Entrada do formulário de aparência: valida e normaliza as cores. */
export const temaInputSchema = z.object({
  corPrimaria: corHex.nullable(),
  corMenu: corHex.nullable(),
});

export const TEMA_PADRAO = { corPrimaria: '#1d4ed8', corMenu: '#ffffff' } as const;

// SVG fica de fora: pode conter scripts.
export const LOGO_TIPOS = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const LOGO_TAMANHO_MAXIMO = 1024 * 1024; // 1 MB

export const sessaoSchema = z.object({
  usuario: z.object({ id: z.uuid(), nome: z.string(), email: z.string(), papel: papelSchema }),
  // logoVersao: null = sem logo; senão, muda a cada troca (usado na URL para renovar o cache).
  oficina: z.object({ id: z.uuid(), nome: z.string(), tema: temaSchema, logoVersao: z.string().nullable() }),
});
export type Sessao = z.infer<typeof sessaoSchema>;

export const usuarioSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
  email: z.string(),
  papel: papelSchema,
  ativo: z.boolean(),
  criadoEm: z.coerce.date(),
});
export type Usuario = z.infer<typeof usuarioSchema>;

export const usuarioCriarSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome'),
  email: emailSchema,
  papel: papelSchema,
  senha: senhaSchema,
});
export type UsuarioCriarInput = z.input<typeof usuarioCriarSchema>;

/** Edição pelo admin. Senha vazia = manter a atual. O e-mail não muda (é a chave de login). */
export const usuarioAtualizarSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome'),
  papel: papelSchema,
  ativo: z.boolean(),
  novaSenha: z.union([z.literal(''), senhaSchema]).nullish().transform((v) => v || null),
});
export type UsuarioAtualizarInput = z.input<typeof usuarioAtualizarSchema>;

// ---------- Clientes ----------

export const clienteInputSchema = z
  .object({
    tipo: z.enum(['PF', 'PJ']).default('PF'),
    nome: z.string().trim().min(2, 'Informe o nome'),
    cpfCnpj: textoOpcional,
    telefone: textoOpcional,
    email: z.union([z.literal(''), z.email('E-mail inválido')]).nullish().transform((v) => v || null),
    observacoes: textoOpcional,
  })
  .superRefine((c, ctx) => {
    if (!c.cpfCnpj) return;
    const ok = c.tipo === 'PF' ? cpfValido(c.cpfCnpj) : cnpjValido(c.cpfCnpj);
    if (!ok) ctx.addIssue({ code: 'custom', path: ['cpfCnpj'], message: c.tipo === 'PF' ? 'CPF inválido' : 'CNPJ inválido' });
  })
  .transform((c) => ({ ...c, cpfCnpj: c.cpfCnpj ? somenteDigitos(c.cpfCnpj) : null }));
export type ClienteInput = z.input<typeof clienteInputSchema>;

export const clienteSchema = z.object({
  id: z.uuid(),
  tipo: z.enum(['PF', 'PJ']),
  nome: z.string(),
  cpfCnpj: z.string().nullable(),
  telefone: z.string().nullable(),
  email: z.string().nullable(),
  observacoes: z.string().nullable(),
  criadoEm: z.coerce.date(),
});
export type Cliente = z.infer<typeof clienteSchema>;

// ---------- Veículos ----------

const anoAtual = new Date().getFullYear();

/** Número inteiro opcional vindo de formulário: campo vazio vira null (e não 0). */
const inteiroOpcional = (min: number, max?: number) =>
  z.preprocess(
    (v) => (v === '' || v == null ? null : v),
    z.coerce
      .number()
      .int()
      .min(min)
      .max(max ?? Number.MAX_SAFE_INTEGER)
      .nullable(),
  );

export const veiculoInputSchema = z.object({
  clienteId: z.uuid(),
  placa: z.string().refine(placaValida, 'Placa inválida').transform(normalizarPlaca),
  marca: z.string().trim().min(1, 'Informe a marca'),
  modelo: z.string().trim().min(1, 'Informe o modelo'),
  ano: inteiroOpcional(1900, anoAtual + 1).optional(),
  cor: textoOpcional,
  chassi: textoOpcional.transform((v) => v?.toUpperCase() ?? null),
  kmAtual: inteiroOpcional(0).optional(),
});
export type VeiculoInput = z.input<typeof veiculoInputSchema>;

export const veiculoSchema = z.object({
  id: z.uuid(),
  clienteId: z.uuid(),
  placa: z.string(),
  marca: z.string(),
  modelo: z.string(),
  ano: z.number().nullable(),
  cor: z.string().nullable(),
  chassi: z.string().nullable(),
  kmAtual: z.number().nullable(),
});
export type Veiculo = z.infer<typeof veiculoSchema>;

// ---------- Utilitários ----------

export const idParamSchema = z.object({ id: z.uuid() });

export const paginacaoSchema = z.object({
  q: z.string().trim().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});

export const erroSchema = z.object({
  erro: z.string(),
  campos: z.record(z.string(), z.string()).optional(),
});

// ---------- Relatórios ----------

export const relatorioIdSchema = z.enum(['clientes', 'veiculos', 'usuarios']);
export type RelatorioId = z.infer<typeof relatorioIdSchema>;

const dataIso = z.iso.date('Data inválida');

export const relatorioFiltroSchema = z
  .object({
    de: z.union([z.literal(''), dataIso]).optional().transform((v) => v || undefined),
    ate: z.union([z.literal(''), dataIso]).optional().transform((v) => v || undefined),
  })
  .refine((f) => !f.de || !f.ate || f.de <= f.ate, { message: 'A data inicial deve ser anterior à final', path: ['ate'] });

export type RelatorioDescricao = {
  id: RelatorioId;
  titulo: string;
  descricao: string;
  colunas: { chave: string; titulo: string }[];
};

export type RelatorioPrevia = {
  colunas: { chave: string; titulo: string }[];
  linhas: Record<string, string>[];
  total: number;
};
