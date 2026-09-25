import { z } from 'zod';
import { cestValido, gtinValido, ncmValido, somenteDigitos } from './documentos.js';
import { hojeIso } from './formatos.js';
import { horasParaMinutos } from './mascaras.js';

/*
 * Módulo Materiais e Preços (docs/modulos/MATERIAIS_E_PRECOS.md).
 * Escopo: material, serviço, categoria, marca, depósito, tabela de preço e preço por vigência (de material ou serviço).
 * Estoque, compras, vendas e O.S. usarão estes cadastros, mas não estão aqui.
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

/** Códigos de negócio (SKU, código de depósito/tabela/categoria/marca): maiúsculos, sem espaços. */
const codigo = (rotulo: string, max: number) =>
  z
    .string({ error: `Informe o ${rotulo}` })
    .trim()
    .toUpperCase()
    .min(1, `Informe o ${rotulo}`)
    .max(max, `Máximo de ${max} caracteres`)
    .regex(/^[A-Z0-9][A-Z0-9._/-]*$/, 'Use letras, números e . _ / - (sem espaços)');
const codigoOpcional = (rotulo: string, max: number) => z.preprocess(vazioComoNulo, codigo(rotulo, max).nullable());

/** Controle de concorrência otimista: a edição informa a versão lida; se outra pessoa salvou antes, a API recusa. */
const versao = z.number().int().min(1).optional();

/** Ativar/inativar (desativação lógica). */
export const statusInputSchema = z.object({ ativo: z.boolean() });

const auditoria = {
  criadoEm: z.coerce.date(),
  atualizadoEm: z.coerce.date(),
  criadoPor: z.string().nullable(),
  atualizadoPor: z.string().nullable(),
  versao: z.number(),
};

// ---------- Unidades e origem fiscal (domínios fixos: mudam por norma, não por oficina) ----------

/** `fracionada`: aceita quantidade com casas decimais (usado por estoque/venda no futuro). */
export const UNIDADES = {
  UN: { nome: 'Unidade', fracionada: false },
  PC: { nome: 'Peça', fracionada: false },
  PAR: { nome: 'Par', fracionada: false },
  JG: { nome: 'Jogo', fracionada: false },
  KIT: { nome: 'Kit', fracionada: false },
  CX: { nome: 'Caixa', fracionada: false },
  L: { nome: 'Litro', fracionada: true },
  ML: { nome: 'Mililitro', fracionada: false },
  KG: { nome: 'Quilograma', fracionada: true },
  G: { nome: 'Grama', fracionada: false },
  M: { nome: 'Metro', fracionada: true },
} as const;
export type Unidade = keyof typeof UNIDADES;

/** Origem da mercadoria (tabela da NF-e, 0 a 8). */
export const ORIGENS_FISCAIS = [
  'Nacional',
  'Estrangeira — importação direta',
  'Estrangeira — adquirida no mercado interno',
  'Nacional com mais de 40% de conteúdo importado',
  'Nacional — processos produtivos básicos',
  'Nacional com até 40% de conteúdo importado',
  'Estrangeira — importação direta, sem similar nacional',
  'Estrangeira — mercado interno, sem similar nacional',
  'Nacional com mais de 70% de conteúdo importado',
] as const;

// ---------- Categoria (hierárquica) ----------

export const categoriaInputSchema = z.object({
  codigo: codigoOpcional('código', 20),
  nome: z.string({ error: 'Informe o nome' }).trim().min(2, 'Informe o nome').max(80, 'Máximo de 80 caracteres'),
  descricao: textoOpcional(500),
  categoriaPaiId: z.preprocess(vazioComoNulo, z.uuid().nullable()),
  versao,
});
export type CategoriaInput = z.input<typeof categoriaInputSchema>;

