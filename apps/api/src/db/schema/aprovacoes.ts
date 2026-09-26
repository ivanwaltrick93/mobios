import { sql } from 'drizzle-orm';
import {
  type EventoAprovacaoComercial,
  EVENTOS_APROVACAO_COMERCIAL,
  type SnapshotComercial,
  STATUS_APROVACAO_COMERCIAL,
  type StatusAprovacaoComercial,
  type TipoDocumentoComercial,
  TIPOS_DOCUMENTO_COMERCIAL,
} from '@mobios/shared';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { isolamentoPorTenant, tenantId, timestamps } from './comum.js';
import { autoria, fksAutoria, funcoes, users } from './oficina.js';
import { orcamentos } from './orcamentos.js';
import { ordensServico } from './ordensServico.js';

// ---------- Aprovação comercial por alçada (docs/modulos/APROVACAO_COMERCIAL.md) ----------

export const tipoDocumentoComercial = pgEnum(
  'tipo_documento_comercial',
  Object.keys(TIPOS_DOCUMENTO_COMERCIAL) as [TipoDocumentoComercial, ...TipoDocumentoComercial[]],
);
export const statusAprovacaoComercial = pgEnum(
  'status_aprovacao_comercial',
  Object.keys(STATUS_APROVACAO_COMERCIAL) as [StatusAprovacaoComercial, ...StatusAprovacaoComercial[]],
);
export const eventoAprovacaoComercial = pgEnum(
  'evento_aprovacao_comercial',
  Object.keys(EVENTOS_APROVACAO_COMERCIAL) as [EventoAprovacaoComercial, ...EventoAprovacaoComercial[]],
);

/**
 * Alçada de desconto de cada função (centésimos: 5% = 500). Função sem linha, ou com a alçada inativa, vale 0%.
 * O usuário fica com a maior alçada entre as suas funções ativas.
 */
export const alcadasDesconto = pgTable(
  'alcadas_desconto',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    funcaoId: uuid().notNull(),
    percentual: integer().notNull(),
    ativa: boolean().notNull().default(true),
    ...autoria,
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    uniqueIndex('alcadas_desconto_funcao_unica').on(t.tenantId, t.funcaoId),
    foreignKey({ columns: [t.tenantId, t.funcaoId], foreignColumns: [funcoes.tenantId, funcoes.id] }).onDelete(
      'cascade',
    ),
    ...fksAutoria(t),
    check('alcadas_desconto_percentual', sql`${t.percentual} between 0 and 10000`),
    isolamentoPorTenant('alcadas_desconto'),
  ],
);

/** Histórico das alçadas (só inclusão; o banco impede alterar e apagar): antes, depois, quem e quando. */
export const alcadasDescontoEventos = pgTable(
  'alcadas_desconto_eventos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    funcaoId: uuid().notNull(),
    percentualAntes: integer(),
    percentualDepois: integer().notNull(),
    ativaAntes: boolean(),
    ativaDepois: boolean().notNull(),
    usuarioId: uuid(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.funcaoId], foreignColumns: [funcoes.tenantId, funcoes.id] }),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }),
    index().on(t.funcaoId, t.criadoEm.desc()),
    index().on(t.tenantId, t.criadoEm.desc()),
    isolamentoPorTenant('alcadas_desconto_eventos'),
  ],
);

/**
 * Solicitação de aprovação comercial: desconto acima da alçada de quem emitiu. Presa a uma versão do documento
 * (o registro da versão), com o retrato (`snapshot`) e as alçadas do momento. Uma coluna por tipo de documento
 * (hoje só `orcamento_id`; Pedido de Venda e O.S. ganham a sua), para manter a FK composta. Decidida, não muda
 * mais (trigger); só uma pendente por documento.
 */
