import { z } from 'zod';
import { aprovacaoDoDocumentoSchema } from './aprovacoes.js';
import { horasParaMinutos } from './mascaras.js';
import { FORMAS_PRECO_SERVICO, PRECO_MAXIMO, TIPOS_ITEM_PRECO, UNIDADES } from './materiais.js';
import { itemOrcamentoInputSchema, itemOrcamentoSchema, MAXIMO_ITENS_ORCAMENTO } from './orcamentos.js';

/*
 * Ordens de Serviço (menu Ordens de serviço; docs/modulos/ORDENS_SERVICO.md). Itens do catálogo seguem as mesmas
 * contas do orçamento (calcularItem/somarItens); avulsos têm o preço digitado, sem desconto.
 */

const chaves = <T extends Record<string, unknown>>(o: T) =>
  Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const vazioComoNulo = (v: unknown) => (v === '' || v === undefined ? null : v);
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .nullish()
    .transform((v) => v || null);

/** Número da O.S. com 6 dígitos: 123 → "OS-000123". */
export const formatarNumeroOs = (numero: number) => `OS-${String(numero).padStart(6, '0')}`;

// ---------- Situações ----------

export const SITUACOES_OS = {
  aberta: 'Aberta',
  em_diagnostico: 'Em diagnóstico',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovada: 'Aprovada',
  em_execucao: 'Em execução',
  aguardando_peca: 'Aguardando peça',
  concluida: 'Concluída',
  entregue: 'Entregue',
  recusada: 'Recusada',
  cancelada: 'Cancelada',
} as const;
export type SituacaoOs = keyof typeof SITUACOES_OS;
export const STATUS_OS = chaves(SITUACOES_OS);

/** Situações em que a O.S. ainda está na oficina (conta em "O.S. em aberto" e aceita cancelamento). */
export const SITUACOES_OS_EM_ABERTO: SituacaoOs[] = [
  'aberta',
  'em_diagnostico',
  'aguardando_aprovacao',
  'aprovada',
  'em_execucao',
  'aguardando_peca',
];

/** Situações em que os itens podem mudar (aguardando aprovação: o cliente está decidindo sobre eles). */
export const SITUACOES_OS_ITENS_EDITAVEIS: SituacaoOs[] = [
  'aberta',
  'em_diagnostico',
  'aprovada',
  'em_execucao',
  'aguardando_peca',
];

/** Aprovação do item pelo cliente. `recusado` fica reservado para a aprovação parcial (futura). */
export const APROVACOES_ITEM_OS = { pendente: 'Pendente', aprovado: 'Aprovado', recusado: 'Recusado' } as const;
export type AprovacaoItemOs = keyof typeof APROVACOES_ITEM_OS;

export const EVENTOS_OS = {
  criada: 'Aberta',
  convertida: 'Aberta a partir do orçamento',
  dados_alterados: 'Dados alterados',
  itens_alterados: 'Itens alterados',
  descontos_alterados: 'Descontos alterados',
  diagnostico_iniciado: 'Diagnóstico iniciado',
  aprovacao_solicitada: 'Enviada para aprovação do cliente',
  aprovada: 'Aprovada pelo cliente',
  recusada: 'Recusada pelo cliente',
  execucao_iniciada: 'Execução iniciada',
  aguardando_peca: 'Aguardando peça',
  execucao_retomada: 'Execução retomada',
  cancelada: 'Cancelada',
  mecanico_vinculado: 'Mecânico vinculado',
  mecanico_desvinculado: 'Mecânico desvinculado',
  aprovacao_comercial_solicitada: 'Enviada para aprovação comercial',
  aprovado_comercialmente: 'Aprovado comercialmente',
  reprovado_comercialmente: 'Reprovado comercialmente',
  checklist_registrado: 'Checklist de entrada registrado',
  diagnostico_registrado: 'Diagnóstico registrado',
  foto_adicionada: 'Foto adicionada',
  foto_removida: 'Foto removida',
  servico_executado: 'Serviço executado',
  execucao_desfeita: 'Execução do serviço desfeita',
  mecanicos_do_servico: 'Mecânicos do serviço alterados',
  peca_solicitada: 'Peça solicitada',
  solicitacao_atendida: 'Solicitação de peça atendida',
  solicitacao_recusada: 'Solicitação de peça recusada',
  concluida: 'Concluída',
} as const;
export type EventoOs = keyof typeof EVENTOS_OS;

