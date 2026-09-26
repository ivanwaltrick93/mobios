import { sql } from 'drizzle-orm';
import { type FormaPrecoServico, FORMAS_PRECO_SERVICO, type Unidade, UNIDADES } from '@mobios/shared';
import {
  bigint,
  boolean,
  check,
  char,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { codigoAutomatico, isolamentoPorTenant, listaDeOpcoes, tenantId, timestamps } from './comum.js';
import { autoria, fksAutoria, users } from './oficina.js';

// ---------- Materiais e preços (docs/modulos/MATERIAIS_E_PRECOS.md) ----------
// Só cadastros mestres. Saldo, reserva e movimentação de estoque ficam para o módulo de estoque,
// que vai referenciar materiais e depósitos pelas chaves (tenant_id, id).

export const unidadeMedida = pgEnum('unidade_medida', Object.keys(UNIDADES) as [Unidade, ...Unidade[]]);
export const eventoPreco = pgEnum('evento_preco', ['criado', 'alterado', 'encerrado', 'cancelado', 'reaberto']);

/** Tipos editáveis por oficina (Configurações → Tipos de material / de depósito), como as listas de clientes. */
export const tiposMaterial = listaDeOpcoes('tipos_material');
export const tiposDeposito = listaDeOpcoes('tipos_deposito');
export const classificacoesServico = listaDeOpcoes('classificacoes_servico');

/**
 * Categoria hierárquica (Peças › Motor › Filtros). O nome é único entre irmãs; o código, na oficina.
 * Ciclos são barrados por trigger (categorias_sem_ciclo, na migração 0012), inclusive com alterações simultâneas.
 */
export const categorias = pgTable(
  'categorias',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    codigo: text(),
    nome: text().notNull(),
    descricao: text(),
    categoriaPaiId: uuid(),
    ativa: boolean().notNull().default(true),
    ...autoria,
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.categoriaPaiId], foreignColumns: [t.tenantId, t.id] }),
    check('categorias_pai_diferente', sql`${t.categoriaPaiId} <> ${t.id}`),
    uniqueIndex('categorias_codigo_unico')
      .on(t.tenantId, t.codigo)
      .where(sql`${t.codigo} is not null`),
    uniqueIndex('categorias_nome_unico').on(
      t.tenantId,
      sql`coalesce(${t.categoriaPaiId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${t.nome})`,
    ),
    index().on(t.categoriaPaiId),
    ...fksAutoria(t),
    isolamentoPorTenant('categorias'),
  ],
);

export const marcas = pgTable(
  'marcas',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    codigo: text(),
    nome: text().notNull(),
    descricao: text(),
    ativa: boolean().notNull().default(true),
    ...autoria,
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    uniqueIndex('marcas_codigo_unico')
      .on(t.tenantId, t.codigo)
      .where(sql`${t.codigo} is not null`),
    uniqueIndex('marcas_nome_unico').on(t.tenantId, sql`lower(${t.nome})`),
    ...fksAutoria(t),
    isolamentoPorTenant('marcas'),
  ],
);

/**
 * Material/produto. PK técnica (id); o SKU é a chave de negócio (única na oficina, gravada em maiúsculas).
 * Subcategoria não é coluna: é a própria categoria na hierarquia.
 */
