import {
  COMBUSTIVEIS,
  formatarCep,
  formatarData,
  formatarDataIso,
  formatarDocumento,
  formatarPlaca,
  formatarTelefone,
  pendenciasCliente,
  pendenciasVeiculo,
  SEXOS,
  STATUS_VEICULO,
  type RelatorioDescricao,
  type RelatorioId,
} from '@mobios/shared';
import { and, asc, count, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Tx } from '../../db/client.js';
import { clienteEnderecos, clientes, origensCliente, relacionamentosCliente, users, veiculos } from '../../db/schema.js';

export type Filtro = { de?: string; ate?: string };

type Definicao = RelatorioDescricao & {
  /** Além do acesso ao módulo Relatórios: exige a função Administrador. */
  somenteAdmin: boolean;
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
    descricao: 'Cadastro completo de clientes, com endereço principal e quantidade de veículos.',
    somenteAdmin: false,
    colunas: [
      { chave: 'nome', titulo: 'Nome / Razão social' },
      { chave: 'tipo', titulo: 'Tipo' },
      { chave: 'documento', titulo: 'CPF/CNPJ' },
      { chave: 'rgIe', titulo: 'RG/IE' },
      { chave: 'nascimento', titulo: 'Nascimento' },
      { chave: 'sexo', titulo: 'Sexo' },
      { chave: 'telefone', titulo: 'Telefone' },
      { chave: 'whatsapp', titulo: 'WhatsApp' },
      { chave: 'email', titulo: 'E-mail' },
      { chave: 'responsavel', titulo: 'Responsável (PJ)' },
      { chave: 'responsavelContato', titulo: 'Contato do responsável' },
      { chave: 'endereco', titulo: 'Endereço principal' },
      { chave: 'cidade', titulo: 'Cidade/UF' },
      { chave: 'origem', titulo: 'Origem' },
      { chave: 'relacionamento', titulo: 'Relacionamento' },
      { chave: 'clienteDesde', titulo: 'Cliente desde' },
      { chave: 'status', titulo: 'Status' },
      { chave: 'veiculos', titulo: 'Veículos' },
      { chave: 'pendencias', titulo: 'Pendências no cadastro' },
      { chave: 'cadastro', titulo: 'Cadastrado em' },
    ],
    async consultar(tx, filtro, limite) {
      const where = periodo(clientes.criadoEm, filtro);
      const [{ total }] = (await tx.select({ total: count() }).from(clientes).where(where)) as [{ total: number }];
      const linhas = await tx
        .select({
          c: clientes,
          origem: origensCliente.nome,
          relacionamento: relacionamentosCliente.nome,
          endereco: clienteEnderecos,
          // Correlação escrita à mão (o Drizzle não qualifica colunas dentro da subconsulta).
          veiculos: sql<number>`(select count(*) from veiculos v where v.cliente_id = "clientes"."id")`.mapWith(Number),
          // Responsável principal (PJ): "nome (função)" e o telefone.
          responsavel: sql<string | null>`(select r.nome || ' (' || c.nome || ')' from cliente_responsaveis r join cargos_responsavel c on c.id = r.cargo_id
            where r.cliente_id = "clientes"."id" and r.principal)`,
          responsavelTelefone: sql<string | null>`(select r.telefone from cliente_responsaveis r where r.cliente_id = "clientes"."id" and r.principal)`,
        })
        .from(clientes)
        .leftJoin(origensCliente, eq(origensCliente.id, clientes.origemId))
        .leftJoin(relacionamentosCliente, eq(relacionamentosCliente.id, clientes.relacionamentoId))
        .leftJoin(clienteEnderecos, and(eq(clienteEnderecos.clienteId, clientes.id), eq(clienteEnderecos.principal, true)))
        .where(where)
        .orderBy(asc(clientes.nome))
        .limit(limite);
      return {
        total,
        linhas: linhas.map(({ c, origem, relacionamento, endereco: e, veiculos, responsavel, responsavelTelefone }) => ({
          nome: c.nome,
          tipo: c.tipo === 'PF' ? 'Pessoa física' : 'Pessoa jurídica',
          documento: c.cpfCnpj ? formatarDocumento(c.cpfCnpj) : '',
          rgIe: texto(c.rgIe),
          nascimento: c.dataNascimento ? formatarDataIso(c.dataNascimento) : '',
          sexo: c.sexo ? SEXOS[c.sexo] : '',
          telefone: c.telefone ? formatarTelefone(c.telefone) : '',
          whatsapp: c.whatsapp ? formatarTelefone(c.whatsapp) : '',
          email: texto(c.email),
          responsavel: texto(responsavel),
          responsavelContato: responsavelTelefone ? formatarTelefone(responsavelTelefone) : '',
          endereco: e ? [`${e.logradouro}, ${e.numero}`, e.complemento, e.bairro, formatarCep(e.cep)].filter(Boolean).join(' - ') : '',
          cidade: e ? `${e.cidade}/${e.uf}` : '',
          origem: texto(origem),
          relacionamento: texto(relacionamento),
          clienteDesde: formatarDataIso(c.clienteDesde),
          status: c.ativo ? 'Ativo' : 'Inativo',
          veiculos: texto(veiculos),
          pendencias: pendenciasCliente(c, !!e, !!responsavel).join(', '),
          cadastro: formatarData(c.criadoEm),
        })),
      };
    },
  },

  veiculos: {
    id: 'veiculos',
    titulo: 'Veículos',
    descricao: 'Frota atendida, com o proprietário de cada veículo.',
    somenteAdmin: false,
    colunas: [
      { chave: 'placa', titulo: 'Placa' },
      { chave: 'marca', titulo: 'Marca' },
      { chave: 'modelo', titulo: 'Modelo' },
      { chave: 'versao', titulo: 'Versão' },
      { chave: 'anoFabricacao', titulo: 'Ano fabricação' },
      { chave: 'anoModelo', titulo: 'Ano modelo' },
      { chave: 'cor', titulo: 'Cor' },
      { chave: 'combustivel', titulo: 'Combustível' },
      { chave: 'km', titulo: 'Km atual' },
      { chave: 'chassi', titulo: 'Chassi' },
      { chave: 'renavam', titulo: 'Renavam' },
      { chave: 'status', titulo: 'Status' },
      { chave: 'principal', titulo: 'Principal' },
      { chave: 'ultimaVisita', titulo: 'Última visita' },
      { chave: 'cliente', titulo: 'Cliente' },
      { chave: 'whatsapp', titulo: 'WhatsApp do cliente' },
      { chave: 'pendencias', titulo: 'Pendências no cadastro' },
      { chave: 'cadastro', titulo: 'Cadastrado em' },
    ],
    async consultar(tx, filtro, limite) {
      const where = periodo(veiculos.criadoEm, filtro);
      const [{ total }] = (await tx.select({ total: count() }).from(veiculos).where(where)) as [{ total: number }];
      const linhas = await tx
        .select({ v: veiculos, cliente: clientes.nome, whatsapp: clientes.whatsapp })
        .from(veiculos)
        .innerJoin(clientes, eq(clientes.id, veiculos.clienteId))
        .where(where)
        .orderBy(asc(veiculos.placa))
        .limit(limite);
      return {
        total,
        linhas: linhas.map(({ v, cliente, whatsapp }) => ({
          placa: formatarPlaca(v.placa),
          marca: v.marca,
          modelo: v.modelo,
          versao: texto(v.versao),
          anoFabricacao: texto(v.anoFabricacao),
          anoModelo: texto(v.anoModelo),
          cor: texto(v.cor),
          combustivel: v.combustivel ? COMBUSTIVEIS[v.combustivel] : '',
          km: v.kmAtual == null ? '' : v.kmAtual.toLocaleString('pt-BR'),
          chassi: texto(v.chassi),
          renavam: texto(v.renavam),
          status: STATUS_VEICULO[v.status],
          principal: v.principal ? 'Sim' : 'Não',
          ultimaVisita: v.ultimaVisita ? formatarDataIso(v.ultimaVisita) : '',
          cliente,
          whatsapp: whatsapp ? formatarTelefone(whatsapp) : '',
          pendencias: pendenciasVeiculo(v).join(', '),
          cadastro: formatarData(v.criadoEm),
        })),
      };
    },
  },

  usuarios: {
    id: 'usuarios',
    titulo: 'Usuários',
    descricao: 'Equipe com acesso ao sistema, função e status.',
    somenteAdmin: true,
    colunas: [
      { chave: 'nome', titulo: 'Nome' },
      { chave: 'email', titulo: 'E-mail' },
      { chave: 'funcoes', titulo: 'Funções' },
      { chave: 'status', titulo: 'Status' },
      { chave: 'cadastro', titulo: 'Cadastrado em' },
    ],
    async consultar(tx, filtro, limite) {
      const where = periodo(users.criadoEm, filtro);
      const [{ total }] = (await tx.select({ total: count() }).from(users).where(where)) as [{ total: number }];
      // Sem senha_hash: só as colunas do relatório.
      const linhas = await tx
        .select({
          nome: users.nome,
          email: users.email,
          ativo: users.ativo,
          criadoEm: users.criadoEm,
          // Correlação escrita à mão (o Drizzle não qualifica colunas dentro da subconsulta).
          funcoes: sql<string | null>`(select string_agg(f.nome || case when f.ativa then '' else ' (desativada)' end, ', ' order by f.nome)
            from usuario_funcoes uf join funcoes f on f.id = uf.funcao_id where uf.usuario_id = "users"."id")`,
        })
        .from(users)
        .where(where)
        .orderBy(asc(users.nome))
        .limit(limite);
      return {
        total,
        linhas: linhas.map((u) => ({
          nome: u.nome,
          email: u.email,
          funcoes: texto(u.funcoes),
          status: u.ativo ? 'Ativo' : 'Desativado',
          cadastro: formatarData(u.criadoEm),
        })),
      };
    },
  },
};
