import {
  formatarDataIso,
  formatarMoeda,
  formatarNumeroOrcamento,
  formatarPlaca,
  SITUACOES_ORCAMENTO,
  type OrcamentoResumo,
} from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { SeloSituacao } from '../components/Orcamento';
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
  Tabela,
  Td,
  Th,
  Titulo,
  Vazio,
} from '../components/ui';
import { api } from '../lib/api';
import { useVendedoresOrcamento } from '../lib/orcamentos';
import { usePode } from '../lib/sessao';

const FILTRO_INICIAL = { q: '', situacao: '', vendedorId: '', desde: '', ate: '' };

/** Orçamentos: lista com número, versão, cliente, vendedor, total, validade e situação ("vencido" é automático). */
export function Orcamentos() {
  const pode = usePode();
  // Links do Início chegam com a situação na URL (ex.: ?situacao=aprovado).
  const [params] = useSearchParams();
  const [filtro, setFiltro] = useState(() => ({ ...FILTRO_INICIAL, situacao: params.get('situacao') ?? '' }));
  const [pagina, setPagina] = useState(1);
  const vendedores = useVendedoresOrcamento();
  const parametros = new URLSearchParams(
    Object.entries({ ...filtro, pagina: String(pagina), porPagina: String(POR_PAGINA) }).filter(([, v]) => v),
  );
  const orcamentos = useQuery({
    queryKey: ['orcamentos', 'lista', parametros.toString()],
    queryFn: () => api<{ itens: OrcamentoResumo[]; total: number }>(`/orcamentos?${parametros}`),
    placeholderData: keepPreviousData,
    enabled: pode('orcamentos'),
  });
  const mudar = (campo: keyof typeof filtro, valor: string) => {
    setFiltro((f) => ({ ...f, [campo]: valor }));
    setPagina(1);
  };
  const dados = orcamentos.data;
  const filtrando = Object.values(filtro).some(Boolean);

  if (!pode('orcamentos')) return <Alerta>Você não tem permissão para acessar os orçamentos.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo
        acao={
          pode('orcamentos', 'editar') && (
            <Link to="/orcamentos/novo" className={classesBotao('primario')}>
              <Plus className="mr-1.5 size-4" aria-hidden /> Novo orçamento
            </Link>
          )
        }
      >
        Orçamentos
      </Titulo>

      <div className="space-y-3">
        <CampoBusca
          rotulo="Buscar orçamentos"
          placeholder="Número (ORC-…), nome do cliente ou placa"
          valor={filtro.q}
          aoMudar={(valor) => mudar('q', valor)}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Situação">
            <Select value={filtro.situacao} onChange={(e) => mudar('situacao', e.target.value)}>
              <option value="">Todas</option>
              {Object.entries(SITUACOES_ORCAMENTO).map(([valor, rotulo]) => (
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
                  {v.ativo ? '' : ' (inativo)'}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo rotulo="Criado de">
            <Input type="date" value={filtro.desde} onChange={(e) => mudar('desde', e.target.value)} />
          </Campo>
          <Campo rotulo="Criado até">
            <Input type="date" min={filtro.desde} value={filtro.ate} onChange={(e) => mudar('ate', e.target.value)} />
          </Campo>
        </div>
      </div>

      <Alerta>{orcamentos.isError && orcamentos.error.message}</Alerta>
      {dados && dados.itens.length === 0 ? (
        <Vazio icone={<FileText />} titulo={filtrando ? 'Nenhum orçamento encontrado' : 'Nenhum orçamento ainda'} />
      ) : (
        <Tabela>
          <Cabecalho>
            <Th>Número</Th>
            <Th>Versão</Th>
            <Th>Cliente</Th>
            <Th>Placa</Th>
            <Th>Vendedor</Th>
            <Th className="text-right">Total</Th>
            <Th>Validade</Th>
            <Th>Situação</Th>
            <Th />
          </Cabecalho>
          <tbody>
            {dados?.itens.map((o) => (
              <Linha key={o.id} className="hover:bg-superficie-alt">
                <Td className="whitespace-nowrap font-mono text-xs font-semibold">
                  <Link to={`/orcamentos/${o.id}`} className="hover:text-primaria">
                    {formatarNumeroOrcamento(o.numero)}
                  </Link>
                </Td>
                <Td suave>{o.versaoOrcamento}</Td>
                <Td>{o.clienteNome}</Td>
                <Td suave className="whitespace-nowrap">
                  {o.veiculoPlaca ? formatarPlaca(o.veiculoPlaca) : '—'}
                </Td>
                <Td suave>{o.vendedorNome}</Td>
                <Td className="whitespace-nowrap text-right font-semibold">{formatarMoeda(o.totalCentavos)}</Td>
                <Td suave className="whitespace-nowrap">
                  {formatarDataIso(o.validadeAte)}
                </Td>
                <Td>
                  <SeloSituacao situacao={o.situacao} />
                </Td>
                <Td className="text-right">
                  <BotaoVisualizar para={`/orcamentos/${o.id}`} />
                </Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      )}

      {dados && (
        <Paginacao pagina={pagina} total={dados.total} aoMudar={setPagina} carregando={orcamentos.isFetching} />
      )}
    </div>
  );
}
