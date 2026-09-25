import {
  descreverValidade,
  EVENTOS_ORCAMENTO,
  formatarDataIso,
  formatarHoras,
  formatarMoeda,
  formatarNumeroOrcamento,
  formatarPlaca,
  formatarQuantidade,
  type Orcamento,
} from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, Pencil, Send, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ClienteDoOrcamento, PrecoNegociado, SeloSituacao, Totais } from '../components/Orcamento';
import {
  Alerta,
  AreaTexto,
  Aviso,
  Botao,
  Cabecalho,
  Campo,
  Cartao,
  classesBotao,
  Janela,
  Linha,
  Secao,
  Tabela,
  Td,
  TextoSuave,
  Th,
  Titulo,
} from '../components/ui';
import { api } from '../lib/api';
import { useOrcamento } from '../lib/orcamentos';
import { usePode } from '../lib/sessao';

const dataHora = (d: Date | string) => new Date(d).toLocaleString('pt-BR');

type Acao = 'emitir' | 'enviar' | 'aprovar' | 'recusar' | 'cancelar' | 'nova-versao';

/** Ações que pedem confirmação numa janela (recusa e cancelamento aceitam um motivo, opcional). */
const CONFIRMACOES: Record<Acao, { titulo: string; texto: string; botao: string; motivo?: boolean }> = {
  emitir: {
    titulo: 'Emitir orçamento',
    texto: 'Depois de emitido, os itens e preços não mudam mais. Para alterar, será preciso gerar uma nova versão.',
    botao: 'Emitir',
  },
  enviar: { titulo: 'Marcar como enviado', texto: 'Registra que o orçamento foi enviado ao cliente.', botao: 'Marcar' },
  aprovar: {
    titulo: 'Aprovar orçamento',
    texto: 'Registra a aprovação do cliente, com a data, a hora e o seu usuário.',
    botao: 'Aprovar',
  },
  recusar: { titulo: 'Recusar orçamento', texto: 'Registra que o cliente recusou.', botao: 'Recusar', motivo: true },
  cancelar: {
    titulo: 'Cancelar orçamento',
    texto: 'O orçamento deixa de valer.',
    botao: 'Cancelar orçamento',
    motivo: true,
  },
  'nova-versao': {
    titulo: 'Gerar nova versão',
    texto:
      'Cria um rascunho com o mesmo número e os mesmos itens, para renegociar. Esta versão é cancelada e fica no histórico.',
    botao: 'Gerar nova versão',
  },
};

const Dado = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <div>
    <dt className="text-xs text-texto-suave">{rotulo}</dt>
    <dd className="text-sm text-texto">{children || '—'}</dd>
  </div>
);

