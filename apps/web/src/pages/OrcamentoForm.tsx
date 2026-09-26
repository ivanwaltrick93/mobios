import { zodResolver } from '@hookform/resolvers/zod';
import {
  formatarDataIso,
  formatarMoeda,
  formatarNumeroOrcamento,
  formatarPlaca,
  hojeIso,
  VALIDADE_PADRAO_DIAS,
  type Orcamento,
} from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, RotateCw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useBlocker, useNavigate, useParams } from 'react-router';
import {
  cabecalhoSchema,
  CamposCabecalho,
  useVeiculosCliente,
  valoresDoOrcamento,
  type ClienteEscolhido,
  type EntradaCabecalho as Entrada,
  type SaidaCabecalho as Saida,
} from '../components/CabecalhoOrcamento';
import { Etapas } from '../components/Etapas';
import { ItensOrcamento } from '../components/ItensOrcamento';
import { atributosDoOrcamento, SeloSituacao } from '../components/Orcamento';
import { FaixaResumo, RevisaoOrcamento, totaisDasLinhas } from '../components/ResumoOrcamento';
import {
  Alerta,
  Aviso,
  Botao,
  CabecalhoObjeto,
  CabecalhoPagina,
  Cartao,
  Confirmacao,
  Janela,
  TextoSuave,
} from '../components/ui';
import { api } from '../lib/api';
import {
  contarItens,
  itemParaApi,
  linhaDoItem,
  linhaValida,
  precoDaLinha,
  type FiltroTipoItem,
  type LinhaTela,
} from '../lib/linhasOrcamento';
import { aplicarErrosDaApi } from '../lib/formulario';
import { useOrcamento, useTabelasOrcamento, useVendedoresOrcamento } from '../lib/orcamentos';
import { usePerfilOrcamento } from '../lib/sessao';

// ---------- Jornada: Cliente → Produtos e serviços → Revisão → Finalizar ----------

const ETAPAS = ['Cliente', 'Produtos e serviços', 'Revisão'];
const CLIENTE = 0;
const PRODUTOS = 1;
const REVISAO = 2;
/** Campos validados ao sair da etapa Cliente. */
const CAMPOS_CLIENTE = ['clienteId', 'veiculoId', 'vendedorId', 'tabelaPrecoId', 'validadeAte', 'observacoes'] as const;
/** Espera depois da última digitação antes de gravar (incluir e remover item gravam na hora). */
const ESPERA_GRAVACAO_MS = 800;

/** Barra de ações de cada etapa (voltar à esquerda, avançar à direita). */
const BarraAcoes = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-borda bg-superficie px-4 py-3 shadow-sm">
    {children}
  </div>
);

const detalhesDasEtapas = (cliente: string | null | undefined, linhas: LinhaTela[]) => [
  cliente ?? 'Identifique o cliente',
  linhas.length
    ? `${contarItens(linhas.length)} · ${formatarMoeda(totaisDasLinhas(linhas).totalCentavos)}`
    : 'Adicione os itens',
  'Confira e finalize',
];

/** Pede confirmação ao sair (navegação do app e fechar/recarregar a aba) enquanto `ativo`. */
function useConfirmarSaida(ativo: boolean, liberado: { current: boolean }, mensagem: string) {
  const bloqueio = useBlocker(
    ({ currentLocation, nextLocation }) =>
      ativo && !liberado.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!ativo) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [ativo]);
  return bloqueio.state === 'blocked' ? (
    <Confirmacao
      titulo="Sair do orçamento?"
      mensagem={mensagem}
      rotuloConfirmar="Sair assim mesmo"
      perigo
      aoConfirmar={() => bloqueio.proceed()}
      aoFechar={() => bloqueio.reset()}
    />
  ) : null;
}

/**
 * Novo orçamento, etapa Cliente. "Continuar para produtos" cria o rascunho (POST) e abre a edição dele, onde a
 * jornada continua com gravação automática: a partir daí, atualizar a página ou voltar ao orçamento recupera tudo.
 */