export const materiais = pgTable(
  'materiais',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    sku: text().notNull(),
    codigoBarras: text(),
    descricao: text().notNull(),
    descricaoCurta: text(),
    tipoId: uuid().notNull(),
    categoriaId: uuid().notNull(),
    marcaId: uuid(),
    unidade: unidadeMedida().notNull(),
    codigoFabricante: text(),
    ncm: char({ length: 8 }),
    cest: char({ length: 7 }),
    origem: smallint(),
    controlaEstoque: boolean().notNull().default(true),
    permiteVenda: boolean().notNull().default(true),
    permiteCompra: boolean().notNull().default(true),
    permiteUsoOs: boolean().notNull().default(true),
    controlaLote: boolean().notNull().default(false),
    controlaSerie: boolean().notNull().default(false),
    /** Vende-se só em múltiplos desta quantidade (caixa master); 1 = unitário. */
    multiplo: integer().notNull().default(1),
    /** Tempo de ressuprimento, em dias corridos. */
    leadtimeDias: integer().notNull().default(30),
    /**
     * PMC (preço médio de compra), em centavos: custo de compra, base da margem da aprovação comercial. null = não
     * disponível. Interno (módulo "Custos e margem"); mudanças em materiais_pmc_eventos.
     */
    pmcCentavos: bigint({ mode: 'number' }),
    ativo: boolean().notNull().default(true),
    ...autoria,
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    uniqueIndex('materiais_sku_unico').on(t.tenantId, t.sku),
    uniqueIndex('materiais_codigo_barras_unico')
      .on(t.tenantId, t.codigoBarras)
      .where(sql`${t.codigoBarras} is not null`),
    foreignKey({ columns: [t.tenantId, t.tipoId], foreignColumns: [tiposMaterial.tenantId, tiposMaterial.id] }),
    foreignKey({ columns: [t.tenantId, t.categoriaId], foreignColumns: [categorias.tenantId, categorias.id] }),
    foreignKey({ columns: [t.tenantId, t.marcaId], foreignColumns: [marcas.tenantId, marcas.id] }),
    check('materiais_origem_valida', sql`${t.origem} between 0 and 8`),
    check('materiais_pmc_positivo', sql`${t.pmcCentavos} is null or ${t.pmcCentavos} >= 0`),
    check('materiais_sku_maiusculo', sql`${t.sku} = upper(${t.sku})`),
    check('materiais_multiplo_positivo', sql`${t.multiplo} > 0`),
    check('materiais_leadtime_positivo', sql`${t.leadtimeDias} >= 0`),
    index().on(t.tenantId, t.categoriaId),
    index().on(t.tenantId, t.marcaId),
    index().on(t.tenantId, t.tipoId),
    index().on(t.tenantId, t.ativo, t.descricao),
    index().on(t.tenantId, t.codigoFabricante),
    ...fksAutoria(t),
    isolamentoPorTenant('materiais'),
  ],
);

/** Histórico do PMC do material (só inclusão; o banco impede alterar e apagar): antes, depois, quem e quando. */
export const materiaisPmcEventos = pgTable(
  'materiais_pmc_eventos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    materialId: uuid().notNull(),
    antesCentavos: bigint({ mode: 'number' }),
    depoisCentavos: bigint({ mode: 'number' }),
    usuarioId: uuid(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.materialId], foreignColumns: [materiais.tenantId, materiais.id] }),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }),
    index().on(t.materialId, t.criadoEm.desc()),
    isolamentoPorTenant('materiais_pmc_eventos'),
  ],
);

export const formaPrecoServico = pgEnum(
  'forma_preco_servico',
  Object.keys(FORMAS_PRECO_SERVICO) as [FormaPrecoServico, ...FormaPrecoServico[]],
);

/**
 * Serviço (mão de obra), vendido como o material: preço nas mesmas tabelas de preço (vigências e padrão).
 * `forma_preco`: o preço da tabela é o do serviço (fechado) ou o de uma hora (hora × tempo de referência).
 * Código sequencial por oficina, imutável (exibido com 6 dígitos). O nome pode repetir: quem identifica é o código.
 */
export const servicos = pgTable(
  'servicos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    codigo: codigoAutomatico('servicos'),
    nome: text().notNull(),
    descricao: text(),
    formaPreco: formaPrecoServico().notNull().default('fechado'),
    /** Horas de trabalho de referência, em minutos. Obrigatório no valor-hora. */
    tempoMinutos: integer(),
    observacao: text(),
    classificacaoId: uuid(),
    garantiaDias: integer(),
    garantiaKm: integer(),
    ativo: boolean().notNull().default(true),
    ...autoria,
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    uniqueIndex('servicos_codigo_unico').on(t.tenantId, t.codigo),
    foreignKey({
      columns: [t.tenantId, t.classificacaoId],
      foreignColumns: [classificacoesServico.tenantId, classificacoesServico.id],
    }),
    check('servicos_tempo_positivo', sql`${t.tempoMinutos} is null or ${t.tempoMinutos} > 0`),
    check('servicos_valor_hora_com_tempo', sql`${t.formaPreco} <> 'hora' or ${t.tempoMinutos} is not null`),
    check('servicos_garantia_positiva', sql`coalesce(${t.garantiaDias}, 0) >= 0 and coalesce(${t.garantiaKm}, 0) >= 0`),
    index().on(t.tenantId, t.ativo, t.codigo),
    index().on(t.classificacaoId),
    ...fksAutoria(t),
    isolamentoPorTenant('servicos'),
  ],
);

