import { formatarQuantidade, type Saldo } from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Boxes, Search } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { AjusteEstoqueForm, HistoricoAjustes } from '../components/Estoque';
import { Alerta, BotaoLink, Cabecalho, Input, Linha, LinhaVazia, Marcador, Select, Selo, Tabela, Td, TextoSuave, Th, Titulo } from '../components/ui';
import { api } from '../lib/api';
import { useDepositos } from '../lib/materiais';
import { usePode } from '../lib/sessao';

const chave = (s: Saldo) => `${s.materialId}:${s.depositoId}`;

/** Tabela de estoque: uma linha por SKU + depósito, com disponível (livre) e reservado. */
export function Estoque() {
  const pode = usePode();
  const editar = pode('estoque', 'editar');
  const [busca, setBusca] = useState('');
  const [depositoId, setDepositoId] = useState('');
  const [soComSaldo, setSoComSaldo] = useState(false);
  const [aberto, setAberto] = useState<{ chave: string; modo: 'ajuste' | 'historico' } | null>(null);
  const depositos = useDepositos();
  const parametros = new URLSearchParams(Object.entries({ q: busca, depositoId, comSaldo: String(soComSaldo), porPagina: '100' }).filter(([, v]) => v));
  const saldos = useQuery({
    queryKey: ['estoque', parametros.toString()],
    queryFn: () => api<{ itens: Saldo[]; total: number }>(`/estoque?${parametros}`),
    placeholderData: keepPreviousData,
  });

  if (!pode('estoque')) return <Alerta>Você não tem permissão para acessar o estoque.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo>Estoque</Titulo>
      <TextoSuave>
        Disponível = livre para vender ou usar. Reservado = separado para O.S. ou pedido. Físico = disponível + reservado. Todo material ativo aparece em cada depósito; por enquanto os saldos mudam por ajuste manual, sempre com motivo.
      </TextoSuave>

      <div className="grid gap-3 md:grid-cols-[1fr_16rem_auto] md:items-center">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-texto-suave" aria-hidden />
          <Input className="h-12 pl-12 text-base" placeholder="SKU, descrição ou código do fabricante" aria-label="Buscar no estoque" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Select aria-label="Depósito" value={depositoId} onChange={(e) => setDepositoId(e.target.value)}>
          <option value="">Todos os depósitos</option>
          {depositos.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.codigo} — {d.nome}
            </option>
          ))}
        </Select>
        <Marcador rotulo="Só com saldo" checked={soComSaldo} onChange={(e) => setSoComSaldo(e.target.checked)} />
      </div>

      <Tabela>
        <Cabecalho>
          <Th>SKU</Th>
          <Th>Material</Th>
          <Th>Depósito</Th>
          <Th className="text-right">Disponível</Th>
          <Th className="text-right">Reservado</Th>
          <Th className="text-right">Físico</Th>
          <Th />
        </Cabecalho>
        <tbody>
          {saldos.data?.itens.map((s) => (
            <Fragment key={chave(s)}>
              <Linha className="hover:bg-superficie-alt">
                <Td className="whitespace-nowrap font-mono text-xs font-semibold">{s.sku}</Td>
                <Td className="min-w-56">
                  <Link to={`/materiais/${s.materialId}?aba=estoque`} className="text-primaria hover:underline">
                    {s.descricao}
                  </Link>
                  {!s.materialAtivo && (
                    <span className="ml-2">
                      <Selo>Inativo</Selo>
                    </span>
                  )}
                </Td>
                <Td suave className="whitespace-nowrap">
                  {s.depositoCodigo} — {s.depositoNome}
                </Td>
                <Td className={`text-right font-semibold whitespace-nowrap ${s.disponivel === 0 ? 'text-alerta' : ''}`}>
                  {formatarQuantidade(s.disponivel)} <span className="text-xs font-normal text-texto-suave">{s.unidade}</span>
                </Td>
                <Td className="text-right whitespace-nowrap">{formatarQuantidade(s.reservado)}</Td>
                <Td suave className="text-right whitespace-nowrap">
                  {formatarQuantidade(s.total)}
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <span className="flex justify-end gap-3">
                    {editar && s.materialAtivo && s.depositoAtivo && <BotaoLink onClick={() => setAberto({ chave: chave(s), modo: 'ajuste' })}>Ajustar</BotaoLink>}
                    {s.versao != null && (
                      <BotaoLink onClick={() => setAberto(aberto?.chave === chave(s) && aberto.modo === 'historico' ? null : { chave: chave(s), modo: 'historico' })}>Histórico</BotaoLink>
                    )}
                  </span>
                </Td>
              </Linha>
              {aberto?.chave === chave(s) && (
                <tr>
                  <td colSpan={7} className="px-4 pb-4">
                    {aberto.modo === 'ajuste' ? <AjusteEstoqueForm saldo={s} aoConcluir={() => setAberto(null)} /> : <HistoricoAjustes saldo={s} />}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {saldos.data?.itens.length === 0 && (
            <LinhaVazia colunas={7}>
              <span className="inline-flex flex-col items-center gap-2">
                <Boxes className="size-8" aria-hidden />
                {busca || depositoId || soComSaldo ? 'Nada encontrado com esses filtros.' : 'Cadastre materiais (que controlam estoque) e depósitos para ver a tabela.'}
              </span>
            </LinhaVazia>
          )}
        </tbody>
      </Tabela>
      {saldos.data && saldos.data.total > saldos.data.itens.length && (
        <TextoSuave className="text-center text-xs">
          Mostrando {saldos.data.itens.length} de {saldos.data.total.toLocaleString('pt-BR')}. Refine a busca ou filtre por depósito.
        </TextoSuave>
      )}
    </div>
  );
}
