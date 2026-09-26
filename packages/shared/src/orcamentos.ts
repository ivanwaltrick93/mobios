import { z } from 'zod';
import { aprovacaoDoDocumentoSchema } from './aprovacoes.js';
import { formatarDataIso, hojeIso } from './formatos.js';
import { horasParaMinutos } from './mascaras.js';
import { FORMAS_PRECO_SERVICO, PRECO_MAXIMO, TIPOS_ITEM_PRECO } from './materiais.js';

/*
 * Orçamentos (menu Orçamentos; docs/modulos/ORCAMENTOS.md). Cálculos de quantidade, desconto e totais ficam aqui
 * para a tela mostrar o mesmo que a API grava: a API sempre recalcula e é ela quem vale.
 * Dinheiro em centavos (inteiro); as contas usam BigInt para não perder precisão.
 */

const chaves = <T extends Record<string, unknown>>(o: T) =>
  Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

/** Número do orçamento com 10 dígitos: 1 → "ORC-0000000001". A versão aparece à parte. */
export const formatarNumeroOrcamento = (numero: number) => `ORC-${String(numero).padStart(10, '0')}`;

// ---------- Situação e validade ----------

/**
 * Situação gravada. "Vencido" não é gravado: é calculado pela validade (ver situacaoOrcamento).
 * Aguardando/reprovado comercialmente: emissão com desconto acima da alçada (docs/modulos/APROVACAO_COMERCIAL.md).
 */
export const STATUS_ORCAMENTO = [
  'rascunho',
  'aguardando_aprovacao_comercial',
  'reprovado_comercialmente',
  'emitido',
  'enviado',
  'aprovado',
  'recusado',
  'cancelado',
] as const;
export type StatusOrcamento = (typeof STATUS_ORCAMENTO)[number];

export const SITUACOES_ORCAMENTO = {
  rascunho: 'Rascunho',
  aguardando_aprovacao_comercial: 'Aguardando aprovação comercial',
  reprovado_comercialmente: 'Reprovado comercialmente',
  emitido: 'Emitido',
  enviado: 'Enviado',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  vencido: 'Vencido',
  cancelado: 'Cancelado',
} as const;
export type SituacaoOrcamento = keyof typeof SITUACOES_ORCAMENTO;

/** Sem validade informada, a emissão assume 7 dias; o máximo é 30 dias a partir da emissão. */
export const VALIDADE_PADRAO_DIAS = 7;
export const VALIDADE_MAXIMA_DIAS = 30;

