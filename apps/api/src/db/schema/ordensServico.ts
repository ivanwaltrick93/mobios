import { sql } from 'drizzle-orm';
import {
  APROVACOES_ITEM_OS,
  CATEGORIAS_FOTO_OS,
  ESTADOS_CHECKLIST,
  EVENTOS_OS,
  IMAGEM_TAMANHO_MAXIMO,
  NIVEIS_COMBUSTIVEL,
  STATUS_OS,
  STATUS_SOLICITACAO_PECA,
  type AprovacaoItemOs,
  type CategoriaFotoOs,
  type EstadoChecklist,
  type EventoOs,
  type NivelCombustivel,
  type StatusSolicitacaoPeca,
} from '@mobios/shared';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, codigoAutomatico, isolamentoPorTenant, quantidade, tenantId, timestamps } from './comum.js';
import { clientes, veiculos } from './clientes.js';
import { formaPrecoServico, materiais, servicos, tabelasPreco } from './materiais.js';
import { autoria, fksAutoria, users } from './oficina.js';
import { orcamentoItens, orcamentos, tipoItemOrcamento } from './orcamentos.js';
import { vendedores } from './vendedores.js';

// ---------- Ordens de Serviço (docs/modulos/ORDENS_SERVICO.md) ----------

export const statusOs = pgEnum('status_os', STATUS_OS);
export const eventoOs = pgEnum('evento_os', Object.keys(EVENTOS_OS) as [EventoOs, ...EventoOs[]]);
export const aprovacaoItemOs = pgEnum(
  'aprovacao_item_os',
  Object.keys(APROVACOES_ITEM_OS) as [AprovacaoItemOs, ...AprovacaoItemOs[]],
);
export const nivelCombustivel = pgEnum(
  'nivel_combustivel',
  Object.keys(NIVEIS_COMBUSTIVEL) as [NivelCombustivel, ...NivelCombustivel[]],
);
export const estadoChecklist = pgEnum(
  'estado_checklist',
  Object.keys(ESTADOS_CHECKLIST) as [EstadoChecklist, ...EstadoChecklist[]],
);
export const statusSolicitacaoPeca = pgEnum(
  'status_solicitacao_peca',
  Object.keys(STATUS_SOLICITACAO_PECA) as [StatusSolicitacaoPeca, ...StatusSolicitacaoPeca[]],
);
export const categoriaFotoOs = pgEnum(
  'categoria_foto_os',
  Object.keys(CATEGORIAS_FOTO_OS) as [CategoriaFotoOs, ...CategoriaFotoOs[]],
);

/**
 * O.S.: registro operacional durável da passagem do veículo pela oficina. `numero` é sequencial por oficina
 * (contador "ordens_servico", gerado pelo banco). `orcamento_id`: orçamento de origem da conversão, só como
 * referência (uma O.S. por orçamento, para sempre). `criado_em` é a abertura. `versao`: concorrência otimista.
 */
