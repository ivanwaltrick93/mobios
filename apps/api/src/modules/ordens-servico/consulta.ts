import { SITUACOES_OS, type OrdemServico, type SituacaoOs } from '@mobios/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Tx } from '../../db/client.js';
import {
  aprovacoesComerciais,
  clientes,
  orcamentos,
  ordensServico,
  osChecklist,
  osEventos,
  osFotos,
  osItemMecanicos,
  osMecanicos,
  osSolicitacoesPeca,
  tabelasPreco,
  users,
  veiculos,
  vendedores,
} from '../../db/schema.js';
import { nomeUsuario } from '../../lib/cadastro.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import {
  filtroVisiveis,
  itensDaOs,
  pendenciasDaConclusao,
  podeAlterarOs,
  podeProdutosOs,
  type ItemOsGravado,
  type OsGravada,
} from './regras.js';

// Leitura e trava da O.S., sempre respeitando o que o usuário pode ver (mecânico: só as vinculadas; fora disso, 404).

export type Usuario = FastifyRequest['user'];

type Pessoa = { id: string; nome: string };

const paraItem = (
  {
    tenantId: _t,
    ordemServicoId: _o,
    pmcCentavos: _pmc,
    orcamentoItemId: _oi,
    executadoPor,
    quantidade,
    descontoPercentual,
    ...i
  }: ItemOsGravado,
  nomes: Map<string, string>,
  mecanicos: Pessoa[],
) => ({
  ...i,
  quantidade: quantidade == null ? null : Number(quantidade),
  descontoPercentual: descontoPercentual == null ? null : descontoPercentual / 100,
  executadoPor: executadoPor ? (nomes.get(executadoPor) ?? null) : null,
  mecanicos,
});