/** Situações em que o serviço pode ser confirmado como executado (ou desfeito). */
export const SITUACOES_OS_EXECUCAO: SituacaoOs[] = ['em_execucao', 'aguardando_peca'];

// ---------- Execução (onda 5.3; docs/modulos/ORDENS_SERVICO.md §11) ----------

export const STATUS_SOLICITACAO_PECA = { pendente: 'Pendente', atendida: 'Atendida', recusada: 'Recusada' } as const;
export type StatusSolicitacaoPeca = keyof typeof STATUS_SOLICITACAO_PECA;

/** Mecânicos atribuídos a um serviço (substitui a lista). */
export const mecanicosDoServicoInputSchema = z.object({
  usuarioIds: z.array(z.uuid()).max(10, 'No máximo 10 mecânicos por serviço'),
  versao: z.number().int().min(1),
});

/** Solicitação de peça pelo mecânico (OS-21, sem estoque nesta fase): o que precisa, quanto e por quê. */
export const solicitacaoPecaInputSchema = z.object({
  descricao: z.string().trim().min(1, 'Informe a peça').max(200, 'Máximo de 200 caracteres'),
  quantidade: z
    .number({ error: 'Informe a quantidade' })
    .positive('A quantidade deve ser maior que zero')
    .max(99_999, 'Quantidade alta demais'),
  observacao: textoOpcional(500),
  versao: z.number().int().min(1),
});
export type SolicitacaoPecaInput = z.input<typeof solicitacaoPecaInputSchema>;

/** Atender (resposta opcional) ou recusar (motivo obrigatório) a solicitação. */
export const atendimentoSolicitacaoSchema = z.object({ versao: z.number().int().min(1), resposta: textoOpcional(500) });
export const recusaSolicitacaoSchema = z.object({
  versao: z.number().int().min(1),
  resposta: z
    .string({ error: 'Informe o motivo' })
    .trim()
    .min(1, 'Informe o motivo')
    .max(500, 'Máximo de 500 caracteres'),
});

// ---------- Recepção e diagnóstico (onda 5.2; docs/modulos/ORDENS_SERVICO.md §10) ----------

/** Estado de cada item do checklist de entrada. */
export const ESTADOS_CHECKLIST = {
  presente: 'Presente',
  ausente: 'Ausente',
  avariado: 'Avariado',
  nao_aplicavel: 'Não se aplica',
} as const;
export type EstadoChecklist = keyof typeof ESTADOS_CHECKLIST;

/** Nível de combustível na entrada. */
export const NIVEIS_COMBUSTIVEL = {
  reserva: 'Reserva',
  um_quarto: '1/4',
  meio: '1/2',
  tres_quartos: '3/4',
  cheio: 'Cheio',
} as const;
export type NivelCombustivel = keyof typeof NIVEIS_COMBUSTIVEL;

/** Itens sugeridos no checklist de uma O.S. nova (a tela permite tirar e incluir outros). */
export const ITENS_CHECKLIST_PADRAO = [
  'Estepe',
  'Macaco',
  'Chave de roda',
  'Triângulo',
  'Rádio / som',
  'Tapetes',
  'Documento do veículo',
  'Calotas',
  'Antena',
  'Manual do proprietário',
] as const;

export const CATEGORIAS_FOTO_OS = { entrada: 'Entrada', avaria: 'Avaria', execucao: 'Execução' } as const;
export type CategoriaFotoOs = keyof typeof CATEGORIAS_FOTO_OS;

/** Fotos por O.S. (decisão de 26/09/2026): guardadas no banco, reduzidas no navegador antes do envio. */
export const MAXIMO_FOTOS_OS = 5;
export const MAXIMO_ITENS_CHECKLIST = 40;

export const checklistOsInputSchema = z.object({
  itens: z
    .array(
      z.object({
        item: z.string().trim().min(1, 'Informe o item').max(60, 'Máximo de 60 caracteres'),
        estado: z.enum(chaves(ESTADOS_CHECKLIST), { error: 'Escolha o estado' }),
        observacao: textoOpcional(200),
      }),
    )
    .max(MAXIMO_ITENS_CHECKLIST, `No máximo ${MAXIMO_ITENS_CHECKLIST} itens`)
    .refine((itens) => new Set(itens.map((i) => i.item.toLowerCase())).size === itens.length, {
      message: 'Há itens repetidos no checklist',
    }),
  combustivel: z.preprocess(vazioComoNulo, z.enum(chaves(NIVEIS_COMBUSTIVEL)).nullable()),
  avariasEntrada: textoOpcional(1000),
  versao: z.number().int().min(1),
});
export type ChecklistOsInput = z.input<typeof checklistOsInputSchema>;

