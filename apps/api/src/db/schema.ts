import { sql } from 'drizzle-orm';
import { MODULO_IDS, NIVEIS } from '@mobios/shared';
import { boolean, customType, date, foreignKey, index, integer, pgEnum, pgPolicy, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const timestamps = {
  criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Coluna tenant_id preenchida pelo próprio banco a partir de app.tenant_id,
 * que é definido por withTenant() no início de cada transação.
 */
const tenantId = () =>
  uuid()
    .notNull()
    .references(() => tenants.id)
    .default(sql`nullif(current_setting('app.tenant_id', true), '')::uuid`);

/**
 * Toda tabela de negócio DEVE usar esta política. Ela ativa o RLS na tabela e
 * restringe leitura e escrita às linhas da oficina corrente.
 */
const isolamentoPorTenant = (tabela: string) =>
  pgPolicy(`${tabela}_isolamento_tenant`, {
    for: 'all',
    using: sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`,
    withCheck: sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`,
  });

// ---------- Global (sem RLS) ----------

export const tenants = pgTable('tenants', {
  id: uuid().primaryKey().defaultRandom(),
  nome: text().notNull(),
  cnpj: text(),
  plano: text().notNull().default('gratuito'),
  ...timestamps,
});

/**
 * Usuários também ficam sob RLS. O login (busca por e-mail antes de o tenant ser
 * conhecido) usa a função SECURITY DEFINER auth_usuario_por_email, criada na migração.
 */
export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
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
    index().on(t.tenantId, t.nome),
    isolamentoPorTenant('users'),
  ],
);

// ---------- Negócio (com RLS) ----------

export const tipoPessoa = pgEnum('tipo_pessoa', ['PF', 'PJ']);
export const sexo = pgEnum('sexo', ['masculino', 'feminino', 'outro', 'nao_informado']);
export const tipoEndereco = pgEnum('tipo_endereco', ['residencial', 'comercial', 'outro']);
export const combustivel = pgEnum('combustivel', ['flex', 'gasolina', 'etanol', 'diesel', 'gnv', 'eletrico', 'hibrido']);
export const statusVeiculo = pgEnum('status_veiculo', ['ativo', 'vendido', 'inativo']);

/** Lista editável por oficina (Configurações → Cadastros). Desativar tira da escolha, sem mexer nos clientes que já usam. */
const listaDeOpcoes = (tabela: string) =>
  pgTable(
    tabela,
    {
      id: uuid().primaryKey().defaultRandom(),
      tenantId: tenantId(),
      nome: text().notNull(),
      ativa: boolean().notNull().default(true),
      ...timestamps,
    },
    (t) => [
      unique().on(t.tenantId, t.id),
      uniqueIndex(`${tabela}_nome_unico`).on(t.tenantId, sql`lower(${t.nome})`),
      isolamentoPorTenant(tabela),
    ],
  );

export const origensCliente = listaDeOpcoes('origens_cliente');
export const relacionamentosCliente = listaDeOpcoes('relacionamentos_cliente');
export const cargosResponsavel = listaDeOpcoes('cargos_responsavel');

/**
 * Colunas obrigatórias no formulário (documento, telefones, endereço) ficam anuláveis no banco:
 * cadastros anteriores às regras atuais continuam válidos e aparecem como "cadastro incompleto".
 */
export const clientes = pgTable(
  'clientes',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    tipo: tipoPessoa().notNull().default('PF'),
    nome: text().notNull(),
    cpfCnpj: text(),
    rgIe: text(),
    dataNascimento: date(),
    sexo: sexo(),
    telefone: text(),
    whatsapp: text(),
    email: text(),
    observacoes: text(),
    clienteDesde: date().notNull().default(sql`current_date`),
    origemId: uuid(),
    relacionamentoId: uuid(),
    ativo: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    // Alvo das FKs compostas: garante que filhos só apontem para linhas do mesmo tenant.
    unique().on(t.tenantId, t.id),
    uniqueIndex().on(t.tenantId, t.cpfCnpj).where(sql`${t.cpfCnpj} is not null`),
    index().on(t.tenantId, t.nome),
    foreignKey({ columns: [t.tenantId, t.origemId], foreignColumns: [origensCliente.tenantId, origensCliente.id] }),
    foreignKey({ columns: [t.tenantId, t.relacionamentoId], foreignColumns: [relacionamentosCliente.tenantId, relacionamentosCliente.id] }),
    index().on(t.origemId),
    index().on(t.relacionamentoId),
    isolamentoPorTenant('clientes'),
  ],
);

