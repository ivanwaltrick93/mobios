import { z } from 'zod';
import { somenteDigitos, telefoneValido } from './documentos.js';
import { hojeIso } from './formatos.js';

// Mensagens padrão do Zod em português, no front e no back.
z.config(z.locales.pt());

// ---------- Campos comuns (usados pelos schemas de cada domínio) ----------

export const textoOpcional = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullish();

// Normaliza antes de validar: e-mails colados costumam vir com espaços ou maiúsculas.
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('E-mail inválido'));

export const chaves = <T extends Record<string, string>>(o: T) =>
  Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

/** Select vazio do formulário vira null. */
export const vazioComoNulo = (v: unknown) => (v === '' || v === undefined ? null : v);

export const textoObrigatorio = (msg: string, max = 120) =>
  z.string({ error: msg }).trim().min(1, msg).max(max, 'Texto longo demais');

export const telefoneSchema = (rotulo: string) =>
  z
    .string({ error: `Informe o ${rotulo}` })
    .trim()
    .min(1, `Informe o ${rotulo}`)
    .refine(telefoneValido, `${rotulo[0]!.toUpperCase()}${rotulo.slice(1)} inválido: use DDD + número`)
    .transform(somenteDigitos);

export const dataPassadaOpcional = z
  .union([z.literal(''), z.iso.date('Data inválida')])
  .nullish()
  .transform((v) => v || null)
  .refine((v) => !v || (v >= '1900-01-01' && v <= hojeIso()), 'Data fora do intervalo permitido');

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
