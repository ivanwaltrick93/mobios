import { formatarMoeda, type Indicador, type ModuloId, type Nivel, type Painel } from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CarFront,
  ClipboardPlus,
  FileBarChart,
  Info,
  Package,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { Alerta, Cartao, Selo, TextoSuave } from '../components/ui';
import { api } from '../lib/api';
import { usePode, useSessao } from '../lib/sessao';

type Atalho = {
  para: string;
  rotulo: string;
  descricao: string;
  icone: LucideIcon;
  emBreve?: boolean;
  modulo: ModuloId;
  nivel: Nivel;
};

// Ações mais frequentes do balcão, em botões grandes (fáceis de tocar em tablet).
const atalhos: Atalho[] = [
  {
    para: '/clientes/novo',
    rotulo: 'Novo cliente',
    descricao: 'Cadastrar pessoa ou empresa',
    icone: UserPlus,
    modulo: 'clientes',
    nivel: 'editar',
  },
  {
    para: '/veiculos/novo',
    rotulo: 'Novo veículo',
    descricao: 'Vincular a um cliente',
    icone: CarFront,
    modulo: 'clientes',
    nivel: 'editar',
  },
  {
    para: '/os',
    rotulo: 'Abrir O.S.',
    descricao: 'Nova ordem de serviço',
    icone: ClipboardPlus,
    emBreve: true,
    modulo: 'os',
    nivel: 'editar',
  },
  {
    para: '/estoque',
    rotulo: 'Estoque',
    descricao: 'Peças e quantidades',
    icone: Package,
    emBreve: true,
    modulo: 'estoque',
    nivel: 'consultar',
  },
  {
    para: '/relatorios',
    rotulo: 'Relatórios',
    descricao: 'Extrair em CSV/Excel',
    icone: FileBarChart,
    modulo: 'relatorios',
    nivel: 'consultar',
  },
];

function saudacao() {
  const hora = Number(
    new Date().toLocaleString('pt-BR', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }),
  );
  return hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
}

function CartaoIndicador({ indicador }: { indicador: Indicador }) {
  const disponivel = indicador.valor !== null;
  const valor = !disponivel
    ? '—'
    : indicador.formato === 'moeda'
      ? formatarMoeda(indicador.valor!)
      : indicador.valor!.toLocaleString('pt-BR');
  const conteudo = (
    <Cartao className={`h-full p-5 ${indicador.link ? 'transition hover:border-primaria' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <TextoSuave>{indicador.titulo}</TextoSuave>
        {!disponivel && <Selo>Em breve</Selo>}
      </div>
      <div className={`mt-2 text-3xl font-semibold ${disponivel ? 'text-texto' : 'text-texto-suave'}`}>{valor}</div>
      <TextoSuave className="mt-1 text-xs">{indicador.detalhe}</TextoSuave>
    </Cartao>
  );
  return indicador.link ? <Link to={indicador.link}>{conteudo}</Link> : conteudo;
}

export function Inicio() {
  const sessao = useSessao();
  const painel = useQuery({ queryKey: ['painel'], queryFn: () => api<Painel>('/painel'), refetchInterval: 60_000 });
  const pode = usePode();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">
          {saudacao()}, {sessao.data?.usuario.nome.split(' ')[0]}
        </h1>
        <TextoSuave>O que vamos fazer agora?</TextoSuave>
      </div>

      <section aria-label="Atalhos" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {atalhos
          .filter((a) => pode(a.modulo, a.nivel))
          .map(({ para, rotulo, descricao, icone: Icone, emBreve }) => (
            <Link
              key={para}
              to={para}
              className="group relative flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border border-borda bg-superficie p-4 text-center shadow-sm transition hover:border-primaria hover:bg-primaria-suave focus-visible:outline-2 focus-visible:outline-primaria"
            >
              {emBreve && (
                <span className="absolute top-2 right-2">
                  <Selo>Em breve</Selo>
                </span>
              )}
              <Icone className="size-10 text-primaria" strokeWidth={1.75} aria-hidden />
              <span className="text-base font-semibold text-texto">{rotulo}</span>
              <span className="text-xs text-texto-suave">{descricao}</span>
            </Link>
          ))}
      </section>

      {painel.isError && <Alerta>{painel.error.message}</Alerta>}

      <section aria-label="Indicadores" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {painel.data?.indicadores.map((i) => (
          <CartaoIndicador key={i.id} indicador={i} />
        ))}
      </section>

      {painel.data && (
        <section aria-label="Alertas">
          <h2 className="mb-3 text-lg font-medium">Alertas</h2>
          <Cartao className="divide-y divide-borda">
            {painel.data.alertas.length === 0 && <TextoSuave className="p-4">Nenhum alerta. Tudo em ordem.</TextoSuave>}
            {painel.data.alertas.map((a) => {
              const Icone = a.nivel === 'aviso' ? AlertTriangle : Info;
              return (
                <div key={a.mensagem} className="flex items-center gap-3 p-4">
                  <span
                    className={`rounded-full p-2 ${a.nivel === 'aviso' ? 'bg-alerta-suave text-alerta' : 'bg-primaria-suave text-primaria'}`}
                  >
                    <Icone className="size-4" aria-hidden />
                  </span>
                  <span className="flex-1 text-sm">{a.mensagem}</span>
                  {a.link && (
                    <Link to={a.link} className="text-primaria hover:underline" aria-label="Ver detalhes">
                      <ArrowRight className="size-4" />
                    </Link>
                  )}
                </div>
              );
            })}
            {painel.data.modulosPendentes.length > 0 && (
              <TextoSuave className="p-4 text-xs">
                Em breve neste painel: {painel.data.modulosPendentes.join(' · ')}.
              </TextoSuave>
            )}
          </Cartao>
        </section>
      )}
    </div>
  );
}
