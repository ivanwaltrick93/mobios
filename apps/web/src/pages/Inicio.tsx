import {
  formatarDataIso,
  formatarMoeda,
  PERIODOS_PAINEL,
  SITUACOES_ORCAMENTO,
  type AlertaPainel,
  type Aniversariante,
  type Indicador,
  type ModuloId,
  type Nivel,
  type Painel,
  type PeriodoPainel,
  type SituacaoOrcamento,
} from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CarFront,
  ChevronRight,
  CircleCheck,
  FileBarChart,
  FilePlus2,
  Info,
  Package,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { LinkWhatsApp } from '../components/Cliente';
import { GraficoBarras, GraficoRosca } from '../components/Graficos';
import {
  Alerta,
  Bloco,
  CabecalhoPagina,
  Carregando,
  CartaoKpi,
  classesBotao,
  FiltroSelect,
  MenuAcoes,
  Selo,
  TextoSuave,
} from '../components/ui';
import { api } from '../lib/api';
import { usePode, useSessao } from '../lib/sessao';

// Início: cockpit da oficina. Responde, nesta ordem: como estão os resultados, o que precisa de atenção, como está o
// comercial e quais clientes merecem contato. Tudo vem do GET /painel; nada é calculado ou inventado aqui.

type Atalho = { para: string; rotulo: string; icone: LucideIcon; modulo: ModuloId; nivel: Nivel };

/** Ação principal do balcão: em destaque no cabeçalho. */
const NOVO_ORCAMENTO: Atalho = {
  para: '/orcamentos/novo',
  rotulo: 'Novo orçamento',
  icone: FilePlus2,
  modulo: 'orcamentos',
  nivel: 'editar',
};

/** Demais atalhos, agrupados num menu para não disputar com a ação principal. */
const ATALHOS: Atalho[] = [
  { para: '/clientes/novo', rotulo: 'Novo cliente', icone: UserPlus, modulo: 'clientes', nivel: 'editar' },
  { para: '/veiculos/novo', rotulo: 'Novo veículo', icone: CarFront, modulo: 'clientes', nivel: 'editar' },
  { para: '/estoque', rotulo: 'Estoque', icone: Package, modulo: 'estoque', nivel: 'consultar' },
  { para: '/relatorios', rotulo: 'Relatórios', icone: FileBarChart, modulo: 'relatorios', nivel: 'consultar' },
];

/** Resultados comerciais do período, em destaque; os demais indicadores com valor vêm menores, ao lado. */
const INDICADORES_PRINCIPAIS = ['orcamentos', 'valor_aprovado', 'taxa_aprovacao', 'ticket_medio'];

/**
 * Cor de cada situação no gráfico, só com tokens: neutro para rascunho e cancelado, alerta para o que aguarda,
 * informação para o que está com o cliente, sucesso para aprovado e perigo para recusado. Tons mais claros do mesmo
 * token distinguem situações da mesma família (emitido × enviado, reprovado × recusado, aguardando × vencido).
 */
const tomClaro = (token: string) => `color-mix(in oklab, var(${token}) 50%, var(--cor-superficie))`;
const COR_SITUACAO: Record<SituacaoOrcamento, string> = {
  rascunho: 'var(--cor-borda-forte)',
  aguardando_aprovacao_comercial: 'var(--cor-alerta)',
  reprovado_comercialmente: 'var(--cor-perigo)',
  emitido: 'var(--cor-info)',
  enviado: tomClaro('--cor-info'),
  aprovado: 'var(--cor-sucesso)',
  recusado: tomClaro('--cor-perigo'),
  vencido: tomClaro('--cor-alerta'),
  cancelado: 'var(--cor-texto-suave)',
};

function saudacao() {
  const hora = Number(
    new Date().toLocaleString('pt-BR', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }),
  );
  return hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
}

