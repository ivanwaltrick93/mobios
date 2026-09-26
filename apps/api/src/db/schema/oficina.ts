import { sql } from 'drizzle-orm';
import { MODULO_IDS, NIVEIS } from '@mobios/shared';
import {
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
import { bytea, codigoAutomatico, isolamentoPorTenant, tenantId, timestamps } from './comum.js';

/**
 * Falhas de login por e-mail e por IP (limite de tentativas, PLT-08). Global e sem RLS: o login acontece
 * antes de a oficina ser conhecida. A chave é um hash SHA-256 ("email:<email>" ou "ip:<ip>"): nenhum
 * e-mail ou IP fica gravado em claro.
 */
export const loginTentativas = pgTable(
  'login_tentativas',
  {
    chave: text().primaryKey(),
    falhas: integer().notNull(),
    janelaInicio: timestamp({ withTimezone: true }).notNull(),
    bloqueadoAte: timestamp({ withTimezone: true }),
    atualizadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.atualizadoEm)],
);

/**
 * Usuários também ficam sob RLS. O login (busca por e-mail antes de o tenant ser
 * conhecido) usa a função SECURITY DEFINER auth_usuario_por_email, criada na migração.
 */
export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    codigo: codigoAutomatico('usuarios'),
    nome: text().notNull(),
    email: text().notNull(),
    senhaHash: text().notNull(),
    ativo: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex().on(t.email),
    // Alvo das FKs compostas (usuario_funcoes).
    unique().on(t.tenantId, t.id),
    uniqueIndex('users_codigo_unico').on(t.tenantId, t.codigo),
    index().on(t.tenantId, t.nome),
    isolamentoPorTenant('users'),
  ],
);

/** Quem criou e quem alterou por último (usuários da mesma oficina) + versão para concorrência otimista. */
export const autoria = {
  criadoPor: uuid(),
  atualizadoPor: uuid(),
  versao: integer().notNull().default(1),
};
type ColunaFk = Parameters<typeof foreignKey>[0]['columns'][number];
export const fksAutoria = (t: { tenantId: ColunaFk; criadoPor: ColunaFk; atualizadoPor: ColunaFk }) => [
  foreignKey({ columns: [t.tenantId, t.criadoPor], foreignColumns: [users.tenantId, users.id] }),
  foreignKey({ columns: [t.tenantId, t.atualizadoPor], foreignColumns: [users.tenantId, users.id] }),
];

/** Logo da oficina guardado no próprio banco (um por oficina; a PK é o tenant). */
export const tenantLogos = pgTable(
  'tenant_logos',
  {
    tenantId: tenantId().primaryKey(),
    conteudo: bytea().notNull(),
    tipo: text().notNull(),
    tamanho: integer().notNull(),
    ...timestamps,
  },
  () => [isolamentoPorTenant('tenant_logos')],
);

/** Tokens do style guide configurados pela oficina (um registro por oficina; null = padrão). */
export const tenantAparencia = pgTable(
  'tenant_aparencia',
  {
    tenantId: tenantId().primaryKey(),
    corPrimaria: text(),
    corMenu: text(),
    corBotaoPrimario: text(),
    corBotaoPrimarioTexto: text(),
    corBotaoSecundario: text(),
    corBotaoSecundarioTexto: text(),
    ...timestamps,
  },
  () => [isolamentoPorTenant('tenant_aparencia')],
);

// ---------- Funções e permissões (configuráveis pelo admin da oficina) ----------

export const modulo = pgEnum('modulo', MODULO_IDS);
export const nivelAcesso = pgEnum('nivel_acesso', NIVEIS);

/** Função de trabalho (Atendente, Mecânico...). `admin` = Administrador fixo, com acesso total (uma por oficina). */
export const funcoes = pgTable(
  'funcoes',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    codigo: codigoAutomatico('funcoes'),
    nome: text().notNull(),
    descricao: text(),
    admin: boolean().notNull().default(false),
    ativa: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    uniqueIndex('funcoes_codigo_unico').on(t.tenantId, t.codigo),
    uniqueIndex('funcoes_nome_unico').on(t.tenantId, sql`lower(${t.nome})`),
    uniqueIndex('funcoes_admin_unico')
      .on(t.tenantId)
      .where(sql`${t.admin}`),
    isolamentoPorTenant('funcoes'),
  ],
);

/** Nível de uma função em um módulo. Módulo ausente = sem acesso. */
export const funcaoPermissoes = pgTable(
  'funcao_permissoes',
  {
    tenantId: tenantId(),
    funcaoId: uuid().notNull(),
    modulo: modulo().notNull(),
    nivel: nivelAcesso().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.funcaoId, t.modulo] }),
    foreignKey({ columns: [t.tenantId, t.funcaoId], foreignColumns: [funcoes.tenantId, funcoes.id] }).onDelete(
      'cascade',
    ),
    isolamentoPorTenant('funcao_permissoes'),
  ],
);

/** Funções de cada usuário (várias por usuário; o acesso é a soma delas). */
export const usuarioFuncoes = pgTable(
  'usuario_funcoes',
  {
    tenantId: tenantId(),
    usuarioId: uuid().notNull(),
    funcaoId: uuid().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.usuarioId, t.funcaoId] }),
    index().on(t.funcaoId),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.funcaoId], foreignColumns: [funcoes.tenantId, funcoes.id] }),
    isolamentoPorTenant('usuario_funcoes'),
  ],
);

/**
 * Catálogo global de parâmetros de função (ex.: VENDEDOR), mantido pelas migrações: o app só lê
 * (a migração 0018 retira do mobios_app o direito de gravar). Não tem tenant_id: vale para todas as oficinas.
 */
export const parametrosFuncao = pgTable(
  'parametros_funcao',
  {
    id: uuid().primaryKey().defaultRandom(),
    codigo: text().notNull(),
    nome: text().notNull(),
    descricao: text().notNull(),
  },
  (t) => [uniqueIndex('parametros_funcao_codigo_unico').on(t.codigo)],
);

/** Parâmetros marcados em cada função da oficina. */
export const funcaoParametros = pgTable(
  'funcao_parametros',
  {
    tenantId: tenantId(),
    funcaoId: uuid().notNull(),
    parametroId: uuid()
      .notNull()
      .references(() => parametrosFuncao.id),
  },
  (t) => [
    primaryKey({ columns: [t.funcaoId, t.parametroId] }),
    foreignKey({ columns: [t.tenantId, t.funcaoId], foreignColumns: [funcoes.tenantId, funcoes.id] }).onDelete(
      'cascade',
    ),
    index().on(t.parametroId),
    isolamentoPorTenant('funcao_parametros'),
  ],
);

/** Sequências de negócio por oficina (código de usuário, função e vendedor; depois, o número da O.S.). */
export const contadores = pgTable(
  'contadores',
  {
    tenantId: tenantId(),
    chave: text().notNull(),
    valor: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.chave] }),
    check('contadores_valor_positivo', sql`${t.valor} > 0`),
    isolamentoPorTenant('contadores'),
  ],
);

/** Foto opcional do usuário, no próprio banco (uma por usuário; PK = usuario_id). */
export const usuarioFotos = pgTable(
  'usuario_fotos',
  {
    usuarioId: uuid().primaryKey(),
    tenantId: tenantId(),
    conteudo: bytea().notNull(),
    tipo: text().notNull(),
    tamanho: integer().notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }).onDelete('cascade'),
    isolamentoPorTenant('usuario_fotos'),
  ],
);