export const categoriaSchema = z.object({
  id: z.uuid(),
  codigo: z.string().nullable(),
  nome: z.string(),
  descricao: z.string().nullable(),
  categoriaPaiId: z.uuid().nullable(),
  ativa: z.boolean(),
  /** Materiais ligados diretamente a esta categoria. */
  materiais: z.number(),
  versao: z.number(),
});
export type Categoria = z.infer<typeof categoriaSchema>;

// ---------- Marca ----------

export const marcaInputSchema = z.object({
  codigo: codigoOpcional('código', 20),
  nome: z.string({ error: 'Informe o nome' }).trim().min(1, 'Informe o nome').max(80, 'Máximo de 80 caracteres'),
  descricao: textoOpcional(500),
  versao,
});
export type MarcaInput = z.input<typeof marcaInputSchema>;

export const marcaSchema = z.object({
  id: z.uuid(),
  codigo: z.string().nullable(),
  nome: z.string(),
  descricao: z.string().nullable(),
  ativa: z.boolean(),
  materiais: z.number(),
  versao: z.number(),
});
export type Marca = z.infer<typeof marcaSchema>;

// ---------- Material ----------

/** Inteiro de formulário ou planilha em que vazio assume o padrão (não é "sem valor"). */
const inteiroComPadrao = (padrao: number, min: number, max: number, mensagem: string) =>
  z.preprocess(
    (v) => (v === '' || v == null ? padrao : Number(v)),
    z.number({ error: mensagem }).int(mensagem).min(min, mensagem).max(max, mensagem),
  );

/** Suprimento: múltiplo de venda (caixa master) e tempo de ressuprimento em dias corridos. */
export const MULTIPLO_PADRAO = 1;
export const LEADTIME_PADRAO_DIAS = 30;

export const materialInputSchema = z.object({
  sku: codigo('SKU', 40),
  codigoBarras: z
    .preprocess(vazioComoNulo, z.string().trim().nullable())
    .refine((v) => !v || gtinValido(v), 'Código de barras inválido (EAN/GTIN de 8, 12, 13 ou 14 dígitos)'),
  descricao: z
    .string({ error: 'Informe a descrição' })
    .trim()
    .min(3, 'Informe a descrição')
    .max(120, 'Máximo de 120 caracteres'),
  descricaoCurta: textoOpcional(40),
  tipoId: z.uuid('Escolha o tipo'),
  categoriaId: z.uuid('Escolha a categoria'),
  marcaId: z.preprocess(vazioComoNulo, z.uuid().nullable()),
  unidade: z.enum(chaves(UNIDADES), 'Escolha a unidade'),
  codigoFabricante: z.preprocess(
    vazioComoNulo,
    z.string().trim().toUpperCase().max(40, 'Máximo de 40 caracteres').nullable(),
  ),
  ncm: z
    .preprocess(vazioComoNulo, z.string().nullable())
    .refine((v) => !v || ncmValido(v), 'NCM tem 8 dígitos')
    .transform((v) => (v ? somenteDigitos(v) : null)),
  cest: z
    .preprocess(vazioComoNulo, z.string().nullable())
    .refine((v) => !v || cestValido(v), 'CEST tem 7 dígitos')
    .transform((v) => (v ? somenteDigitos(v) : null)),
  origem: z.preprocess(
    (v) => (v === '' || v == null ? null : Number(v)),
    z.number().int().min(0).max(8, 'Origem de 0 a 8').nullable(),
  ),
  controlaEstoque: z.boolean().default(true),
  permiteVenda: z.boolean().default(true),
  permiteCompra: z.boolean().default(true),
  permiteUsoOs: z.boolean().default(true),
  controlaLote: z.boolean().default(false),
  controlaSerie: z.boolean().default(false),
  multiplo: inteiroComPadrao(MULTIPLO_PADRAO, 1, 999_999, 'Múltiplo: número inteiro de 1 a 999.999'),
  leadtimeDias: inteiroComPadrao(LEADTIME_PADRAO_DIAS, 0, 3650, 'Leadtime: número inteiro de dias, de 0 a 3.650'),
  versao,
});
export type MaterialInput = z.input<typeof materialInputSchema>;
export type MaterialDados = z.output<typeof materialInputSchema>;

