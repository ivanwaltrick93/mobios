import {
  FILTROS_LINHAS_PRECO,
  formatarDataIso,
  formatarMoeda,
  SITUACOES_LINHA_PRECO,
  type LinhaPreco,
} from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import {
  BotaoVisualizar,
  Cabecalho,
  CampoBusca,
  Linha,
  LinhaVazia,
  Paginacao,
  POR_PAGINA,
  Select,
  Selo,
  Tabela,
  Td,
  Th,
} from './ui';

type Situacao = LinhaPreco['situacao'];
type Filtro = keyof typeof FILTROS_LINHAS_PRECO;

const tomDaSituacao: Record<Situacao, 'sucesso' | 'primario' | 'neutro' | 'alerta'> = {
  vigente: 'sucesso',
  futuro: 'primario',
  encerrado: 'neutro',
  cancelado: 'alerta',
  padrao: 'neutro',
};

/**
 * Linhas de Preço de uma tabela: cada vigência numa linha (início, fim e situação) e o preço padrão em outra.
 * Só preço: nada de estoque nem de outros dados do material. Usada em Linhas de Preço e no detalhe da tabela;
 * troque a `key` ao mudar de tabela para a busca e a página recomeçarem.
 */
export function LinhasDePreco({ tabelaPrecoId, autoFocus = false }: { tabelaPrecoId: string; autoFocus?: boolean }) {
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<Filtro>('atuais');
  const [pagina, setPagina] = useState(1);
  const parametros = new URLSearchParams({
    tabelaPrecoId,
    q: busca,
    situacao,
    pagina: String(pagina),
    porPagina: String(POR_PAGINA),
  });
  const linhas = useQuery({
    queryKey: ['linhas-preco', parametros.toString()],
    queryFn: () => api<{ itens: LinhaPreco[]; total: number }>(`/precos/linhas?${parametros}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[1fr_16rem] md:items-center">
        <CampoBusca
          autoFocus={autoFocus}
          rotulo="Buscar nas linhas de preço"
          placeholder="SKU, descrição, código do fabricante ou de barras"
          valor={busca}
          aoMudar={(valor) => {
            setBusca(valor);
            setPagina(1);
          }}
        />
        <Select
          aria-label="Situação"
          value={situacao}
          onChange={(e) => {
            setSituacao(e.target.value as Filtro);
            setPagina(1);
          }}
        >
          {Object.entries(FILTROS_LINHAS_PRECO).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </Select>
      </div>

      <Tabela>
        <Cabecalho>
          <Th>SKU</Th>
          <Th>Material</Th>
          <Th className="text-right">Preço</Th>
          <Th>Início</Th>
          <Th>Fim</Th>
          <Th>Situação</Th>
          <Th />
        </Cabecalho>
        <tbody>
          {linhas.data?.itens.map((l) => (
            <Linha key={l.id} className="hover:bg-superficie-alt">
              <Td className="whitespace-nowrap font-mono text-xs font-semibold">{l.sku}</Td>
              <Td>{l.descricao}</Td>
              <Td className="text-right font-semibold whitespace-nowrap">{formatarMoeda(l.precoCentavos)}</Td>
              <Td suave className="whitespace-nowrap">
                {l.dataInicio ? formatarDataIso(l.dataInicio) : '—'}
              </Td>
              <Td suave className="whitespace-nowrap">
                {l.situacao === 'padrao' ? '—' : l.dataFim ? formatarDataIso(l.dataFim) : 'Sem fim'}
              </Td>
              <Td>
                <Selo
                  tom={tomDaSituacao[l.situacao]}
                  titulo={
                    l.situacao === 'padrao' ? 'Sem vigência: vale quando nenhuma vigência cobre o dia' : undefined
                  }
                >
                  {SITUACOES_LINHA_PRECO[l.situacao]}
                </Selo>
              </Td>
              <Td className="text-right">
                <BotaoVisualizar para={`/materiais/${l.materialId}?aba=precos`} />
              </Td>
            </Linha>
          ))}
          {linhas.data?.itens.length === 0 && (
            <LinhaVazia colunas={7}>
              {busca ? 'Nenhuma linha de preço encontrada.' : 'Nenhuma linha de preço nesta situação.'}
            </LinhaVazia>
          )}
        </tbody>
      </Tabela>
      {linhas.data && (
        <Paginacao pagina={pagina} total={linhas.data.total} aoMudar={setPagina} carregando={linhas.isFetching} />
      )}
    </div>
  );
}
