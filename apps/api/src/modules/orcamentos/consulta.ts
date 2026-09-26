import {
  formatarDataIso,
  hojeIso,
  pendenciasCliente,
  situacaoOrcamento,
  SITUACOES_ORCAMENTO,
  type Orcamento,
  type SituacaoOrcamento,
} from '@mobios/shared';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Tx } from '../../db/client.js';
import {
  aprovacoesComerciais,
  clientes,
  orcamentos,
  orcamentosEventos,
  ordensServico,
  tabelasPreco,
  users,
  veiculos,
  vendedores,
} from '../../db/schema.js';
import { nomeUsuario } from '../../lib/cadastro.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import { temEndereco, temResponsavel } from '../clientes/routes.js';
import { itensDoOrcamento } from './regras.js';

// Leitura e travas do orçamento, usadas pelas rotas (routes.ts, apoio.ts e transicoes.ts) e pelo Painel.

/**
 * Alterar (criar, editar, emitir, enviar, nova versão, cancelar): só o Administrador e o vendedor, nos próprios.
 * Os demais só consultam, mesmo com "Editar" em Orçamentos na matriz (decisão de 25/09/2026).
 */
export const exigirQuemAltera = async (req: FastifyRequest) => {
  if (!req.user.admin && !req.user.vendedorId)
    throw new ErroHttp(403, 'Só o Administrador e os vendedores criam e alteram orçamentos.');
};

export type Gravado = typeof orcamentos.$inferSelect;

/** Emitido/enviado vence sozinho depois do dia seguinte ao da validade (a mesma regra de situacaoOrcamento). */
const vencidoSql = (hoje: string) =>
  sql`(${orcamentos.status} in ('emitido', 'enviado') and ${orcamentos.validadeAte} + 1 < ${hoje}::date)`;
export const situacaoSql = (hoje: string) =>
  sql<SituacaoOrcamento>`case when ${vencidoSql(hoje)} then 'vencido' else ${orcamentos.status}::text end`;

/** Filtro da situação exibida (vencido é calculado; emitido/enviado só enquanto não vencem). */
export function filtroSituacao(situacao: SituacaoOrcamento, hoje: string): SQL {
  if (situacao === 'vencido') return vencidoSql(hoje);
  if (situacao === 'emitido' || situacao === 'enviado')
    return and(eq(orcamentos.status, situacao), sql`not ${vencidoSql(hoje)}`)!;
  return eq(orcamentos.status, situacao);
}

export const colunasPendencia = {
  tipo: clientes.tipo,
  cpfCnpj: clientes.cpfCnpj,
  telefone: clientes.telefone,
  whatsapp: clientes.whatsapp,
  temEndereco,
  temResponsavel,
};
export type BasePendencia = {
  tipo: 'PF' | 'PJ';
  cpfCnpj: string | null;
  telefone: string | null;
  whatsapp: string | null;
  temEndereco: boolean;
  temResponsavel: boolean;
};
export const pendencias = (c: BasePendencia) => pendenciasCliente(c, c.temEndereco, c.temResponsavel);

/**
 * Orçamento completo. `dono`: vendedor que só enxerga os próprios (req.user.vendedorId); de outro vendedor, 404.
 */