export const materialResumoSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  descricao: z.string(),
  codigoFabricante: z.string().nullable(),
  unidade: z.enum(chaves(UNIDADES)),
  tipoNome: z.string(),
  categoriaNome: z.string(),
  marcaNome: z.string().nullable(),
  ativo: z.boolean(),
});
export type MaterialResumo = z.infer<typeof materialResumoSchema>;

export const materialSchema = materialResumoSchema.extend({
  codigoBarras: z.string().nullable(),
  descricaoCurta: z.string().nullable(),
  tipoId: z.uuid(),
  categoriaId: z.uuid(),
  /** Caminho da categoria na hierarquia ("Peças › Motor › Filtros"). */
  categoriaCaminho: z.string(),
  marcaId: z.uuid().nullable(),
  ncm: z.string().nullable(),
  cest: z.string().nullable(),
  origem: z.number().nullable(),
  controlaEstoque: z.boolean(),
  permiteVenda: z.boolean(),
  permiteCompra: z.boolean(),
  permiteUsoOs: z.boolean(),
  controlaLote: z.boolean(),
  controlaSerie: z.boolean(),
  /** Vende-se só em múltiplos desta quantidade (caixa master); 1 = unitário. */
  multiplo: z.number().int(),
  /** Tempo de ressuprimento, em dias corridos. */
  leadtimeDias: z.number().int(),
  ...auditoria,
});
export type Material = z.infer<typeof materialSchema>;

export const materialFiltroSchema = z.object({
  q: z.string().trim().optional(),
  tipoId: z.uuid().optional(),
  categoriaId: z.uuid().optional(),
  marcaId: z.uuid().optional(),
  ativo: z.enum(['true', 'false']).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(30),
});

// ---------- Serviço (mão de obra; menu Ofertas) ----------

/** Como o preço do serviço é formado: o valor da tabela é o do serviço inteiro ou o de uma hora. */
export const FORMAS_PRECO_SERVICO = { fechado: 'Preço fechado', hora: 'Valor-hora' } as const;
export type FormaPrecoServico = keyof typeof FORMAS_PRECO_SERVICO;

/** Inteiro opcional de formulário ou planilha: vazio = sem valor (null). */
const inteiroOpcional = (max: number, mensagem: string) =>
  z.preprocess(
    (v) => (v === '' || v == null ? null : Number(v)),
    z.number({ error: mensagem }).int(mensagem).min(0, mensagem).max(max, mensagem).nullable(),
  );

export const servicoInputSchema = z
  .object({
    nome: z.string({ error: 'Informe o nome' }).trim().min(2, 'Informe o nome').max(120, 'Máximo de 120 caracteres'),
    descricao: textoOpcional(500),
    formaPreco: z.enum(chaves(FORMAS_PRECO_SERVICO), 'Escolha a forma de preço').default('fechado'),
    /** Horas de trabalho de referência, em minutos. Aceita "1:30" (formulário e planilha) ou o número de minutos. */
    tempoMinutos: z.preprocess(
      (v) => (v === '' || v == null ? null : typeof v === 'string' ? horasParaMinutos(v) : v),
      z
        .number({ error: 'Use horas e minutos, ex.: 1:30' })
        .int('Use horas e minutos, ex.: 1:30')
        .min(1, 'As horas devem ser maiores que zero')
        .max(999 * 60 + 59, 'Máximo de 999:59')
        .nullable(),
    ),
    observacao: textoOpcional(1000),
    classificacaoId: z.preprocess(vazioComoNulo, z.uuid().nullable()),
    garantiaDias: inteiroOpcional(3650, 'Garantia em dias: inteiro de 0 a 3.650'),
    garantiaKm: inteiroOpcional(1_000_000, 'Garantia em km: inteiro de 0 a 1.000.000'),
    versao,
  })
  .refine((s) => s.formaPreco !== 'hora' || s.tempoMinutos != null, {
    message: 'No valor-hora, informe as horas de referência',
    path: ['tempoMinutos'],
  });