export function NovoOrcamento() {
  const perfil = usePerfilOrcamento();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tabelas = useTabelasOrcamento(perfil.podeAlterar);
  const [cliente, setCliente] = useState<ClienteEscolhido | null>(null);
  const form = useForm<Entrada, unknown, Saida>({
    resolver: zodResolver(cabecalhoSchema),
    // O vendedor logado já vem como vendedor do orçamento.
    defaultValues: { ...valoresDoOrcamento(), vendedorId: perfil.vendedorId ?? '' },
    mode: 'onTouched',
  });
  // A tabela padrão da oficina já vem escolhida.
  const padraoId = tabelas.data?.find((t) => t.padrao)?.id;
  useEffect(() => {
    if (padraoId && !form.getValues('tabelaPrecoId')) form.setValue('tabelaPrecoId', padraoId);
  }, [padraoId, form]);
  const criando = useRef(false);
  const criar = useMutation({
    mutationFn: (dados: Saida) => api<Orcamento>('/orcamentos', { method: 'POST', body: { ...dados, itens: [] } }),
    onMutate: () => {
      criando.current = true;
    },
    onError: () => {
      criando.current = false;
    },
    onSuccess: (o) => {
      queryClient.setQueryData(['orcamentos', o.id], o);
      queryClient.invalidateQueries({ queryKey: ['orcamentos', 'lista'] });
      navigate(`/orcamentos/${o.id}/editar`, { replace: true });
    },
  });
  const confirmacaoSaida = useConfirmarSaida(
    !!cliente,
    criando,
    'O orçamento ainda não foi criado. Se sair agora, o que foi preenchido será perdido.',
  );
  const continuar = form.handleSubmit((dados) => criar.mutate(dados));

  if (!perfil.podeAlterar) return <Alerta>Só o Administrador e os vendedores criam orçamentos.</Alerta>;
  if (tabelas.data?.length === 0)
    return (
      <Alerta>
        A oficina ainda não tem tabela de preço. Cadastre uma em Política Comercial → Tabelas de Preço para fazer
        orçamentos.
      </Alerta>
    );

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <CabecalhoPagina titulo="Novo orçamento" subtitulo="Monte a proposta: cliente, produtos e serviços, revisão." />
      <Cartao className="px-4 py-3">
        <Etapas
          rotulo="Etapas do orçamento"
          titulos={ETAPAS}
          detalhes={detalhesDasEtapas(cliente?.nome, [])}
          atual={CLIENTE}
          aoIr={() => undefined}
        />
      </Cartao>
      <Cartao className="p-4 sm:p-5">
        <CamposCabecalho
          form={form}
          cliente={cliente}
          aoTrocarCliente={(c) => {
            setCliente(c);
            form.setValue('clienteId', c.id, { shouldValidate: true });
            form.setValue('veiculoId', '');
          }}
          aoMudarTabela={(id) => form.setValue('tabelaPrecoId', id)}
        />
      </Cartao>
      <Alerta>{criar.isError && aplicarErrosDaApi(criar.error, form.setError)}</Alerta>
      <BarraAcoes>
        <span className="mr-auto text-xs text-texto-suave">
          Ao continuar, o rascunho é criado e cada alteração passa a ser salva automaticamente.
        </span>
        <Botao type="button" variante="secundario" onClick={() => navigate(-1)}>
          Cancelar
        </Botao>
        <Botao type="button" disabled={criar.isPending} onClick={() => void continuar()}>
          {criar.isPending ? 'Criando…' : 'Continuar para produtos'}
          {!criar.isPending && <ArrowRight className="ml-1.5 size-4" aria-hidden />}
        </Botao>
      </BarraAcoes>
      {confirmacaoSaida}
    </div>
  );
}

type Gravacao =
  | { estado: 'salvo'; em: Date | null }
  | { estado: 'salvando' }
  | { estado: 'invalido'; motivo: string }
  | { estado: 'erro'; motivo: string };