const valorDoIndicador = (i: Indicador) =>
  i.valor === null
    ? null
    : i.formato === 'moeda'
      ? formatarMoeda(i.valor)
      : i.formato === 'percentual'
        ? `${i.valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
        : i.valor.toLocaleString('pt-BR');

const periodoEmTexto = (p: Painel['periodo']) =>
  p.inicio === p.fim ? formatarDataIso(p.inicio) : `${formatarDataIso(p.inicio)} a ${formatarDataIso(p.fim)}`;

export function Inicio() {
  const sessao = useSessao();
  const pode = usePode();
  const [periodo, setPeriodo] = useState<PeriodoPainel>('mes');
  const painel = useQuery({
    queryKey: ['painel', periodo],
    queryFn: () => api<Painel>(`/painel?periodo=${periodo}`),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const dados = painel.data;
  const atalhos = ATALHOS.filter((a) => pode(a.modulo, a.nivel));

  return (
    <div className="space-y-4">
      <CabecalhoPagina
        titulo={`${saudacao()}, ${sessao.data?.usuario.nome.split(' ')[0] ?? ''}`}
        subtitulo={
          dados && (
            <>
              {sessao.data?.oficina.nome} · {periodoEmTexto(dados.periodo)}
              <span className="ml-2 text-xs">
                atualizado às{' '}
                {new Date(dados.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </>
          )
        }
        acoes={
          <>
            <FiltroSelect
              rotulo="Período"
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value as PeriodoPainel)}
            >
              {Object.entries(PERIODOS_PAINEL).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </FiltroSelect>
            <MenuAcoes
              texto
              rotulo="Atalhos"
              acoes={atalhos.map(({ para, rotulo, icone }) => ({ para, rotulo, icone }))}
            />
            {pode(NOVO_ORCAMENTO.modulo, NOVO_ORCAMENTO.nivel) && (
              <Link to={NOVO_ORCAMENTO.para} className={classesBotao('primario')}>
                <NOVO_ORCAMENTO.icone className="mr-1.5 size-4" aria-hidden /> {NOVO_ORCAMENTO.rotulo}
              </Link>
            )}
          </>
        }
      />

      {painel.isError && <Alerta>{painel.error.message}</Alerta>}
      {!dados && painel.isPending && <Carregando />}
      {dados && <Cockpit painel={dados} relacionamento={pode('clientes')} />}
    </div>
  );
}

/** Corpo do Início, com os dados do Painel já carregados. */
function Cockpit({ painel, relacionamento }: { painel: Painel; relacionamento: boolean }) {
  // Indicador sem valor é de módulo que ainda não existe: não ocupa espaço de KPI, vai para a nota do rodapé.
  const comValor = painel.indicadores.filter((i) => i.valor !== null);
  const principais = comValor.filter((i) => INDICADORES_PRINCIPAIS.includes(i.id));
  const apoio = comValor.filter((i) => !INDICADORES_PRINCIPAIS.includes(i.id));
  const emBreve = [
    ...painel.indicadores.filter((i) => i.valor === null).map((i) => i.titulo),
    ...painel.modulosPendentes,
  ];
  const comercial = painel.orcamentosPorSituacao !== null || painel.aprovadosPorVendedor !== null;
  // Com o comercial, duas colunas: resultados à esquerda, atenção e relacionamento à direita. A ordem no HTML é a
  // de leitura no celular (atenção logo depois dos indicadores); no desktop, a grade posiciona cada bloco.
  const direita = comercial ? 'lg:col-start-3' : 'lg:col-span-3';

  return (
    <>
      <section aria-label="Resultados do período" className="grid gap-3 lg:grid-cols-4">
        {principais.length > 0 && (
          <div
            className={`grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4 ${apoio.length ? 'lg:col-span-3' : 'lg:col-span-4'}`}
          >
            {principais.map((i) => (
              <CartaoKpi
                key={i.id}
                titulo={i.titulo}
                valor={valorDoIndicador(i)}
                detalhe={i.detalhe}
                variacao={i.variacao}
                para={i.link}
              />
            ))}
          </div>
        )}
        {apoio.length > 0 && (
          <div className={`grid grid-cols-2 gap-3 ${principais.length ? '' : 'md:grid-cols-4 lg:col-span-4'}`}>
            {apoio.map((i) => (
              <CartaoKpi
                key={i.id}
                compacto
                titulo={i.titulo}
                valor={valorDoIndicador(i)}
                detalhe={i.detalhe}
                variacao={i.variacao}
                para={i.link}
              />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <AcoesNecessarias alertas={painel.alertas} className={`${direita} lg:row-start-1`} />

        {painel.orcamentosPorSituacao && (
          <Bloco
            titulo="Orçamentos do período por situação"
            className="lg:col-span-2 lg:col-start-1 lg:row-start-1"
            acao={
              <Link to="/orcamentos" className="text-xs text-primaria hover:underline">
                Ver orçamentos
              </Link>
            }
          >
            <GraficoRosca
              vazio="Nenhum orçamento criado no período."
              centro={
                <>
                  <span className="text-2xl font-semibold tabular-nums">
                    {painel.orcamentosPorSituacao.reduce((s, o) => s + o.quantidade, 0)}
                  </span>
                  <span className="text-xs text-texto-suave">orçamentos</span>
                </>
              }
              fatias={(Object.keys(SITUACOES_ORCAMENTO) as SituacaoOrcamento[])
                .map((s) => {
                  const linha = painel.orcamentosPorSituacao!.find((o) => o.situacao === s);
                  return {
                    rotulo: SITUACOES_ORCAMENTO[s],
                    valor: linha?.quantidade ?? 0,
                    cor: COR_SITUACAO[s],
                    detalhe: linha ? formatarMoeda(linha.totalCentavos) : undefined,
                    para: `/orcamentos?situacao=${s}`,
                  };
                })
                .filter((f) => f.valor > 0)}
            />
          </Bloco>
        )}

        {painel.aprovadosPorVendedor && (
          <Bloco titulo="Valor aprovado por vendedor" className="lg:col-span-2 lg:col-start-1 lg:row-start-2">
            <GraficoBarras
              vazio="Nenhum orçamento aprovado no período."
              barras={painel.aprovadosPorVendedor.map((v) => ({
                rotulo: v.vendedor,
                valor: v.totalCentavos,
                texto: formatarMoeda(v.totalCentavos),
                detalhe: `${v.quantidade} orç.`,
              }))}
            />
          </Bloco>
        )}

        {relacionamento && (
          <Relacionamento lista={painel.aniversariantes} className={`${direita} lg:row-start-2 lg:self-start`} />
        )}
      </div>

      {emBreve.length > 0 && (
        <TextoSuave className="text-xs">Em breve neste painel: {[...new Set(emBreve)].join(' · ')}.</TextoSuave>
      )}
    </>
  );
}

/** Pendências que pedem ação (vindas do Painel), as de aviso primeiro; a linha inteira leva à tela da pendência. */
function AcoesNecessarias({ alertas, className }: { alertas: AlertaPainel[]; className: string }) {
  const ordenados = [...alertas].sort((a, b) => Number(b.nivel === 'aviso') - Number(a.nivel === 'aviso'));
  const avisos = alertas.filter((a) => a.nivel === 'aviso').length;
  return (
    <Bloco
      className={className}
      titulo={
        <span className="flex items-center gap-2">
          Ações necessárias
          {avisos > 0 && <Selo tom="alerta">{avisos}</Selo>}
        </span>
      }
    >
      {ordenados.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-texto-suave">
          <CircleCheck className="size-4 text-sucesso" aria-hidden /> Nenhuma pendência. Tudo em ordem.
        </p>
      ) : (
        <ul className="-mx-4 -my-4 divide-y divide-borda">
          {ordenados.map((a) => {
            const aviso = a.nivel === 'aviso';
            const Icone = aviso ? AlertTriangle : Info;
            const conteudo = (
              <>
                <span
                  className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded ${
                    aviso ? 'bg-alerta-suave text-alerta' : 'bg-info-suave text-info'
                  }`}
                >
                  <Icone className="size-3.5" aria-hidden />
                </span>
                <span className="flex-1 text-texto">{a.mensagem}</span>
                {a.link && <ChevronRight className="mt-0.5 size-4 shrink-0 text-texto-suave" aria-hidden />}
              </>
            );
            return (
              <li key={a.mensagem}>
                {a.link ? (
                  <Link
                    to={a.link}
                    className="flex items-start gap-3 px-4 py-2.5 text-sm hover:bg-superficie-alt focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primaria"
                  >
                    {conteudo}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 px-4 py-2.5 text-sm">{conteudo}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Bloco>
  );
}

const quandoFazAnos = (dias: number) => (dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`);

/** Aniversários de hoje e da semana, com atalho para dar parabéns pelo WhatsApp. Peso visual menor. */
function Relacionamento({ lista, className }: { lista: Aniversariante[]; className: string }) {
  const hoje = lista.filter((a) => a.dias === 0).length;
  return (
    <Bloco
      className={className}
      titulo="Relacionamento"
      acao={
        hoje > 0 ? (
          <Selo tom="primario">{hoje === 1 ? '1 aniversário hoje' : `${hoje} aniversários hoje`}</Selo>
        ) : undefined
      }
    >
      <TextoSuave className="-mt-1 mb-2 text-xs">Aniversários da semana: uma mensagem aproxima o cliente.</TextoSuave>
      {lista.length === 0 ? (
        <TextoSuave className="text-sm">Nenhum aniversário nesta semana.</TextoSuave>
      ) : (
        <ul className="-mx-1 max-h-72 divide-y divide-borda overflow-y-auto px-1">
          {lista.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-1.5 text-sm">
              <Link to={`/clientes/${a.id}`} className="min-w-0 flex-1 truncate text-texto hover:text-primaria">
                {a.nome}
              </Link>
              <span className={`shrink-0 text-xs ${a.dias === 0 ? 'font-medium text-primaria' : 'text-texto-suave'}`}>
                {quandoFazAnos(a.dias)}
              </span>
              {a.whatsapp && <LinkWhatsApp numero={a.whatsapp} soIcone />}
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}
