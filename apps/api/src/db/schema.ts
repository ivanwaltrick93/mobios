import { sql } from 'drizzle-orm';
import {
  EVENTOS_APROVACAO_COMERCIAL,
  EVENTOS_ORCAMENTO,
  FORMAS_PRECO_SERVICO,
  MODULO_IDS,
  NIVEIS,
  STATUS_APROVACAO_COMERCIAL,
  STATUS_ORCAMENTO,
  TIPOS_DOCUMENTO_COMERCIAL,
  TIPOS_ITEM_PRECO,
  type EventoAprovacaoComercial,
  type EventoOrcamento,
  type TipoItemPreco,
  UNIDADES,
  type FormaPrecoServico,
  type SnapshotComercial,
  type StatusAprovacaoComercial,
  type TipoDocumentoComercial,
  type Unidade,
} from '@mobios/shared';
import {
  bigint,
  boolean,
  check,
  char,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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

/**
 * Código sequencial por oficina, gerado pelo banco no INSERT (função `proximo_codigo`, migração 0018) a partir
 * da tabela `contadores`, na mesma transação: nunca se repete nem é reaproveitado. Um trigger impede alterá-lo.
 */
const codigoAutomatico = (chave: string) =>
  integer()
    .notNull()
    .default(sql.raw(`proximo_codigo('${chave}')`));

// ---------- Global (sem RLS) ----------

export const tenants = pgTable('tenants', {
  id: uuid().primaryKey().defaultRandom(),
  nome: text().notNull(),
  cnpj: text(),
  plano: text().notNull().default('gratuito'),
  ...timestamps,
});

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

// ---------- Negócio (com RLS) ----------

export const tipoPessoa = pgEnum('tipo_pessoa', ['PF', 'PJ']);
export const sexo = pgEnum('sexo', ['masculino', 'feminino', 'outro', 'nao_informado']);
export const tipoEndereco = pgEnum('tipo_endereco', ['residencial', 'comercial', 'outro']);
export const combustivel = pgEnum('combustivel', [
  'flex',
  'gasolina',
  'etanol',
  'diesel',
  'gnv',
  'eletrico',
  'hibrido',
]);
export const statusVeiculo = pgEnum('status_veiculo', ['ativo', 'vendido', 'inativo']);

/**
 * Lista editável por oficina (Configurações, uma página por lista): código automático, nome, descrição e status.
 * Desativar tira da escolha sem mexer nos registros que já usam; excluir só o que nunca foi usado (FK RESTRICT).
 */
const listaDeOpcoes = (tabela: string) =>
  pgTable(
    tabela,
    {
      id: uuid().primaryKey().defaultRandom(),
      tenantId: tenantId(),
      codigo: codigoAutomatico(tabela),
      nome: text().notNull(),
      descricao: text(),
      ativa: boolean().notNull().default(true),
      ...timestamps,
    },
    (t) => [
      unique().on(t.tenantId, t.id),
      uniqueIndex(`${tabela}_codigo_unico`).on(t.tenantId, t.codigo),
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
    clienteDesde: date()
      .notNull()
      .default(sql`current_date`),
    origemId: uuid(),
    relacionamentoId: uuid(),
    ativo: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    // Alvo das FKs compostas: garante que filhos só apontem para linhas do mesmo tenant.
    unique().on(t.tenantId, t.id),
    uniqueIndex()
      .on(t.tenantId, t.cpfCnpj)
      .where(sql`${t.cpfCnpj} is not null`),
    index().on(t.tenantId, t.nome),
    // Filtro "cliente desde" da lista de clientes.
    index().on(t.tenantId, t.clienteDesde),
    foreignKey({ columns: [t.tenantId, t.origemId], foreignColumns: [origensCliente.tenantId, origensCliente.id] }),
    foreignKey({
      columns: [t.tenantId, t.relacionamentoId],
      foreignColumns: [relacionamentosCliente.tenantId, relacionamentosCliente.id],
    }),
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
    foreignKey({ columns: [t.tenantId, t.clienteId], foreignColumns: [clientes.tenantId, clientes.id] }).onDelete(
      'cascade',
    ),
    index().on(t.clienteId),
    uniqueIndex('cliente_enderecos_principal_unico')
      .on(t.clienteId)
      .where(sql`${t.principal}`),
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
    foreignKey({ columns: [t.tenantId, t.clienteId], foreignColumns: [clientes.tenantId, clientes.id] }).onDelete(
      'cascade',
    ),
    foreignKey({
      columns: [t.tenantId, t.cargoId],
      foreignColumns: [cargosResponsavel.tenantId, cargosResponsavel.id],
    }),
    index().on(t.clienteId),
    index().on(t.cargoId),
    uniqueIndex('cliente_responsaveis_principal_unico')
      .on(t.clienteId)
      .where(sql`${t.principal}`),
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
    // Alvo das FKs compostas (orçamentos).
    unique().on(t.tenantId, t.id),
    // FK composta: checagens de FK ignoram o RLS, então sem o tenant_id aqui uma
    // oficina poderia vincular um veículo ao cliente de outra (conhecendo o UUID).
    foreignKey({ columns: [t.tenantId, t.clienteId], foreignColumns: [clientes.tenantId, clientes.id] }),
    // Placa e chassi são únicos na oficina: na venda para outro cliente, o veículo é transferido.
    uniqueIndex().on(t.tenantId, t.placa),
    uniqueIndex()
      .on(t.tenantId, t.chassi)
      .where(sql`${t.chassi} is not null`),
    uniqueIndex('veiculos_principal_unico')
      .on(t.clienteId)
      .where(sql`${t.principal}`),
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

// ---------- Materiais e preços (docs/modulos/MATERIAIS_E_PRECOS.md) ----------
// Só cadastros mestres. Saldo, reserva e movimentação de estoque ficam para o módulo de estoque,
// que vai referenciar materiais e depósitos pelas chaves (tenant_id, id).

/** Quem criou e quem alterou por último (usuários da mesma oficina) + versão para concorrência otimista. */
const autoria = {
  criadoPor: uuid(),
  atualizadoPor: uuid(),
  versao: integer().notNull().default(1),
};
type ColunaFk = Parameters<typeof foreignKey>[0]['columns'][number];
const fksAutoria = (t: { tenantId: ColunaFk; criadoPor: ColunaFk; atualizadoPor: ColunaFk }) => [
  foreignKey({ columns: [t.tenantId, t.criadoPor], foreignColumns: [users.tenantId, users.id] }),
  foreignKey({ columns: [t.tenantId, t.atualizadoPor], foreignColumns: [users.tenantId, users.id] }),
];

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

// ---------- Estoque (saldo por material + depósito) ----------
// Por enquanto o saldo só muda por ajuste manual (estoque_ajustes). Entradas de compra, venda no balcão
// e O.S. virão depois e movimentarão estas mesmas linhas.

/** Quantidade com até 3 casas (litro, quilo, metro); devolvida como número pela API. */
const quantidade = () => numeric({ precision: 14, scale: 3, mode: 'number' });

/**
 * Saldo de um material num depósito. Chave de negócio = chave primária: (material, depósito).
 * Disponível = tudo o que há no depósito; reservado = parte dele separada para O.S./pedido (CHECK: nunca maior);
 * saldo = disponível − reservado (livre), calculado na consulta.
 */
export const estoques = pgTable(
  'estoques',
  {
    tenantId: tenantId(),
    materialId: uuid().notNull(),
    depositoId: uuid().notNull(),
    disponivel: quantidade().notNull().default(0),
    reservado: quantidade().notNull().default(0),
    atualizadoPor: uuid(),
    versao: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.materialId, t.depositoId] }),
    foreignKey({ columns: [t.tenantId, t.materialId], foreignColumns: [materiais.tenantId, materiais.id] }),
    foreignKey({ columns: [t.tenantId, t.depositoId], foreignColumns: [depositos.tenantId, depositos.id] }),
    foreignKey({ columns: [t.tenantId, t.atualizadoPor], foreignColumns: [users.tenantId, users.id] }),
    check('estoques_disponivel_positivo', sql`${t.disponivel} >= 0`),
    check('estoques_reservado_positivo', sql`${t.reservado} >= 0`),
    // Disponível = tudo o que há no depósito; reservado é parte dele. Saldo livre = disponível − reservado.
    check('estoques_reservado_ate_disponivel', sql`${t.reservado} <= ${t.disponivel}`),
    index().on(t.depositoId),
    isolamentoPorTenant('estoques'),
  ],
);

