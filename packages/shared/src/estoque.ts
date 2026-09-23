import { z } from 'zod';
import { UNIDADES } from './materiais.js';

/*
 * Estoque por material + depósito (chave: SKU + depósito).
 * Disponível = livre para vender/usar agora; reservado = separado para O.S./pedido; físico = disponível + reservado.
 * Por enquanto o saldo muda só por ajuste manual com motivo; compras, vendas e O.S. vão movimentar depois.
 */

const chaves = <T extends Record<string, unknown>>(o: T) =>
  Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

/** Até 99.999.999.999,999 com no máximo 3 casas decimais. */
const quantidade = (rotulo: string) =>
  z
    .number({ error: `Informe ${rotulo}` })
    .min(0, `${rotulo[0]!.toUpperCase()}${rotulo.slice(1)} não pode ser negativo`)
    .max(99_999_999_999, 'Quantidade alta demais')
    .refine((v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, 'Use no máximo 3 casas decimais');

export const estoqueAjusteSchema = z.object({
  disponivel: quantidade('o disponível'),
  reservado: quantidade('o reservado'),
  motivo: z
    .string({ error: 'Informe o motivo' })
    .trim()
    .min(3, 'Informe o motivo do ajuste')
    .max(200, 'Máximo de 200 caracteres'),
  /** Versão lida do saldo (obrigatória quando o saldo já existe): evita sobrescrever ajuste de outra pessoa. */
  versao: z.number().int().min(1).optional(),
});
export type EstoqueAjusteInput = z.input<typeof estoqueAjusteSchema>;

export const saldoSchema = z.object({
  materialId: z.uuid(),
  sku: z.string(),
  descricao: z.string(),
  unidade: z.enum(chaves(UNIDADES)),
  materialAtivo: z.boolean(),
  depositoId: z.uuid(),
  depositoCodigo: z.string(),
  depositoNome: z.string(),
  depositoAtivo: z.boolean(),
  disponivel: z.number(),
  reservado: z.number(),
  /** Físico = disponível + reservado. */
  total: z.number(),
  atualizadoEm: z.coerce.date().nullable(),
  atualizadoPor: z.string().nullable(),
  /** null = ainda não há saldo gravado para esse material nesse depósito (zero). */
  versao: z.number().nullable(),
});
export type Saldo = z.infer<typeof saldoSchema>;

export const estoqueFiltroSchema = z.object({
  q: z.string().trim().optional(),
  depositoId: z.uuid().optional(),
  materialId: z.uuid().optional(),
  /**
   * "false" (padrão): todo material ativo que controla estoque × todo depósito ativo (zerado onde não há saldo),
   * mais as linhas com saldo de itens já inativados. "true": só linhas com disponível ou reservado.
   */
  comSaldo: z.enum(['true', 'false']).default('false'),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(50),
});

export const ajusteEstoqueSchema = z.object({
  id: z.uuid(),
  disponivelAntes: z.number(),
  disponivelDepois: z.number(),
  reservadoAntes: z.number(),
  reservadoDepois: z.number(),
  motivo: z.string(),
  usuario: z.string().nullable(),
  criadoEm: z.coerce.date(),
});
export type AjusteEstoque = z.infer<typeof ajusteEstoqueSchema>;

// ---------- Lista de preços (consulta rápida no atendimento) ----------

export const listaPrecosQuerySchema = z.object({
  tabelaPrecoId: z.uuid('Escolha a tabela de preço'),
  q: z.string().trim().optional(),
  /** "true" = só materiais com preço vigente hoje. */
  comPreco: z.enum(['true', 'false']).default('false'),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(50),
});

export const itemListaPrecosSchema = z.object({
  materialId: z.uuid(),
  sku: z.string(),
  descricao: z.string(),
  marcaNome: z.string().nullable(),
  unidade: z.enum(chaves(UNIDADES)),
  precoCentavos: z.number().nullable(),
  vigenteDesde: z.string().nullable(),
  vigenteAte: z.string().nullable(),
  proximoPrecoCentavos: z.number().nullable(),
  proximoInicio: z.string().nullable(),
  /** Soma do disponível em todos os depósitos; null = usuário sem acesso ao Estoque. */
  disponivel: z.number().nullable(),
});
export type ItemListaPrecos = z.infer<typeof itemListaPrecosSchema>;
