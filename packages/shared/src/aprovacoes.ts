import { z } from 'zod';

/*
 * Aprovação comercial por alçada (docs/modulos/APROVACAO_COMERCIAL.md). Desconto acima da alçada da função de
 * quem emite gera uma solicitação que só quem tem alçada suficiente aprova ou reprova. Hoje só o Orçamento usa o
 * motor; Pedido de Venda e O.S. entram depois, com um adaptador próprio (mesmas tabelas, mesmas regras).
 * Percentuais em centésimos (8,5% = 850; 100% = 10000), como o desconto dos itens do orçamento.
 */

const chaves = <T extends Record<string, unknown>>(o: T) =>
  Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

/** Documentos ligados ao motor. Pedido de Venda e O.S. entram aqui quando existirem. */
export const TIPOS_DOCUMENTO_COMERCIAL = { orcamento: 'Orçamento' } as const;
export type TipoDocumentoComercial = keyof typeof TIPOS_DOCUMENTO_COMERCIAL;

export const STATUS_APROVACAO_COMERCIAL = {
  pendente: 'Pendente',
  aprovada: 'Aprovada',
  reprovada: 'Reprovada',
  cancelada: 'Cancelada',
} as const;
export type StatusAprovacaoComercial = keyof typeof STATUS_APROVACAO_COMERCIAL;

export const EVENTOS_APROVACAO_COMERCIAL = {
  necessaria: 'Aprovação necessária',
  solicitada: 'Aprovação solicitada',
  aprovada: 'Aprovada',
  reprovada: 'Reprovada',
  cancelada: 'Cancelada',
} as const;
export type EventoAprovacaoComercial = keyof typeof EVENTOS_APROVACAO_COMERCIAL;

/** 100%, em centésimos: teto de qualquer alçada. */
export const ALCADA_MAXIMA = 10_000;

/**
 * Percentual de desconto do documento (desconto ÷ subtotal), em centésimos, arredondado PARA CIMA: 8,001% vira
 * 8,01%. Assim "percentual <= alçada" equivale a comparar os valores exatos.
 */
export function percentualDeDesconto(subtotalCentavos: number, descontoCentavos: number): number {
  if (subtotalCentavos <= 0 || descontoCentavos <= 0) return 0;
  const s = BigInt(subtotalCentavos);
  return Number((BigInt(descontoCentavos) * 10_000n + s - 1n) / s);
}

/** Desconto igual à alçada está dentro dela. */
export const dentroDaAlcada = (percentual: number, alcada: number) => percentual <= alcada;

