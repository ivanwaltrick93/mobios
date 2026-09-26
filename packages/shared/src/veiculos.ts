import { z } from 'zod';
import {
  chassiValido,
  normalizarChassi,
  normalizarPlaca,
  placaValida,
  renavamValido,
  somenteDigitos,
} from './documentos.js';
import { chaves, textoObrigatorio, textoOpcional, vazioComoNulo } from './schemas.js';

// ---------- Veículos ----------

/** Vendido/Inativo: continua no histórico, mas não recebe O.S. nova até ser reativado. */
export const STATUS_VEICULO = { ativo: 'Ativo', vendido: 'Vendido', inativo: 'Inativo' } as const;
export type StatusVeiculo = keyof typeof STATUS_VEICULO;

export const COMBUSTIVEIS = {
  flex: 'Flex',
  gasolina: 'Gasolina',
  etanol: 'Etanol',
  diesel: 'Diesel',
  gnv: 'GNV',
  eletrico: 'Elétrico',
  hibrido: 'Híbrido',
} as const;
export type Combustivel = keyof typeof COMBUSTIVEIS;

const anoAtual = new Date().getFullYear();

/** Número inteiro opcional vindo de formulário: campo vazio vira null (e não 0). */
const inteiroOpcional = (min: number, max?: number) =>
  z.preprocess(
    // Aceita o valor com máscara (ex.: km "125.000").
    (v) => (v === '' || v == null ? null : typeof v === 'string' ? v.replace(/\D/g, '') || null : v),
    z.coerce
      .number()
      .int()
      .min(min)
      .max(max ?? Number.MAX_SAFE_INTEGER)
      .nullable(),
  );

const ano = (msg: string, max: number) =>
  z.preprocess(
    (v) => (v === '' || v == null ? undefined : Number(v)),
    z.number({ error: msg }).int(msg).min(1900, 'Ano inválido').max(max, 'Ano inválido'),
  );

const veiculoCampos = z.object({
  placa: z.string({ error: 'Informe a placa' }).refine(placaValida, 'Placa inválida').transform(normalizarPlaca),
  renavam: textoOpcional
    .refine((v) => !v || renavamValido(v), 'Renavam inválido')
    .transform((v) => (v ? somenteDigitos(v).padStart(11, '0') : null)),
  chassi: textoOpcional
    .refine((v) => !v || chassiValido(v), 'Chassi inválido: 17 caracteres, sem I, O e Q')
    .transform((v) => (v ? normalizarChassi(v) : null)),
  marca: textoObrigatorio('Informe a marca', 60),
  modelo: textoObrigatorio('Informe o modelo', 80),
  versao: textoOpcional,
  anoFabricacao: ano('Informe o ano de fabricação', anoAtual + 1),
  anoModelo: ano('Informe o ano modelo', anoAtual + 2),
  cor: textoOpcional,
  combustivel: z.preprocess(vazioComoNulo, z.enum(chaves(COMBUSTIVEIS)).nullable()),
  kmAtual: inteiroOpcional(0)
    .optional()
    .transform((v) => v ?? null),
  principal: z.boolean().default(false),
  status: z.enum(chaves(STATUS_VEICULO)).default('ativo'),
});

const regrasVeiculo = <T extends { anoFabricacao: number; anoModelo: number }>(v: T, ctx: z.RefinementCtx) => {
  if (v.anoModelo < v.anoFabricacao || v.anoModelo > v.anoFabricacao + 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['anoModelo'],
      message: 'O ano modelo deve ser igual ao de fabricação ou o seguinte',
    });
  }
};

/** Edição: o dono não muda aqui (use a transferência). */
export const veiculoAtualizarSchema = veiculoCampos.superRefine(regrasVeiculo);
export const veiculoInputSchema = veiculoCampos.extend({ clienteId: z.uuid() }).superRefine(regrasVeiculo);
export type VeiculoInput = z.input<typeof veiculoInputSchema>;
export type VeiculoAtualizarInput = z.input<typeof veiculoAtualizarSchema>;

export const veiculoTransferirSchema = z.object({ clienteId: z.uuid('Escolha o novo proprietário') });

export function pendenciasVeiculo(v: { anoFabricacao: number | null; anoModelo: number | null }): string[] {
  const faltando: string[] = [];
  if (v.anoFabricacao == null) faltando.push('ano de fabricação');
  if (v.anoModelo == null) faltando.push('ano modelo');
  return faltando;
}

export const veiculoSchema = z.object({
  id: z.uuid(),
  clienteId: z.uuid(),
  placa: z.string(),
  renavam: z.string().nullable(),
  chassi: z.string().nullable(),
  marca: z.string(),
  modelo: z.string(),
  versao: z.string().nullable(),
  anoFabricacao: z.number().nullable(),
  anoModelo: z.number().nullable(),
  cor: z.string().nullable(),
  combustivel: z.enum(chaves(COMBUSTIVEIS)).nullable(),
  kmAtual: z.number().nullable(),
  /** Preenchida automaticamente pela O.S. (fase 1). */
  ultimaVisita: z.string().nullable(),
  principal: z.boolean(),
  status: z.enum(chaves(STATUS_VEICULO)),
  pendencias: z.array(z.string()),
});
export type Veiculo = z.infer<typeof veiculoSchema>;

/** Linha da lista geral de veículos (página Veículos): o veículo e o dono. */
export const veiculoListaSchema = veiculoSchema.extend({ clienteNome: z.string() });
export type VeiculoLista = z.infer<typeof veiculoListaSchema>;

export const veiculoFiltroSchema = z.object({
  /** Placa, marca, modelo ou nome do dono. */
  q: z.string().trim().optional(),
  status: z.union([z.literal(''), z.enum(chaves(STATUS_VEICULO))]).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});

export const sugestoesVeiculoSchema = z.object({ marcas: z.array(z.string()), modelos: z.array(z.string()) });
export type SugestoesVeiculo = z.infer<typeof sugestoesVeiculoSchema>;