export const diagnosticoOsInputSchema = z.object({
  diagnostico: textoOpcional(4000),
  versao: z.number().int().min(1),
});

/** Envio da foto: o arquivo vai no corpo; categoria e versão lida na URL. */
export const fotoOsQuerySchema = z.object({
  categoria: z.enum(chaves(CATEGORIAS_FOTO_OS)),
  versao: z.coerce.number().int().min(1),
});

// ---------- Entradas ----------

const kmEntrada = z
  .number({ error: 'Informe o km de entrada' })
  .int('Informe o km sem casas decimais')
  .min(0, 'O km não pode ser negativo')
  .max(9_999_999, 'Km alto demais');

/** Data e hora local de Brasília ("2026-09-30T17:30"), como o campo datetime-local envia. Vazio = sem previsão. */
const previsaoEntrega = z.preprocess(
  vazioComoNulo,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Data e hora inválidas')
    .nullable(),
);

export const aberturaOsInputSchema = z.object({
  clienteId: z.uuid('Escolha o cliente'),
  veiculoId: z.uuid('Escolha o veículo'),
  kmEntrada,
  relatoCliente: textoOpcional(2000),
  /** Vazio = sem vendedor (o vendedor logado já vem escolhido na tela). */
  vendedorId: z.preprocess(vazioComoNulo, z.uuid().nullable()),
  previsaoEntrega,
});
export type AberturaOsInput = z.input<typeof aberturaOsInputSchema>;

/** Dados do cabeçalho que mudam depois da abertura (cliente, veículo e km de entrada não mudam). */
export const cabecalhoOsInputSchema = z.object({
  relatoCliente: textoOpcional(2000),
  observacoes: textoOpcional(2000),
  vendedorId: z.preprocess(vazioComoNulo, z.uuid().nullable()),
  previsaoEntrega,
  versao: z.number().int().min(1),
});
export type CabecalhoOsInput = z.input<typeof cabecalhoOsInputSchema>;

/** Conversão do orçamento aprovado (docs/modulos/ORCAMENTOS.md §6): o que a abertura exige e o orçamento não tem. */
export const conversaoOrcamentoInputSchema = z.object({
  /** Obrigatório se o orçamento não tem veículo; se tem, é o dele. */
  veiculoId: z.preprocess(vazioComoNulo, z.uuid().nullable()),
  kmEntrada,
  relatoCliente: textoOpcional(2000),
});
export type ConversaoOrcamentoInput = z.input<typeof conversaoOrcamentoInputSchema>;
export type ConversaoOrcamentoDados = z.output<typeof conversaoOrcamentoInputSchema>;

/**
 * Item avulso (só na O.S.): digitado na hora, sem cadastro, com o preço final (sem desconto nem alçada).
 * Serviço: preço fechado (quantidade) ou por hora (horas × valor-hora). Peça: unidade e quantidade.
 */
export const itemAvulsoOsInputSchema = z
  .object({
    id: z.uuid().optional(),
    avulso: z.literal(true),
    tipo: z.enum(chaves(TIPOS_ITEM_PRECO)),
    descricao: z.string().trim().min(1, 'Informe a descrição').max(200, 'Máximo de 200 caracteres'),
    /** Peça avulsa. */
    unidade: z.enum(chaves(UNIDADES)).optional(),
    /** Serviço avulso. */
    formaPreco: z.enum(chaves(FORMAS_PRECO_SERVICO)).optional(),
    quantidade: z
      .number({ error: 'Informe a quantidade' })
      .positive('A quantidade deve ser maior que zero')
      .max(999_999, 'Quantidade alta demais')
      .optional(),
    tempoMinutos: z
      .preprocess(
        (v) => (typeof v === 'string' ? horasParaMinutos(v) : v),
        z
          .number()
          .int()
          .min(1, 'Informe as horas (ex.: 1:30)')
          .max(999 * 60 + 59, 'Horas demais'),
      )
      .optional(),
    precoUnitarioCentavos: z
      .number({ error: 'Informe o preço' })
      .int('Informe o preço em centavos')
      .min(0, 'O preço não pode ser negativo')
      .max(PRECO_MAXIMO, 'Preço alto demais'),
  })
  .refine((i) => i.tipo === 'servico' || !!i.unidade, { message: 'Informe a unidade', path: ['unidade'] })
  .refine((i) => i.tipo === 'material' || !!i.formaPreco, { message: 'Informe a forma de preço', path: ['formaPreco'] })
  .refine((i) => (i.tipo === 'servico' && i.formaPreco === 'hora' ? !!i.tempoMinutos : !!i.quantidade), {
    message: 'Informe a quantidade ou as horas',
    path: ['quantidade'],
  });

