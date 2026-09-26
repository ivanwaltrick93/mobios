import {
  EVENTOS_APROVACAO_COMERCIAL,
  formatarHoras,
  formatarMoeda,
  formatarPercentual,
  formatarQuantidade,
  TIPOS_DOCUMENTO_COMERCIAL,
  type AprovacaoComercial,
} from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, TriangleAlert } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { AnaliseMargem } from '../components/AnaliseMargem';
import { AcoesDecisao, SeloAprovacao } from '../components/AprovacaoComercial';
import { CONTORNO_ACIMA_DA_ALCADA } from '../components/ItensOrcamento';
import { PrecoNegociado, Totais } from '../components/Orcamento';
import {
  Alerta,
  Bloco,
  Cabecalho,
  CabecalhoObjeto,
  Carregando,
  classesBotao,
  Dado,
  Linha,
  Tabela,
  Td,
  TextoSuave,
  Th,
} from '../components/ui';
import { api } from '../lib/api';
import { usePerfilOrcamento, usePode } from '../lib/sessao';
import { useTrilha } from '../lib/trilha';

const dataHora = (d: Date | string) => new Date(d).toLocaleString('pt-BR');

/** Quem, com a função e a alçada do momento: "João (Gerente, alçada 15,00%)". */
const quem = (nome: string | null, funcao: string | null, alcada: number | null) =>
  `${nome ?? '—'}${funcao ? ` (${funcao}${alcada != null ? `, alçada ${formatarPercentual(alcada)}` : ''})` : ''}`;

/**
 * Detalhe da aprovação comercial: o retrato do documento na solicitação (não o estado atual), quem pode aprovar,
 * a decisão com a alçada do momento e a linha do tempo.
 */
