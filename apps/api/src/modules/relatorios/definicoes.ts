import { formatarData, formatarDocumento, formatarPlaca, nomesPapel, type Papel, type RelatorioDescricao, type RelatorioId } from '@mobios/shared';
import { asc, count, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Tx } from '../../db/client.js';
import { clientes, users, veiculos } from '../../db/schema.js';

export type Filtro = { de?: string; ate?: string };

type Definicao = RelatorioDescricao & {
  papeis: Papel[];
  /** Linhas já formatadas como texto: a prévia e o CSV mostram exatamente o mesmo. */
  consultar: (tx: Tx, filtro: Filtro, limite: number) => Promise<{ linhas: Record<string, string>[]; total: number }>;
};

const FUSO = 'America/Sao_Paulo';

/** Filtro de período pela data local (Brasília) de cadastro, com os dois extremos inclusivos. */
function periodo(coluna: PgColumn, { de, ate }: Filtro): SQL | undefined {
  const dia = sql`(${coluna} at time zone ${FUSO})::date`;
  if (de && ate) return sql`${dia} between ${de}::date and ${ate}::date`;
  if (de) return sql`${dia} >= ${de}::date`;
  if (ate) return sql`${dia} <= ${ate}::date`;
  return undefined;
}

const texto = (v: string | number | null | undefined) => (v == null || v === '' ? '' : String(v));

// O isolamento por oficina vem do RLS (withTenant), como em qualquer módulo.
export const relatorios: Record<RelatorioId, Definicao> = {
  clientes: {
    id: 'clientes',
    titulo: 'Clientes',
    descricao: 'Cadastro de clientes com contato e quantidade de veículos.',
    papeis: ['admin', 'atendente', 'financeiro'],
    colunas: [
      { chave: 'nome', titulo: 'Nome' },
      { chave: 'tipo', titulo: 'Tipo' },
      { chave: 'documento', titulo: 'CPF/CNPJ' },
      { chave: 'telefone', titulo: 'Telefone' },
      { chave: 'email', titulo: 'E-mail' },
      { chave: 'veiculos', titulo: 'Veículos' },
      { chave: 'cadastro', titulo: 'Cadastrado em' },
    ],
    async consultar(tx, filtro, limite) {
      const where = periodo(clientes.criadoEm, filtro);
      const [{ total }] = (await tx.select({ total: count() }).from(clientes).where(where)) as [{ total: number }];
      const linhas = await tx
        .select({
          nome: clientes.nome,
          tipo: clientes.tipo,
          cpfCnpj: clientes.cpfCnpj,
          telefone: clientes.telefone,
          email: clientes.email,
          criadoEm: clientes.criadoEm,
          veiculos: count(veiculos.id),
        })
        .from(clientes)
        .leftJoin(veiculos, eq(veiculos.clienteId, clientes.id))
        .where(where)
        .groupBy(clientes.id)
        .orderBy(asc(clientes.nome))
        .limit(limite);
      return {
        total,
        linhas: linhas.map((c) => ({
          nome: c.nome,
          tipo: c.tipo === 'PF' ? 'Pessoa física' : 'Pessoa jurídica',
          documento: c.cpfCnpj ? formatarDocumento(c.cpfCnpj) : '',
          telefone: texto(c.telefone),
          email: texto(c.email),
          veiculos: texto(c.veiculos),
          cadastro: formatarData(c.criadoEm),
        })),
      };
    },
  },

  veiculos: {
    id: 'veiculos',
    titulo: 'Veículos',
    descricao: 'Frota atendida, com o proprietário de cada veículo.',
    papeis: ['admin', 'atendente', 'financeiro'],
    colunas: [
      { chave: 'placa', titulo: 'Placa' },
      { chave: 'marca', titulo: 'Marca' },
      { chave: 'modelo', titulo: 'Modelo' },
      { chave: 'ano', titulo: 'Ano' },
      { chave: 'cor', titulo: 'Cor' },
      { chave: 'km', titulo: 'Km atual' },
      { chave: 'chassi', titulo: 'Chassi' },
      { chave: 'cliente', titulo: 'Cliente' },
      { chave: 'telefone', titulo: 'Telefone do cliente' },
      { chave: 'cadastro', titulo: 'Cadastrado em' },
    ],
    async consultar(tx, filtro, limite) {
      const where = periodo(veiculos.criadoEm, filtro);
      const [{ total }] = (await tx.select({ total: count() }).from(veiculos).where(where)) as [{ total: number }];
      const linhas = await tx
        .select({ v: veiculos, cliente: clientes.nome, telefone: clientes.telefone })
        .from(veiculos)
        .innerJoin(clientes, eq(clientes.id, veiculos.clienteId))
        .where(where)
        .orderBy(asc(veiculos.placa))
        .limit(limite);
      return {
        total,
        linhas: linhas.map(({ v, cliente, telefone }) => ({
          placa: formatarPlaca(v.placa),
          marca: v.marca,
          modelo: v.modelo,
          ano: texto(v.ano),
          cor: texto(v.cor),
          km: v.kmAtual == null ? '' : v.kmAtual.toLocaleString('pt-BR'),
          chassi: texto(v.chassi),
          cliente,
          telefone: texto(telefone),
          cadastro: formatarData(v.criadoEm),
        })),
      };
    },
  },

  usuarios: {
    id: 'usuarios',
    titulo: 'Usuários',
    descricao: 'Equipe com acesso ao sistema, função e status.',
    papeis: ['admin'],
    colunas: [
      { chave: 'nome', titulo: 'Nome' },
      { chave: 'email', titulo: 'E-mail' },
      { chave: 'funcao', titulo: 'Função' },
      { chave: 'status', titulo: 'Status' },
      { chave: 'cadastro', titulo: 'Cadastrado em' },
    ],
    async consultar(tx, filtro, limite) {
      const where = periodo(users.criadoEm, filtro);
      const [{ total }] = (await tx.select({ total: count() }).from(users).where(where)) as [{ total: number }];
      // Sem senha_hash: só as colunas do relatório.
      const linhas = await tx
        .select({ nome: users.nome, email: users.email, papel: users.papel, ativo: users.ativo, criadoEm: users.criadoEm })
        .from(users)
        .where(where)
        .orderBy(asc(users.nome))
        .limit(limite);
      return {
        total,
        linhas: linhas.map((u) => ({
          nome: u.nome,
          email: u.email,
          funcao: nomesPapel[u.papel],
          status: u.ativo ? 'Ativo' : 'Desativado',
          cadastro: formatarData(u.criadoEm),
        })),
      };
    },
  },
};