/** Item enviado pela tela: do catálogo (mesmas regras do orçamento) ou avulso. */
export const itemOsInputSchema = z.union([itemAvulsoOsInputSchema, itemOrcamentoInputSchema]);
export type ItemOsInput = z.input<typeof itemOsInputSchema>;
export type ItemOsDados = z.output<typeof itemOsInputSchema>;

export const itensOsInputSchema = z.object({
  itens: z.array(itemOsInputSchema).max(MAXIMO_ITENS_ORCAMENTO, `No máximo ${MAXIMO_ITENS_ORCAMENTO} itens`),
  versao: z.number().int().min(1),
});
export type ItensOsInput = z.input<typeof itensOsInputSchema>;

/** Ações de situação, com a versão lida (concorrência otimista). Recusa: motivo opcional. */
export const transicaoOsSchema = z.object({ versao: z.number().int().min(1), motivo: textoOpcional(500) });

export const cancelamentoOsSchema = z.object({
  versao: z.number().int().min(1),
  motivo: z
    .string({ error: 'Informe o motivo do cancelamento' })
    .trim()
    .min(1, 'Informe o motivo do cancelamento')
    .max(500, 'Máximo de 500 caracteres'),
});

export const mecanicoOsInputSchema = z.object({
  usuarioId: z.uuid('Escolha o mecânico'),
  versao: z.number().int().min(1),
});

// ---------- Respostas ----------

const situacao = z.enum(STATUS_OS);

export const itemOsSchema = itemOrcamentoSchema.extend({
  /** Avulso: sem produto ou serviço de cadastro. */
  avulso: z.boolean(),
  /** Código do cadastro (null no avulso). */
  codigo: z.string().nullable(),
  aprovacao: z.enum(chaves(APROVACOES_ITEM_OS)),
  /** Serviço: confirmação de execução (OS-22) e mecânicos atribuídos (OS-10). */
  executadoEm: z.coerce.date().nullable(),
  executadoPor: z.string().nullable(),
  mecanicos: z.array(z.object({ id: z.uuid(), nome: z.string() })),
});
export type ItemOs = z.infer<typeof itemOsSchema>;

export const ordemServicoResumoSchema = z.object({
  id: z.uuid(),
  numero: z.number(),
  situacao,
  clienteNome: z.string(),
  veiculoPlaca: z.string(),
  vendedorNome: z.string().nullable(),
  mecanicos: z.array(z.string()),
  previsaoEntrega: z.coerce.date().nullable(),
  totalCentavos: z.number(),
  abertaEm: z.coerce.date(),
  /** Solicitações de peça ainda sem resposta. */
  pecasSolicitadas: z.number(),
});
export type OrdemServicoResumo = z.infer<typeof ordemServicoResumoSchema>;

