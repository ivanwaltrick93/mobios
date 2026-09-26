import { zodResolver } from '@hookform/resolvers/zod';
import {
  cabecalhoOsInputSchema,
  entregaOsInputSchema,
  EVENTOS_OS,
  formatarHoras,
  formatarMoeda,
  formatarNumeroOrcamento,
  formatarNumeroOs,
  formatarPlaca,
  formatarQuantidade,
  SITUACOES_OS,
  SITUACOES_OS_EM_ABERTO,
  SITUACOES_OS_ITENS_EDITAVEIS,
  type OrdemServico,
  type SituacaoOs,
} from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  CheckCircle2,
  FileText,
  KeyRound,
  Pause,
  Pencil,
  Play,
  Search,
  Send,
  UserPlus,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import type { z } from 'zod';
import { ExecucaoOs } from '../components/ExecucaoOs';
import { ItensOrcamento } from '../components/ItensOrcamento';
import { AvisoAprovacaoComercial, PrecoNegociado, Totais } from '../components/Orcamento';
import { ItensAvulsos, SeloSituacaoOs } from '../components/OrdemServico';
import { ChecklistOs, DiagnosticoOs, FotosOs } from '../components/RecepcaoOs';
import {
  Abas,
  Alerta,
  AreaTexto,
  Aviso,
  Botao,
  Cabecalho,
  CabecalhoObjeto,
  Campo,
  Cartao,
  classesBotao,
  Input,
  Janela,
  Linha,
  LinhaVazia,
  Secao,
  Select,
  Selo,
  Tabela,
  Td,
  TextoSuave,
  Th,
  useNotificar,
} from '../components/ui';
import { api } from '../lib/api';
import { aplicarErrosDaApi } from '../lib/formulario';
import {
  itemParaApi,
  linhaDoItem,
  linhaValida,
  precoDaLinha,
  type FiltroTipoItem,
  type LinhaTela,
} from '../lib/linhasOrcamento';
import {
  APOIO_OS,
  avulsoDoItem,
  avulsoParaApi,
  avulsoValido,
  useMecanicosOs,
  useOrdemServico,
  useVendedoresOs,
  type LinhaAvulsa,
} from '../lib/ordensServico';
import { usePerfilOs } from '../lib/sessao';

const dataHora = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null;

