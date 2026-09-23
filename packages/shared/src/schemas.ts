import { z } from 'zod';
import { cnpjValido, cpfValido, normalizarPlaca, placaValida, somenteDigitos } from './documentos.js';

// Mensagens padrão do Zod em português, no front e no back.
z.config(z.locales.pt());

const textoOpcional = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullish();

// ---------- Auth ----------

export const papelSchema = z.enum(['dono', 'atendente', 'mecanico', 'financeiro']);
export type Papel = z.infer<typeof papelSchema>;

export const cadastroOficinaSchema = z.object({
  nomeOficina: z.string().trim().min(2, 'Informe o nome da oficina'),
  cnpj: textoOpcional.refine((v) => v == null || cnpjValido(v), 'CNPJ inválido').transform((v) => (v ? somenteDigitos(v) : null)),
  nome: z.string().trim().min(2, 'Informe seu nome'),
  email: z.email('E-mail inválido').trim().toLowerCase(),
  senha: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres'),
});
export type CadastroOficinaInput = z.input<typeof cadastroOficinaSchema>;

export const loginSchema = z.object({
  email: z.email('E-mail inválido').trim().toLowerCase(),
  senha: z.string().min(1, 'Informe a senha'),
});
export type LoginInput = z.input<typeof loginSchema>;

export const sessaoSchema = z.object({
  usuario: z.object({ id: z.uuid(), nome: z.string(), email: z.string(), papel: papelSchema }),
  oficina: z.object({ id: z.uuid(), nome: z.string() }),
});
export type Sessao = z.infer<typeof sessaoSchema>;

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