export function AprovacaoComercialDetalhe() {
  const { id } = useParams() as { id: string };
  const perfil = usePerfilOrcamento();
  const pode = usePode();
  const consulta = useQuery({
    queryKey: ['aprovacoes-comerciais', id],
    queryFn: () => api<AprovacaoComercial>(`/aprovacoes-comerciais/${id}`),
  });
  const a = consulta.data;
  useTrilha(a?.documentoNumero);

  if (consulta.isError) return <Alerta>{consulta.error.message}</Alerta>;
  if (!a) return <Carregando />;
  const s = a.snapshot;
  // O vendedor só abre os próprios orçamentos; os demais, se consultam orçamentos.
  const abreDocumento = perfil.vendedorId ? perfil.vendedorId === a.documentoVendedorId : perfil.podeVer;
  const decidida = a.status === 'aprovada' || a.status === 'reprovada';

  return (
    <div className="space-y-4">
      <CabecalhoObjeto
        titulo={`${a.documentoNumero} · versão ${a.documentoVersao}`}
        selos={<SeloAprovacao status={a.status} />}
        atributos={[
          { rotulo: 'Tipo', valor: TIPOS_DOCUMENTO_COMERCIAL[a.tipoDocumento] },
          { rotulo: 'Cliente', valor: a.clienteNome },
          { rotulo: 'Solicitante', valor: quem(a.solicitante, a.solicitanteFuncao, null) },
          { rotulo: 'Alçada do solicitante', valor: formatarPercentual(a.alcadaSolicitante) },
          { rotulo: 'Solicitado em', valor: dataHora(a.criadoEm) },
          { rotulo: 'Valor original', valor: formatarMoeda(a.subtotalCentavos) },
          { rotulo: 'Desconto', valor: formatarMoeda(a.descontoCentavos) },
          { rotulo: 'Maior desconto por item', valor: <strong>{formatarPercentual(a.percentual)}</strong> },
          { rotulo: 'Valor final', valor: formatarMoeda(a.totalCentavos) },
          {
            rotulo: 'Aprovador necessário',
            valor: a.aprovadores.length
              ? a.aprovadores.map((f) => `${f.funcao} (${formatarPercentual(f.alcada)})`).join(', ')
              : `Alçada de ${formatarPercentual(a.percentual)} ou mais`,
          },
        ]}
        acoes={
          <>
            {a.podeDecidir && <AcoesDecisao aprovacao={a} />}
            {abreDocumento && (
              <Link to={`/orcamentos/${a.documentoId}`} className={classesBotao('secundario')}>
                <ExternalLink className="mr-1.5 size-4" aria-hidden /> Abrir orçamento
              </Link>
            )}
          </>
        }
      >
        {a.status === 'pendente' && !a.podeDecidir && a.motivoBloqueio && <TextoSuave>{a.motivoBloqueio}</TextoSuave>}
        {decidida && (
          <dl className="grid gap-x-6 gap-y-2 rounded-md bg-superficie-alt p-3 sm:grid-cols-3">
            <Dado rotulo={a.status === 'aprovada' ? 'Aprovado por' : 'Reprovado por'}>
              {quem(a.decisor, a.decisorFuncao, a.alcadaDecisor)}
            </Dado>
            <Dado rotulo="Em">{a.decididoEm && dataHora(a.decididoEm)}</Dado>
            {a.justificativa && <Dado rotulo="Motivo da reprovação">{a.justificativa}</Dado>}
          </dl>
        )}
        {a.status === 'cancelada' && (
          <TextoSuave>
            Cancelada em {a.decididoEm && dataHora(a.decididoEm)} por {a.decisor ?? '—'}.
          </TextoSuave>
        )}
      </CabecalhoObjeto>

      {/* Margem: informação interna, só com "Custos e margem" (a API também só a devolve a eles). */}
      {pode('custos') && <AnaliseMargem snapshot={s} />}

      <Bloco titulo="Itens no momento da solicitação">
        <div className="space-y-3">
          <Tabela>
            <Cabecalho>
              <Th>Código</Th>
              <Th>Descrição</Th>
              <Th className="text-right">Quantidade</Th>
              <Th className="text-right">Preço</Th>
              <Th className="text-right">Desconto</Th>
              <Th className="text-right">%</Th>
              <Th className="text-right">Total</Th>
            </Cabecalho>
            <tbody>
              {s.itens.map((i, n) => (
                // Itens que passaram da alçada de quem pediu: contorno laranja (retratos antigos não têm a marca).
                <Linha key={`${i.codigo}-${n}`} className={i.acimaDaAlcada ? CONTORNO_ACIMA_DA_ALCADA : ''}>
                  <Td className="whitespace-nowrap font-mono text-xs">{i.codigo}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      {i.descricao}
                      {i.acimaDaAlcada && (
                        <TriangleAlert
                          className="size-4 shrink-0 text-alerta"
                          aria-label="Acima da alçada de quem pediu"
                        />
                      )}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">
                    {i.tempoMinutos != null
                      ? `${formatarHoras(i.tempoMinutos)} h`
                      : `${formatarQuantidade(i.quantidade ?? 0)} ${i.unidade}`}
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    <PrecoNegociado
                      precoTabelaCentavos={i.precoTabelaCentavos}
                      precoUnitarioCentavos={i.precoUnitarioCentavos}
                    />
                  </Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">
                    {i.descontoCentavos ? `−${formatarMoeda(i.descontoCentavos)}` : '—'}
                  </Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">
                    {i.percentual ? formatarPercentual(i.percentual) : '—'}
                  </Td>
                  <Td className="whitespace-nowrap text-right font-semibold tabular-nums">
                    {formatarMoeda(i.totalCentavos)}
                  </Td>
                </Linha>
              ))}
            </tbody>
          </Tabela>
          <Totais subtotal={s.subtotalCentavos} desconto={s.descontoCentavos} total={s.totalCentavos} />
        </div>
      </Bloco>

      <div className="grid gap-4 lg:grid-cols-2">
        <Bloco titulo="Documento na solicitação">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Dado rotulo="Vendedor">{s.vendedor}</Dado>
            <Dado rotulo="Veículo">{s.veiculo ?? 'Sem veículo'}</Dado>
            <Dado rotulo="Tabela de preço">{s.tabela}</Dado>
            <Dado rotulo="Validade pedida">
              {s.validadeDias != null && `${s.validadeDias} dia(s), contados da aprovação`}
            </Dado>
          </dl>
          {s.observacoes && <p className="mt-3 whitespace-pre-line text-sm">{s.observacoes}</p>}
        </Bloco>

        <Bloco titulo="Histórico">
          <ol className="space-y-3 text-sm">
            {a.eventos.map((e, n) => (
              <li key={n} className="border-l-2 border-borda pl-3">
                <p className="text-xs text-texto-suave">{dataHora(e.criadoEm)}</p>
                <p>
                  <span className="font-medium">{EVENTOS_APROVACAO_COMERCIAL[e.evento]}</span>
                  {e.usuario && <span className="text-texto-suave"> — {quem(e.usuario, e.funcao, e.alcada)}</span>}
                </p>
                {e.detalhe && <p className="text-texto-suave">{e.detalhe}</p>}
              </li>
            ))}
          </ol>
        </Bloco>
      </div>
    </div>
  );
}
