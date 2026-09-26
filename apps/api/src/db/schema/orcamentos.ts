import { sql } from 'drizzle-orm';
import {
  type EventoOrcamento,
  EVENTOS_ORCAMENTO,
  STATUS_ORCAMENTO,
  type TipoItemPreco,
  TIPOS_ITEM_PRECO,
} from '@mobios/shared';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { codigoAutomatico, isolamentoPorTenant, quantidade, tenantId, timestamps } from './comum.js';
import { clientes, veiculos } from './clientes.js';
import { formaPrecoServico, materiais, servicos, tabelasPreco } from './materiais.js';
import { autoria, fksAutoria, users } from './oficina.js';
import { vendedores } from './vendedores.js';

// ---------- Orçamentos (docs/modulos/ORCAMENTOS.md) ----------

export const statusOrcamento = pgEnum('status_orcamento', STATUS_ORCAMENTO);
export const tipoItemOrcamento = pgEnum(
  'tipo_item_orcamento',
  Object.keys(TIPOS_ITEM_PRECO) as [TipoItemPreco, ...TipoItemPreco[]],
);
export const eventoOrcamento = pgEnum(
  'evento_orcamento',
  Object.keys(EVENTOS_ORCAMENTO) as [EventoOrcamento, ...EventoOrcamento[]],
);

/**
 * Orçamento. `numero` é sequencial por oficina (contador "orcamentos", gerado pelo banco na 1ª versão); cada
 * nova versão é outro registro com o mesmo número, `versao_orcamento` + 1 e `orcamento_origem_id` apontando a
 * anterior, que é cancelada na mesma transação (índice orcamentos_uma_versao_viva). "Vencido" não é gravado:
 * emitido/enviado vence sozinho pela validade (ver situacaoOrcamento). `versao` é a da concorrência otimista.
 */
export const orcamentos = pgTable(
  'orcamentos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    numero: codigoAutomatico('orcamentos'),
    versaoOrcamento: integer().notNull().default(1),
    orcamentoOrigemId: uuid(),
    status: statusOrcamento().notNull().default('rascunho'),
    clienteId: uuid().notNull(),
    veiculoId: uuid(),
    vendedorId: uuid().notNull(),
    tabelaPrecoId: uuid().notNull(),
    validadeAte: date(),
    /** Dia (Brasília) em que os preços dos itens foram calculados. */
    precosEm: date().notNull(),
    observacoes: text(),
    subtotalCentavos: bigint({ mode: 'number' }).notNull().default(0),
    descontoCentavos: bigint({ mode: 'number' }).notNull().default(0),
    totalCentavos: bigint({ mode: 'number' }).notNull().default(0),
    emitidoEm: timestamp({ withTimezone: true }),
    emitidoPor: uuid(),
    enviadoEm: timestamp({ withTimezone: true }),
    enviadoPor: uuid(),
    aprovadoEm: timestamp({ withTimezone: true }),
    aprovadoPor: uuid(),
    recusadoEm: timestamp({ withTimezone: true }),
    recusadoPor: uuid(),
    motivoRecusa: text(),
    canceladoEm: timestamp({ withTimezone: true }),
    canceladoPor: uuid(),
    motivoCancelamento: text(),
    ...autoria,
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    uniqueIndex('orcamentos_numero_versao_unico').on(t.tenantId, t.numero, t.versaoOrcamento),
    // Só uma versão de cada número fica "viva": gerar a nova cancela a anterior.
    uniqueIndex('orcamentos_uma_versao_viva')
      .on(t.tenantId, t.numero)
      .where(sql`${t.status} <> 'cancelado'`),
    foreignKey({ columns: [t.tenantId, t.orcamentoOrigemId], foreignColumns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.clienteId], foreignColumns: [clientes.tenantId, clientes.id] }),
    foreignKey({ columns: [t.tenantId, t.veiculoId], foreignColumns: [veiculos.tenantId, veiculos.id] }),
    foreignKey({ columns: [t.tenantId, t.vendedorId], foreignColumns: [vendedores.tenantId, vendedores.id] }),
    foreignKey({ columns: [t.tenantId, t.tabelaPrecoId], foreignColumns: [tabelasPreco.tenantId, tabelasPreco.id] }),
    ...[t.emitidoPor, t.enviadoPor, t.aprovadoPor, t.recusadoPor, t.canceladoPor].map((c) =>
      foreignKey({ columns: [t.tenantId, c], foreignColumns: [users.tenantId, users.id] }),
    ),
    ...fksAutoria(t),
    check('orcamentos_versao_positiva', sql`${t.versaoOrcamento} >= 1`),
    check('orcamentos_origem_da_versao', sql`(${t.versaoOrcamento} = 1) = (${t.orcamentoOrigemId} is null)`),
    check(
      'orcamentos_emitido_com_validade',
      sql`${t.status} in ('rascunho', 'cancelado', 'aguardando_aprovacao_comercial', 'reprovado_comercialmente')
        or ${t.validadeAte} is not null`,
    ),
    check(
      'orcamentos_totais',
      sql`${t.subtotalCentavos} >= 0 and ${t.descontoCentavos} >= 0 and ${t.totalCentavos} >= 0
        and ${t.totalCentavos} = ${t.subtotalCentavos} - ${t.descontoCentavos}`,
    ),
    // Lista de orçamentos: a mesma ordenação da tela (criado_em, número), para ler só a página pedida. NULLS FIRST
    // é o padrão do ORDER BY ... DESC; com NULLS LAST o Postgres não usa o índice e ordena a oficina inteira.
    index('orcamentos_lista').on(t.tenantId, t.criadoEm.desc().nullsFirst(), t.numero.desc().nullsFirst()),
    index().on(t.tenantId, t.status, t.validadeAte),
    index().on(t.clienteId),
    index().on(t.veiculoId),
    index().on(t.vendedorId),
    index().on(t.tabelaPrecoId),
    index().on(t.orcamentoOrigemId),
    isolamentoPorTenant('orcamentos'),
  ],
);

