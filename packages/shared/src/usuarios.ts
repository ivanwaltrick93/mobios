import { z } from 'zod';
import { acessosSchema, funcaoResumoSchema } from './acessos.js';
import { emailSchema } from './schemas.js';

// ---------- Auth e usuários ----------

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

/**
 * Tokens do style guide configuráveis por oficina. null = padrão do style guide;
 * nas cores de texto, null = automático (maior contraste com o fundo).
 */
export const CAMPOS_TEMA = [
  'corPrimaria',
  'corMenu',
  'corBotaoPrimario',
  'corBotaoPrimarioTexto',
  'corBotaoSecundario',
  'corBotaoSecundarioTexto',
] as const;
export type CampoTema = (typeof CAMPOS_TEMA)[number];

/** Tema salvo. Sem transformações: é usado em respostas. */
export const temaSchema = z.object(
  Object.fromEntries(CAMPOS_TEMA.map((c) => [c, z.string().nullable()])) as Record<
    CampoTema,
    z.ZodNullable<z.ZodString>
  >,
);
export type Tema = z.infer<typeof temaSchema>;

/** Entrada do formulário de aparência: valida e normaliza as cores. */
export const temaInputSchema = z.object(
  Object.fromEntries(CAMPOS_TEMA.map((c) => [c, corHex.nullable()])) as Record<CampoTema, z.ZodNullable<typeof corHex>>,
);

export const TEMA_VAZIO: Tema = Object.fromEntries(CAMPOS_TEMA.map((c) => [c, null])) as Tema;

/** Padrões do style guide (quando o campo do tema é null). */
export const TEMA_PADRAO = { corPrimaria: '#1d4ed8', corMenu: '#ffffff', corBotaoSecundario: '#ffffff' } as const;

/** Marca da oficina exibida antes do login (cores, logo e nome: nada sensível). */
export const aparenciaPublicaSchema = z.object({
  oficinaId: z.string().nullable(),
  nome: z.string().nullable(),
  tema: temaSchema,
  logoVersao: z.string().nullable(),
});
export type AparenciaPublica = z.infer<typeof aparenciaPublicaSchema>;

// Imagens enviadas (logo da oficina, fotos da equipe). SVG fica de fora: pode conter scripts.
export const IMAGEM_TIPOS = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const IMAGEM_TAMANHO_MAXIMO = 1024 * 1024; // 1 MB

export const sessaoSchema = z.object({
  usuario: z.object({
    id: z.uuid(),
    nome: z.string(),
    email: z.string(),
    fotoVersao: z.string().nullable(),
    admin: z.boolean(),
    funcoes: z.array(funcaoResumoSchema),
  }),
  /** Nível efetivo por módulo (maior entre as funções ativas; tudo, para o admin). */
  acessos: acessosSchema,
  /** Vendedor ativo do usuário (nunca para o Administrador): orçamentos no nome dele; vê e altera só os próprios. */
  vendedorId: z.uuid().nullable(),
  // logoVersao: null = sem logo; senão, muda a cada troca (usado na URL para renovar o cache).
  oficina: z.object({ id: z.uuid(), nome: z.string(), tema: temaSchema, logoVersao: z.string().nullable() }),
});
export type Sessao = z.infer<typeof sessaoSchema>;

export const usuarioSchema = z.object({
  id: z.uuid(),
  /** Sequencial por oficina, gerado pelo banco e imutável. */
  codigo: z.number().int(),
  nome: z.string(),
  email: z.string(),
  /** null = sem foto; senão, muda a cada troca (renova o cache). */
  fotoVersao: z.string().nullable(),
  /** Inclui funções desativadas (sem efeito até serem reativadas), para o admin enxergar. */
  funcoes: z.array(funcaoResumoSchema.extend({ ativa: z.boolean() })),
  ativo: z.boolean(),
  criadoEm: z.coerce.date(),
});
export type Usuario = z.infer<typeof usuarioSchema>;

const funcoesIdsSchema = z
  .array(z.uuid())
  .min(1, 'Escolha ao menos uma função')
  .transform((ids) => [...new Set(ids)]);

export const usuarioCriarSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome'),
  email: emailSchema,
  funcoes: funcoesIdsSchema,
  senha: senhaSchema,
});
export type UsuarioCriarInput = z.input<typeof usuarioCriarSchema>;

/** Edição pelo admin. Senha vazia = manter a atual. O e-mail não muda (é a chave de login). */
export const usuarioAtualizarSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome'),
  funcoes: funcoesIdsSchema,
  ativo: z.boolean(),
  novaSenha: z
    .union([z.literal(''), senhaSchema])
    .nullish()
    .transform((v) => v || null),
});
export type UsuarioAtualizarInput = z.input<typeof usuarioAtualizarSchema>;

// Troca da própria senha (Meu perfil): exige a senha atual.
const alterarSenhaCampos = {
  senhaAtual: z.string().min(1, 'Informe a senha atual').max(128),
  novaSenha: senhaSchema,
};
const novaSenhaDiferente = {
  regra: (d: { senhaAtual: string; novaSenha: string }) => d.novaSenha !== d.senhaAtual,
  erro: { message: 'A nova senha deve ser diferente da atual', path: ['novaSenha'] },
};

export const alterarSenhaSchema = z
  .object(alterarSenhaCampos)
  .refine(novaSenhaDiferente.regra, novaSenhaDiferente.erro);

/** Formulário do Meu perfil: os mesmos campos e a confirmação da nova senha (não vai para a API). */
export const alterarSenhaFormSchema = z
  .object({ ...alterarSenhaCampos, confirmacao: z.string() })
  .refine(novaSenhaDiferente.regra, novaSenhaDiferente.erro)
  .refine((d) => d.confirmacao === d.novaSenha, { message: 'As senhas não conferem', path: ['confirmacao'] });
