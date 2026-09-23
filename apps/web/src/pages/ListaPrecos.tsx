import { formatarDataIso, formatarMoeda, formatarQuantidade, type ItemListaPrecos } from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, Tag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AbasPrecos } from '../components/AbasPrecos';
import {
  Alerta,
  Botao,
  Cabecalho,
  classesBotao,
  Input,
  Linha,
  LinhaVazia,
  Marcador,
  Select,
  Tabela,
  Td,
  TextoSuave,
  Th,
  Titulo,
  Vazio,
} from '../components/ui';
import { api } from '../lib/api';
import { useTabelasPreco } from '../lib/materiais';
import { usePode } from '../lib/sessao';

const CHAVE_TABELA = 'mobios.listaPrecos.tabela';
const POR_PAGINA = 50;

/** Última tabela escolhida (conveniência do atendente; se o navegador bloquear, usa a primeira ativa). */
const lerTabelaSalva = () => {
  try {
    return localStorage.getItem(CHAVE_TABELA) ?? '';
  } catch {
    return '';
  }
};

/** Lista de preços para o atendimento: busca rápida, preço vigente, próximo preço e disponível. */
export function ListaPrecos() {
  const pode = usePode();
  const tabelas = useTabelasPreco(pode('precos'));
  const ativas = tabelas.data?.filter((t) => t.ativa) ?? [];
  const [tabelaId, setTabelaId] = useState(lerTabelaSalva);
  const [busca, setBusca] = useState('');
  const [soComPreco, setSoComPreco] = useState(false);
  const [quantidade, setQuantidade] = useState(POR_PAGINA);
  const tabela = ativas.find((t) => t.id === tabelaId) ?? ativas[0];

  useEffect(() => {
    if (!tabela) return;
    try {
      localStorage.setItem(CHAVE_TABELA, tabela.id);
    } catch {
      /* sem armazenamento: só não lembra a escolha */
    }
  }, [tabela]);

  const parametros = new URLSearchParams({
    tabelaPrecoId: tabela?.id ?? '',
    q: busca,
    comPreco: String(soComPreco),
    porPagina: String(Math.min(quantidade, 100)),
  });
  const lista = useQuery({
    queryKey: ['lista-precos', parametros.toString()],
    queryFn: () => api<{ itens: ItemListaPrecos[]; total: number }>(`/precos/lista?${parametros}`),
    enabled: !!tabela,
    placeholderData: keepPreviousData,
  });

  if (!pode('precos')) return <Alerta>Você não tem permissão para acessar os preços.</Alerta>;
  const verEstoque = pode('estoque');

  return (
    <div className="space-y-6">
      <Titulo>Lista de preços</Titulo>
      <AbasPrecos />

      {tabelas.data && ativas.length === 0 ? (
        <Vazio
          icone={<Tag />}
          titulo="Nenhuma tabela de preço ativa"
          acao={
            pode('precos', 'editar') && (
              <Link to="/tabelas-preco" className={classesBotao('primario')}>
                Cadastrar tabela de preço
              </Link>
            )
          }
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-[14rem_1fr_auto] md:items-center">
            <Select
              aria-label="Tabela de preço"
              value={tabela?.id ?? ''}
              onChange={(e) => (setTabelaId(e.target.value), setQuantidade(POR_PAGINA))}
            >
              {ativas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </Select>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-texto-suave"
                aria-hidden
              />
              <Input
                autoFocus
                className="h-12 pl-12 text-base"
                placeholder="SKU, descrição, código do fabricante ou de barras"
                aria-label="Buscar na lista de preços"
                value={busca}
                onChange={(e) => (setBusca(e.target.value), setQuantidade(POR_PAGINA))}
              />
            </div>
            <Marcador rotulo="Só com preço" checked={soComPreco} onChange={(e) => setSoComPreco(e.target.checked)} />
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
                    <div className="text-xs text-texto-suave">
                      {[i.marcaNome, i.unidade].filter(Boolean).join(' · ')}
                    </div>
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {i.precoCentavos != null ? (
                      <>
                        <div className="text-base font-semibold text-texto">{formatarMoeda(i.precoCentavos)}</div>
                        {i.vigenteAte && (
                          <div className="text-xs text-texto-suave">até {formatarDataIso(i.vigenteAte)}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-sm text-alerta">Sem preço</span>
                    )}
                  </Td>
                  <Td suave className="whitespace-nowrap text-sm">
                    {i.proximoPrecoCentavos != null
                      ? `${formatarMoeda(i.proximoPrecoCentavos)} a partir de ${formatarDataIso(i.proximoInicio)}`
                      : '—'}
                  </Td>
                  {verEstoque && (
                    <Td
                      className={`text-right font-semibold whitespace-nowrap ${i.disponivel === 0 ? 'text-alerta' : ''}`}
                    >
                      {formatarQuantidade(i.disponivel ?? 0)}{' '}
                      <span className="text-xs font-normal text-texto-suave">{i.unidade}</span>
                    </Td>
                  )}
                </Linha>
              ))}
              {lista.data?.itens.length === 0 && (
                <LinhaVazia colunas={verEstoque ? 5 : 4}>
                  {busca ? 'Nenhum material encontrado.' : 'Nenhum material ativo nesta lista.'}
                </LinhaVazia>
              )}
            </tbody>
          </Tabela>
          {lista.data && lista.data.total > 0 && (
            <div className="flex flex-col items-center gap-3">
              <TextoSuave className="text-xs">
                Mostrando {lista.data.itens.length} de {lista.data.total.toLocaleString('pt-BR')} material(is)
                {verEstoque && ' · disponível somado de todos os depósitos'}
              </TextoSuave>
              {lista.data.total > lista.data.itens.length && quantidade < 100 && (
                <Botao
                  variante="secundario"
                  disabled={lista.isFetching}
                  onClick={() => setQuantidade((q) => q + POR_PAGINA)}
                >
                  Mostrar mais
                </Botao>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
