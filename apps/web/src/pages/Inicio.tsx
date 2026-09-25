import {
  formatarDataIso,
  formatarMoeda,
  PERIODOS_PAINEL,
  SITUACOES_ORCAMENTO,
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
  ArrowRight,
  Cake,
  CarFront,
  FileBarChart,
  FilePlus2,
  Info,
  Package,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { LinkWhatsApp, SeloAniversario } from '../components/Cliente';
import { GraficoBarras, GraficoRosca } from '../components/Graficos';
import { Alerta, Bloco, CabecalhoPagina, CartaoKpi, classesBotao, FiltroSelect, TextoSuave } from '../components/ui';
import { api } from '../lib/api';
import { usePode, useSessao } from '../lib/sessao';

type Atalho = { para: string; rotulo: string; icone: LucideIcon; modulo: ModuloId; nivel: Nivel };

// Ações mais frequentes do balcão, no topo da página.
const atalhos: Atalho[] = [
  { para: '/clientes/novo', rotulo: 'Novo cliente', icone: UserPlus, modulo: 'clientes', nivel: 'editar' },
  { para: '/veiculos/novo', rotulo: 'Novo veículo', icone: CarFront, modulo: 'clientes', nivel: 'editar' },
  { para: '/orcamentos/novo', rotulo: 'Novo orçamento', icone: FilePlus2, modulo: 'orcamentos', nivel: 'editar' },
  { para: '/estoque', rotulo: 'Estoque', icone: Package, modulo: 'estoque', nivel: 'consultar' },
  { para: '/relatorios', rotulo: 'Relatórios', icone: FileBarChart, modulo: 'relatorios', nivel: 'consultar' },
];

/** Cor de cada situação no gráfico (tokens do style guide). */
const COR_SITUACAO: Record<SituacaoOrcamento, string> = {
  rascunho: 'var(--cor-borda-forte)',
  emitido: 'var(--cor-info)',
  enviado: 'var(--cor-primaria)',
  aprovado: 'var(--cor-sucesso)',
  recusado: 'var(--cor-perigo)',
  vencido: 'var(--cor-alerta)',
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

/** Início: indicadores do período com variação, orçamentos por situação e por vendedor, alertas e aniversários. */
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
  const oficina = sessao.data?.oficina.nome;

  return (
    <div className="space-y-4">
      <CabecalhoPagina
        titulo={`${saudacao()}, ${sessao.data?.usuario.nome.split(' ')[0] ?? ''}`}
        subtitulo={
          dados &&
          `${oficina} · ${PERIODOS_PAINEL[periodo]}: ${formatarDataIso(dados.periodo.inicio)}${
            dados.periodo.inicio === dados.periodo.fim ? '' : ` a ${formatarDataIso(dados.periodo.fim)}`
          }`
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
            {atalhos
              .filter((a) => pode(a.modulo, a.nivel))
              .map(({ para, rotulo, icone: Icone }) => (
                <Link key={para} to={para} className={classesBotao('secundario')}>
                  <Icone className="mr-1.5 size-4 text-primaria" aria-hidden /> {rotulo}
                </Link>
              ))}
          </>
        }
      />

      {painel.isError && <Alerta>{painel.error.message}</Alerta>}

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {dados?.indicadores.map((i) => (
          <CartaoKpi
            key={i.id}
            titulo={i.titulo}
            valor={valorDoIndicador(i)}
            detalhe={i.detalhe}
            variacao={i.variacao}
            para={i.link}
          />
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {dados?.orcamentosPorSituacao && (
          <Bloco
            titulo="Orçamentos do período por situação"
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
                  <span className="text-xl font-semibold tabular-nums">
                    {dados.orcamentosPorSituacao.reduce((s, o) => s + o.quantidade, 0)}
                  </span>
                  <span className="text-xs text-texto-suave">orçamentos</span>
                </>
              }
              fatias={(Object.keys(SITUACOES_ORCAMENTO) as SituacaoOrcamento[])
                .map((s) => {
                  const linha = dados.orcamentosPorSituacao!.find((o) => o.situacao === s);
                  return {
                    rotulo: SITUACOES_ORCAMENTO[s],
                    valor: linha?.quantidade ?? 0,
                    cor: COR_SITUACAO[s],
                    detalhe: linha ? formatarMoeda(linha.totalCentavos) : undefined,
                  };
                })
                .filter((f) => f.valor > 0)}
            />
          </Bloco>
        )}
        {dados?.aprovadosPorVendedor && (
          <Bloco titulo="Valor aprovado por vendedor">
            <GraficoBarras
              vazio="Nenhum orçamento aprovado no período."
              barras={dados.aprovadosPorVendedor.map((v) => ({
                rotulo: v.vendedor,
                valor: v.totalCentavos,
                texto: formatarMoeda(v.totalCentavos),
                detalhe: `${v.quantidade} orç.`,
              }))}
            />
          </Bloco>
        )}
        {dados && <Alertas painel={dados} />}
      </div>

      {dados && dados.aniversariantes.length > 0 && <Aniversariantes lista={dados.aniversariantes} />}
    </div>
  );
}

/** Pendências de cadastro que impedem abrir O.S. e o que ainda vem por aí. */
function Alertas({ painel }: { painel: Painel }) {
  return (
    <Bloco titulo="Alertas">
      <ul className="-my-2 divide-y divide-borda">
        {painel.alertas.length === 0 && <TextoSuave className="py-2">Nenhum alerta. Tudo em ordem.</TextoSuave>}
        {painel.alertas.map((a) => {
          const Icone = a.nivel === 'aviso' ? AlertTriangle : Info;
          return (
            <li key={a.mensagem} className="flex items-start gap-2.5 py-2 text-sm">
              <Icone
                className={`mt-0.5 size-4 shrink-0 ${a.nivel === 'aviso' ? 'text-alerta' : 'text-info'}`}
                aria-hidden
              />
              <span className="flex-1">{a.mensagem}</span>
              {a.link && (
                <Link to={a.link} className="text-primaria hover:underline" aria-label="Ver detalhes">
                  <ArrowRight className="size-4" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {painel.modulosPendentes.length > 0 && (
        <TextoSuave className="mt-3 text-xs">Em breve neste painel: {painel.modulosPendentes.join(' · ')}.</TextoSuave>
      )}
    </Bloco>
  );
}

/** Aniversariantes de hoje e da semana, com atalho para dar parabéns pelo WhatsApp. */
function Aniversariantes({ lista }: { lista: Aniversariante[] }) {
  const hoje = lista.filter((a) => a.dias === 0).length;
  return (
    <Bloco
      titulo={
        <span className="flex items-center gap-2">
          <Cake className="size-4 text-primaria" aria-hidden />
          {hoje > 0 ? `Hoje é aniversário de ${hoje} cliente(s)` : 'Aniversários da semana'}
        </span>
      }
    >
      <ul className="-my-2 grid gap-x-6 divide-y divide-borda md:grid-cols-2 md:divide-y-0 xl:grid-cols-3">
        {lista.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <Link to={`/clientes/${a.id}`} className="flex-1 truncate font-medium text-texto hover:text-primaria">
              {a.nome}
            </Link>
            <SeloAniversario dias={a.dias} />
            {a.whatsapp && <LinkWhatsApp numero={a.whatsapp} />}
          </li>
        ))}
      </ul>
    </Bloco>
  );
}