export const ordensServico = pgTable(
  'ordens_servico',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    numero: codigoAutomatico('ordens_servico'),
    status: statusOs().notNull().default('aberta'),
    clienteId: uuid().notNull(),
    veiculoId: uuid().notNull(),
    vendedorId: uuid(),
    orcamentoId: uuid(),
    tabelaPrecoId: uuid().notNull(),
    kmEntrada: integer().notNull(),
    relatoCliente: text(),
    observacoes: text(),
    previsaoEntrega: timestamp({ withTimezone: true }),
    aprovadaEm: timestamp({ withTimezone: true }),
    aprovadaPor: uuid(),
    recusadaEm: timestamp({ withTimezone: true }),
    recusadaPor: uuid(),
    motivoRecusa: text(),
    canceladaEm: timestamp({ withTimezone: true }),
    canceladaPor: uuid(),
    motivoCancelamento: text(),
    /** Recepção (onda 5.2): combustível, avarias na entrada e quando o checklist foi registrado. */
    combustivel: nivelCombustivel(),
    avariasEntrada: text(),
    checklistEm: timestamp({ withTimezone: true }),
    /** Diagnóstico técnico e observações do mecânico (OS-05). */
    diagnostico: text(),
    /** Conclusão (onda 5.3): todos os serviços aprovados executados. */
    concluidaEm: timestamp({ withTimezone: true }),
    concluidaPor: uuid(),
    /** Bruto dos serviços e dos produtos, desconto (só de produto do catálogo) e total. */
    subtotalServicosCentavos: bigint({ mode: 'number' }).notNull().default(0),
    subtotalMateriaisCentavos: bigint({ mode: 'number' }).notNull().default(0),
    descontoCentavos: bigint({ mode: 'number' }).notNull().default(0),
    totalCentavos: bigint({ mode: 'number' }).notNull().default(0),
    ...autoria,
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    uniqueIndex('ordens_servico_numero_unico').on(t.tenantId, t.numero),
    // Uma O.S. por orçamento, para sempre, mesmo cancelada (CV-06): refazer = orçamento novo.
    uniqueIndex('ordens_servico_um_orcamento')
      .on(t.tenantId, t.orcamentoId)
      .where(sql`${t.orcamentoId} is not null`),
    foreignKey({ columns: [t.tenantId, t.clienteId], foreignColumns: [clientes.tenantId, clientes.id] }),
    foreignKey({ columns: [t.tenantId, t.veiculoId], foreignColumns: [veiculos.tenantId, veiculos.id] }),
    foreignKey({ columns: [t.tenantId, t.vendedorId], foreignColumns: [vendedores.tenantId, vendedores.id] }),
    foreignKey({ columns: [t.tenantId, t.orcamentoId], foreignColumns: [orcamentos.tenantId, orcamentos.id] }),
    foreignKey({ columns: [t.tenantId, t.tabelaPrecoId], foreignColumns: [tabelasPreco.tenantId, tabelasPreco.id] }),
    ...[t.aprovadaPor, t.recusadaPor, t.canceladaPor, t.concluidaPor].map((c) =>
      foreignKey({ columns: [t.tenantId, c], foreignColumns: [users.tenantId, users.id] }),
    ),
    ...fksAutoria(t),
    check('ordens_servico_km_entrada', sql`${t.kmEntrada} >= 0`),
    check(
      'ordens_servico_totais',
      sql`${t.subtotalServicosCentavos} >= 0 and ${t.subtotalMateriaisCentavos} >= 0 and ${t.descontoCentavos} >= 0
        and ${t.totalCentavos} = ${t.subtotalServicosCentavos} + ${t.subtotalMateriaisCentavos} - ${t.descontoCentavos}`,
    ),
    check('ordens_servico_cancelamento', sql`${t.status} <> 'cancelada' or ${t.motivoCancelamento} is not null`),
    // Lista: a ordem da tela (abertura, número). NULLS FIRST: o padrão do ORDER BY ... DESC (DATABASE.md §2).
    index('ordens_servico_lista').on(t.tenantId, t.criadoEm.desc().nullsFirst(), t.numero.desc().nullsFirst()),
    index().on(t.tenantId, t.status),
    index().on(t.clienteId),
    index().on(t.veiculoId),
    index().on(t.vendedorId),
    index().on(t.tabelaPrecoId),
    isolamentoPorTenant('ordens_servico'),
  ],
);

/**
 * Item da O.S.: do catálogo (produto ou serviço, com retrato do cadastro e do preço, como no orçamento) ou avulso
 * (sem produto nem serviço: descrição e preço digitados, sem desconto). `aprovacao`: do cliente (total nesta versão).
 */