/** Detalhe do orçamento: cabeçalho, itens, totais, versões, histórico e as ações da situação atual. */
export function OrcamentoDetalhe() {
  const { id } = useParams() as { id: string };
  const pode = usePode();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { orcamento, recalculando, erroRecalculo, avisos } = useOrcamento(id);
  // Vindo de "Salvar orçamento": confirma e mostra o que a gravação ajustou. O aviso é guardado na tela e sai do
  // histórico do navegador, para não reaparecer ao recarregar ou voltar.
  const location = useLocation();
  const [avisosAoSalvar] = useState(() => (location.state as { avisosAoSalvar?: string[] } | null)?.avisosAoSalvar);
  const temEstado = location.state != null;
  useEffect(() => {
    if (temEstado) navigate(location.pathname, { replace: true });
  }, [temEstado, navigate, location.pathname]);
  const [confirmando, setConfirmando] = useState<Acao | null>(null);
  const [motivo, setMotivo] = useState('');
  const acao = useMutation({
    mutationFn: ({ tipo, o }: { tipo: Acao; o: Orcamento }) =>
      api<Orcamento>(`/orcamentos/${o.id}/${tipo}`, { method: 'POST', body: { versao: o.versao, motivo } }),
    onSuccess: (resultado, { tipo }) => {
      setConfirmando(null);
      setMotivo('');
      queryClient.invalidateQueries({ queryKey: ['orcamentos'] });
      if (tipo === 'nova-versao') navigate(`/orcamentos/${resultado.id}/editar`);
      else queryClient.setQueryData(['orcamentos', id], resultado);
    },
  });

  if (!pode('orcamentos')) return <Alerta>Você não tem permissão para acessar os orçamentos.</Alerta>;
  if (orcamento.isError) return <Alerta>{orcamento.error.message}</Alerta>;
  if (!orcamento.data || recalculando) return <TextoSuave>Carregando…</TextoSuave>;
  const o = orcamento.data;
  const editar = pode('orcamentos', 'editar');
  const aprovar = pode('aprovar_orcamentos', 'editar');
  const aberto = o.situacao === 'emitido' || o.situacao === 'enviado';
  const botoes: { tipo: Acao; rotulo: string; icone: ReactNode; variante?: 'secundario' | 'perigo' | 'sucesso' }[] = [
    ...(editar && o.situacao === 'rascunho'
      ? [
          {
            tipo: 'emitir' as const,
            rotulo: 'Emitir',
            icone: <Send className="mr-1.5 size-4" aria-hidden />,
            variante: 'sucesso' as const,
          },
        ]
      : []),
    ...(aprovar && aberto
      ? [
          {
            tipo: 'aprovar' as const,
            rotulo: 'Aprovar',
            icone: <CheckCircle2 className="mr-1.5 size-4" aria-hidden />,
          },
          {
            tipo: 'recusar' as const,
            rotulo: 'Recusar',
            icone: <XCircle className="mr-1.5 size-4" aria-hidden />,
            variante: 'secundario' as const,
          },
        ]
      : []),
    ...(editar && o.situacao === 'emitido'
      ? [{ tipo: 'enviar' as const, rotulo: 'Marcar como enviado', icone: null, variante: 'secundario' as const }]
      : []),
    ...(editar && aberto
      ? [
          {
            tipo: 'nova-versao' as const,
            rotulo: 'Nova versão',
            icone: <Copy className="mr-1.5 size-4" aria-hidden />,
            variante: 'secundario' as const,
          },
        ]
      : []),
    ...(editar && (o.situacao === 'rascunho' || aberto)
      ? [{ tipo: 'cancelar' as const, rotulo: 'Cancelar', icone: null, variante: 'secundario' as const }]
      : []),
  ];
  const confirmacao = confirmando && CONFIRMACOES[confirmando];

  return (
    <div className="space-y-6">
      <Titulo>Resumo do Orçamento</Titulo>
      {avisosAoSalvar && (
        <Aviso>
          Orçamento salvo.
          {avisosAoSalvar.length > 0 && (
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {avisosAoSalvar.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </Aviso>
      )}
      <Cartao>
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-superficie-alt px-2 py-0.5 font-mono text-sm font-semibold">
                {formatarNumeroOrcamento(o.numero)}
              </span>
              <span className="text-sm text-texto-suave">Versão {o.versaoOrcamento}</span>
              <SeloSituacao situacao={o.situacao} />
            </div>
            <h1 className="text-2xl font-semibold">
              <ClienteDoOrcamento cliente={o.cliente} />
            </h1>
            <p className="text-sm text-texto-suave">
              {[
                o.veiculo && `${formatarPlaca(o.veiculo.placa)} — ${o.veiculo.marca} ${o.veiculo.modelo}`,
                `Vendedor: ${o.vendedor.nome}${o.vendedor.ativo ? '' : ' (inativo)'}`,
                `Tabela: ${o.tabela.nome}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {editar && o.situacao === 'rascunho' && (
              <Link to={`/orcamentos/${o.id}/editar`} className={classesBotao('secundario')}>
                <Pencil className="mr-1.5 size-4" aria-hidden /> Editar
              </Link>
            )}
            {botoes.map((b) => (
              <Botao key={b.tipo} variante={b.variante} onClick={() => setConfirmando(b.tipo)}>
                {b.icone}
                {b.rotulo}
              </Botao>
            ))}
          </div>
        </div>
        <div className="mt-3 space-y-2">
          <Alerta>{(acao.isError && acao.error.message) || (erroRecalculo && erroRecalculo.message)}</Alerta>
          <Aviso>{avisos.length > 0 && `Preços recalculados para hoje: ${avisos.join(' ')}`}</Aviso>
        </div>
      </Cartao>

      <Tabela>
        <Cabecalho>
          <Th>Código</Th>
          <Th>Descrição</Th>
          <Th className="text-right">Quantidade</Th>
          <Th className="text-right">Preço</Th>
          <Th className="text-right">Total</Th>
        </Cabecalho>
        <tbody>
          {o.itens.map((i) => (
            <Linha key={i.id}>
              <Td className="whitespace-nowrap font-mono text-xs">{i.codigo}</Td>
              <Td>{i.descricao}</Td>
              <Td className="whitespace-nowrap text-right">
                {i.tempoMinutos != null
                  ? `${formatarHoras(i.tempoMinutos)} h`
                  : `${formatarQuantidade(i.quantidade!)} ${i.unidade}`}
              </Td>
              <Td className="whitespace-nowrap text-right">
                <PrecoNegociado {...i} />
                {i.formaPreco === 'hora' && <span className="text-xs text-texto-suave">/hora</span>}
              </Td>
              <Td className="whitespace-nowrap text-right font-semibold">{formatarMoeda(i.totalCentavos)}</Td>
            </Linha>
          ))}
          {o.itens.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-texto-suave">
                Nenhum item.
              </td>
            </tr>
          )}
        </tbody>
      </Tabela>
      <Totais subtotal={o.subtotalCentavos} desconto={o.descontoCentavos} total={o.totalCentavos} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Cartao className="p-5">
          <Secao titulo="Dados">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Dado rotulo="Validade">{o.validadeAte ? descreverValidade(o.validadeAte) : 'Definida na emissão'}</Dado>
              <Dado rotulo="Preços de">{formatarDataIso(o.precosEm)}</Dado>
              <Dado rotulo="Criado">{`${dataHora(o.criadoEm)} por ${o.criadoPor ?? '—'}`}</Dado>
              <Dado rotulo="Emitido">{o.emitidoEm && dataHora(o.emitidoEm)}</Dado>
              {o.aprovadoEm && <Dado rotulo="Aprovado">{`${dataHora(o.aprovadoEm)} por ${o.aprovadoPor ?? '—'}`}</Dado>}
              {o.recusadoEm && (
                <Dado rotulo="Recusado">
                  {`${dataHora(o.recusadoEm)} por ${o.recusadoPor ?? '—'}`}
                  {o.motivoRecusa && ` — ${o.motivoRecusa}`}
                </Dado>
              )}
              {o.canceladoEm && (
                <Dado rotulo="Cancelado">
                  {dataHora(o.canceladoEm)}
                  {o.motivoCancelamento && ` — ${o.motivoCancelamento}`}
                </Dado>
              )}
            </dl>
            {o.observacoes && <p className="whitespace-pre-line text-sm">{o.observacoes}</p>}
          </Secao>
        </Cartao>

        <Cartao className="p-5">
          <Secao titulo="Versões">
            <ul className="divide-y divide-borda text-sm">
              {o.versoes.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                  {v.id === o.id ? (
                    <span className="font-medium">Versão {v.versaoOrcamento} (esta)</span>
                  ) : (
                    <Link to={`/orcamentos/${v.id}`} className="text-primaria hover:underline">
                      Versão {v.versaoOrcamento}
                    </Link>
                  )}
                  <span className="flex items-center gap-2">
                    {formatarMoeda(v.totalCentavos)}
                    <SeloSituacao situacao={v.situacao} />
                  </span>
                </li>
              ))}
            </ul>
          </Secao>
        </Cartao>
      </div>

      <Cartao className="p-5">
        <Secao titulo="Histórico">
          <ul className="space-y-2 text-sm">
            {o.eventos.map((e, n) => (
              <li key={n} className="flex flex-wrap gap-x-2">
                <span className="whitespace-nowrap text-texto-suave">{dataHora(e.criadoEm)}</span>
                <span className="font-medium">{EVENTOS_ORCAMENTO[e.evento]}</span>
                {e.usuario && <span className="text-texto-suave">por {e.usuario}</span>}
                {e.detalhe && <span className="w-full text-texto-suave sm:w-auto">— {e.detalhe}</span>}
              </li>
            ))}
          </ul>
        </Secao>
      </Cartao>

      {confirmando && confirmacao && (
        <Janela titulo={confirmacao.titulo} aoFechar={() => setConfirmando(null)}>
          <div className="space-y-4">
            <TextoSuave>{confirmacao.texto}</TextoSuave>
            {confirmacao.motivo && (
              <Campo rotulo="Motivo (opcional)">
                <AreaTexto rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              </Campo>
            )}
            <Alerta>{acao.isError && acao.error.message}</Alerta>
            <div className="flex gap-2">
              <Botao
                variante={
                  confirmando === 'cancelar' || confirmando === 'recusar'
                    ? 'perigo'
                    : confirmando === 'emitir'
                      ? 'sucesso'
                      : 'primario'
                }
                disabled={acao.isPending}
                onClick={() => acao.mutate({ tipo: confirmando, o })}
              >
                {confirmacao.botao}
              </Botao>
              <Botao variante="secundario" onClick={() => setConfirmando(null)}>
                Voltar
              </Botao>
            </div>
          </div>
        </Janela>
      )}
    </div>
  );
}