/** Estado da gravação automática, ao lado do resumo. */
function SituacaoGravacao({ gravacao, aoTentar }: { gravacao: Gravacao; aoTentar: () => void }) {
  const base = 'flex items-center gap-1.5 text-xs';
  if (gravacao.estado === 'salvando')
    return (
      <span role="status" className={`${base} text-texto-suave`}>
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Salvando…
      </span>
    );
  if (gravacao.estado === 'erro')
    return (
      <span role="alert" className={`${base} text-perigo`}>
        <TriangleAlert className="size-3.5" aria-hidden /> Não foi possível salvar: {gravacao.motivo}
        <button type="button" onClick={aoTentar} className="inline-flex items-center gap-1 font-medium underline">
          <RotateCw className="size-3.5" aria-hidden /> Tentar de novo
        </button>
      </span>
    );
  if (gravacao.estado === 'invalido')
    return (
      <span role="status" className={`${base} text-alerta`}>
        <TriangleAlert className="size-3.5" aria-hidden /> {gravacao.motivo}
      </span>
    );
  return (
    <span role="status" className={`${base} text-sucesso`}>
      <CheckCircle2 className="size-3.5" aria-hidden />
      {gravacao.em ? `Salvo às ${gravacao.em.toLocaleTimeString('pt-BR', { timeStyle: 'short' })}` : 'Salvo'}
    </span>
  );
}

/** O que a gravação automática compara para saber se há mudança (sem os ids, que chegam depois de gravar). */
const assinaturaDe = (cabecalho: Entrada, linhas: LinhaTela[]) =>
  JSON.stringify({ cabecalho, itens: linhas.map((l) => ({ ...itemParaApi(l), id: undefined, chave: l.chave })) });

/**
 * Jornada do rascunho já criado (docs/modulos/ORCAMENTOS.md §5): cada alteração do cabeçalho e dos itens é gravada
 * automaticamente com o PUT do rascunho (incluir e remover na hora; digitação, após uma pausa), uma gravação por
 * vez e sempre com a versão lida. Os ids devolvidos pela API passam às linhas, então nada é criado duas vezes.
 * "Finalizar" leva ao resumo (o orçamento continua rascunho; a emissão é lá).
 */
