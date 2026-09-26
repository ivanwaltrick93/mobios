import { formatarMoeda, formatarNumeroOs, formatarPlaca, SITUACOES_OS, type OrdemServicoResumo } from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { SeloSituacaoOs } from '../components/OrdemServico';
import {
  Alerta,
  BotaoVisualizar,
  Cabecalho,
  Campo,
  CampoBusca,
  classesBotao,
  Input,
  Linha,
  Paginacao,
  POR_PAGINA,
  Select,
  Selo,
  Tabela,
  Td,
  Th,
  Titulo,
  Vazio,
} from '../components/ui';
import { api } from '../lib/api';
import { useMecanicosOs, useVendedoresOs } from '../lib/ordensServico';
import { usePerfilOs } from '../lib/sessao';

const FILTRO_INICIAL = { q: '', situacao: '', vendedorId: '', mecanicoId: '', pecaPendente: '', desde: '', ate: '' };

const dataHora = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/** Ordens de serviço: lista com número, cliente, placa, vendedor, mecânicos, situação, previsão e total. */
export function OrdensServico() {
  const perfil = usePerfilOs();
  const [params] = useSearchParams();
  const [filtro, setFiltro] = useState(() => ({ ...FILTRO_INICIAL, situacao: params.get('situacao') ?? '' }));
  const [pagina, setPagina] = useState(1);
  const vendedores = useVendedoresOs();
  const mecanicos = useMecanicosOs(!perfil.mecanico);
  const parametros = new URLSearchParams(
    Object.entries({ ...filtro, pagina: String(pagina), porPagina: String(POR_PAGINA) }).filter(([, v]) => v),
  );
  const lista = useQuery({
    queryKey: ['ordens-servico', 'lista', parametros.toString()],
    queryFn: ({ signal }) =>
      api<{ itens: OrdemServicoResumo[]; total: number }>(`/ordens-servico?${parametros}`, { signal }),
    placeholderData: keepPreviousData,
    enabled: perfil.podeVer,
  });
  const mudar = (campo: keyof typeof filtro, valor: string) => {
    setFiltro((f) => ({ ...f, [campo]: valor }));
    setPagina(1);
  };
  const dados = lista.data;
  const filtrando = Object.values(filtro).some(Boolean);

  if (!perfil.podeVer) return <Alerta>Você não tem permissão para acessar as ordens de serviço.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo
        acao={
          perfil.podeAbrir && (
            <Link to="/os/nova" className={classesBotao('primario')}>
              <Plus className="mr-1.5 size-4" aria-hidden /> Nova O.S.
            </Link>
          )
        }
      >
        Ordens de serviço
      </Titulo>

      <div className="space-y-3">
        <CampoBusca
          rotulo="Buscar O.S."
          placeholder="Número (OS-…), nome do cliente ou placa"
          valor={filtro.q}
          aoMudar={(valor) => mudar('q', valor)}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Campo rotulo="Situação">
            <Select value={filtro.situacao} onChange={(e) => mudar('situacao', e.target.value)}>
              <option value="">Todas</option>
              {Object.entries(SITUACOES_OS).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo rotulo="Vendedor">
            <Select value={filtro.vendedorId} onChange={(e) => mudar('vendedorId', e.target.value)}>
              <option value="">Todos</option>
              {vendedores.data?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nome}
                </option>
              ))}
            </Select>
          </Campo>
          {/* O mecânico já vê só as O.S. dele: o filtro seria redundante. */}
          {!perfil.mecanico && (
            <Campo rotulo="Mecânico">
              <Select value={filtro.mecanicoId} onChange={(e) => mudar('mecanicoId', e.target.value)}>
                <option value="">Todos</option>
                {mecanicos.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </Select>
            </Campo>
          )}
          <Campo rotulo="Peças">
            <Select value={filtro.pecaPendente} onChange={(e) => mudar('pecaPendente', e.target.value)}>
              <option value="">Todas</option>
              <option value="true">Com peça solicitada</option>
            </Select>
          </Campo>
          <Campo rotulo="Aberta de">
            <Input type="date" value={filtro.desde} onChange={(e) => mudar('desde', e.target.value)} />
          </Campo>
          <Campo rotulo="Aberta até">
            <Input type="date" min={filtro.desde} value={filtro.ate} onChange={(e) => mudar('ate', e.target.value)} />
          </Campo>
        </div>
      </div>

      <Alerta>{lista.isError && lista.error.message}</Alerta>
      {dados && dados.itens.length === 0 ? (
        <Vazio icone={<ClipboardList />} titulo={filtrando ? 'Nenhuma O.S. encontrada' : 'Nenhuma O.S. ainda'}>
          {!filtrando && perfil.mecanico && 'Aparecem aqui as O.S. em que você for vinculado como mecânico.'}
        </Vazio>
      ) : (
        <Tabela>
          <Cabecalho>
            <Th>Número</Th>
            <Th>Cliente</Th>
            <Th>Placa</Th>
            <Th>Vendedor</Th>
            <Th>Mecânicos</Th>
            <Th>Situação</Th>
            <Th>Previsão</Th>
            <Th className="text-right">Total</Th>
            <Th>Aberta em</Th>
            <Th />
          </Cabecalho>
          <tbody>
            {dados?.itens.map((o) => (
              <Linha key={o.id} className="hover:bg-superficie-alt">
                <Td className="whitespace-nowrap font-mono text-xs font-semibold">
                  <Link to={`/os/${o.id}`} className="hover:text-primaria">
                    {formatarNumeroOs(o.numero)}
                  </Link>
                </Td>
                <Td>{o.clienteNome}</Td>
                <Td suave className="whitespace-nowrap">
                  {formatarPlaca(o.veiculoPlaca)}
                </Td>
                <Td suave>{o.vendedorNome ?? '—'}</Td>
                <Td suave>{o.mecanicos.length ? o.mecanicos.join(', ') : '—'}</Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-1">
                    <SeloSituacaoOs situacao={o.situacao} />
                    {o.pecasSolicitadas > 0 && <Selo tom="alerta">{o.pecasSolicitadas} peça(s) pedida(s)</Selo>}
                  </div>
                </Td>
                <Td suave className="whitespace-nowrap">
                  {dataHora(o.previsaoEntrega)}
                </Td>
                <Td className="whitespace-nowrap text-right font-semibold">{formatarMoeda(o.totalCentavos)}</Td>
                <Td suave className="whitespace-nowrap">
                  {dataHora(o.abertaEm)}
                </Td>
                <Td className="text-right">
                  <BotaoVisualizar para={`/os/${o.id}`} />
                </Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      )}

      {dados && <Paginacao pagina={pagina} total={dados.total} aoMudar={setPagina} carregando={lista.isFetching} />}
    </div>
  );
}