export const ordemServicoSchema = ordemServicoResumoSchema.extend({
  cliente: z.object({ id: z.uuid(), nome: z.string() }),
  veiculo: z.object({ id: z.uuid(), placa: z.string(), marca: z.string(), modelo: z.string() }),
  vendedor: z.object({ id: z.uuid(), nome: z.string(), ativo: z.boolean() }).nullable(),
  tabela: z.object({ id: z.uuid(), codigo: z.string(), nome: z.string() }),
  /** Orçamento de origem (conversão), só como referência. */
  orcamento: z.object({ id: z.uuid(), numero: z.number(), versaoOrcamento: z.number() }).nullable(),
  kmEntrada: z.number(),
  relatoCliente: z.string().nullable(),
  observacoes: z.string().nullable(),
  subtotalServicosCentavos: z.number(),
  subtotalMateriaisCentavos: z.number(),
  descontoCentavos: z.number(),
  aprovadaEm: z.coerce.date().nullable(),
  aprovadaPor: z.string().nullable(),
  recusadaEm: z.coerce.date().nullable(),
  motivoRecusa: z.string().nullable(),
  canceladaEm: z.coerce.date().nullable(),
  motivoCancelamento: z.string().nullable(),
  itens: z.array(itemOsSchema),
  mecanicosVinculados: z.array(z.object({ id: z.uuid(), nome: z.string() })),
  /** Aprovação comercial mais recente (null = nunca precisou); pendente = O.S. travada. */
  aprovacaoComercial: aprovacaoDoDocumentoSchema.nullable(),
  eventos: z.array(
    z.object({
      evento: z.enum(chaves(EVENTOS_OS)),
      situacaoAnterior: situacao.nullable(),
      situacaoNova: situacao.nullable(),
      detalhe: z.string().nullable(),
      usuario: z.string().nullable(),
      criadoEm: z.coerce.date(),
    }),
  ),
  /** Checklist de entrada (null em `checklistEm` = ainda não registrado). */
  checklist: z.array(
    z.object({ item: z.string(), estado: z.enum(chaves(ESTADOS_CHECKLIST)), observacao: z.string().nullable() }),
  ),
  combustivel: z.enum(chaves(NIVEIS_COMBUSTIVEL)).nullable(),
  avariasEntrada: z.string().nullable(),
  checklistEm: z.coerce.date().nullable(),
  diagnostico: z.string().nullable(),
  concluidaEm: z.coerce.date().nullable(),
  concluidaPor: z.string().nullable(),
  solicitacoesPeca: z.array(
    z.object({
      id: z.uuid(),
      descricao: z.string(),
      quantidade: z.number(),
      observacao: z.string().nullable(),
      status: z.enum(chaves(STATUS_SOLICITACAO_PECA)),
      solicitadaPor: z.string().nullable(),
      solicitadaEm: z.coerce.date(),
      resolvidaPor: z.string().nullable(),
      resolvidaEm: z.coerce.date().nullable(),
      resposta: z.string().nullable(),
    }),
  ),
  fotos: z.array(
    z.object({
      id: z.uuid(),
      categoria: z.enum(chaves(CATEGORIAS_FOTO_OS)),
      tamanho: z.number(),
      criadaPor: z.string().nullable(),
      criadaEm: z.coerce.date(),
    }),
  ),
  /** O que o usuário atual pode fazer (a API confere de novo em cada ação). */
  permissoes: z.object({ alterar: z.boolean(), produtos: z.boolean() }),
  /** Faltas para concluir (vazia = pode concluir, se estiver em execução). */
  pendenciasConclusao: z.array(z.string()),
  criadaPor: z.string().nullable(),
  versao: z.number(),
  /** Avisos da última gravação (quantidades arredondadas). */
  avisos: z.array(z.string()),
});
export type OrdemServico = z.infer<typeof ordemServicoSchema>;

const dataFiltro = z.union([z.literal(''), z.iso.date('Data inválida')]).optional();
const idFiltro = z.union([z.literal(''), z.uuid()]).optional();

export const ordemServicoFiltroSchema = z.object({
  /** Número (com ou sem "OS-" e zeros), nome do cliente ou placa. */
  q: z.string().trim().optional(),
  situacao: z.union([z.literal(''), situacao]).optional(),
  clienteId: idFiltro,
  veiculoId: idFiltro,
  vendedorId: idFiltro,
  mecanicoId: idFiltro,
  /** Só as em aberto (tela do mecânico). */
  abertas: z.enum(['', 'true']).optional(),
  /** Só as com solicitação de peça pendente. */
  pecaPendente: z.enum(['', 'true']).optional(),
  /** Período da abertura (extremos inclusivos). */
  desde: dataFiltro,
  ate: dataFiltro,
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});
export type OrdemServicoFiltro = z.input<typeof ordemServicoFiltroSchema>;

export const mecanicoParaOsSchema = z.object({ id: z.uuid(), nome: z.string() });
export type MecanicoParaOs = z.infer<typeof mecanicoParaOsSchema>;

/** Resultado da conversão do orçamento (docs/modulos/ORCAMENTOS.md §6, CV-12). */
export const conversaoOrcamentoSchema = z.object({
  destino: z.literal('ordem_servico'),
  ordemServicoId: z.uuid(),
});
