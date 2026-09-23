import { z } from 'zod';
import { cestValido, gtinValido, ncmValido, somenteDigitos } from './documentos.js';
import { hojeIso } from './formatos.js';

/*
 * Módulo Materiais e Preços (docs/modulos/MATERIAIS_E_PRECOS.md).
 * Escopo: material, categoria, marca, depósito, tabela de preço e preço por vigência.
 * Estoque, compras, vendas e O.S. usarão estes cadastros, mas não estão aqui.
 */

const chaves = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
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

export const materialInputSchema = z.object({
  sku: codigo('SKU', 40),
  codigoBarras: z
    .preprocess(vazioComoNulo, z.string().trim().nullable())
    .refine((v) => !v || gtinValido(v), 'Código de barras inválido (EAN/GTIN de 8, 12, 13 ou 14 dígitos)'),
  descricao: z.string({ error: 'Informe a descrição' }).trim().min(3, 'Informe a descrição').max(120, 'Máximo de 120 caracteres'),
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
  /** Materiais com preço vigente hoje nesta tabela. */
  materiaisComPreco: z.number(),
  ...auditoria,
});
export type TabelaPreco = z.infer<typeof tabelaPrecoSchema>;

// ---------- Preço por material (vigências) ----------

/** Maior valor aceito: R$ 99.999.999,99 (em centavos). */
const PRECO_MAXIMO = 9_999_999_999;
const dataIso = (msg: string) => z.iso.date(msg);
const dataFimOpcional = z.preprocess(vazioComoNulo, dataIso('Data inválida').nullable());

const centavos = z.number({ error: 'Informe o preço' }).int('Informe o preço em centavos').min(0, 'O preço não pode ser negativo').max(PRECO_MAXIMO, 'Preço alto demais');

const vigenciaValida = <T extends { dataInicio: string; dataFim: string | null }>(v: T, ctx: z.RefinementCtx) => {
  if (v.dataFim && v.dataFim < v.dataInicio) ctx.addIssue({ code: 'custom', path: ['dataFim'], message: 'O fim deve ser igual ou posterior ao início' });
};

/**
 * Nova vigência. Regras (aplicadas na API, dentro de uma trava por material + tabela):
 * - começa hoje ou depois (o passado não é reescrito);
 * - a vigência que estiver valendo na data de início é encerrada no dia anterior;
 * - fim vazio = vigência aberta; se houver preço futuro depois, a nova termina na véspera dele.
 */
export const precoInputSchema = z
  .object({
    materialId: z.uuid('Informe o material'),
    tabelaPrecoId: z.uuid('Escolha a tabela de preço'),
    precoCentavos: centavos,
    dataInicio: dataIso('Informe o início da vigência'),
    dataFim: dataFimOpcional,
  })
  .superRefine(vigenciaValida);
export type PrecoInput = z.input<typeof precoInputSchema>;

/**
 * Edição só de preço futuro (ainda não começou): valor e fim. Para mudar o início, cancele e cadastre de novo
 * (assim o encerramento automático da vigência anterior continua coerente).
 */
export const precoAtualizarSchema = z.object({ precoCentavos: centavos, dataFim: dataFimOpcional });

export const precoEncerrarSchema = z.object({ dataFim: dataIso('Informe a data de encerramento') });
export const precoCancelarSchema = z.object({ motivo: z.string({ error: 'Informe o motivo' }).trim().min(3, 'Informe o motivo').max(200, 'Máximo de 200 caracteres') });

export const SITUACOES_PRECO = { futuro: 'Futuro', vigente: 'Vigente', encerrado: 'Encerrado', cancelado: 'Cancelado' } as const;
export type SituacaoPreco = keyof typeof SITUACOES_PRECO;

/** Situação de uma vigência numa data (padrão: hoje). O fim é inclusivo; fim vazio = aberta. */
export function situacaoPreco(p: { dataInicio: string; dataFim: string | null; cancelado: boolean }, data = hojeIso()): SituacaoPreco {
  if (p.cancelado) return 'cancelado';
  if (p.dataInicio > data) return 'futuro';
  if (p.dataFim && p.dataFim < data) return 'encerrado';
  return 'vigente';
}

export const precoSchema = z.object({
  id: z.uuid(),
  materialId: z.uuid(),
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
  .refine((q) => q.tabelaPrecoId || q.tabela, { message: 'Informe tabelaPrecoId ou tabela (código)', path: ['tabela'] });

export const precoVigenteSchema = z.object({
  data: z.string(),
  material: z.object({ id: z.uuid(), sku: z.string(), descricao: z.string(), ativo: z.boolean() }),
  tabela: z.object({ id: z.uuid(), codigo: z.string(), nome: z.string(), ativa: z.boolean() }),
  /** null = não existe preço vigente nessa data. */
  preco: precoSchema.nullable(),
});
export type PrecoVigente = z.infer<typeof precoVigenteSchema>;