/** Depósito: só o cadastro do local lógico. Saldo por depósito será de outro módulo. */
export const depositos = pgTable(
  'depositos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    codigo: text().notNull(),
    nome: text().notNull(),
    descricao: text(),
    tipoId: uuid().notNull(),
    permiteVenda: boolean().notNull().default(true),
    permiteUsoOs: boolean().notNull().default(true),
    permiteTransferencia: boolean().notNull().default(true),
    ativo: boolean().notNull().default(true),
    ...autoria,
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    uniqueIndex('depositos_codigo_unico').on(t.tenantId, t.codigo),
    uniqueIndex('depositos_nome_unico').on(t.tenantId, sql`lower(${t.nome})`),
    foreignKey({ columns: [t.tenantId, t.tipoId], foreignColumns: [tiposDeposito.tenantId, tiposDeposito.id] }),
    index().on(t.tipoId),
    ...fksAutoria(t),
    isolamentoPorTenant('depositos'),
  ],
);

export const tabelasPreco = pgTable(
  'tabelas_preco',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    codigo: text().notNull(),
    nome: text().notNull(),
    descricao: text(),
    moeda: char({ length: 3 }).notNull().default('BRL'),
    ativa: boolean().notNull().default(true),
    /** Tabela padrão da oficina (usada no orçamento quando nenhuma é escolhida): no máximo uma, sempre ativa. */
    padrao: boolean().notNull().default(false),
    ...autoria,
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    uniqueIndex('tabelas_preco_codigo_unico').on(t.tenantId, t.codigo),
    uniqueIndex('tabelas_preco_nome_unico').on(t.tenantId, sql`lower(${t.nome})`),
    uniqueIndex('tabelas_preco_padrao_unico')
      .on(t.tenantId)
      .where(sql`${t.padrao}`),
    check('tabelas_preco_padrao_ativa', sql`not ${t.padrao} or ${t.ativa}`),
    check('tabelas_preco_moeda_iso', sql`${t.moeda} ~ '^[A-Z]{3}$'`),
    ...fksAutoria(t),
    isolamentoPorTenant('tabelas_preco'),
  ],
);

/**
 * Preço de um material ou serviço numa tabela durante uma vigência [data_inicio, data_fim] (fim inclusivo; NULL =
 * aberta). O nome ficou da época em que só havia material. Nunca é apagado nem tem o valor alterado depois que
 * começa: o histórico é esta própria tabela. Sobreposição de vigências é barrada pelas constraints EXCLUDE
 * materiais_precos_sem_sobreposicao (0012, material) e materiais_precos_servico_sem_sobreposicao (0023, serviço).
 * `encerradoPeloPrecoId`/`dataFimAnterior`: se a vigência foi encerrada automaticamente por uma nova,
 * cancelar a nova devolve o fim anterior.
 */
export const materiaisPrecos = pgTable(
  'materiais_precos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    // Item do preço: material OU serviço (CHECK materiais_precos_um_item).
    materialId: uuid(),
    servicoId: uuid(),
    tabelaPrecoId: uuid().notNull(),
    precoCentavos: bigint({ mode: 'number' }).notNull(),
    dataInicio: date().notNull(),
    dataFim: date(),
    cancelado: boolean().notNull().default(false),
    motivoCancelamento: text(),
    canceladoEm: timestamp({ withTimezone: true }),
    canceladoPor: uuid(),
    encerradoPeloPrecoId: uuid(),
    dataFimAnterior: date(),
    criadoPor: uuid(),
    atualizadoPor: uuid(),
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.materialId], foreignColumns: [materiais.tenantId, materiais.id] }),
    foreignKey({ columns: [t.tenantId, t.servicoId], foreignColumns: [servicos.tenantId, servicos.id] }),
    foreignKey({ columns: [t.tenantId, t.tabelaPrecoId], foreignColumns: [tabelasPreco.tenantId, tabelasPreco.id] }),
    foreignKey({ columns: [t.tenantId, t.encerradoPeloPrecoId], foreignColumns: [t.tenantId, t.id] }),
    check('materiais_precos_um_item', sql`num_nonnulls(${t.materialId}, ${t.servicoId}) = 1`),
    foreignKey({ columns: [t.tenantId, t.canceladoPor], foreignColumns: [users.tenantId, users.id] }),
    ...fksAutoria(t),
    check('materiais_precos_valor_positivo', sql`${t.precoCentavos} >= 0`),
    check('materiais_precos_vigencia_valida', sql`${t.dataFim} is null or ${t.dataFim} >= ${t.dataInicio}`),
    check('materiais_precos_cancelamento', sql`not ${t.cancelado} or ${t.motivoCancelamento} is not null`),
    // Consulta do preço vigente: material + tabela, a partir da vigência mais recente.
    index('materiais_precos_consulta').on(t.materialId, t.tabelaPrecoId, t.dataInicio.desc()),
    index('materiais_precos_consulta_servico').on(t.servicoId, t.tabelaPrecoId, t.dataInicio.desc()),
    index().on(t.tabelaPrecoId),
    index().on(t.encerradoPeloPrecoId),
    isolamentoPorTenant('materiais_precos'),
  ],
);