export async function carregar(tx: Tx, id: string, dono: string | null, avisos: string[] = []): Promise<Orcamento> {
  const hoje = hojeIso();
  const [o] = await tx
    .select({
      id: orcamentos.id,
      numero: orcamentos.numero,
      versaoOrcamento: orcamentos.versaoOrcamento,
      status: orcamentos.status,
      situacao: situacaoSql(hoje),
      totalCentavos: orcamentos.totalCentavos,
      subtotalCentavos: orcamentos.subtotalCentavos,
      descontoCentavos: orcamentos.descontoCentavos,
      validadeAte: orcamentos.validadeAte,
      precosEm: orcamentos.precosEm,
      observacoes: orcamentos.observacoes,
      criadoEm: orcamentos.criadoEm,
      atualizadoEm: orcamentos.atualizadoEm,
      versao: orcamentos.versao,
      emitidoEm: orcamentos.emitidoEm,
      enviadoEm: orcamentos.enviadoEm,
      aprovadoEm: orcamentos.aprovadoEm,
      recusadoEm: orcamentos.recusadoEm,
      motivoRecusa: orcamentos.motivoRecusa,
      canceladoEm: orcamentos.canceladoEm,
      motivoCancelamento: orcamentos.motivoCancelamento,
      criadoPor: nomeUsuario('orcamentos', 'criado_por'),
      aprovadoPor: nomeUsuario('orcamentos', 'aprovado_por'),
      recusadoPor: nomeUsuario('orcamentos', 'recusado_por'),
      cliente: { id: clientes.id, nome: clientes.nome, ativo: clientes.ativo, ...colunasPendencia },
      veiculoId: veiculos.id,
      veiculoPlaca: veiculos.placa,
      veiculoMarca: veiculos.marca,
      veiculoModelo: veiculos.modelo,
      vendedor: { id: vendedores.id, nome: users.nome, ativo: vendedores.ativo },
      tabela: { id: tabelasPreco.id, codigo: tabelasPreco.codigo, nome: tabelasPreco.nome },
    })
    .from(orcamentos)
    .innerJoin(clientes, eq(clientes.id, orcamentos.clienteId))
    .leftJoin(veiculos, eq(veiculos.id, orcamentos.veiculoId))
    .innerJoin(vendedores, eq(vendedores.id, orcamentos.vendedorId))
    .innerJoin(users, eq(users.id, vendedores.usuarioId))
    .innerJoin(tabelasPreco, eq(tabelasPreco.id, orcamentos.tabelaPrecoId))
    .where(and(eq(orcamentos.id, id), dono ? eq(orcamentos.vendedorId, dono) : undefined));
  if (!o) throw naoEncontrado('Orçamento');

  const itens = await itensDoOrcamento(tx, id);
  const eventos = await tx
    .select({
      evento: orcamentosEventos.evento,
      detalhe: orcamentosEventos.detalhe,
      usuario: users.nome,
      criadoEm: orcamentosEventos.criadoEm,
    })
    .from(orcamentosEventos)
    .leftJoin(users, eq(users.id, orcamentosEventos.usuarioId))
    .where(eq(orcamentosEventos.orcamentoId, id))
    .orderBy(desc(orcamentosEventos.criadoEm), desc(orcamentosEventos.id));
  const versoes = await tx
    .select({
      id: orcamentos.id,
      versaoOrcamento: orcamentos.versaoOrcamento,
      situacao: situacaoSql(hoje),
      totalCentavos: orcamentos.totalCentavos,
    })
    .from(orcamentos)
    .where(and(eq(orcamentos.numero, o.numero), dono ? eq(orcamentos.vendedorId, dono) : undefined))
    .orderBy(desc(orcamentos.versaoOrcamento));
  const [aprovacao] = await tx
    .select({
      id: aprovacoesComerciais.id,
      status: aprovacoesComerciais.status,
      percentual: aprovacoesComerciais.percentual,
      alcadaSolicitante: aprovacoesComerciais.alcadaSolicitante,
      solicitanteId: aprovacoesComerciais.solicitanteId,
      solicitante: nomeUsuario('aprovacoes_comerciais', 'solicitante_id'),
      solicitanteFuncao: aprovacoesComerciais.solicitanteFuncao,
      criadoEm: aprovacoesComerciais.criadoEm,
      decisor: nomeUsuario('aprovacoes_comerciais', 'decidido_por'),
      decisorFuncao: aprovacoesComerciais.decisorFuncao,
      alcadaDecisor: aprovacoesComerciais.alcadaDecisor,
      decididoEm: aprovacoesComerciais.decididoEm,
      justificativa: aprovacoesComerciais.justificativa,
    })
    .from(aprovacoesComerciais)
    .where(eq(aprovacoesComerciais.orcamentoId, id))
    .orderBy(desc(aprovacoesComerciais.criadoEm))
    .limit(1);

  // A O.S. guarda a referência ao orçamento; o orçamento não muda ao ser convertido (ORCAMENTOS.md §6, CV-07).
  const [ordemServico] = await tx
    .select({ id: ordensServico.id, numero: ordensServico.numero })
    .from(ordensServico)
    .where(eq(ordensServico.orcamentoId, id));

  const { cliente, veiculoId, veiculoPlaca, veiculoMarca, veiculoModelo, ...resto } = o;
  return {
    ...resto,
    clienteNome: cliente.nome,
    vendedorNome: o.vendedor.nome,
    cliente: { id: cliente.id, nome: cliente.nome, ativo: cliente.ativo, pendencias: pendencias(cliente) },
    veiculo: veiculoId ? { id: veiculoId, placa: veiculoPlaca!, marca: veiculoMarca!, modelo: veiculoModelo! } : null,
    veiculoPlaca,
    // O PMC congelado no item é interno (margem da aprovação): nunca vai na resposta do orçamento.
    itens: itens.map(({ tenantId: _t, orcamentoId: _o, pmcCentavos: _pmc, descontoPercentual, quantidade, ...i }) => ({
      ...i,
      quantidade: quantidade == null ? null : Number(quantidade),
      descontoPercentual: descontoPercentual == null ? null : descontoPercentual / 100,
    })),
    aprovacaoComercial: aprovacao ? { ...aprovacao, solicitante: aprovacao.solicitante ?? '' } : null,
    ordemServico: ordemServico ?? null,
    eventos,
    versoes,
    avisos,
  };
}

/** Lê o orçamento travando a linha até o fim da transação (transições e edição não se atropelam). */
export async function travar(tx: Tx, id: string, dono: string | null): Promise<Gravado> {
  const [o] = await tx
    .select()
    .from(orcamentos)
    .where(and(eq(orcamentos.id, id), dono ? eq(orcamentos.vendedorId, dono) : undefined))
    .for('update');
  if (!o) throw naoEncontrado('Orçamento');
  return o;
}

export function exigirVersaoLida(o: Gravado, versao: number | undefined) {
  if (versao == null) throw new ErroHttp(400, 'Informe a versão do registro (campo "versao").');
  if (versao !== o.versao)
    throw new ErroHttp(409, 'Este orçamento foi alterado por outra pessoa. Recarregue a página e refaça a ação.');
}

/** A ação só vale nas situações indicadas (vencido é calculado pela validade). */
export function exigirSituacao(o: Gravado, permitidas: SituacaoOrcamento[], acao: string) {
  const atual = situacaoOrcamento(o.status, o.validadeAte);
  if (!permitidas.includes(atual))
    throw new ErroHttp(
      409,
      `Orçamento ${SITUACOES_ORCAMENTO[atual].toLowerCase()}: não é possível ${acao}. Recarregue a página.`,
    );
}

/** Rascunho aberto em outro dia precisa ser recalculado (POST /:id/recalcular) antes de mudar ou emitir. */
export function exigirPrecosDoDia(o: Gravado) {
  if (o.precosEm < hojeIso())
    throw new ErroHttp(
      409,
      `Os preços deste rascunho são de ${formatarDataIso(o.precosEm)}. Abra o orçamento de novo para recalcular.`,
    );
}