function JornadaOrcamento({
  orcamento,
  avisosIniciais,
  aoTrocarTabela,
}: {
  orcamento: Orcamento;
  /** Avisos da gravação que remontou a jornada (itens removidos ou reprecificados na troca de tabela). */
  avisosIniciais: string[];
  /** A API reprecificou os itens na nova tabela: a página remonta com os dados gravados. */
  aoTrocarTabela: (o: Orcamento) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tabelas = useTabelasOrcamento();
  const vendedores = useVendedoresOrcamento();
  const [etapa, setEtapa] = useState(PRODUTOS);
  const [cliente, setCliente] = useState<ClienteEscolhido>(orcamento.cliente);
  const [linhas, setLinhas] = useState<LinhaTela[]>(() => orcamento.itens.map(linhaDoItem));
  const [tipo, setTipo] = useState<FiltroTipoItem>('');
  const [tabelaPendente, setTabelaPendente] = useState<string | null>(null);
  const [erroEtapa, setErroEtapa] = useState<string | null>(null);
  const [avisos, setAvisos] = useState(avisosIniciais);
  const [gravacao, setGravacao] = useState<Gravacao>({ estado: 'salvo', em: null });
  const form = useForm<Entrada, unknown, Saida>({
    resolver: zodResolver(cabecalhoSchema),
    defaultValues: valoresDoOrcamento(orcamento),
    mode: 'onTouched',
  });
  const veiculos = useVeiculosCliente(cliente.id);
  const cabecalho = form.watch();

  // ---- Gravação automática ----
  const versao = useRef(orcamento.versao);
  const tabelaGravada = useRef(orcamento.tabela.id);
  const linhasAtuais = useRef(linhas);
  const emAndamento = useRef(false);
  const deNovo = useRef(false);
  const saindo = useRef(false);
  const assinatura = assinaturaDe(cabecalho, linhas);
  const [assinaturaGravada, setAssinaturaGravada] = useState(assinatura);
  useEffect(() => {
    linhasAtuais.current = linhas;
  }, [linhas]);

  const gravar = useCallback(async () => {
    if (emAndamento.current) {
      deNovo.current = true;
      return;
    }
    const enviadas = linhasAtuais.current;
    const valores = form.getValues();
    const dados = cabecalhoSchema.safeParse(valores);
    if (!dados.success) return setGravacao({ estado: 'invalido', motivo: 'Revise os dados do cliente para salvar.' });
    if (enviadas.some((l) => precoDaLinha(l).erro))
      return setGravacao({ estado: 'invalido', motivo: 'Corrija a negociação para salvar.' });
    if (!enviadas.every(linhaValida))
      return setGravacao({ estado: 'invalido', motivo: 'Informe a quantidade dos itens para salvar.' });

    emAndamento.current = true;
    setGravacao({ estado: 'salvando' });
    try {
      const salvo = await api<Orcamento>(`/orcamentos/${orcamento.id}`, {
        method: 'PUT',
        body: { ...dados.data, itens: enviadas.map(itemParaApi), versao: versao.current, automatico: true },
      });
      versao.current = salvo.versao;
      queryClient.setQueryData(['orcamentos', orcamento.id], salvo);
      queryClient.invalidateQueries({ queryKey: ['orcamentos', 'lista'], refetchType: 'none' });
      if (salvo.tabela.id !== tabelaGravada.current) {
        tabelaGravada.current = salvo.tabela.id;
        return aoTrocarTabela(salvo);
      }
      // Itens novos recebem o id gravado (mesma ordem do envio); se a API tirou algum, vale o que ela gravou.
      if (salvo.itens.length === enviadas.length)
        setLinhas((atuais) =>
          atuais.map((l) => {
            const i = enviadas.findIndex((e) => e.chave === l.chave);
            return i < 0 || l.id ? l : { ...l, id: salvo.itens[i]!.id };
          }),
        );
      else setLinhas(salvo.itens.map(linhaDoItem));
      setAvisos(salvo.avisos);
      setAssinaturaGravada(assinaturaDe(valores, enviadas));
      setGravacao({ estado: 'salvo', em: new Date() });
    } catch (e) {
      setGravacao({ estado: 'erro', motivo: e instanceof Error ? e.message : 'erro inesperado.' });
    } finally {
      emAndamento.current = false;
      if (deNovo.current) {
        deNovo.current = false;
        void gravar();
      }
    }
  }, [form, orcamento.id, queryClient, aoTrocarTabela]);

  // Mudou algo: grava (incluir/remover na hora; digitação, depois de uma pausa).
  const quantidadeGravada = useRef(linhas.length);
  useEffect(() => {
    if (assinatura === assinaturaGravada) return;
    const imediato = linhas.length !== quantidadeGravada.current;
    quantidadeGravada.current = linhas.length;
    const espera = setTimeout(() => void gravar(), imediato ? 0 : ESPERA_GRAVACAO_MS);
    return () => clearTimeout(espera);
  }, [assinatura, assinaturaGravada, linhas.length, gravar]);

  const pendente = assinatura !== assinaturaGravada || gravacao.estado !== 'salvo';
  const confirmacaoSaida = useConfirmarSaida(
    pendente,
    saindo,
    'Há alterações que ainda não foram salvas. Se sair agora, elas serão perdidas.',
  );

  // ---- Etapas ----
  const irPara = (i: number) => {
    setErroEtapa(null);
    setEtapa(i);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const continuarParaProdutos = async () => {
    if (await form.trigger([...CAMPOS_CLIENTE])) irPara(PRODUTOS);
  };
  const revisar = () => {
    if (!linhas.length) return setErroEtapa('Inclua ao menos um produto ou serviço para revisar o orçamento.');
    if (linhas.some((l) => precoDaLinha(l).erro))
      return setErroEtapa('Corrija a negociação dos itens marcados antes de revisar.');
    irPara(REVISAO);
  };
  const finalizar = () => {
    if (pendente) return setErroEtapa('Aguarde o orçamento terminar de salvar.');
    saindo.current = true;
    navigate(`/orcamentos/${orcamento.id}`, { state: { avisosAoSalvar: avisos } });
  };

  const trocarCliente = (c: ClienteEscolhido) => {
    setCliente(c);
    form.setValue('clienteId', c.id, { shouldValidate: true, shouldDirty: true });
    form.setValue('veiculoId', '', { shouldDirty: true });
  };
  // Com itens, trocar a tabela reprecifica no servidor (volta ao preço cheio; sem preço, sai): pede confirmação.
  const mudarTabela = (id: string) => {
    if (linhas.length) setTabelaPendente(id);
    else form.setValue('tabelaPrecoId', id, { shouldDirty: true });
  };

  const veiculo = veiculos.data?.find((v) => v.id === cabecalho.veiculoId);
  const condicoes = [
    { rotulo: 'Vendedor', valor: vendedores.data?.find((v) => v.id === cabecalho.vendedorId)?.nome },
    { rotulo: 'Tabela de preço', valor: tabelas.data?.find((t) => t.id === cabecalho.tabelaPrecoId)?.nome },
    {
      rotulo: 'Validade',
      valor: cabecalho.validadeAte
        ? `Até ${formatarDataIso(String(cabecalho.validadeAte))}`
        : `${VALIDADE_PADRAO_DIAS} dias a partir da emissão`,
    },
    {
      rotulo: 'Veículo',
      valor: veiculo ? `${formatarPlaca(veiculo.placa)} — ${veiculo.marca} ${veiculo.modelo}` : 'Sem veículo',
    },
    { rotulo: 'Observações', valor: cabecalho.observacoes, largo: true },
  ];
  const situacao = <SituacaoGravacao gravacao={gravacao} aoTentar={() => void gravar()} />;

  return (
    <div className="space-y-4">
      <Cartao className="px-4 py-3">
        <Etapas
          rotulo="Etapas do orçamento"
          titulos={ETAPAS}
          detalhes={detalhesDasEtapas(cliente.nome, linhas)}
          atual={etapa}
          aoIr={irPara}
        />
      </Cartao>

      <FaixaResumo cliente={cliente.nome} linhas={linhas} situacao={situacao} />
      <Aviso>
        {avisos.length > 0 && (
          <ul className="list-inside list-disc space-y-0.5">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
      </Aviso>

      {etapa === CLIENTE && (
        <>
          <Cartao className="p-4 sm:p-5">
            <CamposCabecalho
              form={form}
              cliente={cliente}
              aoTrocarCliente={trocarCliente}
              aoMudarTabela={mudarTabela}
              clienteFixo={orcamento.versaoOrcamento > 1}
              vendedorAtualId={orcamento.vendedor.id}
            />
          </Cartao>
          <BarraAcoes>
            <Botao type="button" onClick={() => void continuarParaProdutos()}>
              Continuar para produtos <ArrowRight className="ml-1.5 size-4" aria-hidden />
            </Botao>
          </BarraAcoes>
        </>
      )}

      {etapa === PRODUTOS && (
        <>
          <Cartao className="p-4 sm:p-5">
            <ItensOrcamento
              linhas={linhas}
              aoMudarLinhas={setLinhas}
              tabelaPrecoId={String(cabecalho.tabelaPrecoId ?? '')}
              tipo={tipo}
              aoMudarTipo={setTipo}
            />
          </Cartao>
          <Alerta>{erroEtapa}</Alerta>
          <BarraAcoes>
            <Botao type="button" variante="secundario" className="mr-auto" onClick={() => irPara(CLIENTE)}>
              <ArrowLeft className="mr-1.5 size-4" aria-hidden /> Cliente
            </Botao>
            <Botao type="button" onClick={revisar}>
              Revisar orçamento <ArrowRight className="ml-1.5 size-4" aria-hidden />
            </Botao>
          </BarraAcoes>
        </>
      )}

      {etapa === REVISAO && (
        <>
          <RevisaoOrcamento cliente={cliente} linhas={linhas} condicoes={condicoes} />
          <Alerta>{erroEtapa}</Alerta>
          <BarraAcoes>
            <Botao type="button" variante="secundario" className="mr-auto" onClick={() => irPara(PRODUTOS)}>
              <ArrowLeft className="mr-1.5 size-4" aria-hidden /> Voltar
            </Botao>
            <Botao type="button" variante="sucesso" disabled={pendente} onClick={finalizar}>
              {pendente ? 'Salvando…' : 'Finalizar'}
            </Botao>
          </BarraAcoes>
        </>
      )}

      {tabelaPendente && (
        <Janela titulo="Trocar a tabela de preço" aoFechar={() => setTabelaPendente(null)}>
          <div className="space-y-4">
            <TextoSuave>
              Os preços de todos os itens serão recalculados pela nova tabela, voltando ao preço cheio (a negociação é
              desfeita). Itens sem preço nela serão removidos do orçamento.
            </TextoSuave>
            <div className="flex gap-2">
              <Botao
                type="button"
                onClick={() => {
                  form.setValue('tabelaPrecoId', tabelaPendente, { shouldDirty: true });
                  setTabelaPendente(null);
                }}
              >
                Trocar e recalcular
              </Botao>
              <Botao type="button" variante="secundario" onClick={() => setTabelaPendente(null)}>
                Manter a tabela atual
              </Botao>
            </div>
          </div>
        </Janela>
      )}
      {confirmacaoSaida}
    </div>
  );
}

/** Edição do rascunho: a jornada aberta em Produtos e serviços, com gravação automática. */
export function EditarOrcamento() {
  const { id } = useParams() as { id: string };
  const perfil = usePerfilOrcamento();
  const queryClient = useQueryClient();
  const { orcamento, recalculando, erroRecalculo, avisos } = useOrcamento(id);
  // Remonta a jornada só quando a API reprecifica os itens (troca de tabela); a gravação automática não remonta.
  const [geracao, setGeracao] = useState(0);
  const [avisosDaTroca, setAvisosDaTroca] = useState<string[]>([]);

  if (!perfil.podeAlterar) return <Alerta>Só o Administrador e os vendedores alteram orçamentos.</Alerta>;
  if (orcamento.isError) return <Alerta>{orcamento.error.message}</Alerta>;
  if (erroRecalculo) return <Alerta>{erroRecalculo.message}</Alerta>;
  const o = orcamento.data;
  if (!o || recalculando || (o.status === 'rascunho' && o.precosEm < hojeIso()))
    return <TextoSuave>Carregando…</TextoSuave>;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <CabecalhoObjeto
        titulo={`${formatarNumeroOrcamento(o.numero)} · Versão ${o.versaoOrcamento}`}
        selos={<SeloSituacao situacao={o.situacao} />}
        atributos={atributosDoOrcamento(o, true)}
      />
      {o.status !== 'rascunho' ? (
        <Alerta>
          Só o rascunho pode ser alterado. Para mudar um orçamento emitido, gere uma nova versão no detalhe.
        </Alerta>
      ) : (
        <>
          <Aviso>
            {avisos.length > 0 && (
              <ul className="list-inside list-disc space-y-0.5">
                {avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </Aviso>
          <TextoSuave className="text-xs">Preços de {formatarDataIso(o.precosEm)}.</TextoSuave>
          <JornadaOrcamento
            key={geracao}
            orcamento={o}
            avisosIniciais={avisosDaTroca}
            aoTrocarTabela={(salvo) => {
              queryClient.setQueryData(['orcamentos', id], salvo);
              setAvisosDaTroca(salvo.avisos.length ? salvo.avisos : ['Itens recalculados pela nova tabela.']);
              setGeracao((g) => g + 1);
            }}
          />
        </>
      )}
    </div>
  );
}