/** Centésimos → "8,50%". */
export const formatarPercentual = (centesimos: number) =>
  `${(centesimos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

// ---------- Retrato (snapshot) do documento no momento da solicitação ----------

export const snapshotComercialSchema = z.object({
  documento: z.object({ tipo: z.enum(chaves(TIPOS_DOCUMENTO_COMERCIAL)), numero: z.string(), versao: z.number() }),
  cliente: z.object({ id: z.uuid(), nome: z.string() }),
  vendedor: z.string().nullable(),
  veiculo: z.string().nullable(),
  tabela: z.string().nullable(),
  /** Validade pedida, em dias a partir da emissão (a validade passa a contar na aprovação). */
  validadeDias: z.number().nullable(),
  observacoes: z.string().nullable(),
  itens: z.array(
    z.object({
      tipo: z.string(),
      codigo: z.string(),
      descricao: z.string(),
      unidade: z.string(),
      quantidade: z.number().nullable(),
      tempoMinutos: z.number().nullable(),
      precoTabelaCentavos: z.number(),
      precoUnitarioCentavos: z.number(),
      brutoCentavos: z.number(),
      descontoCentavos: z.number(),
      totalCentavos: z.number(),
    }),
  ),
  subtotalCentavos: z.number(),
  descontoCentavos: z.number(),
  totalCentavos: z.number(),
});
export type SnapshotComercial = z.infer<typeof snapshotComercialSchema>;

// ---------- Schemas da API ----------

const status = z.enum(chaves(STATUS_APROVACAO_COMERCIAL));
const tipoDocumento = z.enum(chaves(TIPOS_DOCUMENTO_COMERCIAL));

export const aprovacaoComercialResumoSchema = z.object({
  id: z.uuid(),
  tipoDocumento,
  documentoId: z.uuid(),
  /** Número formatado (ORC-0000000001). */
  documentoNumero: z.string(),
  documentoVersao: z.number(),
  clienteNome: z.string(),
  solicitanteId: z.uuid(),
  solicitante: z.string(),
  solicitanteFuncao: z.string().nullable(),
  subtotalCentavos: z.number(),
  descontoCentavos: z.number(),
  totalCentavos: z.number(),
  /** Centésimos. */
  percentual: z.number(),
  alcadaSolicitante: z.number(),
  status,
  criadoEm: z.coerce.date(),
  decisor: z.string().nullable(),
  decididoEm: z.coerce.date().nullable(),
  /** Concorrência otimista da decisão. */
  versao: z.number(),
});
export type AprovacaoComercialResumo = z.infer<typeof aprovacaoComercialResumoSchema>;

export const aprovacaoComercialSchema = aprovacaoComercialResumoSchema.extend({
  decisorFuncao: z.string().nullable(),
  alcadaDecisor: z.number().nullable(),
  justificativa: z.string().nullable(),
  /** Vendedor do documento (a tela só oferece abrir o documento a quem pode vê-lo). */
  documentoVendedorId: z.uuid().nullable(),
  snapshot: snapshotComercialSchema,
  /** Funções que hoje podem aprovar este percentual (alçada suficiente e permissão), com a alçada. */
  aprovadores: z.array(z.object({ funcao: z.string(), alcada: z.number() })),
  /** O usuário atual pode decidir? Se não, por quê (a API confere de novo na decisão). */
  podeDecidir: z.boolean(),
  motivoBloqueio: z.string().nullable(),
  eventos: z.array(
    z.object({
      evento: z.enum(chaves(EVENTOS_APROVACAO_COMERCIAL)),
      usuario: z.string().nullable(),
      funcao: z.string().nullable(),
      alcada: z.number().nullable(),
      detalhe: z.string().nullable(),
      criadoEm: z.coerce.date(),
    }),
  ),
});
export type AprovacaoComercial = z.infer<typeof aprovacaoComercialSchema>;

export const aprovacaoComercialFiltroSchema = z.object({
  /** Número do documento ou nome do cliente. */
  q: z.string().trim().optional(),
  status: z.union([z.literal(''), status]).default('pendente'),
  tipo: z.union([z.literal(''), tipoDocumento]).optional(),
  /** "true" = só as pendentes que o usuário pode decidir. */
  posso: z.enum(['true', '']).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});

export const decisaoComercialSchema = z.object({ versao: z.number().int().min(1) });

export const reprovacaoComercialSchema = decisaoComercialSchema.extend({
  justificativa: z
    .string({ error: 'Informe o motivo da reprovação' })
    .trim()
    .min(1, 'Informe o motivo da reprovação')
    .max(500, 'Máximo de 500 caracteres'),
});
export type ReprovacaoComercialInput = z.input<typeof reprovacaoComercialSchema>;

/** Resumo da aprovação comercial mais recente, mostrado dentro do documento. */
export const aprovacaoDoDocumentoSchema = z.object({
  id: z.uuid(),
  status,
  percentual: z.number(),
  alcadaSolicitante: z.number(),
  solicitanteId: z.uuid(),
  solicitante: z.string(),
  solicitanteFuncao: z.string().nullable(),
  criadoEm: z.coerce.date(),
  decisor: z.string().nullable(),
  decisorFuncao: z.string().nullable(),
  alcadaDecisor: z.number().nullable(),
  decididoEm: z.coerce.date().nullable(),
  justificativa: z.string().nullable(),
});
export type AprovacaoDoDocumento = z.infer<typeof aprovacaoDoDocumentoSchema>;

// ---------- Alçadas (Configurações → Alçadas de desconto; só o Administrador) ----------

/** Alçada de cada função. Função sem alçada configurada (ou com ela inativa) = 0%: todo desconto pede aprovação. */
export const alcadaSchema = z.object({
  funcaoId: z.uuid(),
  funcao: z.string(),
  admin: z.boolean(),
  funcaoAtiva: z.boolean(),
  /** Centésimos. */
  percentual: z.number(),
  ativa: z.boolean(),
  /** null = nunca configurada. */
  versao: z.number().nullable(),
  atualizadoEm: z.coerce.date().nullable(),
  atualizadoPor: z.string().nullable(),
});
export type Alcada = z.infer<typeof alcadaSchema>;

export const alcadaInputSchema = z.object({
  /** Percentual digitado (até 2 casas): 7,5 → 750 centésimos na API. */
  percentual: z
    .number({ error: 'Informe o percentual' })
    .min(0, 'A alçada não pode ser negativa')
    .max(100, 'A alçada vai até 100%')
    .refine((v) => Number.isInteger(Math.round(v * 100 * 1e6) / 1e6), 'Use até 2 casas decimais'),
  ativa: z.boolean(),
  /** Versão lida (null = a alçada ainda não existia). */
  versao: z.number().int().min(1).nullable(),
});
export type AlcadaInput = z.input<typeof alcadaInputSchema>;

export const alcadaEventoSchema = z.object({
  funcao: z.string(),
  percentualAntes: z.number().nullable(),
  percentualDepois: z.number(),
  ativaAntes: z.boolean().nullable(),
  ativaDepois: z.boolean(),
  usuario: z.string().nullable(),
  criadoEm: z.coerce.date(),
});
export type AlcadaEvento = z.infer<typeof alcadaEventoSchema>;

/** Alçada do usuário logado: a maior entre as funções ativas dele. */
export const minhaAlcadaSchema = z.object({ percentual: z.number(), funcao: z.string().nullable() });
export type MinhaAlcada = z.infer<typeof minhaAlcadaSchema>;