/** Trilha de auditoria das vigências: o que mudou, quem e quando (antes/depois em JSON). */
export const precosEventos = pgTable(
  'precos_eventos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    precoId: uuid().notNull(),
    evento: eventoPreco().notNull(),
    antes: jsonb(),
    depois: jsonb(),
    usuarioId: uuid(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.precoId], foreignColumns: [materiaisPrecos.tenantId, materiaisPrecos.id] }),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }),
    index().on(t.precoId, t.criadoEm),
    isolamentoPorTenant('precos_eventos'),
  ],
);

/**
 * Preço padrão (sem vigência) de um material ou serviço numa tabela: vale nos dias em que nenhuma vigência cobre
 * a data. Um por item + tabela; pode mudar a qualquer momento, com a trilha em precos_padrao_eventos.
 */
export const precosPadrao = pgTable(
  'precos_padrao',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    // Material OU serviço (CHECK precos_padrao_um_item).
    materialId: uuid(),
    servicoId: uuid(),
    tabelaPrecoId: uuid().notNull(),
    precoCentavos: bigint({ mode: 'number' }).notNull(),
    ...autoria,
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.materialId], foreignColumns: [materiais.tenantId, materiais.id] }),
    foreignKey({ columns: [t.tenantId, t.servicoId], foreignColumns: [servicos.tenantId, servicos.id] }),
    foreignKey({ columns: [t.tenantId, t.tabelaPrecoId], foreignColumns: [tabelasPreco.tenantId, tabelasPreco.id] }),
    ...fksAutoria(t),
    check('precos_padrao_um_item', sql`num_nonnulls(${t.materialId}, ${t.servicoId}) = 1`),
    uniqueIndex('precos_padrao_unico').on(t.tenantId, t.materialId, t.tabelaPrecoId),
    uniqueIndex('precos_padrao_servico_unico')
      .on(t.tenantId, t.servicoId, t.tabelaPrecoId)
      .where(sql`${t.servicoId} is not null`),
    check('precos_padrao_valor_positivo', sql`${t.precoCentavos} >= 0`),
    index().on(t.tabelaPrecoId),
    isolamentoPorTenant('precos_padrao'),
  ],
);

/** Trilha do preço padrão: definido, alterado ou removido, com valor antes/depois, quem e quando. */
export const precosPadraoEventos = pgTable(
  'precos_padrao_eventos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    materialId: uuid(),
    servicoId: uuid(),
    tabelaPrecoId: uuid().notNull(),
    evento: text().notNull(),
    precoAntes: bigint({ mode: 'number' }),
    precoDepois: bigint({ mode: 'number' }),
    usuarioId: uuid(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.materialId], foreignColumns: [materiais.tenantId, materiais.id] }),
    foreignKey({ columns: [t.tenantId, t.tabelaPrecoId], foreignColumns: [tabelasPreco.tenantId, tabelasPreco.id] }),
    foreignKey({ columns: [t.tenantId, t.servicoId], foreignColumns: [servicos.tenantId, servicos.id] }),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }),
    check('precos_padrao_eventos_evento', sql`${t.evento} in ('definido', 'alterado', 'removido')`),
    check('precos_padrao_eventos_um_item', sql`num_nonnulls(${t.materialId}, ${t.servicoId}) = 1`),
    index().on(t.materialId, t.tabelaPrecoId, t.criadoEm),
    index().on(t.servicoId, t.tabelaPrecoId, t.criadoEm),
    index().on(t.tabelaPrecoId),
    isolamentoPorTenant('precos_padrao_eventos'),
  ],
);