/** Instante → valor do campo datetime-local ("2026-09-30T17:30"), no fuso do navegador. */
function paraCampoDataHora(d: Date | string | null) {
  if (!d) return '';
  const x = new Date(d);
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${dois(x.getMonth() + 1)}-${dois(x.getDate())}T${dois(x.getHours())}:${dois(x.getMinutes())}`;
}

type Acao =
  | 'iniciar-diagnostico'
  | 'solicitar-aprovacao'
  | 'aprovar'
  | 'recusar'
  | 'iniciar-execucao'
  | 'aguardar-peca'
  | 'retomar'
  | 'concluir'
  | 'cancelar';

type Aba = 'itens' | 'execucao' | 'recepcao' | 'fotos' | 'diagnostico' | 'dados' | 'historico';

type Variante = 'primario' | 'secundario' | 'perigo' | 'sucesso';

/** Ações de situação (docs/modulos/ORDENS_SERVICO.md §3): de onde partem, texto da confirmação e motivo. */
const ACOES: Record<
  Acao,
  {
    rotulo: string;
    de: SituacaoOs[];
    icone: ReactNode;
    variante: Variante;
    texto: string;
    motivo?: { rotulo: string; obrigatorio?: boolean };
  }
> = {
  'iniciar-diagnostico': {
    rotulo: 'Iniciar diagnóstico',
    de: ['aberta'],
    icone: <Search className="mr-1.5 size-4" aria-hidden />,
    variante: 'secundario',
    texto: 'Registra o início do diagnóstico do veículo.',
  },
  'solicitar-aprovacao': {
    rotulo: 'Enviar para aprovação',
    de: ['aberta', 'em_diagnostico'],
    icone: <Send className="mr-1.5 size-4" aria-hidden />,
    variante: 'primario',
    texto: 'Os itens pendentes vão para a aprovação do cliente. Enquanto ele decide, os itens não mudam.',
  },
  aprovar: {
    rotulo: 'Aprovar',
    de: ['aguardando_aprovacao'],
    icone: <CheckCircle2 className="mr-1.5 size-4" aria-hidden />,
    variante: 'sucesso',
    texto: 'Registra a aprovação do cliente para todos os itens pendentes, com a data, a hora e o seu usuário.',
  },
  recusar: {
    rotulo: 'Recusar',
    de: ['aguardando_aprovacao'],
    icone: <XCircle className="mr-1.5 size-4" aria-hidden />,
    variante: 'perigo',
    texto: 'Registra que o cliente recusou o serviço.',
    motivo: { rotulo: 'Motivo (opcional)' },
  },
  'iniciar-execucao': {
    rotulo: 'Iniciar execução',
    de: ['aberta', 'em_diagnostico', 'aprovada'],
    icone: <Play className="mr-1.5 size-4" aria-hidden />,
    variante: 'primario',
    texto: 'Registra o início do serviço. Todos os itens precisam estar aprovados pelo cliente.',
  },
  'aguardar-peca': {
    rotulo: 'Aguardando peça',
    de: ['em_execucao'],
    icone: <Pause className="mr-1.5 size-4" aria-hidden />,
    variante: 'secundario',
    texto: 'O serviço fica parado até a peça chegar.',
    motivo: { rotulo: 'Qual peça (opcional)' },
  },
  retomar: {
    rotulo: 'Retomar execução',
    de: ['aguardando_peca'],
    icone: <Play className="mr-1.5 size-4" aria-hidden />,
    variante: 'primario',
    texto: 'A peça chegou: o serviço volta à execução.',
  },
  concluir: {
    rotulo: 'Concluir',
    de: ['em_execucao'],
    icone: <CheckCircle2 className="mr-1.5 size-4" aria-hidden />,
    variante: 'sucesso',
    texto: 'Todos os serviços foram executados: a O.S. fica concluída e sai das O.S. em aberto. A entrega vem depois.',
  },
  cancelar: {
    rotulo: 'Cancelar O.S.',
    de: SITUACOES_OS_EM_ABERTO,
    icone: <Ban className="mr-1.5 size-4" aria-hidden />,
    variante: 'perigo',
    texto: 'A O.S. é cancelada e sai das O.S. em aberto. Um pedido de aprovação comercial pendente também é cancelado.',
    motivo: { rotulo: 'Motivo do cancelamento *', obrigatorio: true },
  },
};

/** Ações que a situação e os itens permitem agora (a API confere de novo). */
function acoesPossiveis(o: OrdemServico): Acao[] {
  const pendentes = o.itens.some((i) => i.aprovacao === 'pendente');
  return (Object.keys(ACOES) as Acao[]).filter((a) => {
    if (!ACOES[a].de.includes(o.situacao)) return false;
    if (a === 'solicitar-aprovacao') return pendentes;
    if (a === 'iniciar-execucao') return o.itens.length > 0 && !pendentes;
    if (a === 'concluir') return o.pendenciasConclusao.length === 0;
    return true;
  });
}

/**
 * Detalhe da O.S. (OS-01 a OS-06): cabeçalho com as ações da situação e abas de itens, recepção (checklist), fotos,
 * diagnóstico, dados e mecânicos e histórico.
 */
export function OrdemServicoDetalhe() {
  const { id } = useParams() as { id: string };
  const perfil = usePerfilOs();
  const queryClient = useQueryClient();
  const os = useOrdemServico(id);
  const [confirmando, setConfirmando] = useState<Acao | null>(null);
  const [motivo, setMotivo] = useState('');
  const [editandoDados, setEditandoDados] = useState(false);
  const [entregando, setEntregando] = useState(false);
  const [editandoItens, setEditandoItens] = useState(false);
  // O mecânico chega pela execução; os demais, pelos itens.
  const [aba, setAba] = useState<Aba>(perfil.mecanico ? 'execucao' : 'itens');
  const [avisos, setAvisos] = useState<string[]>([]);
  const guardar = (o: OrdemServico) => {
    queryClient.setQueryData(['ordens-servico', id], o);
    queryClient.invalidateQueries({ queryKey: ['ordens-servico', 'lista'] });
    queryClient.invalidateQueries({ queryKey: ['painel'] });
  };
  const acao = useMutation({
    mutationFn: ({ tipo, o }: { tipo: Acao; o: OrdemServico }) =>
      api<OrdemServico>(`/ordens-servico/${o.id}/${tipo}`, {
        method: 'POST',
        body: { versao: o.versao, motivo: motivo.trim() || null },
      }),
    onSuccess: (o) => {
      setConfirmando(null);
      setMotivo('');
      guardar(o);
    },
  });

  if (!perfil.podeVer) return <Alerta>Você não tem permissão para acessar as ordens de serviço.</Alerta>;
  if (os.isError) return <Alerta>{os.error.message}</Alerta>;
  if (!os.data) return <TextoSuave>Carregando…</TextoSuave>;
  const o = os.data;
  const alterar = o.permissoes.alterar;
  const emAberto = SITUACOES_OS_EM_ABERTO.includes(o.situacao);
  const aprovacaoPendente = o.aprovacaoComercial?.status === 'pendente';
  // Com aprovação comercial pendente, a O.S. fica parada: só o cancelamento anda.
  const acoes = alterar ? acoesPossiveis(o).filter((a) => !aprovacaoPendente || a === 'cancelar') : [];
  const podeEditarItens = alterar && !aprovacaoPendente && SITUACOES_OS_ITENS_EDITAVEIS.includes(o.situacao);
  const confirmacao = confirmando && ACOES[confirmando];

  return (
    <div className="space-y-6">
      <CabecalhoObjeto
        icone={
          <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-primaria-suave text-primaria">
            <Wrench className="size-5" aria-hidden />
          </span>
        }
        titulo={<span className="font-mono">{formatarNumeroOs(o.numero)}</span>}
        selos={
          <>
            <SeloSituacaoOs situacao={o.situacao} />
            {o.atrasada && <Selo tom="perigo">Atrasada</Selo>}
          </>
        }
        atributos={[
          { rotulo: 'Cliente', valor: o.cliente.nome },
          {
            rotulo: 'Veículo',
            valor: `${formatarPlaca(o.veiculo.placa)} — ${o.veiculo.marca} ${o.veiculo.modelo}`,
          },
          { rotulo: 'Km de entrada', valor: o.kmEntrada.toLocaleString('pt-BR') },
          { rotulo: 'Previsão de entrega', valor: dataHora(o.previsaoEntrega) ?? 'Sem previsão' },
          { rotulo: 'Total', valor: <span className="font-semibold">{formatarMoeda(o.totalCentavos)}</span> },
        ]}
        acoes={
          <>
            {acoes.map((a) => (
              <Botao key={a} variante={ACOES[a].variante} onClick={() => setConfirmando(a)}>
                {ACOES[a].icone}
                {ACOES[a].rotulo}
              </Botao>
            ))}
            {alterar && o.situacao === 'concluida' && (
              <Botao variante="sucesso" onClick={() => setEntregando(true)}>
                <KeyRound className="mr-1.5 size-4" aria-hidden /> Entregar
              </Botao>
            )}
            {/* PDF gerado na hora pela API (OS-14), numa aba nova. */}
            <a
              href={`/api/ordens-servico/${o.id}/pdf`}
              target="_blank"
              rel="noopener"
              className={classesBotao('secundario')}
            >
              <FileText className="mr-1.5 size-4" aria-hidden /> PDF
            </a>
          </>
        }
      >
        <AvisoAprovacaoComercial aprovacao={o.aprovacaoComercial} />
        {o.situacao === 'recusada' && (
          <Alerta>
            Recusada pelo cliente em {dataHora(o.recusadaEm)}
            {o.motivoRecusa && ` — ${o.motivoRecusa}`}.
          </Alerta>
        )}
        {o.situacao === 'cancelada' && (
          <Alerta>
            Cancelada em {dataHora(o.canceladaEm)} — {o.motivoCancelamento}.
          </Alerta>
        )}
        {o.situacao === 'em_execucao' && o.pendenciasConclusao.length > 0 && (
          <Aviso>
            Para concluir: {o.pendenciasConclusao.join(' ')}{' '}
            <button type="button" className="font-medium underline" onClick={() => setAba('execucao')}>
              Ver execução
            </button>
          </Aviso>
        )}
        {o.concluidaEm && (
          <TextoSuave>
            Concluída em {dataHora(o.concluidaEm)} por {o.concluidaPor ?? '—'}.
          </TextoSuave>
        )}
        <Alerta>{acao.isError && !confirmando && acao.error.message}</Alerta>
      </CabecalhoObjeto>

      <Abas
        abas={[
          { id: 'itens', rotulo: 'Serviços e produtos', contagem: o.itens.length },
          { id: 'execucao', rotulo: 'Execução', contagem: o.pecasSolicitadas || undefined },
          { id: 'recepcao', rotulo: 'Recepção' },
          { id: 'fotos', rotulo: 'Fotos', contagem: o.fotos.length },
          { id: 'diagnostico', rotulo: 'Diagnóstico' },
          { id: 'dados', rotulo: 'Dados e mecânicos' },
          { id: 'historico', rotulo: 'Histórico' },
        ]}
        atual={aba}
        aoTrocar={setAba}
      />

      {/* Abas escondidas, não desmontadas: a edição em andamento numa aba não se perde ao trocar. */}
      <div hidden={aba !== 'execucao'}>
        <Cartao className="p-5">
          <ExecucaoOs os={o} aoSalvar={guardar} />
        </Cartao>
      </div>
      <div hidden={aba !== 'recepcao'}>
        <Cartao className="p-5">
          <ChecklistOs os={o} podeAlterar={alterar && emAberto} aoSalvar={guardar} />
        </Cartao>
      </div>
      <div hidden={aba !== 'fotos'}>
        <Cartao className="p-5">
          <FotosOs os={o} podeAlterar={alterar && emAberto} aoSalvar={guardar} />
        </Cartao>
      </div>
      <div hidden={aba !== 'diagnostico'}>
        <Cartao className="p-5">
          <DiagnosticoOs os={o} podeAlterar={alterar && emAberto} aoSalvar={guardar} />
        </Cartao>
      </div>

      <div hidden={aba !== 'itens'}>
        <Cartao className="p-5">
          <Secao
            titulo="Serviços e produtos"
            acao={
              podeEditarItens &&
              !editandoItens && (
                <Botao variante="secundario" onClick={() => setEditandoItens(true)}>
                  <Pencil className="mr-1.5 size-4" aria-hidden /> Editar itens
                </Botao>
              )
            }
          >
            <Aviso>{avisos.length > 0 && avisos.join(' ')}</Aviso>
            {editandoItens ? (
              <EdicaoItens
                os={o}
                aoSalvar={(salva) => {
                  guardar(salva);
                  setAvisos(salva.avisos);
                  setEditandoItens(false);
                }}
                aoCancelar={() => setEditandoItens(false)}
              />
            ) : (
              <ItensDaOs os={o} />
            )}
          </Secao>
        </Cartao>
      </div>

      <div hidden={aba !== 'dados'} className="grid gap-4 lg:grid-cols-2">
        <Cartao className="p-5">
          <Secao
            titulo="Dados"
            acao={
              alterar &&
              emAberto && (
                <Botao variante="secundario" onClick={() => setEditandoDados(true)}>
                  <Pencil className="mr-1.5 size-4" aria-hidden /> Alterar
                </Botao>
              )
            }
          >
            <dl className="grid gap-3 sm:grid-cols-2">
              <Dado rotulo="Vendedor">{o.vendedor && `${o.vendedor.nome}${o.vendedor.ativo ? '' : ' (inativo)'}`}</Dado>
              <Dado rotulo="Tabela de preço">{o.tabela.nome}</Dado>
              <Dado rotulo="Aberta">{`${dataHora(o.abertaEm)} por ${o.criadaPor ?? '—'}`}</Dado>
              <Dado rotulo="Orçamento de origem">
                {o.orcamento && (
                  <Link to={`/orcamentos/${o.orcamento.id}`} className="text-primaria hover:underline">
                    {formatarNumeroOrcamento(o.orcamento.numero)} v{o.orcamento.versaoOrcamento}
                  </Link>
                )}
              </Dado>
              {o.aprovadaEm && (
                <Dado rotulo="Aprovada pelo cliente">{`${dataHora(o.aprovadaEm)} por ${o.aprovadaPor ?? '—'}`}</Dado>
              )}
              {o.entregueEm && (
                <>
                  <Dado rotulo="Entregue">{`${dataHora(o.entregueEm)} por ${o.entreguePor ?? '—'}`}</Dado>
                  <Dado rotulo="Km de saída">{o.kmSaida?.toLocaleString('pt-BR')}</Dado>
                  <Dado rotulo="Retirado por">{o.recebidoPor}</Dado>
                  <Dado rotulo="Observações da entrega">{o.observacoesEntrega}</Dado>
                </>
              )}
            </dl>
            <Dado rotulo="Relato do cliente">
              <span className="whitespace-pre-line">{o.relatoCliente}</span>
            </Dado>
            <Dado rotulo="Observações">
              <span className="whitespace-pre-line">{o.observacoes}</span>
            </Dado>
          </Secao>
        </Cartao>

        <Cartao className="p-5">
          <Mecanicos os={o} podeAlterar={alterar && emAberto} aoSalvar={guardar} />
        </Cartao>
      </div>

      <div hidden={aba !== 'historico'}>
        <Cartao className="p-5">
          <Secao titulo="Histórico">
            <ul className="space-y-2 text-sm">
              {o.eventos.map((e, n) => (
                <li key={n} className="flex flex-wrap gap-x-2">
                  <span className="whitespace-nowrap text-texto-suave">{dataHora(e.criadoEm)}</span>
                  <span className="font-medium">{EVENTOS_OS[e.evento]}</span>
                  {e.situacaoAnterior && e.situacaoNova && (
                    <span className="text-texto-suave">
                      ({SITUACOES_OS[e.situacaoAnterior]} → {SITUACOES_OS[e.situacaoNova]})
                    </span>
                  )}
                  {e.usuario && <span className="text-texto-suave">por {e.usuario}</span>}
                  {e.detalhe && <span className="w-full text-texto-suave sm:w-auto">— {e.detalhe}</span>}
                </li>
              ))}
            </ul>
          </Secao>
        </Cartao>
      </div>

      {entregando && <JanelaEntrega os={o} aoSalvar={guardar} aoFechar={() => setEntregando(false)} />}
      {editandoDados && <JanelaDados os={o} aoSalvar={guardar} aoFechar={() => setEditandoDados(false)} />}

      {confirmando && confirmacao && (
        <Janela titulo={confirmacao.rotulo} aoFechar={() => setConfirmando(null)}>
          <div className="space-y-4">
            <TextoSuave>{confirmacao.texto}</TextoSuave>
            {confirmacao.motivo && (
              <Campo rotulo={confirmacao.motivo.rotulo}>
                <AreaTexto rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              </Campo>
            )}
            <Alerta>{acao.isError && acao.error.message}</Alerta>
            <div className="flex justify-end gap-2">
              <Botao variante="secundario" onClick={() => setConfirmando(null)}>
                Voltar
              </Botao>
              <Botao
                variante={confirmacao.variante === 'secundario' ? 'primario' : confirmacao.variante}
                disabled={acao.isPending || (!!confirmacao.motivo?.obrigatorio && !motivo.trim())}
                onClick={() => acao.mutate({ tipo: confirmando, o })}
              >
                {confirmacao.rotulo}
              </Botao>
            </div>
          </div>
        </Janela>
      )}
    </div>
  );
}

const Dado = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <div>
    <dt className="text-xs text-texto-suave">{rotulo}</dt>
    <dd className="text-sm text-texto">{children || '—'}</dd>
  </div>
);

/** Itens gravados (leitura): catálogo e avulsos, com a aprovação do cliente de cada um. */
function ItensDaOs({ os: o }: { os: OrdemServico }) {
  return (
    <>
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
              <Td className="whitespace-nowrap font-mono text-xs">{i.codigo ?? '—'}</Td>
              <Td>
                <span className="mr-2">{i.descricao}</span>
                {i.avulso && <Selo tom="neutro">Avulso</Selo>}{' '}
                {i.aprovacao === 'pendente' && <Selo tom="alerta">Aguardando cliente</Selo>}
              </Td>
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
          {o.itens.length === 0 && <LinhaVazia colunas={5}>Nenhum item ainda.</LinhaVazia>}
        </tbody>
      </Tabela>
      <Totais
        subtotal={o.subtotalServicosCentavos + o.subtotalMateriaisCentavos}
        desconto={o.descontoCentavos}
        total={o.totalCentavos}
      />
    </>
  );
}

/**
 * Edição dos itens com gravação explícita ("Salvar itens", com a versão lida). Catálogo: a mesma tela do orçamento,
 * com a busca da O.S. (produtos com "Permite uso em O.S."); desconto acima da alçada de quem salva manda a O.S.
 * para a aprovação comercial. Avulsos: preço final digitado.
 */
function EdicaoItens({
  os: o,
  aoSalvar,
  aoCancelar,
}: {
  os: OrdemServico;
  aoSalvar: (o: OrdemServico) => void;
  aoCancelar: () => void;
}) {
  const notificar = useNotificar();
  const pecas = o.permissoes.produtos;
  const [linhas, setLinhas] = useState<LinhaTela[]>(() =>
    o.itens.filter((i) => !i.avulso).map((i) => linhaDoItem({ ...i, codigo: i.codigo ?? '' })),
  );
  const [avulsos, setAvulsos] = useState<LinhaAvulsa[]>(() => o.itens.filter((i) => i.avulso).map(avulsoDoItem));
  const [tipo, setTipo] = useState<FiltroTipoItem>(pecas ? '' : 'servico');
  const [erro, setErro] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: () =>
      api<OrdemServico>(`/ordens-servico/${o.id}/itens`, {
        method: 'PUT',
        body: { itens: [...linhas.map(itemParaApi), ...avulsos.map(avulsoParaApi)], versao: o.versao },
      }),
    onSuccess: (salva) => {
      if (salva.aprovacaoComercial?.status === 'pendente' && o.aprovacaoComercial?.status !== 'pendente')
        notificar('Itens salvos. O desconto passou da sua alçada: a O.S. aguarda a aprovação comercial.', 'alerta');
      else notificar('Itens salvos.');
      aoSalvar(salva);
    },
  });
  const conferirESalvar = () => {
    if (linhas.some((l) => precoDaLinha(l).erro)) return setErro('Corrija a negociação dos itens marcados.');
    if (!linhas.every(linhaValida)) return setErro('Informe a quantidade (ou as horas) de todos os itens.');
    if (!avulsos.every(avulsoValido))
      return setErro('Preencha descrição, quantidade (ou horas) e preço de todos os itens avulsos.');
    setErro(null);
    salvar.mutate();
  };

  return (
    <div className="space-y-6">
      <ItensOrcamento
        linhas={linhas}
        aoMudarLinhas={setLinhas}
        tabelaPrecoId={o.tabela.id}
        tipo={tipo}
        aoMudarTipo={setTipo}
        buscaEm={`${APOIO_OS}/itens`}
        filtros={pecas ? undefined : ['servico']}
        descricao={`Preços da tabela ${o.tabela.nome}.${pecas ? '' : ' Produtos exigem a permissão "Peças na O.S.".'}`}
      />
      <ItensAvulsos linhas={avulsos} aoMudarLinhas={setAvulsos} pecas={pecas} />
      <Alerta>{erro || (salvar.isError && salvar.error.message)}</Alerta>
      <div className="flex justify-end gap-2">
        <Botao variante="secundario" onClick={aoCancelar}>
          <X className="mr-1.5 size-4" aria-hidden /> Cancelar
        </Botao>
        <Botao disabled={salvar.isPending} onClick={conferirESalvar}>
          {salvar.isPending ? 'Salvando…' : 'Salvar itens'}
        </Botao>
      </div>
    </div>
  );
}

type EntradaDados = z.input<typeof cabecalhoOsInputSchema>;
type SaidaDados = z.output<typeof cabecalhoOsInputSchema>;

/** Relato, observações, vendedor e previsão de entrega (cliente, veículo e km de entrada não mudam). */
type EntradaEntrega = z.input<typeof entregaOsInputSchema>;
type SaidaEntrega = z.output<typeof entregaOsInputSchema>;

/** Entrega ao cliente (OS-13): km de saída (não menor que o de entrada), quem retirou e observações. */
function JanelaEntrega({
  os: o,
  aoSalvar,
  aoFechar,
}: {
  os: OrdemServico;
  aoSalvar: (o: OrdemServico) => void;
  aoFechar: () => void;
}) {
  const form = useForm<EntradaEntrega, unknown, SaidaEntrega>({
    resolver: zodResolver(entregaOsInputSchema),
    defaultValues: { recebidoPor: o.cliente.nome, observacoesEntrega: '', versao: o.versao },
    mode: 'onTouched',
  });
  const erros = form.formState.errors;
  const entregar = useMutation({
    mutationFn: (dados: SaidaEntrega) =>
      api<OrdemServico>(`/ordens-servico/${o.id}/entregar`, { method: 'POST', body: dados }),
    onSuccess: (salva) => {
      aoSalvar(salva);
      aoFechar();
    },
  });
  return (
    <Janela titulo="Entregar ao cliente" aoFechar={aoFechar}>
      <form noValidate onSubmit={form.handleSubmit((d) => entregar.mutate(d))} className="space-y-4">
        <TextoSuave>
          A O.S. fica entregue e não muda mais. O PDF passa a trazer o termo de entrega para a assinatura do cliente.
        </TextoSuave>
        <Campo rotulo={`Km de saída * (entrada: ${o.kmEntrada.toLocaleString('pt-BR')})`} erro={erros.kmSaida}>
          <Input
            type="number"
            inputMode="numeric"
            min={o.kmEntrada}
            {...form.register('kmSaida', { setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)) })}
          />
        </Campo>
        <Campo rotulo="Retirado por" erro={erros.recebidoPor}>
          <Input maxLength={120} {...form.register('recebidoPor')} />
        </Campo>
        <Campo rotulo="Observações da entrega" erro={erros.observacoesEntrega}>
          <AreaTexto rows={2} maxLength={1000} {...form.register('observacoesEntrega')} />
        </Campo>
        <Alerta>{entregar.isError && aplicarErrosDaApi(entregar.error, form.setError)}</Alerta>
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundario" onClick={aoFechar}>
            Voltar
          </Botao>
          <Botao type="submit" variante="sucesso" disabled={entregar.isPending}>
            {entregar.isPending ? 'Entregando…' : 'Entregar'}
          </Botao>
        </div>
      </form>
    </Janela>
  );
}

function JanelaDados({
  os: o,
  aoSalvar,
  aoFechar,
}: {
  os: OrdemServico;
  aoSalvar: (o: OrdemServico) => void;
  aoFechar: () => void;
}) {
  const vendedores = useVendedoresOs();
  const form = useForm<EntradaDados, unknown, SaidaDados>({
    resolver: zodResolver(cabecalhoOsInputSchema),
    defaultValues: {
      relatoCliente: o.relatoCliente ?? '',
      observacoes: o.observacoes ?? '',
      vendedorId: o.vendedor?.id ?? '',
      previsaoEntrega: paraCampoDataHora(o.previsaoEntrega),
      versao: o.versao,
    },
    mode: 'onTouched',
  });
  const erros = form.formState.errors;
  const salvar = useMutation({
    mutationFn: (dados: SaidaDados) => api<OrdemServico>(`/ordens-servico/${o.id}`, { method: 'PUT', body: dados }),
    onSuccess: (salva) => {
      aoSalvar(salva);
      aoFechar();
    },
  });
  // O vendedor atual continua na lista mesmo inativo (a API aceita manter; trocar exige um ativo).
  const opcoes = [
    ...(o.vendedor && !vendedores.data?.some((v) => v.id === o.vendedor!.id)
      ? [{ id: o.vendedor.id, nome: `${o.vendedor.nome} (inativo)` }]
      : []),
    ...(vendedores.data ?? []),
  ];
  return (
    <Janela titulo="Alterar dados da O.S." aoFechar={aoFechar}>
      <form noValidate onSubmit={form.handleSubmit((d) => salvar.mutate(d))} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Vendedor" erro={erros.vendedorId}>
            <Select {...form.register('vendedorId')}>
              <option value="">Sem vendedor</option>
              {opcoes.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nome}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo rotulo="Previsão de entrega" erro={erros.previsaoEntrega}>
            <Input type="datetime-local" {...form.register('previsaoEntrega')} />
          </Campo>
        </div>
        <Campo rotulo="Relato do cliente" erro={erros.relatoCliente}>
          <AreaTexto rows={3} {...form.register('relatoCliente')} />
        </Campo>
        <Campo rotulo="Observações" erro={erros.observacoes}>
          <AreaTexto rows={3} {...form.register('observacoes')} />
        </Campo>
        <Alerta>{salvar.isError && aplicarErrosDaApi(salvar.error, form.setError)}</Alerta>
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundario" onClick={aoFechar}>
            Voltar
          </Botao>
          <Botao type="submit" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </Botao>
        </div>
      </form>
    </Janela>
  );
}

/** Mecânicos vinculados (OS-05): quem pode alterar a O.S. vincula e desvincula; o mecânico vê só as dele. */
function Mecanicos({
  os: o,
  podeAlterar,
  aoSalvar,
}: {
  os: OrdemServico;
  podeAlterar: boolean;
  aoSalvar: (o: OrdemServico) => void;
}) {
  const mecanicos = useMecanicosOs(podeAlterar);
  const [escolhido, setEscolhido] = useState('');
  const vincular = useMutation({
    mutationFn: () =>
      api<OrdemServico>(`/ordens-servico/${o.id}/mecanicos`, {
        method: 'POST',
        body: { usuarioId: escolhido, versao: o.versao },
      }),
    onSuccess: (salva) => {
      setEscolhido('');
      aoSalvar(salva);
    },
  });
  const desvincular = useMutation({
    mutationFn: (usuarioId: string) =>
      api<OrdemServico>(`/ordens-servico/${o.id}/mecanicos/${usuarioId}?versao=${o.versao}`, { method: 'DELETE' }),
    onSuccess: aoSalvar,
  });
  const disponiveis = mecanicos.data?.filter((m) => !o.mecanicosVinculados.some((v) => v.id === m.id)) ?? [];
  return (
    <Secao titulo="Mecânicos">
      {o.mecanicosVinculados.length === 0 ? (
        <TextoSuave>Nenhum mecânico vinculado.</TextoSuave>
      ) : (
        <ul className="divide-y divide-borda text-sm">
          {o.mecanicosVinculados.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2">
              <span className="font-medium">{m.nome}</span>
              {podeAlterar && (
                <button
                  type="button"
                  title="Desvincular"
                  aria-label={`Desvincular ${m.nome}`}
                  disabled={desvincular.isPending}
                  className="inline-flex size-9 items-center justify-center rounded-md text-texto-suave hover:bg-superficie-alt hover:text-perigo"
                  onClick={() => desvincular.mutate(m.id)}
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {podeAlterar && (
        <div className="flex gap-2">
          <Select aria-label="Mecânico" value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
            <option value="">
              {mecanicos.data?.length === 0 ? 'Nenhum usuário com função de mecânico' : 'Escolha o mecânico'}
            </option>
            {disponiveis.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </Select>
          <Botao variante="secundario" disabled={!escolhido || vincular.isPending} onClick={() => vincular.mutate()}>
            <UserPlus className="mr-1.5 size-4" aria-hidden /> Vincular
          </Botao>
        </div>
      )}
      <Alerta>
        {(vincular.isError && vincular.error.message) || (desvincular.isError && desvincular.error.message)}
      </Alerta>
    </Secao>
  );
}