/** Histórico de ajustes manuais: antes/depois, motivo, quem e quando. */
export const estoqueAjustes = pgTable(
  'estoque_ajustes',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    materialId: uuid().notNull(),
    depositoId: uuid().notNull(),
    disponivelAntes: quantidade().notNull(),
    disponivelDepois: quantidade().notNull(),
    reservadoAntes: quantidade().notNull(),
    reservadoDepois: quantidade().notNull(),
    motivo: text().notNull(),
    usuarioId: uuid(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.materialId], foreignColumns: [materiais.tenantId, materiais.id] }),
    foreignKey({ columns: [t.tenantId, t.depositoId], foreignColumns: [depositos.tenantId, depositos.id] }),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }),
    index().on(t.materialId, t.depositoId, t.criadoEm.desc()),
    index().on(t.depositoId),
    isolamentoPorTenant('estoque_ajustes'),
  ],
);

// ---------- Vendedores (CAD-18) ----------
// Vão ser referenciados por clientes, oportunidades, orçamentos e O.S. pela chave (tenant_id, id).

/**
 * Vendedor = um usuário da oficina (1:1) com função ativa de parâmetro VENDEDOR. Nome e e-mail ficam só no
 * usuário. Não é excluído: inativa por botão ou automaticamente quando o usuário perde a condição.
 */