export const osItens = pgTable(
  'os_itens',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    ordemServicoId: uuid().notNull(),
    ordem: integer().notNull(),
    tipo: tipoItemOrcamento().notNull(),
    materialId: uuid(),
    servicoId: uuid(),
    avulso: boolean().notNull().default(false),
    /** Item do orçamento de origem (conversão). */
    orcamentoItemId: uuid(),
    /** SKU do produto ou código do serviço; null no avulso. */
    codigo: text(),
    descricao: text().notNull(),
    unidade: text().notNull(),
    formaPreco: formaPrecoServico(),
    multiplo: integer().notNull(),
    fracionada: boolean().notNull().default(false),
    quantidade: quantidade(),
    tempoMinutos: integer(),
    precoTabelaCentavos: bigint({ mode: 'number' }).notNull(),
    precoUnitarioCentavos: bigint({ mode: 'number' }).notNull(),
    descontoPercentual: integer(),
    /** PMC do produto do catálogo, congelado ao incluir (margem da aprovação comercial). Nunca vai na resposta. */
    pmcCentavos: bigint({ mode: 'number' }),
    brutoCentavos: bigint({ mode: 'number' }).notNull(),
    descontoCentavos: bigint({ mode: 'number' }).notNull(),
    totalCentavos: bigint({ mode: 'number' }).notNull(),
    aprovacao: aprovacaoItemOs().notNull().default('pendente'),
    /** Serviço confirmado como executado (OS-22): quem e quando. */
    executadoEm: timestamp({ withTimezone: true }),
    executadoPor: uuid(),
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.executadoPor], foreignColumns: [users.tenantId, users.id] }),
    check(
      'os_itens_execucao',
      sql`(${t.executadoEm} is null) = (${t.executadoPor} is null) and (${t.executadoEm} is null or ${t.tipo} = 'servico')`,
    ),
    index().on(t.executadoPor),
    foreignKey({
      columns: [t.tenantId, t.ordemServicoId],
      foreignColumns: [ordensServico.tenantId, ordensServico.id],
    }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.materialId], foreignColumns: [materiais.tenantId, materiais.id] }),
    foreignKey({ columns: [t.tenantId, t.servicoId], foreignColumns: [servicos.tenantId, servicos.id] }),
    foreignKey({
      columns: [t.tenantId, t.orcamentoItemId],
      foreignColumns: [orcamentoItens.tenantId, orcamentoItens.id],
    }),
    uniqueIndex('os_itens_ordem_unica').on(t.ordemServicoId, t.ordem),
    check(
      'os_itens_um_item',
      sql`case when ${t.avulso} then ${t.materialId} is null and ${t.servicoId} is null and ${t.codigo} is null
        when ${t.tipo} = 'material' then ${t.materialId} is not null and ${t.servicoId} is null and ${t.codigo} is not null
        else ${t.servicoId} is not null and ${t.materialId} is null and ${t.codigo} is not null end`,
    ),
    check(
      'os_itens_quantidade',
      sql`case when ${t.formaPreco} = 'hora' then ${t.tempoMinutos} > 0 and ${t.quantidade} is null
        else ${t.quantidade} > 0 and ${t.tempoMinutos} is null end`,
    ),
    check('os_itens_multiplo_positivo', sql`${t.multiplo} > 0`),
    check(
      'os_itens_preco_negociado',
      sql`${t.precoUnitarioCentavos} >= 0 and ${t.precoUnitarioCentavos} <= ${t.precoTabelaCentavos}`,
    ),
    // Negociação só em produto do catálogo: serviço e avulso têm o preço de tabela (ou digitado) como final.
    check(
      'os_itens_sem_negociacao',
      sql`(${t.tipo} = 'material' and not ${t.avulso})
        or (${t.precoUnitarioCentavos} = ${t.precoTabelaCentavos} and ${t.descontoPercentual} is null)`,
    ),
    check(
      'os_itens_pmc',
      sql`${t.pmcCentavos} is null or (${t.tipo} = 'material' and not ${t.avulso} and ${t.pmcCentavos} >= 0)`,
    ),
    check('os_itens_percentual', sql`${t.descontoPercentual} is null or ${t.descontoPercentual} between 0 and 10000`),
    check(
      'os_itens_totais',
      sql`${t.brutoCentavos} >= 0 and ${t.descontoCentavos} >= 0
        and ${t.totalCentavos} = ${t.brutoCentavos} - ${t.descontoCentavos}`,
    ),
    index().on(t.ordemServicoId),
    index().on(t.materialId),
    index().on(t.servicoId),
    index().on(t.orcamentoItemId),
    isolamentoPorTenant('os_itens'),
  ],
);

/** Histórico da O.S. (só inclusão; o banco impede alterar e apagar): o que aconteceu, situações, quem e quando. */
export const osEventos = pgTable(
  'os_eventos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    ordemServicoId: uuid().notNull(),
    evento: eventoOs().notNull(),
    situacaoAnterior: statusOs(),
    situacaoNova: statusOs(),
    detalhe: text(),
    usuarioId: uuid(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.ordemServicoId],
      foreignColumns: [ordensServico.tenantId, ordensServico.id],
    }),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }),
    index().on(t.ordemServicoId, t.criadoEm),
    isolamentoPorTenant('os_eventos'),
  ],
);

/** Mecânicos vinculados à O.S. (usuários com o parâmetro MECÂNICO na função; docs/modulos/ORDENS_SERVICO.md §6). */
export const osMecanicos = pgTable(
  'os_mecanicos',
  {
    tenantId: tenantId(),
    ordemServicoId: uuid().notNull(),
    usuarioId: uuid().notNull(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ordemServicoId, t.usuarioId] }),
    foreignKey({
      columns: [t.tenantId, t.ordemServicoId],
      foreignColumns: [ordensServico.tenantId, ordensServico.id],
    }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }),
    index().on(t.usuarioId),
    isolamentoPorTenant('os_mecanicos'),
  ],
);

