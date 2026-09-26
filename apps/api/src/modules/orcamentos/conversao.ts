import {
  formatarNumeroOrcamento,
  formatarNumeroOs,
  situacaoOrcamento,
  SITUACOES_ORCAMENTO,
  type ConversaoOrcamentoDados,
} from '@mobios/shared';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Tx } from '../../db/client.js';
import { ordensServico, osItens, vendedores } from '../../db/schema.js';
import { ErroHttp } from '../../lib/erros.js';
import { abrirOs, totaisDaOs, validarAbertura, type LinhaOs } from '../ordens-servico/regras.js';
import { travar } from './consulta.js';
import { itensDoOrcamento } from './regras.js';

/**
 * Conversão do orçamento aprovado em O.S. (docs/modulos/ORCAMENTOS.md §6, regras CV). Uma função só, a autoridade
 * da regra: trava o orçamento (duas conversões simultâneas esperam uma pela outra), confere tudo e cria a O.S.
 * `aberta` com os itens copiados como retrato e já aprovados, na mesma transação. O orçamento não muda (CV-07).
 */
export async function converterEmOs(
  tx: Tx,
  orcamentoId: string,
  dados: ConversaoOrcamentoDados,
  u: FastifyRequest['user'],
): Promise<string> {
  // Vendedor: só os próprios (outro vendedor: 404, CV-11). Administrador: qualquer um.
  const orcamento = await travar(tx, orcamentoId, u.vendedorId);
  const situacao = situacaoOrcamento(orcamento.status, orcamento.validadeAte);
  if (situacao !== 'aprovado')
    throw new ErroHttp(
      409,
      `Só orçamento aprovado vira O.S. (este está ${SITUACOES_ORCAMENTO[situacao].toLowerCase()}).`,
    );
  const [existente] = await tx
    .select({ numero: ordensServico.numero })
    .from(ordensServico)
    .where(eq(ordensServico.orcamentoId, orcamento.id));
  if (existente)
    throw new ErroHttp(409, `Este orçamento já foi convertido na O.S. ${formatarNumeroOs(existente.numero)}.`);

  const itens = await itensDoOrcamento(tx, orcamento.id);
  if (!itens.some((i) => i.tipo === 'servico'))
    throw new ErroHttp(
      409,
      'Este orçamento só tem produtos e não pode virar O.S. Ele será atendido pelo Pedido de Venda, quando esse ' +
        'módulo existir.',
    );

  // Veículo: o do orçamento; sem ele, o escolhido na conversão (um veículo do cliente).
  const veiculoId = orcamento.veiculoId ?? dados.veiculoId;
  if (!veiculoId)
    throw new ErroHttp(400, 'O orçamento não tem veículo: escolha um veículo do cliente.', {
      veiculoId: 'Escolha o veículo',
    });
  // Vendedor do orçamento: segue na O.S. se ainda estiver ativo (OS-R17); inativo, a O.S. fica sem vendedor.
  const [vendedor] = await tx
    .select({ ativo: vendedores.ativo })
    .from(vendedores)
    .where(eq(vendedores.id, orcamento.vendedorId));
  const vendedorId = vendedor?.ativo ? orcamento.vendedorId : null;
  await validarAbertura(tx, { clienteId: orcamento.clienteId, veiculoId, vendedorId });

  const numero = `${formatarNumeroOrcamento(orcamento.numero)} v${orcamento.versaoOrcamento}`;
  const id = await abrirOs(
    tx,
    {
      clienteId: orcamento.clienteId,
      veiculoId,
      vendedorId,
      orcamentoId: orcamento.id,
      tabelaPrecoId: orcamento.tabelaPrecoId,
      kmEntrada: dados.kmEntrada,
      relatoCliente: dados.relatoCliente,
      previsaoEntrega: null,
    },
    u.sub,
    `A partir do ${numero}` + (vendedorId ? '.' : ' (o vendedor do orçamento está inativo: O.S. sem vendedor).'),
  );

  // Retrato dos itens, já aprovados pelo cliente (aprovação total do orçamento, CV-05 e CV-09).
  const linhas: LinhaOs[] = itens.map(({ tenantId: _t, orcamentoId: _o, id: itemId, ...i }) => ({
    ...i,
    id: crypto.randomUUID(),
    avulso: false,
    orcamentoItemId: itemId,
    aprovacao: 'aprovado',
  }));
  if (linhas.length) await tx.insert(osItens).values(linhas.map((l) => ({ ...l, ordemServicoId: id })));
  await tx.update(ordensServico).set(totaisDaOs(linhas)).where(eq(ordensServico.id, id));
  return id;
}
