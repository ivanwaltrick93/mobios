import { z } from 'zod';
import { chaves } from './schemas.js';

// ---------- Relatórios ----------

export const relatorioIdSchema = z.enum(['clientes', 'veiculos', 'usuarios']);
export type RelatorioId = z.infer<typeof relatorioIdSchema>;

const dataIso = z.iso.date('Data inválida');

export const relatorioFiltroSchema = z
  .object({
    de: z
      .union([z.literal(''), dataIso])
      .optional()
      .transform((v) => v || undefined),
    ate: z
      .union([z.literal(''), dataIso])
      .optional()
      .transform((v) => v || undefined),
  })
  .refine((f) => !f.de || !f.ate || f.de <= f.ate, {
    message: 'A data inicial deve ser anterior à final',
    path: ['ate'],
  });

const colunaRelatorioSchema = z.object({ chave: z.string(), titulo: z.string() });

export const relatorioDescricaoSchema = z.object({
  id: relatorioIdSchema,
  titulo: z.string(),
  descricao: z.string(),
  colunas: z.array(colunaRelatorioSchema),
});
export type RelatorioDescricao = z.infer<typeof relatorioDescricaoSchema>;

export const relatorioPreviaSchema = z.object({
  colunas: z.array(colunaRelatorioSchema),
  linhas: z.array(z.record(z.string(), z.string())),
  total: z.number(),
});
export type RelatorioPrevia = z.infer<typeof relatorioPreviaSchema>;

// ---------- Painel (página inicial) ----------

/** Período do painel. A variação compara com o período anterior de mesmo tamanho. */
export const PERIODOS_PAINEL = {
  hoje: 'Hoje',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  mes: 'Este mês',
} as const;
export type PeriodoPainel = keyof typeof PERIODOS_PAINEL;
export const painelQuerySchema = z.object({ periodo: z.enum(chaves(PERIODOS_PAINEL)).default('mes') });

export const indicadorSchema = z.object({
  id: z.enum([
    'clientes',
    'veiculos',
    'orcamentos',
    'valor_aprovado',
    'ticket_medio',
    'taxa_aprovacao',
    'os_abertas',
    'faturamento',
  ]),
  titulo: z.string(),
  /** null = o módulo que fornece o dado ainda não existe (nunca mostrar número inventado). */
  valor: z.number().nullable(),
  formato: z.enum(['numero', 'moeda', 'percentual']),
  detalhe: z.string(),
  /** Variação em % contra o período anterior (null = sem base de comparação). */
  variacao: z.number().nullable(),
  link: z.string().optional(),
});
export type Indicador = z.infer<typeof indicadorSchema>;
export type IndicadorId = Indicador['id'];

export const alertaPainelSchema = z.object({
  nivel: z.enum(['aviso', 'info']),
  mensagem: z.string(),
  link: z.string().optional(),
});
export type AlertaPainel = z.infer<typeof alertaPainelSchema>;

export const aniversarianteSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
  whatsapp: z.string().nullable(),
  /** 0 = hoje. */
  dias: z.number(),
});
export type Aniversariante = z.infer<typeof aniversarianteSchema>;

export const painelSchema = z.object({
  periodo: z.object({ id: z.enum(chaves(PERIODOS_PAINEL)), inicio: z.string(), fim: z.string() }),
  indicadores: z.array(indicadorSchema),
  /** Orçamentos criados no período, por situação (null = sem acesso a Orçamentos). */
  orcamentosPorSituacao: z
    .array(z.object({ situacao: z.string(), quantidade: z.number(), totalCentavos: z.number() }))
    .nullable(),
  /** Valor aprovado no período por vendedor, os 5 maiores (null = sem acesso a Orçamentos). */
  aprovadosPorVendedor: z
    .array(z.object({ vendedor: z.string(), quantidade: z.number(), totalCentavos: z.number() }))
    .nullable(),
  alertas: z.array(alertaPainelSchema),
  /** Clientes PF que fazem aniversário hoje e nos próximos 7 dias (vazio para quem não acessa Clientes). */
  aniversariantes: z.array(aniversarianteSchema),
  /** Módulos ainda não implementados: exibidos como "em breve". */
  modulosPendentes: z.array(z.string()),
  /** Quando os números foram calculados (o Painel pode vir do cache, com até 1 minuto de atraso). */
  atualizadoEm: z.iso.datetime(),
});
export type Painel = z.infer<typeof painelSchema>;