/** O.S. completa (detalhe e resposta das ações). */
export async function carregarOs(tx: Tx, id: string, u: Usuario, avisos: string[] = []): Promise<OrdemServico> {
  const [o] = await tx
    .select({
      gravada: ordensServico,
      cliente: { id: clientes.id, nome: clientes.nome },
      veiculo: { id: veiculos.id, placa: veiculos.placa, marca: veiculos.marca, modelo: veiculos.modelo },
      vendedorNome: users.nome,
      vendedorAtivo: vendedores.ativo,
      tabela: { id: tabelasPreco.id, codigo: tabelasPreco.codigo, nome: tabelasPreco.nome },
      orcamentoNumero: orcamentos.numero,
      orcamentoVersao: orcamentos.versaoOrcamento,
      aprovadaPor: nomeUsuario('ordens_servico', 'aprovada_por'),
      concluidaPor: nomeUsuario('ordens_servico', 'concluida_por'),
      criadaPor: nomeUsuario('ordens_servico', 'criado_por'),
    })
    .from(ordensServico)
    .innerJoin(clientes, eq(clientes.id, ordensServico.clienteId))
    .innerJoin(veiculos, eq(veiculos.id, ordensServico.veiculoId))
    .innerJoin(tabelasPreco, eq(tabelasPreco.id, ordensServico.tabelaPrecoId))
    .leftJoin(vendedores, eq(vendedores.id, ordensServico.vendedorId))
    .leftJoin(users, eq(users.id, vendedores.usuarioId))
    .leftJoin(orcamentos, eq(orcamentos.id, ordensServico.orcamentoId))
    .where(and(eq(ordensServico.id, id), filtroVisiveis(u)));
  if (!o) throw naoEncontrado('O.S.');
  const g = o.gravada;

  const itens = await itensDaOs(tx, id);
  const atribuidos = itens.length
    ? await tx
        .select({ osItemId: osItemMecanicos.osItemId, id: users.id, nome: users.nome })
        .from(osItemMecanicos)
        .innerJoin(users, eq(users.id, osItemMecanicos.usuarioId))
        .where(
          inArray(
            osItemMecanicos.osItemId,
            itens.map((i) => i.id),
          ),
        )
        .orderBy(asc(users.nome))
    : [];
  const executores = [...new Set(itens.flatMap((i) => (i.executadoPor ? [i.executadoPor] : [])))];
  const nomes = new Map(
    (executores.length
      ? await tx.select({ id: users.id, nome: users.nome }).from(users).where(inArray(users.id, executores))
      : []
    ).map((u) => [u.id, u.nome]),
  );
  const solicitacoes = await tx
    .select({
      id: osSolicitacoesPeca.id,
      descricao: osSolicitacoesPeca.descricao,
      quantidade: osSolicitacoesPeca.quantidade,
      observacao: osSolicitacoesPeca.observacao,
      status: osSolicitacoesPeca.status,
      solicitadaPor: nomeUsuario('os_solicitacoes_peca', 'solicitada_por'),
      solicitadaEm: osSolicitacoesPeca.solicitadaEm,
      resolvidaPor: nomeUsuario('os_solicitacoes_peca', 'resolvida_por'),
      resolvidaEm: osSolicitacoesPeca.resolvidaEm,
      resposta: osSolicitacoesPeca.resposta,
    })
    .from(osSolicitacoesPeca)
    .where(eq(osSolicitacoesPeca.ordemServicoId, id))
    .orderBy(desc(osSolicitacoesPeca.solicitadaEm), desc(osSolicitacoesPeca.id));
  const mecanicos = await tx
    .select({ id: users.id, nome: users.nome })
    .from(osMecanicos)
    .innerJoin(users, eq(users.id, osMecanicos.usuarioId))
    .where(eq(osMecanicos.ordemServicoId, id))
    .orderBy(asc(users.nome));
  const eventos = await tx
    .select({
      evento: osEventos.evento,
      situacaoAnterior: osEventos.situacaoAnterior,
      situacaoNova: osEventos.situacaoNova,
      detalhe: osEventos.detalhe,
      usuario: users.nome,
      criadoEm: osEventos.criadoEm,
    })
    .from(osEventos)
    .leftJoin(users, eq(users.id, osEventos.usuarioId))
    .where(eq(osEventos.ordemServicoId, id))
    .orderBy(desc(osEventos.criadoEm), desc(osEventos.id));
  const checklist = await tx
    .select({ item: osChecklist.item, estado: osChecklist.estado, observacao: osChecklist.observacao })
    .from(osChecklist)
    .where(eq(osChecklist.ordemServicoId, id))
    .orderBy(asc(osChecklist.ordem));
  // Só os dados da foto: o conteúdo vem pela rota da imagem.
  const fotos = await tx
    .select({
      id: osFotos.id,
      categoria: osFotos.categoria,
      tamanho: osFotos.tamanho,
      criadaPor: users.nome,
      criadaEm: osFotos.criadoEm,
    })
    .from(osFotos)
    .leftJoin(users, eq(users.id, osFotos.criadoPor))
    .where(eq(osFotos.ordemServicoId, id))
    .orderBy(asc(osFotos.criadoEm), asc(osFotos.id));
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
    .where(eq(aprovacoesComerciais.ordemServicoId, id))
    .orderBy(desc(aprovacoesComerciais.criadoEm))
    .limit(1);

  return {
    id: g.id,
    numero: g.numero,
    situacao: g.status,
    clienteNome: o.cliente.nome,
    veiculoPlaca: o.veiculo.placa,
    vendedorNome: o.vendedorNome,
    mecanicos: mecanicos.map((m) => m.nome),
    previsaoEntrega: g.previsaoEntrega,
    totalCentavos: g.totalCentavos,
    abertaEm: g.criadoEm,
    pecasSolicitadas: solicitacoes.filter((s) => s.status === 'pendente').length,
    cliente: o.cliente,
    veiculo: o.veiculo,
    vendedor: g.vendedorId ? { id: g.vendedorId, nome: o.vendedorNome ?? '', ativo: !!o.vendedorAtivo } : null,
    tabela: o.tabela,
    orcamento:
      g.orcamentoId && o.orcamentoNumero != null
        ? { id: g.orcamentoId, numero: o.orcamentoNumero, versaoOrcamento: o.orcamentoVersao! }
        : null,
    kmEntrada: g.kmEntrada,
    relatoCliente: g.relatoCliente,
    observacoes: g.observacoes,
    subtotalServicosCentavos: g.subtotalServicosCentavos,
    subtotalMateriaisCentavos: g.subtotalMateriaisCentavos,
    descontoCentavos: g.descontoCentavos,
    aprovadaEm: g.aprovadaEm,
    aprovadaPor: o.aprovadaPor,
    recusadaEm: g.recusadaEm,
    motivoRecusa: g.motivoRecusa,
    canceladaEm: g.canceladaEm,
    motivoCancelamento: g.motivoCancelamento,
    itens: itens.map((i) =>
      paraItem(
        i,
        nomes,
        atribuidos.filter((a) => a.osItemId === i.id).map(({ id: usuarioId, nome }) => ({ id: usuarioId, nome })),
      ),
    ),
    mecanicosVinculados: mecanicos,
    aprovacaoComercial: aprovacao ? { ...aprovacao, solicitante: aprovacao.solicitante ?? '' } : null,
    eventos,
    checklist,
    combustivel: g.combustivel,
    avariasEntrada: g.avariasEntrada,
    checklistEm: g.checklistEm,
    diagnostico: g.diagnostico,
    concluidaEm: g.concluidaEm,
    concluidaPor: o.concluidaPor,
    solicitacoesPeca: solicitacoes.map((s) => ({ ...s, quantidade: Number(s.quantidade) })),
    fotos,
    permissoes: { alterar: podeAlterarOs(u, g), produtos: podeProdutosOs(u) },
    pendenciasConclusao: pendenciasDaConclusao(itens, solicitacoes.filter((s) => s.status === 'pendente').length),
    criadaPor: o.criadaPor,
    versao: g.versao,
    avisos,
  };
}

/** Lê a O.S. travando a linha até o fim da transação (ações e edição não se atropelam). Não visível: 404. */
export async function travarOs(tx: Tx, id: string, u: Usuario): Promise<OsGravada> {
  const [o] = await tx
    .select()
    .from(ordensServico)
    .where(and(eq(ordensServico.id, id), filtroVisiveis(u)))
    .for('update');
  if (!o) throw naoEncontrado('O.S.');
  return o;
}

export function exigirVersaoLidaOs(o: OsGravada, versao: number) {
  if (versao !== o.versao)
    throw new ErroHttp(409, 'Esta O.S. foi alterada por outra pessoa. Recarregue a página e refaça a ação.');
}

/** A ação só vale nas situações indicadas. */
export function exigirSituacaoOs(o: OsGravada, permitidas: SituacaoOs[], acao: string) {
  if (!permitidas.includes(o.status))
    throw new ErroHttp(
      409,
      `O.S. ${SITUACOES_OS[o.status].toLowerCase()}: não é possível ${acao}. Recarregue a página.`,
    );
}

/** Com aprovação comercial pendente, itens e ações ficam parados até a decisão (só o cancelamento passa). */
export async function exigirSemAprovacaoPendente(tx: Tx, id: string) {
  const [pendente] = await tx
    .select({ id: aprovacoesComerciais.id })
    .from(aprovacoesComerciais)
    .where(and(eq(aprovacoesComerciais.ordemServicoId, id), eq(aprovacoesComerciais.status, 'pendente')));
  if (pendente)
    throw new ErroHttp(
      409,
      'Esta O.S. aguarda aprovação comercial de desconto: itens e ações ficam parados até a decisão.',
    );
}