export const aprovacoesComerciais = pgTable(
  'aprovacoes_comerciais',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    tipoDocumento: tipoDocumentoComercial().notNull(),
    orcamentoId: uuid(),
    ordemServicoId: uuid(),
    /** Número formatado (ORC-0000000001) e versão do documento, como estavam na solicitação. */
    documentoNumero: text().notNull(),
    documentoVersao: integer().notNull(),
    clienteNome: text().notNull(),
    subtotalCentavos: bigint({ mode: 'number' }).notNull(),
    descontoCentavos: bigint({ mode: 'number' }).notNull(),
    totalCentavos: bigint({ mode: 'number' }).notNull(),
    /** Desconto ÷ subtotal, em centésimos, arredondado para cima: é a alçada necessária para aprovar. */
    percentual: integer().notNull(),
    solicitanteId: uuid().notNull(),
    solicitanteFuncao: text(),
    alcadaSolicitante: integer().notNull(),
    status: statusAprovacaoComercial().notNull().default('pendente'),
    /** Quem aprovou, reprovou ou cancelou (a função e a alçada só na aprovação e na reprovação). */
    decididoPor: uuid(),
    decisorFuncao: text(),
    alcadaDecisor: integer(),
    decididoEm: timestamp({ withTimezone: true }),
    justificativa: text(),
    snapshot: jsonb().$type<SnapshotComercial>().notNull(),
    versao: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    uniqueIndex('aprovacoes_comerciais_uma_pendente')
      .on(t.tenantId, t.tipoDocumento, t.orcamentoId)
      .where(sql`${t.status} = 'pendente'`),
    uniqueIndex('aprovacoes_comerciais_uma_pendente_os')
      .on(t.tenantId, t.ordemServicoId)
      .where(sql`${t.status} = 'pendente' and ${t.ordemServicoId} is not null`),
    foreignKey({ columns: [t.tenantId, t.orcamentoId], foreignColumns: [orcamentos.tenantId, orcamentos.id] }),
    foreignKey({
      columns: [t.tenantId, t.ordemServicoId],
      foreignColumns: [ordensServico.tenantId, ordensServico.id],
    }),
    foreignKey({ columns: [t.tenantId, t.solicitanteId], foreignColumns: [users.tenantId, users.id] }),
    foreignKey({ columns: [t.tenantId, t.decididoPor], foreignColumns: [users.tenantId, users.id] }),
    check(
      'aprovacoes_comerciais_documento',
      sql`(${t.tipoDocumento} = 'orcamento') = (${t.orcamentoId} is not null)
        and (${t.tipoDocumento} = 'ordem_servico') = (${t.ordemServicoId} is not null)`,
    ),
    check(
      'aprovacoes_comerciais_alcadas',
      sql`${t.percentual} between 1 and 10000 and ${t.alcadaSolicitante} between 0 and 10000
        and ${t.alcadaSolicitante} < ${t.percentual}
        and (${t.alcadaDecisor} is null or ${t.alcadaDecisor} >= ${t.percentual})`,
    ),
    check(
      'aprovacoes_comerciais_decisao',
      sql`case ${t.status}
        when 'pendente' then ${t.decididoPor} is null and ${t.decididoEm} is null
        when 'cancelada' then ${t.decididoEm} is not null
        else ${t.decididoPor} is not null and ${t.decididoEm} is not null and ${t.alcadaDecisor} is not null
          and ${t.decididoPor} <> ${t.solicitanteId} end`,
    ),
    check(
      'aprovacoes_comerciais_justificativa',
      sql`${t.status} <> 'reprovada' or length(trim(${t.justificativa})) > 0`,
    ),
    check(
      'aprovacoes_comerciais_totais',
      sql`${t.totalCentavos} = ${t.subtotalCentavos} - ${t.descontoCentavos} and ${t.descontoCentavos} > 0`,
    ),
    index().on(t.tenantId, t.status, t.criadoEm.desc()),
    index().on(t.orcamentoId),
    index().on(t.ordemServicoId),
    index().on(t.solicitanteId),
    index().on(t.decididoPor),
    isolamentoPorTenant('aprovacoes_comerciais'),
  ],
);

/** Linha do tempo da aprovação comercial (só inclusão; o banco impede alterar e apagar). */
export const aprovacoesComerciaisEventos = pgTable(
  'aprovacoes_comerciais_eventos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    aprovacaoId: uuid().notNull(),
    evento: eventoAprovacaoComercial().notNull(),
    usuarioId: uuid(),
    /** Função e alçada do usuário no momento do evento. */
    funcao: text(),
    alcada: integer(),
    detalhe: text(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.aprovacaoId],
      foreignColumns: [aprovacoesComerciais.tenantId, aprovacoesComerciais.id],
    }),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }),
    index().on(t.aprovacaoId, t.criadoEm),
    isolamentoPorTenant('aprovacoes_comerciais_eventos'),
  ],
);