/** Endereços do cliente (ao menos um; exatamente um principal). Em PJ, cada endereço pode acumular finalidades. */
export const clienteEnderecos = pgTable(
  'cliente_enderecos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    clienteId: uuid().notNull(),
    tipo: tipoEndereco().notNull(),
    cep: text().notNull(),
    logradouro: text().notNull(),
    numero: text().notNull(),
    complemento: text(),
    bairro: text().notNull(),
    cidade: text().notNull(),
    uf: text().notNull(),
    pais: text().notNull().default('Brasil'),
    principal: boolean().notNull().default(false),
    faturamento: boolean().notNull().default(false),
    entrega: boolean().notNull().default(false),
    cobranca: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.clienteId], foreignColumns: [clientes.tenantId, clientes.id] }).onDelete('cascade'),
    index().on(t.clienteId),
    uniqueIndex('cliente_enderecos_principal_unico').on(t.clienteId).where(sql`${t.principal}`),
    isolamentoPorTenant('cliente_enderecos'),
  ],
);

/** Pessoas que respondem pela empresa cliente (só PJ; ao menos uma, uma principal). */
export const clienteResponsaveis = pgTable(
  'cliente_responsaveis',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    clienteId: uuid().notNull(),
    nome: text().notNull(),
    telefone: text().notNull(),
    telefoneWhatsapp: boolean().notNull().default(false),
    email: text(),
    cargoId: uuid().notNull(),
    principal: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.clienteId], foreignColumns: [clientes.tenantId, clientes.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.cargoId], foreignColumns: [cargosResponsavel.tenantId, cargosResponsavel.id] }),
    index().on(t.clienteId),
    index().on(t.cargoId),
    uniqueIndex('cliente_responsaveis_principal_unico').on(t.clienteId).where(sql`${t.principal}`),
    isolamentoPorTenant('cliente_responsaveis'),
  ],
);

export const veiculos = pgTable(
  'veiculos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    clienteId: uuid().notNull(),
    placa: text().notNull(),
    renavam: text(),
    chassi: text(),
    marca: text().notNull(),
    modelo: text().notNull(),
    versao: text(),
    anoFabricacao: integer(),
    anoModelo: integer(),
    cor: text(),
    combustivel: combustivel(),
    kmAtual: integer(),
    /** Preenchida pela O.S. (fase 1): data da última entrada do veículo na oficina. */
    ultimaVisita: date(),
    principal: boolean().notNull().default(false),
    status: statusVeiculo().notNull().default('ativo'),
    ...timestamps,
  },
  (t) => [
    // FK composta: checagens de FK ignoram o RLS, então sem o tenant_id aqui uma
    // oficina poderia vincular um veículo ao cliente de outra (conhecendo o UUID).
    foreignKey({ columns: [t.tenantId, t.clienteId], foreignColumns: [clientes.tenantId, clientes.id] }),
    // Placa e chassi são únicos na oficina: na venda para outro cliente, o veículo é transferido.
    uniqueIndex().on(t.tenantId, t.placa),
    uniqueIndex().on(t.tenantId, t.chassi).where(sql`${t.chassi} is not null`),
    uniqueIndex('veiculos_principal_unico').on(t.clienteId).where(sql`${t.principal}`),
    index().on(t.clienteId),
    index().on(t.tenantId, t.marca, t.modelo),
    isolamentoPorTenant('veiculos'),
  ],
);

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

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
    nome: text().notNull(),
    admin: boolean().notNull().default(false),
    ativa: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    uniqueIndex('funcoes_nome_unico').on(t.tenantId, sql`lower(${t.nome})`),
    uniqueIndex('funcoes_admin_unico').on(t.tenantId).where(sql`${t.admin}`),
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
    foreignKey({ columns: [t.tenantId, t.funcaoId], foreignColumns: [funcoes.tenantId, funcoes.id] }).onDelete('cascade'),
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
