import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { isolamentoPorTenant, listaDeOpcoes, tenantId, timestamps } from './comum.js';

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
    /**
     * Mês e dia do nascimento (MMDD), calculado pelo banco: filtro dos aniversariantes com índice. Coluna própria
     * porque, sob o RLS, só operador "leakproof" vira condição de índice, e extract() não é
     * (docs/performance/DATABASE.md §Busca).
     */
    aniversario: smallint().generatedAlwaysAs(
      sql`(extract(month from data_nascimento) * 100 + extract(day from data_nascimento))::smallint`,
    ),
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
    // Aniversariantes (Painel e filtro da lista), sem ler todos os clientes da oficina.
    index('clientes_aniversario')
      .on(t.tenantId, t.aniversario)
      .where(sql`${t.aniversario} is not null`),
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
