import { formatarNumeroOs, formatarPlaca, type OrdemServicoResumo } from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, PackageSearch, Wrench } from 'lucide-react';
import { Link } from 'react-router';
import { SeloSituacaoOs } from '../components/OrdemServico';
import { Alerta, CabecalhoPagina, Carregando, Selo, Vazio } from '../components/ui';
import { api } from '../lib/api';
import { useSessao } from '../lib/sessao';

const dataHora = (d: Date | string) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Tela do mecânico (OS-18): as O.S. em aberto vinculadas a ele, em cartões grandes para o celular. Cada cartão
 * abre a O.S. na aba Execução (confirmar serviços, pedir peça) — a mesma tela de detalhe, com as mesmas regras.
 */
export function MinhasOrdensServico() {
  const usuarioId = useSessao().data?.usuario.id;
  const lista = useQuery({
    queryKey: ['ordens-servico', 'lista', 'minhas', usuarioId],
    queryFn: () =>
      api<{ itens: OrdemServicoResumo[]; total: number }>(
        `/ordens-servico?${new URLSearchParams({ mecanicoId: usuarioId!, abertas: 'true', porPagina: '100' })}`,
      ),
    enabled: !!usuarioId,
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <CabecalhoPagina titulo="Minhas O.S." subtitulo="Ordens de serviço em aberto em que você está vinculado." />
      <Alerta>{lista.isError && lista.error.message}</Alerta>
      {!lista.data ? (
        <Carregando />
      ) : lista.data.itens.length === 0 ? (
        <Vazio icone={<Wrench />} titulo="Nenhuma O.S. em aberto para você">
          Quando alguém vincular você a uma O.S. (ou a um serviço dela), ela aparece aqui.
        </Vazio>
      ) : (
        <ul className="space-y-3">
          {lista.data.itens.map((o) => (
            <li key={o.id}>
              <Link
                to={`/os/${o.id}`}
                className="flex items-center gap-3 rounded-lg border border-borda bg-superficie p-4 shadow-sm hover:border-primaria focus-visible:ring-2 focus-visible:ring-primaria focus-visible:outline-none"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{formatarNumeroOs(o.numero)}</span>
                    <SeloSituacaoOs situacao={o.situacao} />
                  </div>
                  <p className="text-lg font-semibold tracking-wide">{formatarPlaca(o.veiculoPlaca)}</p>
                  <p className="truncate text-sm text-texto-suave">{o.clienteNome}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-texto-suave">
                    {o.previsaoEntrega && <span>Previsão: {dataHora(o.previsaoEntrega)}</span>}
                    {o.pecasSolicitadas > 0 && (
                      <Selo tom="alerta">
                        <PackageSearch className="mr-1 inline size-3.5" aria-hidden />
                        {o.pecasSolicitadas} peça(s) pedida(s)
                      </Selo>
                    )}
                  </div>
                </div>
                <ChevronRight className="size-5 shrink-0 text-texto-suave" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