/**
 * Item do orçamento: material OU serviço, com código, descrição, unidade e preços guardados (snapshot) — mudar o
 * cadastro ou a tabela depois não altera o orçamento. Quantidade (material e preço fechado) ou tempo (valor-hora).
 * Preço negociado nunca acima do de tabela; serviço não tem negociação.
 */
export const orcamentoItens = pgTable(
  'orcamento_itens',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    orcamentoId: uuid().notNull(),
    ordem: integer().notNull(),
    tipo: tipoItemOrcamento().notNull(),
    materialId: uuid(),
    servicoId: uuid(),
    codigo: text().notNull(),
    descricao: text().notNull(),
    unidade: text().notNull(),
    formaPreco: formaPrecoServico(),
    multiplo: integer().notNull(),
    fracionada: boolean().notNull().default(false),
    quantidade: quantidade(),
    tempoMinutos: integer(),
    precoTabelaCentavos: bigint({ mode: 'number' }).notNull(),
    precoUnitarioCentavos: bigint({ mode: 'number' }).notNull(),
    /** Percentual digitado (centésimos: 7,5% = 750); null quando o preço foi digitado ou não há desconto. */
    descontoPercentual: integer(),
    /**
     * PMC do material congelado no item (ao incluir; atualizado com o preço no recálculo do rascunho e na troca de
     * tabela). Base da margem da aprovação; nunca vai nas respostas do orçamento. Serviço: null.
     */
    pmcCentavos: bigint({ mode: 'number' }),
    brutoCentavos: bigint({ mode: 'number' }).notNull(),
    descontoCentavos: bigint({ mode: 'number' }).notNull(),
    totalCentavos: bigint({ mode: 'number' }).notNull(),
  },
  (t) => [
    // Alvo da FK composta do item da O.S. que veio deste item (conversão).
    unique().on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.orcamentoId], foreignColumns: [orcamentos.tenantId, orcamentos.id] }).onDelete(
      'cascade',
    ),
    foreignKey({ columns: [t.tenantId, t.materialId], foreignColumns: [materiais.tenantId, materiais.id] }),
    foreignKey({ columns: [t.tenantId, t.servicoId], foreignColumns: [servicos.tenantId, servicos.id] }),
    uniqueIndex('orcamento_itens_ordem_unica').on(t.orcamentoId, t.ordem),
    check(
      'orcamento_itens_um_item',
      sql`(${t.tipo} = 'material' and ${t.materialId} is not null and ${t.servicoId} is null)
        or (${t.tipo} = 'servico' and ${t.servicoId} is not null and ${t.materialId} is null)`,
    ),
    check(
      'orcamento_itens_quantidade',
      sql`case when ${t.formaPreco} = 'hora' then ${t.tempoMinutos} > 0 and ${t.quantidade} is null
        else ${t.quantidade} > 0 and ${t.tempoMinutos} is null end`,
    ),
    check('orcamento_itens_multiplo_positivo', sql`${t.multiplo} > 0`),
    check(
      'orcamento_itens_preco_negociado',
      sql`${t.precoUnitarioCentavos} >= 0 and ${t.precoUnitarioCentavos} <= ${t.precoTabelaCentavos}`,
    ),
    check(
      'orcamento_itens_servico_sem_negociacao',
      sql`${t.tipo} = 'material' or ${t.precoUnitarioCentavos} = ${t.precoTabelaCentavos}`,
    ),
    check('orcamento_itens_pmc', sql`${t.pmcCentavos} is null or (${t.tipo} = 'material' and ${t.pmcCentavos} >= 0)`),
    check(
      'orcamento_itens_percentual',
      sql`${t.descontoPercentual} is null or ${t.descontoPercentual} between 0 and 10000`,
    ),
    check(
      'orcamento_itens_totais',
      sql`${t.brutoCentavos} >= 0 and ${t.descontoCentavos} >= 0
        and ${t.totalCentavos} = ${t.brutoCentavos} - ${t.descontoCentavos}`,
    ),
    index().on(t.materialId),
    index().on(t.servicoId),
    isolamentoPorTenant('orcamento_itens'),
  ],
);

/** Histórico do orçamento (só inclusão): o que aconteceu, detalhe legível, quem e quando. */
export const orcamentosEventos = pgTable(
  'orcamentos_eventos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    orcamentoId: uuid().notNull(),
    evento: eventoOrcamento().notNull(),
    detalhe: text(),
    usuarioId: uuid(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.orcamentoId], foreignColumns: [orcamentos.tenantId, orcamentos.id] }),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }),
    index().on(t.orcamentoId, t.criadoEm),
    isolamentoPorTenant('orcamentos_eventos'),
  ],
);