/** Checklist de entrada (OS-03): um item por linha, na ordem da tela; regravado inteiro a cada registro. */
export const osChecklist = pgTable(
  'os_checklist',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    ordemServicoId: uuid().notNull(),
    ordem: integer().notNull(),
    item: text().notNull(),
    estado: estadoChecklist().notNull(),
    observacao: text(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.ordemServicoId],
      foreignColumns: [ordensServico.tenantId, ordensServico.id],
    }).onDelete('cascade'),
    uniqueIndex('os_checklist_item_unico').on(t.ordemServicoId, sql`lower(${t.item})`),
    isolamentoPorTenant('os_checklist'),
  ],
);

/**
 * Fotos da O.S. (OS-04): no banco, como o logo e as fotos da equipe (ARQUITETURA §9), reduzidas no navegador;
 * até MAXIMO_FOTOS_OS por O.S., conferido com a O.S. travada. Tipo validado pelos bytes; até 1 MB cada.
 */
export const osFotos = pgTable(
  'os_fotos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    ordemServicoId: uuid().notNull(),
    categoria: categoriaFotoOs().notNull(),
    conteudo: bytea().notNull(),
    tipo: text().notNull(),
    tamanho: integer().notNull(),
    criadoPor: uuid().notNull(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.ordemServicoId],
      foreignColumns: [ordensServico.tenantId, ordensServico.id],
    }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.criadoPor], foreignColumns: [users.tenantId, users.id] }),
    check('os_fotos_tamanho', sql`${t.tamanho} > 0 and ${t.tamanho} <= ${sql.raw(String(IMAGEM_TAMANHO_MAXIMO))}`),
    index().on(t.ordemServicoId, t.criadoEm),
    index().on(t.criadoPor),
    isolamentoPorTenant('os_fotos'),
  ],
);

/** Mecânicos atribuídos a um serviço da O.S. (OS-10); atribuir também vincula o mecânico à O.S. */
export const osItemMecanicos = pgTable(
  'os_item_mecanicos',
  {
    tenantId: tenantId(),
    osItemId: uuid().notNull(),
    usuarioId: uuid().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.osItemId, t.usuarioId] }),
    foreignKey({ columns: [t.tenantId, t.osItemId], foreignColumns: [osItens.tenantId, osItens.id] }).onDelete(
      'cascade',
    ),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }),
    index().on(t.usuarioId),
    isolamentoPorTenant('os_item_mecanicos'),
  ],
);

/**
 * Solicitação de peça pelo mecânico (OS-21, sem estoque nesta fase): descrição livre e quantidade; quem tem
 * "Peças na O.S." atende (e inclui a peça nos itens) ou recusa com o motivo.
 */
export const osSolicitacoesPeca = pgTable(
  'os_solicitacoes_peca',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    ordemServicoId: uuid().notNull(),
    descricao: text().notNull(),
    quantidade: quantidade().notNull(),
    observacao: text(),
    status: statusSolicitacaoPeca().notNull().default('pendente'),
    solicitadaPor: uuid().notNull(),
    solicitadaEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resolvidaPor: uuid(),
    resolvidaEm: timestamp({ withTimezone: true }),
    resposta: text(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.ordemServicoId],
      foreignColumns: [ordensServico.tenantId, ordensServico.id],
    }).onDelete('cascade'),
    ...[t.solicitadaPor, t.resolvidaPor].map((c) =>
      foreignKey({ columns: [t.tenantId, c], foreignColumns: [users.tenantId, users.id] }),
    ),
    check('os_solicitacoes_peca_quantidade', sql`${t.quantidade} > 0`),
    check(
      'os_solicitacoes_peca_resolucao',
      sql`(${t.status} = 'pendente') = (${t.resolvidaEm} is null)
        and (${t.resolvidaEm} is null) = (${t.resolvidaPor} is null)
        and (${t.status} <> 'recusada' or ${t.resposta} is not null)`,
    ),
    index().on(t.ordemServicoId, t.solicitadaEm),
    // Filtro "com peça solicitada" da lista: só as pendentes.
    index('os_solicitacoes_peca_pendentes')
      .on(t.tenantId, t.ordemServicoId)
      .where(sql`${t.status} = 'pendente'`),
    index().on(t.solicitadaPor),
    index().on(t.resolvidaPor),
    isolamentoPorTenant('os_solicitacoes_peca'),
  ],
);
