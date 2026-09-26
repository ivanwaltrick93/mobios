import {
  formatarMoeda,
  formatarPercentual,
  TIPOS_DOCUMENTO_COMERCIAL,
  type AprovacaoComercialResumo,
  type StatusAprovacaoComercial,
} from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BadgeCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { AcoesDecisao, SeloAprovacao, SeloTipoDocumento, usePodeDecidir } from '../components/AprovacaoComercial';
import {
  Alerta,
  BarraFiltros,
  BotaoVisualizar,
  Cabecalho,
  Carregando,
  CabecalhoPagina,
  FiltroSelect,
  Linha,
  Paginacao,
  POR_PAGINA,
  Tabela,
  Td,
  Th,
  Vazio,
} from '../components/ui';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';

const SITUACOES_FILTRO: Record<StatusAprovacaoComercial | '', string> = {
  pendente: 'Pendentes',
  aprovada: 'Aprovadas',
  reprovada: 'Reprovadas',
  cancelada: 'Canceladas',
  '': 'Todas',
};
const FILTRO_INICIAL = { q: '', status: 'pendente', tipo: '', posso: '' };
const dataHora = (d: Date | string) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Aprovações comerciais: descontos acima da alçada aguardando (e já decididos), com aprovar e reprovar na linha. */
export function AprovacoesComerciais() {
  const pode = usePode();
  const podeDecidir = usePodeDecidir();
  const [filtro, setFiltro] = useState(FILTRO_INICIAL);
  const [pagina, setPagina] = useState(1);
  const parametros = new URLSearchParams({ ...filtro, pagina: String(pagina), porPagina: String(POR_PAGINA) });
  const lista = useQuery({
    queryKey: ['aprovacoes-comerciais', 'lista', parametros.toString()],
    queryFn: ({ signal }) =>
      api<{ itens: AprovacaoComercialResumo[]; total: number }>(`/aprovacoes-comerciais?${parametros}`, { signal }),
    placeholderData: keepPreviousData,
    enabled: pode('aprovacao_comercial'),
  });
  const mudar = (campo: keyof typeof filtro, valor: string) => {
    setFiltro((f) => ({ ...f, [campo]: valor }));
    setPagina(1);
  };
  const limpar = () => {
    setFiltro(FILTRO_INICIAL);
    setPagina(1);
  };
  const dados = lista.data;

  if (!pode('aprovacao_comercial'))
    return <Alerta>Você não tem permissão para acessar as aprovações comerciais.</Alerta>;

  return (
    <div className="space-y-4">
      <CabecalhoPagina
        titulo="Aprovações comerciais"
        subtitulo="Descontos acima da alçada de quem emitiu. Aprova quem tem alçada igual ou maior que o desconto."
      />
      <BarraFiltros
        busca={{
          rotulo: 'Buscar aprovações',
          placeholder: 'Número do documento ou cliente',
          valor: filtro.q,
          aoMudar: (valor) => mudar('q', valor),
        }}
        aoLimpar={JSON.stringify(filtro) !== JSON.stringify(FILTRO_INICIAL) ? limpar : undefined}
        total={dados?.total}
      >
        <FiltroSelect rotulo="Situação" value={filtro.status} onChange={(e) => mudar('status', e.target.value)}>
          {Object.entries(SITUACOES_FILTRO).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </FiltroSelect>
        <FiltroSelect rotulo="Documento" value={filtro.tipo} onChange={(e) => mudar('tipo', e.target.value)}>
          <option value="">Todos</option>
          {Object.entries(TIPOS_DOCUMENTO_COMERCIAL).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </FiltroSelect>
        {pode('aprovacao_comercial', 'editar') && (
          <FiltroSelect rotulo="Mostrar" value={filtro.posso} onChange={(e) => mudar('posso', e.target.value)}>
            <option value="">Todas</option>
            <option value="true">Só as que posso aprovar</option>
          </FiltroSelect>
        )}
      </BarraFiltros>

      {lista.isError && <Alerta>{lista.error.message}</Alerta>}
      {!dados ? (
        <Carregando />
      ) : dados.itens.length === 0 ? (
        <Vazio icone={<BadgeCheck />} titulo="Nenhuma aprovação comercial encontrada" />
      ) : (
        <Tabela>
          <Cabecalho>
            <Th>Documento</Th>
            <Th>Tipo</Th>
            <Th>Cliente</Th>
            <Th>Solicitante</Th>
            <Th>Função</Th>
            <Th className="text-right">Versão</Th>
            <Th className="text-right">Valor original</Th>
            <Th className="text-right">Desconto</Th>
            <Th className="text-right">Alçada</Th>
            <Th>Data</Th>
            <Th>Situação</Th>
            <Th className="text-right">Ações</Th>
          </Cabecalho>
          <tbody>
            {dados.itens.map((a) => (
              <Linha key={a.id} className="hover:bg-superficie-alt">
                <Td className="whitespace-nowrap font-mono text-xs font-semibold">
                  <Link to={`/aprovacoes-comerciais/${a.id}`} className="hover:text-primaria">
                    {a.documentoNumero}
                  </Link>
                </Td>
                <Td>
                  <SeloTipoDocumento tipo={a.tipoDocumento} />
                </Td>
                <Td className="min-w-40">{a.clienteNome}</Td>
                <Td suave>{a.solicitante}</Td>
                <Td suave>{a.solicitanteFuncao ?? '—'}</Td>
                <Td suave className="text-right tabular-nums">
                  {a.tipoDocumento === 'ordem_servico' ? '—' : a.documentoVersao}
                </Td>
                <Td className="whitespace-nowrap text-right tabular-nums">{formatarMoeda(a.subtotalCentavos)}</Td>
                <Td className="whitespace-nowrap text-right tabular-nums">{formatarMoeda(a.descontoCentavos)}</Td>
                <Td suave className="whitespace-nowrap text-right tabular-nums">
                  {formatarPercentual(a.alcadaSolicitante)}
                </Td>
                <Td suave className="whitespace-nowrap">
                  {dataHora(a.criadoEm)}
                </Td>
                <Td>
                  <SeloAprovacao status={a.status} />
                </Td>
                <Td className="whitespace-nowrap text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {podeDecidir(a) && <AcoesDecisao aprovacao={a} />}
                    <BotaoVisualizar para={`/aprovacoes-comerciais/${a.id}`} />
                  </div>
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