export type ServicoInput = z.input<typeof servicoInputSchema>;
export type ServicoDados = z.output<typeof servicoInputSchema>;

export const servicoResumoSchema = z.object({
  id: z.uuid(),
  /** Sequencial por oficina, imutável; exibido com 6 dígitos (formatarCodigoServico). */
  codigo: z.number().int(),
  nome: z.string(),
  formaPreco: z.enum(chaves(FORMAS_PRECO_SERVICO)),
  classificacaoNome: z.string().nullable(),
  ativo: z.boolean(),
});
export type ServicoResumo = z.infer<typeof servicoResumoSchema>;

export const servicoSchema = servicoResumoSchema.extend({
  descricao: z.string().nullable(),
  tempoMinutos: z.number().nullable(),
  observacao: z.string().nullable(),
  classificacaoId: z.uuid().nullable(),
  garantiaDias: z.number().nullable(),
  garantiaKm: z.number().nullable(),
  ...auditoria,
});
export type Servico = z.infer<typeof servicoSchema>;

export const servicoFiltroSchema = z.object({
  /** Código ou nome. */
  q: z.string().trim().optional(),
  classificacaoId: z.uuid().optional(),
  ativo: z.enum(['true', 'false']).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------- Depósito (só o cadastro mestre; saldo e movimentação ficam no módulo de estoque) ----------

export const depositoInputSchema = z.object({
  codigo: codigo('código', 20),
  nome: z.string({ error: 'Informe o nome' }).trim().min(2, 'Informe o nome').max(80, 'Máximo de 80 caracteres'),
  descricao: textoOpcional(500),
  tipoId: z.uuid('Escolha o tipo'),
  permiteVenda: z.boolean().default(true),
  permiteUsoOs: z.boolean().default(true),
  permiteTransferencia: z.boolean().default(true),
  versao,
});
export type DepositoInput = z.input<typeof depositoInputSchema>;

export const depositoSchema = z.object({
  id: z.uuid(),
  codigo: z.string(),
  nome: z.string(),
  descricao: z.string().nullable(),
  tipoId: z.uuid(),
  tipoNome: z.string(),
  permiteVenda: z.boolean(),
  permiteUsoOs: z.boolean(),
  permiteTransferencia: z.boolean(),
  ativo: z.boolean(),
  ...auditoria,
});
export type Deposito = z.infer<typeof depositoSchema>;

// ---------- Tabela de preço ----------

/** Por enquanto só real; o campo existe para outras moedas no futuro (ISO 4217). */
export const MOEDAS = { BRL: 'Real (R$)' } as const;

export const tabelaPrecoInputSchema = z.object({
  codigo: codigo('código', 20),
  nome: z.string({ error: 'Informe o nome' }).trim().min(2, 'Informe o nome').max(80, 'Máximo de 80 caracteres'),
  descricao: textoOpcional(500),
  moeda: z.enum(chaves(MOEDAS), 'Moeda não suportada').default('BRL'),
  versao,
});
export type TabelaPrecoInput = z.input<typeof tabelaPrecoInputSchema>;

export const tabelaPrecoSchema = z.object({
  id: z.uuid(),
  codigo: z.string(),
  nome: z.string(),
  descricao: z.string().nullable(),
  moeda: z.enum(chaves(MOEDAS)),
  ativa: z.boolean(),
  /** Materiais com preço hoje nesta tabela (vigência ou preço padrão). */
  materiaisComPreco: z.number(),
  ...auditoria,
});
export type TabelaPreco = z.infer<typeof tabelaPrecoSchema>;

// ---------- Preço por material (vigências) ----------

/** Maior valor aceito: R$ 99.999.999,99 (em centavos). */
export const PRECO_MAXIMO = 9_999_999_999;
const dataIso = (msg: string) => z.iso.date(msg);
const dataFimOpcional = z.preprocess(vazioComoNulo, dataIso('Data inválida').nullable());

const centavos = z
  .number({ error: 'Informe o preço' })
  .int('Informe o preço em centavos')
  .min(0, 'O preço não pode ser negativo')
  .max(PRECO_MAXIMO, 'Preço alto demais');

const vigenciaValida = <T extends { dataInicio: string; dataFim: string | null }>(v: T, ctx: z.RefinementCtx) => {
  if (v.dataFim && v.dataFim < v.dataInicio)
    ctx.addIssue({ code: 'custom', path: ['dataFim'], message: 'O fim deve ser igual ou posterior ao início' });
};

/**
 * Nova vigência. Regras (aplicadas na API, dentro de uma trava por material + tabela):
 * - começa hoje ou depois (o passado não é reescrito);
 * - a vigência que estiver valendo na data de início é encerrada no dia anterior;
 * - fim vazio = vigência aberta; se houver preço futuro depois, a nova termina na véspera dele.
 */
/**
 * Item do preço: um material (pelo id ou pelo SKU digitado) ou um serviço (pelo id ou pelo código digitado).
 * Exatamente um dos dois.
 */
const itemDoPreco = {
  materialId: z.uuid('Informe o material').optional(),
  sku: z.string().trim().toUpperCase().max(40, 'Máximo de 40 caracteres').optional(),
  servicoId: z.uuid('Informe o serviço').optional(),
  /** Código do serviço ("000012" ou 12). */
  servicoCodigo: z.coerce
    .number({ error: 'Código do serviço inválido' })
    .int('Código do serviço inválido')
    .positive('Código do serviço inválido')
    .optional(),
};
type ItemInformado = { materialId?: string; sku?: string; servicoId?: string; servicoCodigo?: number };
const umItem = (v: ItemInformado) =>
  Number(!!(v.materialId || v.sku)) + Number(!!(v.servicoId || v.servicoCodigo)) === 1;
const erroItem = { message: 'Informe o SKU do material ou o código do serviço (só um dos dois)', path: ['sku'] };

export const TIPOS_ITEM_PRECO = { material: 'Material', servico: 'Serviço' } as const;
export type TipoItemPreco = keyof typeof TIPOS_ITEM_PRECO;

/** Consultas de preço de um item: `materialId` ou `servicoId` (só um). */
const itemConsultado = { materialId: z.uuid().optional(), servicoId: z.uuid().optional() };
const umItemConsultado = (q: { materialId?: string; servicoId?: string }) => !!q.materialId !== !!q.servicoId;
const erroItemConsultado = { message: 'Informe materialId ou servicoId', path: ['materialId'] };

/** Vigências ou preços padrão de um item (todas as tabelas ou uma). */
export const itemPrecoQuerySchema = z
  .object({ ...itemConsultado, tabelaPrecoId: z.uuid().optional() })
  .refine(umItemConsultado, erroItemConsultado);
/** Preço padrão de um item numa tabela (remover, trilha). */
export const itemTabelaQuerySchema = z
  .object({ ...itemConsultado, tabelaPrecoId: z.uuid() })
  .refine(umItemConsultado, erroItemConsultado);

export const precoInputSchema = z
  .object({
    ...itemDoPreco,
    tabelaPrecoId: z.uuid('Escolha a tabela de preço'),
    precoCentavos: centavos,
    dataInicio: dataIso('Informe o início da vigência'),
    dataFim: dataFimOpcional,
  })
  .refine(umItem, erroItem)
  .superRefine(vigenciaValida);
export type PrecoInput = z.input<typeof precoInputSchema>;

/**
 * Edição só de preço futuro (ainda não começou): valor e fim. Para mudar o início, cancele e cadastre de novo
 * (assim o encerramento automático da vigência anterior continua coerente).
 */
export const precoAtualizarSchema = z.object({ precoCentavos: centavos, dataFim: dataFimOpcional });

export const precoEncerrarSchema = z.object({ dataFim: dataIso('Informe a data de encerramento') });
export const precoCancelarSchema = z.object({
  motivo: z
    .string({ error: 'Informe o motivo' })
    .trim()
    .min(3, 'Informe o motivo')
    .max(200, 'Máximo de 200 caracteres'),
});

export const SITUACOES_PRECO = {
  futuro: 'Futuro',
  vigente: 'Vigente',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
} as const;
export type SituacaoPreco = keyof typeof SITUACOES_PRECO;

/** Situação de uma vigência numa data (padrão: hoje). O fim é inclusivo; fim vazio = aberta. */
export function situacaoPreco(
  p: { dataInicio: string; dataFim: string | null; cancelado: boolean },
  data = hojeIso(),
): SituacaoPreco {
  if (p.cancelado) return 'cancelado';
  if (p.dataInicio > data) return 'futuro';
  if (p.dataFim && p.dataFim < data) return 'encerrado';
  return 'vigente';
}

export const precoSchema = z.object({
  id: z.uuid(),
  /** Um dos dois: a vigência é de um material ou de um serviço. */
  materialId: z.uuid().nullable(),
  servicoId: z.uuid().nullable(),
  tabelaPrecoId: z.uuid(),
  tabelaCodigo: z.string(),
  tabelaNome: z.string(),
  moeda: z.string(),
  precoCentavos: z.number(),
  dataInicio: z.string(),
  dataFim: z.string().nullable(),
  situacao: z.enum(chaves(SITUACOES_PRECO)),
  motivoCancelamento: z.string().nullable(),
  criadoEm: z.coerce.date(),
  criadoPor: z.string().nullable(),
  canceladoEm: z.coerce.date().nullable(),
  canceladoPor: z.string().nullable(),
});
export type Preco = z.infer<typeof precoSchema>;

// ---------- Preço padrão (sem vigência) ----------

/**
 * Preço padrão de um material numa tabela: vale quando nenhuma vigência cobre a data.
 * Um por material + tabela; alterar ou remover fica registrado na trilha. `versao` só na edição pela tela.
 */
export const precoPadraoInputSchema = z
  .object({
    ...itemDoPreco,
    tabelaPrecoId: z.uuid('Escolha a tabela de preço'),
    precoCentavos: centavos,
    versao: z.number().int().optional(),
  })
  .refine(umItem, erroItem);
export type PrecoPadraoInput = z.input<typeof precoPadraoInputSchema>;

export const precoPadraoSchema = z.object({
  materialId: z.uuid().nullable(),
  servicoId: z.uuid().nullable(),
  tabelaPrecoId: z.uuid(),
  tabelaCodigo: z.string(),
  tabelaNome: z.string(),
  precoCentavos: z.number(),
  atualizadoEm: z.coerce.date(),
  atualizadoPor: z.string().nullable(),
  versao: z.number(),
});
export type PrecoPadrao = z.infer<typeof precoPadraoSchema>;

export const EVENTOS_PRECO_PADRAO = { definido: 'Definido', alterado: 'Alterado', removido: 'Removido' } as const;

export const eventoPrecoPadraoSchema = z.object({
  evento: z.enum(chaves(EVENTOS_PRECO_PADRAO)),
  precoAntes: z.number().nullable(),
  precoDepois: z.number().nullable(),
  usuario: z.string().nullable(),
  criadoEm: z.coerce.date(),
});
export type EventoPrecoPadrao = z.infer<typeof eventoPrecoPadraoSchema>;

// ---------- Linhas de Preço (Política Comercial) ----------

/** Situação de uma linha de preço: a situação da vigência, ou "padrao" para o preço sem vigência. */
export const SITUACOES_LINHA_PRECO = { ...SITUACOES_PRECO, padrao: 'Padrão' } as const;

/** Filtro de situação das Linhas de Preço; o padrão mostra o que vale hoje e o que vem depois. */
export const FILTROS_LINHAS_PRECO = {
  atuais: 'Vigentes, futuras e padrão',
  vigente: 'Vigentes',
  futuro: 'Futuras',
  encerrado: 'Encerradas',
  cancelado: 'Canceladas',
  padrao: 'Padrão (sem vigência)',
  todas: 'Todas',
} as const;

export const linhasPrecoQuerySchema = z.object({
  tabelaPrecoId: z.uuid('Escolha a tabela de preço'),
  q: z.string().trim().optional(),
  /** Vazio = materiais e serviços. */
  tipo: z.union([z.literal(''), z.enum(chaves(TIPOS_ITEM_PRECO))]).optional(),
  situacao: z.enum(chaves(FILTROS_LINHAS_PRECO)).default('atuais'),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});

/** Uma linha de preço de uma tabela: cada vigência do item é uma linha; o preço padrão é outra. */
export const linhaPrecoSchema = z.object({
  /** Id da vigência, ou "padrao:<id do item>" na linha do preço padrão. */
  id: z.string(),
  tipo: z.enum(chaves(TIPOS_ITEM_PRECO)),
  /** Id do material ou do serviço. */
  itemId: z.uuid(),
  /** SKU do material ou código do serviço com 6 dígitos. */
  codigo: z.string(),
  /** Descrição do material ou nome do serviço. */
  descricao: z.string(),
  /** Só serviço: no valor-hora, o preço é o de uma hora. */
  formaPreco: z.enum(chaves(FORMAS_PRECO_SERVICO)).nullable(),
  precoCentavos: z.number(),
  /** Vazios no preço padrão. */
  dataInicio: z.string().nullable(),
  dataFim: z.string().nullable(),
  situacao: z.enum(chaves(SITUACOES_LINHA_PRECO)),
});
export type LinhaPreco = z.infer<typeof linhaPrecoSchema>;

/** De onde vem o preço de um dia: uma vigência que cobre a data ou, na falta dela, o preço padrão. */
export const ORIGENS_PRECO = { vigencia: 'Vigência', padrao: 'Padrão' } as const;
export type OrigemPreco = keyof typeof ORIGENS_PRECO;

/** Pergunta: qual o preço do material X na tabela Y na data Z? (por id ou pelos códigos de negócio). */
export const precoVigenteQuerySchema = z
  .object({
    materialId: z.uuid().optional(),
    sku: z.string().trim().toUpperCase().optional(),
    tabelaPrecoId: z.uuid().optional(),
    tabela: z.string().trim().toUpperCase().optional(),
    data: z.iso.date('Data inválida').optional(),
  })
  .refine((q) => q.materialId || q.sku, { message: 'Informe materialId ou sku', path: ['sku'] })
  .refine((q) => q.tabelaPrecoId || q.tabela, {
    message: 'Informe tabelaPrecoId ou tabela (código)',
    path: ['tabela'],
  });

export const precoVigenteSchema = z.object({
  data: z.string(),
  material: z.object({ id: z.uuid(), sku: z.string(), descricao: z.string(), ativo: z.boolean() }),
  tabela: z.object({ id: z.uuid(), codigo: z.string(), nome: z.string(), ativa: z.boolean() }),
  /** Vigência que cobre a data; null = nenhuma. */
  preco: precoSchema.nullable(),
  /** Preço que vale na data: o da vigência ou, sem vigência, o padrão; null = material sem preço nessa tabela. */
  valorCentavos: z.number().nullable(),
  origem: z.enum(chaves(ORIGENS_PRECO)).nullable(),
});
export type PrecoVigente = z.infer<typeof precoVigenteSchema>;
