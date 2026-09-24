import { formatarDataIso, formatarMoeda, formatarQuantidade, type ItemListaPrecos } from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';
import { CampoBusca, Cabecalho, Linha, LinhaVazia, Marcador, Paginacao, POR_PAGINA, Selo, Tabela, Td, Th } from './ui';

/**
 * Preços de uma tabela, paginados: busca, preço de hoje (vigência ou padrão), próximo preço e disponível.
 * Usada na aba "Lista de preços" e no detalhe de cada tabela de preço. Troque a `key` ao mudar de tabela
 * para a busca e a página recomeçarem.
 */
export function ListaDePrecos({
  tabelaPrecoId,
  soComPrecoInicial = false,
  autoFocus = false,
}: {
  tabelaPrecoId: string;
  soComPrecoInicial?: boolean;
  autoFocus?: boolean;
}) {
  const pode = usePode();
  const verEstoque = pode('estoque');
  const [busca, setBusca] = useState('');
  const [soComPreco, setSoComPreco] = useState(soComPrecoInicial);
  const [pagina, setPagina] = useState(1);
  const parametros = new URLSearchParams({
    tabelaPrecoId,
    q: busca,
    comPreco: String(soComPreco),
    pagina: String(pagina),
    porPagina: String(POR_PAGINA),
  });
  const lista = useQuery({
    queryKey: ['lista-precos', parametros.toString()],
    queryFn: () => api<{ itens: ItemListaPrecos[]; total: number }>(`/precos/lista?${parametros}`),
    placeholderData: keepPreviousData,
  });
  const colunas = verEstoque ? 5 : 4;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
        <CampoBusca
          autoFocus={autoFocus}
          rotulo="Buscar na lista de preços"
          placeholder="SKU, descrição, código do fabricante ou de barras"
          valor={busca}
          aoMudar={(valor) => {
            setBusca(valor);
            setPagina(1);
          }}
        />
        <Marcador
          rotulo="Só com preço"
          checked={soComPreco}
          onChange={(e) => {
            setSoComPreco(e.target.checked);
            setPagina(1);
          }}
        />
      </div>

      <Tabela>
        <Cabecalho>
          <Th>SKU</Th>
          <Th>Material</Th>
          <Th className="text-right">Preço</Th>
          <Th>Próximo preço</Th>
          {verEstoque && <Th className="text-right">Disponível</Th>}
        </Cabecalho>
        <tbody>
          {lista.data?.itens.map((i) => (
            <Linha key={i.materialId} className="hover:bg-superficie-alt">
              <Td className="whitespace-nowrap font-mono text-xs font-semibold">{i.sku}</Td>
              <Td>
                <Link
                  to={`/materiais/${i.materialId}?aba=precos`}
                  className="text-texto hover:text-primaria hover:underline"
                >
                  {i.descricao}
                </Link>
                <div className="text-xs text-texto-suave">{[i.marcaNome, i.unidade].filter(Boolean).join(' · ')}</div>
              </Td>
              <Td className="text-right whitespace-nowrap">
                <PrecoDeHoje item={i} />
              </Td>
              <Td suave className="whitespace-nowrap text-sm">
                {i.proximoPrecoCentavos != null
                  ? `${formatarMoeda(i.proximoPrecoCentavos)} a partir de ${formatarDataIso(i.proximoInicio)}`
                  : '—'}
              </Td>
              {verEstoque && (
                <Td className={`text-right font-semibold whitespace-nowrap ${i.disponivel === 0 ? 'text-alerta' : ''}`}>
                  {formatarQuantidade(i.disponivel ?? 0)}{' '}
                  <span className="text-xs font-normal text-texto-suave">{i.unidade}</span>
                </Td>
              )}
            </Linha>
          ))}
          {lista.data?.itens.length === 0 && (
            <LinhaVazia colunas={colunas}>
              {busca
                ? 'Nenhum material encontrado.'
                : soComPreco
                  ? 'Nenhum preço nesta tabela.'
                  : 'Nenhum material ativo.'}
            </LinhaVazia>
          )}
        </tbody>
      </Tabela>
      {lista.data && (
        <Paginacao pagina={pagina} total={lista.data.total} aoMudar={setPagina} carregando={lista.isFetching} />
      )}
    </div>
  );
}

/** Preço que vale hoje: o da vigência (com o fim, se houver) ou o padrão, sinalizado. */
function PrecoDeHoje({ item }: { item: ItemListaPrecos }) {
  if (item.precoCentavos == null) return <span className="text-sm text-alerta">Sem preço</span>;
  return (
    <>
      <div className="text-base font-semibold text-texto">{formatarMoeda(item.precoCentavos)}</div>
      {item.origem === 'padrao' ? (
        <Selo titulo="Sem vigência: vale quando nenhuma vigência cobre o dia">Padrão</Selo>
      ) : (
        item.vigenteAte && <div className="text-xs text-texto-suave">até {formatarDataIso(item.vigenteAte)}</div>
      )}
    </>
  );
}
