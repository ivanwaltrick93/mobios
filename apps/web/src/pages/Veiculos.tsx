import { STATUS_VEICULO, type VeiculoLista } from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Car, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { SeloPendencias } from '../components/Cliente';
import { Placa } from '../components/Placa';
import {
  Alerta,
  BotaoVisualizar,
  Cabecalho,
  CampoBusca,
  classesBotao,
  Linha,
  LinhaVazia,
  Paginacao,
  POR_PAGINA,
  Select,
  Selo,
  Tabela,
  Td,
  Th,
  Titulo,
} from '../components/ui';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';

/** Frota da oficina: todos os veículos, com o dono, busca pela placa e filtro de status. */
export function Veiculos() {
  const pode = usePode();
  const editar = pode('clientes', 'editar');
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState('');
  const [pagina, setPagina] = useState(1);
  const parametros = new URLSearchParams(
    Object.entries({ q: busca, status, pagina: String(pagina), porPagina: String(POR_PAGINA) }).filter(([, v]) => v),
  );
  const veiculos = useQuery({
    queryKey: ['veiculos', 'lista', parametros.toString()],
    queryFn: ({ signal }) => api<{ itens: VeiculoLista[]; total: number }>(`/veiculos/lista?${parametros}`, { signal }),
    placeholderData: keepPreviousData,
    enabled: pode('clientes'),
  });

  if (!pode('clientes')) return <Alerta>Você não tem permissão para acessar os veículos.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo
        acao={
          editar && (
            <Link to="/veiculos/novo" className={classesBotao('primario')}>
              <Plus className="mr-1.5 size-4" aria-hidden /> Novo veículo
            </Link>
          )
        }
      >
        Veículos
      </Titulo>

      <div className="grid gap-3 md:grid-cols-[1fr_14rem] md:items-center">
        <CampoBusca
          rotulo="Buscar veículos"
          placeholder="Placa, marca, modelo ou nome do dono"
          valor={busca}
          aoMudar={(valor) => {
            setBusca(valor);
            setPagina(1);
          }}
        />
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPagina(1);
          }}
        >
          <option value="">Todos os status</option>
          {Object.entries(STATUS_VEICULO).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </Select>
      </div>

      <Tabela>
        <Cabecalho>
          <Th>Placa</Th>
          <Th>Veículo</Th>
          <Th>Ano</Th>
          <Th>Dono</Th>
          <Th className="text-right">Km atual</Th>
          <Th>Status</Th>
          <Th />
        </Cabecalho>
        <tbody>
          {veiculos.data?.itens.map((v) => (
            <Linha key={v.id} className="hover:bg-superficie-alt">
              <Td>
                <Placa placa={v.placa} tamanho="sm" />
              </Td>
              <Td>
                <div className="font-medium text-texto">
                  {v.marca} {v.modelo} {v.versao}
                </div>
                <SeloPendencias pendencias={v.pendencias} />
              </Td>
              <Td suave className="whitespace-nowrap">
                {v.anoFabricacao && v.anoModelo ? `${v.anoFabricacao}/${v.anoModelo}` : '—'}
              </Td>
              <Td>
                <Link to={`/clientes/${v.clienteId}`} className="text-primaria hover:underline">
                  {v.clienteNome}
                </Link>
              </Td>
              <Td suave className="text-right whitespace-nowrap">
                {v.kmAtual != null ? v.kmAtual.toLocaleString('pt-BR') : '—'}
              </Td>
              <Td>
                <Selo tom={v.status === 'ativo' ? 'sucesso' : 'neutro'}>{STATUS_VEICULO[v.status]}</Selo>
              </Td>
              <Td className="text-right whitespace-nowrap">
                <span className="flex items-center justify-end gap-4">
                  <BotaoVisualizar para={`/clientes/${v.clienteId}?aba=veiculos`} />
                  {editar && (
                    <Link to={`/veiculos/${v.id}/editar`} className="text-sm text-primaria hover:underline">
                      Editar
                    </Link>
                  )}
                </span>
              </Td>
            </Linha>
          ))}
          {veiculos.data?.itens.length === 0 && (
            <LinhaVazia colunas={7}>
              <span className="inline-flex flex-col items-center gap-2">
                <Car className="size-8" aria-hidden />
                {busca || status ? 'Nenhum veículo encontrado.' : 'Nenhum veículo cadastrado ainda.'}
              </span>
            </LinhaVazia>
          )}
        </tbody>
      </Tabela>
      {veiculos.data && (
        <Paginacao pagina={pagina} total={veiculos.data.total} aoMudar={setPagina} carregando={veiculos.isFetching} />
      )}
    </div>
  );
}