export const vendedores = pgTable(
  'vendedores',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    codigo: codigoAutomatico('vendedores'),
    usuarioId: uuid().notNull(),
    matricula: text(),
    whatsapp: text().notNull(),
    funcionarioDesde: date(),
    ativo: boolean().notNull().default(true),
    criadoPor: uuid(),
    atualizadoPor: uuid(),
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    uniqueIndex('vendedores_codigo_unico').on(t.tenantId, t.codigo),
    uniqueIndex('vendedores_usuario_unico').on(t.tenantId, t.usuarioId),
    // Matrícula sem diferenciar maiúsculas: "m-01" e "M-01" são a mesma.
    uniqueIndex('vendedores_matricula_unico')
      .on(t.tenantId, sql`upper(${t.matricula})`)
      .where(sql`${t.matricula} is not null`),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }),
    ...fksAutoria(t),
    isolamentoPorTenant('vendedores'),
  ],
);

export const eventoVendedor = pgEnum('evento_vendedor', ['criado', 'alterado', 'inativado', 'reativado']);
export const origemEventoVendedor = pgEnum('origem_evento_vendedor', ['cadastro', 'importacao', 'automatica']);

/** Log de alterações do vendedor (só inclusão): campo, antes e depois, quem e quando. */
export const vendedoresEventos = pgTable(
  'vendedores_eventos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    vendedorId: uuid().notNull(),
    evento: eventoVendedor().notNull(),
    origem: origemEventoVendedor().notNull(),
    motivo: text(),
    alteracoes: jsonb().$type<{ campo: string; antes: string | null; depois: string | null }[]>().notNull(),
    usuarioId: uuid(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.vendedorId], foreignColumns: [vendedores.tenantId, vendedores.id] }),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }),
    index().on(t.vendedorId, t.criadoEm.desc()),
    isolamentoPorTenant('vendedores_eventos'),
  ],
);

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
    index().on(t.tenantId, t.criadoEm.desc()),
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
    foreignKey({ columns: [t.tenantId, t.orcamentoId], foreignColumns: [orcamentos.tenantId, orcamentos.id] }),
    foreignKey({ columns: [t.tenantId, t.solicitanteId], foreignColumns: [users.tenantId, users.id] }),
    foreignKey({ columns: [t.tenantId, t.decididoPor], foreignColumns: [users.tenantId, users.id] }),
    check('aprovacoes_comerciais_documento', sql`(${t.tipoDocumento} = 'orcamento') = (${t.orcamentoId} is not null)`),
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