/** Data AAAA-MM-DD somando dias (sem fuso: só a data). */
export const somarDias = (data: string, dias: number) =>
  new Date(Date.parse(`${data}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

/**
 * Último dia em que o orçamento ainda pode ser aprovado: o dia seguinte ao da validade (até 23:59, Brasília).
 * Válido até 30/09 → aprovável até 01/10; vencido a partir de 02/10.
 */
export const ultimoDiaParaAprovar = (validadeAte: string) => somarDias(validadeAte, 1);

/** Emitido e enviado vencem sozinhos depois do último dia para aprovar. Rascunho não vence. */
export function situacaoOrcamento(
  status: StatusOrcamento,
  validadeAte: string | null,
  hoje: string = hojeIso(),
): SituacaoOrcamento {
  if ((status === 'emitido' || status === 'enviado') && validadeAte && hoje > ultimoDiaParaAprovar(validadeAte))
    return 'vencido';
  return status;
}

// ---------- Quantidade ----------

/** Quantidade com até 3 casas é guardada e calculada em milésimos (inteiro). */
export const paraMilesimos = (quantidade: number) => Math.round(quantidade * 1000);

/**
 * Quantidade vendável: arredonda PARA CIMA até o próximo múltiplo de venda do material (caixa master).
 * Unidade inteira (UN, PC...): sempre inteira. Unidade fracionada (litro, quilo, metro) com múltiplo 1:
 * aceita a fração como digitada (até 3 casas); com múltiplo maior, arredonda ao múltiplo.
 */
export function arredondarQuantidade(quantidade: number, multiplo: number, fracionada: boolean): number {
  const q = paraMilesimos(quantidade);
  if (fracionada && multiplo === 1) return q / 1000;
  const passo = multiplo * 1000;
  return (Math.ceil(q / passo) * passo) / 1000;
}

/** Serviço em valor-hora: tempo arredondado PARA CIMA até um múltiplo das horas cadastradas no serviço. */
export const arredondarMinutos = (minutos: number, tempoServico: number) =>
  Math.ceil(minutos / tempoServico) * tempoServico;

// ---------- Desconto e totais ----------

/** Percentual de desconto guardado em centésimos: 7,5% = 750; 100% = 10000. */
export const PERCENTUAL_MAXIMO = 10_000;

/** Desconto por percentual, em centavos, arredondado PARA CIMA (a favor do cliente). */
export function descontoPorPercentual(precoCentavos: number, percentualCentesimos: number): number {
  const d = (BigInt(precoCentavos) * BigInt(percentualCentesimos) + 9_999n) / 10_000n;
  return Math.min(Number(d), precoCentavos);
}

/** Percentual equivalente a um preço negociado (para exibição, 2 casas): R$ 110 → R$ 100 = 9,09%. */
export function percentualDoDesconto(precoTabelaCentavos: number, precoUnitarioCentavos: number): number {
  if (precoTabelaCentavos <= 0) return 0;
  const centesimos = Number(
    ((BigInt(precoTabelaCentavos - precoUnitarioCentavos) * 10_000n * 2n) / BigInt(precoTabelaCentavos) + 1n) / 2n,
  );
  return centesimos / 100;
}

/** Valor da linha: preço × quantidade (milésimos) ou preço da hora × minutos, arredondado ao centavo. */
export function valorDaLinha(
  precoCentavos: number,
  qtd: { quantidadeMilesimos: number } | { tempoMinutos: number },
): number {
  const p = BigInt(precoCentavos);
  if ('tempoMinutos' in qtd) return Number((p * BigInt(qtd.tempoMinutos) + 30n) / 60n);
  return Number((p * BigInt(qtd.quantidadeMilesimos) + 500n) / 1000n);
}

export type CalculoItem = { brutoCentavos: number; descontoCentavos: number; totalCentavos: number };

/** Bruto = preço de tabela × quantidade; total = preço negociado × quantidade; desconto = a diferença. */
export function calcularItem(
  precoTabelaCentavos: number,
  precoUnitarioCentavos: number,
  qtd: { quantidadeMilesimos: number } | { tempoMinutos: number },
): CalculoItem {
  const brutoCentavos = valorDaLinha(precoTabelaCentavos, qtd);
  const totalCentavos = valorDaLinha(precoUnitarioCentavos, qtd);
  return { brutoCentavos, descontoCentavos: brutoCentavos - totalCentavos, totalCentavos };
}

export const somarItens = (itens: CalculoItem[]) =>
  itens.reduce(
    (s, i) => ({
      subtotalCentavos: s.subtotalCentavos + i.brutoCentavos,
      descontoCentavos: s.descontoCentavos + i.descontoCentavos,
      totalCentavos: s.totalCentavos + i.totalCentavos,
    }),
    { subtotalCentavos: 0, descontoCentavos: 0, totalCentavos: 0 },
  );

// ---------- Schemas da API ----------

const vazioComoNulo = (v: unknown) => (v === '' || v === undefined ? null : v);
const versao = z.number().int().min(1).optional();

/**
 * Item enviado pela tela. `id` = item já gravado (mantém o preço guardado); sem `id` = item novo (a API busca o
 * preço da tabela na hora). Quantidade: material e serviço de preço fechado; tempo (h:mm ou minutos): valor-hora.
 * Negociação (só material): percentual OU preço digitado, nunca acima do preço da tabela.
 */
export const itemOrcamentoInputSchema = z
  .object({
    id: z.uuid().optional(),
    tipo: z.enum(chaves(TIPOS_ITEM_PRECO)),
    materialId: z.uuid().optional(),
    servicoId: z.uuid().optional(),
    quantidade: z
      .number({ error: 'Informe a quantidade' })
      .positive('A quantidade deve ser maior que zero')
      .max(999_999, 'Quantidade alta demais')
      .optional(),
    tempoMinutos: z
      .preprocess(
        (v) => (typeof v === 'string' ? horasParaMinutos(v) : v),
        z
          .number({ error: 'Informe as horas (ex.: 1:30)' })
          .int('Informe as horas (ex.: 1:30)')
          .min(1, 'Informe as horas (ex.: 1:30)')
          .max(999 * 60 + 59, 'Horas demais'),
      )
      .optional(),
    descontoPercentual: z
      .number({ error: 'Percentual inválido' })
      .min(0, 'O desconto não pode ser negativo')
      .max(100, 'O desconto vai até 100%')
      .refine((v) => Number.isInteger(Math.round(v * 100 * 1e6) / 1e6), 'Use até 2 casas decimais')
      .nullish(),
    precoUnitarioCentavos: z
      .number({ error: 'Informe o preço' })
      .int('Informe o preço em centavos')
      .min(0, 'O preço não pode ser negativo')
      .max(PRECO_MAXIMO, 'Preço alto demais')
      .nullish(),
  })
  .refine((i) => (i.tipo === 'material' ? !!i.materialId && !i.servicoId : !!i.servicoId && !i.materialId), {
    message: 'Item sem produto ou serviço',
    path: ['tipo'],
  })
  .refine((i) => i.descontoPercentual == null || i.precoUnitarioCentavos == null, {
    message: 'Informe o percentual OU o preço, não os dois',
    path: ['descontoPercentual'],
  });
export type ItemOrcamentoInput = z.input<typeof itemOrcamentoInputSchema>;
export type ItemOrcamentoDados = z.output<typeof itemOrcamentoInputSchema>;

export const MAXIMO_ITENS_ORCAMENTO = 200;

export const orcamentoInputSchema = z.object({
  clienteId: z.uuid('Escolha o cliente'),
  veiculoId: z.preprocess(vazioComoNulo, z.uuid().nullable()),
  vendedorId: z.uuid('Escolha o vendedor'),
  /** Vazio = tabela padrão da oficina. */
  tabelaPrecoId: z.preprocess(vazioComoNulo, z.uuid().nullable()).optional(),
  /** Livre no rascunho; conferida (e, vazia, preenchida com 7 dias) na emissão. */
  validadeAte: z.preprocess(vazioComoNulo, z.iso.date('Data inválida').nullable()),
  observacoes: z
    .string()
    .trim()
    .max(2000, 'Máximo de 2000 caracteres')
    .nullish()
    .transform((v) => v || null),
  itens: z.array(itemOrcamentoInputSchema).max(MAXIMO_ITENS_ORCAMENTO, `No máximo ${MAXIMO_ITENS_ORCAMENTO} itens`),
  versao,
  /**
   * Gravação automática do rascunho (a tela grava a cada mudança): não registra "Alterado" no histórico, para não
   * encher de eventos; "Descontos alterados" continua (rastro da aprovação comercial).
   */
  automatico: z.boolean().optional(),
});
export type OrcamentoInput = z.input<typeof orcamentoInputSchema>;
export type OrcamentoDados = z.output<typeof orcamentoInputSchema>;

/** Transições com concorrência otimista: a tela informa a versão do registro que leu. */
export const transicaoOrcamentoSchema = z.object({
  versao: z.number().int().min(1),
  /** Recusa e cancelamento: texto livre opcional. */
  motivo: z
    .string()
    .trim()
    .max(500, 'Máximo de 500 caracteres')
    .nullish()
    .transform((v) => v || null),
});

export const itemOrcamentoSchema = z.object({
  id: z.uuid(),
  ordem: z.number(),
  tipo: z.enum(chaves(TIPOS_ITEM_PRECO)),
  materialId: z.uuid().nullable(),
  servicoId: z.uuid().nullable(),
  /** SKU do material ou código do serviço (6 dígitos), como estava ao entrar no orçamento. */
  codigo: z.string(),
  descricao: z.string(),
  unidade: z.string(),
  formaPreco: z.enum(chaves(FORMAS_PRECO_SERVICO)).nullable(),
  /** Material: múltiplo de venda; valor-hora: horas do serviço (minutos); preço fechado: 1. */
  multiplo: z.number(),
  fracionada: z.boolean(),
  quantidade: z.number().nullable(),
  tempoMinutos: z.number().nullable(),
  precoTabelaCentavos: z.number(),
  precoUnitarioCentavos: z.number(),
  /** Percentual digitado na negociação (null = preço digitado ou sem desconto). */
  descontoPercentual: z.number().nullable(),
  brutoCentavos: z.number(),
  descontoCentavos: z.number(),
  totalCentavos: z.number(),
});
export type ItemOrcamento = z.infer<typeof itemOrcamentoSchema>;

export const EVENTOS_ORCAMENTO = {
  criado: 'Criado',
  alterado: 'Alterado',
  precos_recalculados: 'Preços recalculados',
  tabela_trocada: 'Tabela de preço trocada',
  emitido: 'Emitido',
  enviado: 'Enviado',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  cancelado: 'Cancelado',
  nova_versao: 'Nova versão',
  descontos_alterados: 'Descontos alterados',
  aprovacao_comercial_solicitada: 'Enviado para aprovação comercial',
  aprovado_comercialmente: 'Aprovado comercialmente',
  reprovado_comercialmente: 'Reprovado comercialmente',
  aprovacao_comercial_retirada: 'Pedido de aprovação comercial retirado',
} as const;
export type EventoOrcamento = keyof typeof EVENTOS_ORCAMENTO;

const situacao = z.enum(chaves(SITUACOES_ORCAMENTO));

export const orcamentoResumoSchema = z.object({
  id: z.uuid(),
  numero: z.number(),
  versaoOrcamento: z.number(),
  situacao,
  clienteNome: z.string(),
  veiculoPlaca: z.string().nullable(),
  vendedorNome: z.string(),
  totalCentavos: z.number(),
  validadeAte: z.string().nullable(),
  criadoEm: z.coerce.date(),
});
export type OrcamentoResumo = z.infer<typeof orcamentoResumoSchema>;

export const orcamentoSchema = orcamentoResumoSchema.extend({
  status: z.enum(STATUS_ORCAMENTO),
  cliente: z.object({
    id: z.uuid(),
    nome: z.string(),
    ativo: z.boolean(),
    /** Campos obrigatórios que faltam no cadastro (não impedem o orçamento; só avisam). */
    pendencias: z.array(z.string()),
  }),
  veiculo: z.object({ id: z.uuid(), placa: z.string(), marca: z.string(), modelo: z.string() }).nullable(),
  vendedor: z.object({ id: z.uuid(), nome: z.string(), ativo: z.boolean() }),
  tabela: z.object({ id: z.uuid(), codigo: z.string(), nome: z.string() }),
  observacoes: z.string().nullable(),
  /** Dia em que os preços dos itens foram calculados; rascunho de outro dia precisa ser recalculado. */
  precosEm: z.string(),
  subtotalCentavos: z.number(),
  descontoCentavos: z.number(),
  itens: z.array(itemOrcamentoSchema),
  emitidoEm: z.coerce.date().nullable(),
  enviadoEm: z.coerce.date().nullable(),
  aprovadoEm: z.coerce.date().nullable(),
  aprovadoPor: z.string().nullable(),
  recusadoEm: z.coerce.date().nullable(),
  recusadoPor: z.string().nullable(),
  motivoRecusa: z.string().nullable(),
  canceladoEm: z.coerce.date().nullable(),
  motivoCancelamento: z.string().nullable(),
  /** Aprovação comercial mais recente desta versão (null = nunca precisou). */
  aprovacaoComercial: aprovacaoDoDocumentoSchema.nullable(),
  /**
   * O.S. gerada da conversão deste orçamento (null = não convertido). Lida da O.S., que guarda a referência: o
   * orçamento não muda ao ser convertido (docs/modulos/ORCAMENTOS.md §6, CV-07).
   */
  ordemServico: z.object({ id: z.uuid(), numero: z.number() }).nullable(),
  /** Versões do mesmo número (histórico), da mais nova para a mais antiga. */
  versoes: z.array(z.object({ id: z.uuid(), versaoOrcamento: z.number(), situacao, totalCentavos: z.number() })),
  eventos: z.array(
    z.object({
      evento: z.enum(chaves(EVENTOS_ORCAMENTO)),
      detalhe: z.string().nullable(),
      usuario: z.string().nullable(),
      criadoEm: z.coerce.date(),
    }),
  ),
  criadoPor: z.string().nullable(),
  atualizadoEm: z.coerce.date(),
  versao: z.number(),
  /** Avisos da última gravação (itens recalculados ou removidos por falta de preço). */
  avisos: z.array(z.string()),
});
export type Orcamento = z.infer<typeof orcamentoSchema>;

const dataFiltro = z.union([z.literal(''), z.iso.date('Data inválida')]).optional();

export const orcamentoFiltroSchema = z.object({
  /** Número (com ou sem "ORC-" e zeros), nome do cliente ou placa. */
  q: z.string().trim().optional(),
  situacao: z.union([z.literal(''), situacao]).optional(),
  vendedorId: z.union([z.literal(''), z.uuid()]).optional(),
  /** Período da criação (extremos inclusivos). */
  desde: dataFiltro,
  ate: dataFiltro,
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});

/** Material ou serviço da busca do orçamento, com o preço de hoje na tabela escolhida (null = não pode vender). */
export const itemVendavelSchema = z.object({
  tipo: z.enum(chaves(TIPOS_ITEM_PRECO)),
  id: z.uuid(),
  codigo: z.string(),
  descricao: z.string(),
  unidade: z.string(),
  formaPreco: z.enum(chaves(FORMAS_PRECO_SERVICO)).nullable(),
  multiplo: z.number(),
  fracionada: z.boolean(),
  precoCentavos: z.number().nullable(),
  /** Material: saldo livre somado dos depósitos (disponível − reservado); serviço: null. */
  estoque: z.number().nullable(),
});
export type ItemVendavel = z.infer<typeof itemVendavelSchema>;

export const itemVendavelQuerySchema = z.object({
  q: z.string().trim().min(1),
  tabelaPrecoId: z.uuid(),
  /** Vazio = materiais e serviços. */
  tipo: z.union([z.literal(''), z.enum(chaves(TIPOS_ITEM_PRECO))]).optional(),
});

/** Descrição curta da validade: "até 30/09/2026 (aprovável até 01/10/2026)". */
export const descreverValidade = (validadeAte: string) =>
  `até ${formatarDataIso(validadeAte)} (aprovável até ${formatarDataIso(ultimoDiaParaAprovar(validadeAte))})`;

// ---------- Apoio à tela do orçamento (só o necessário, sem depender de outros módulos) ----------

export const clienteParaOrcamentoSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
  tipo: z.enum(['PF', 'PJ']),
  cpfCnpj: z.string().nullable(),
  telefone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  /** Cidade/UF do endereço principal. */
  cidade: z.string().nullable(),
  placas: z.array(z.string()),
  ativo: z.boolean(),
  pendencias: z.array(z.string()),
});
export type ClienteParaOrcamento = z.infer<typeof clienteParaOrcamentoSchema>;

/** Janela de escolha do cliente: abre listando (busca opcional), com filtros de situação e tipo. */
export const clienteParaOrcamentoFiltroSchema = z.object({
  q: z.string().trim().optional(),
  ativo: z.enum(['true', 'false', '']).default('true'),
  tipo: z.enum(['PF', 'PJ', '']).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(50).default(20),
});

export const veiculoParaOrcamentoSchema = z.object({
  id: z.uuid(),
  placa: z.string(),
  marca: z.string(),
  modelo: z.string(),
});
export type VeiculoParaOrcamento = z.infer<typeof veiculoParaOrcamentoSchema>;

/**
 * Contexto do cliente na tela do orçamento (card e "Visualizar cliente"): cadastro, veículos, os últimos orçamentos
 * e o último aprovado pelo cliente. Para o vendedor, os orçamentos são só os dele (docs/modulos/ORCAMENTOS.md §5).
 * Crédito e última compra não existem no MobiOS (virão com o Financeiro e as vendas).
 */
export const contextoClienteSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
  tipo: z.enum(['PF', 'PJ']),
  cpfCnpj: z.string().nullable(),
  rgIe: z.string().nullable(),
  telefone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  email: z.string().nullable(),
  clienteDesde: z.string(),
  ativo: z.boolean(),
  pendencias: z.array(z.string()),
  endereco: z
    .object({
      logradouro: z.string(),
      numero: z.string(),
      complemento: z.string().nullable(),
      bairro: z.string(),
      cidade: z.string(),
      uf: z.string(),
      cep: z.string(),
    })
    .nullable(),
  veiculos: z.array(veiculoParaOrcamentoSchema),
  ultimoAprovado: z
    .object({
      id: z.uuid(),
      numero: z.number(),
      versaoOrcamento: z.number(),
      aprovadoEm: z.coerce.date(),
      totalCentavos: z.number(),
    })
    .nullable(),
  /** Quantos orçamentos (registros, contando as versões) o cliente tem no escopo de quem consulta. */
  totalOrcamentos: z.number(),
  /** Os 5 mais recentes. */
  orcamentos: z.array(
    z.object({
      id: z.uuid(),
      numero: z.number(),
      versaoOrcamento: z.number(),
      situacao,
      totalCentavos: z.number(),
      criadoEm: z.coerce.date(),
    }),
  ),
});
export type ContextoCliente = z.infer<typeof contextoClienteSchema>;

export const vendedorParaOrcamentoSchema = z.object({
  id: z.uuid(),
  codigo: z.number(),
  nome: z.string(),
  ativo: z.boolean(),
});
export type VendedorParaOrcamento = z.infer<typeof vendedorParaOrcamentoSchema>;

export const tabelaParaOrcamentoSchema = z.object({
  id: z.uuid(),
  codigo: z.string(),
  nome: z.string(),
  padrao: z.boolean(),
});
export type TabelaParaOrcamento = z.infer<typeof tabelaParaOrcamentoSchema>;
