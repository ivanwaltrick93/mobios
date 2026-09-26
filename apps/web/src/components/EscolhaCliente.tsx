import { formatarDocumento, formatarPlaca, formatarTelefone, type ClienteParaOrcamento } from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { ClienteDoOrcamento } from './Orcamento';
import {
  Alerta,
  BarraFiltros,
  Cabecalho,
  Carregando,
  FiltroSelect,
  Janela,
  Linha,
  LinhaVazia,
  Paginacao,
  Selo,
  Tabela,
  Td,
  Th,
} from './ui';

const POR_PAGINA_JANELA = 10;

/**
 * Janela de escolha do cliente do orçamento: abre já listando os clientes ativos; busca por nome, CPF/CNPJ,
 * telefone ou placa, filtros de situação e tipo; com a busca vazia, os clientes recentes no topo. Clicar escolhe. Inativo ou incompleto aparece com o alerta
 * (pode receber orçamento).
 */
export function JanelaEscolhaCliente({
  aoEscolher,
  aoFechar,
}: {
  aoEscolher: (c: ClienteParaOrcamento) => void;
  aoFechar: () => void;
}) {
  const [filtro, setFiltro] = useState({ q: '', ativo: 'true', tipo: '' });
  const [pagina, setPagina] = useState(1);
  const parametros = new URLSearchParams({
    ...filtro,
    pagina: String(pagina),
    porPagina: String(POR_PAGINA_JANELA),
  });
  const lista = useQuery({
    queryKey: ['orcamentos', 'apoio', 'clientes', parametros.toString()],
    queryFn: () => api<{ itens: ClienteParaOrcamento[]; total: number }>(`/orcamentos/apoio/clientes?${parametros}`),
    placeholderData: keepPreviousData,
  });
  const mudar = (campo: keyof typeof filtro, valor: string) => {
    setFiltro((f) => ({ ...f, [campo]: valor }));
    setPagina(1);
  };
  // Recentes: os clientes dos últimos orçamentos, só com a busca vazia (atalho para quem volta a orçar).
  const buscando = filtro.q.trim() !== '';
  const recentes = useQuery({
    queryKey: ['orcamentos', 'apoio', 'clientes', 'recentes'],
    queryFn: () => api<ClienteParaOrcamento[]>('/orcamentos/apoio/clientes/recentes'),
    enabled: !buscando,
  });
  const dados = lista.data;

  return (
    <Janela titulo="Selecionar cliente" largura="max-w-5xl" aoFechar={aoFechar}>
      <div className="space-y-3">
        <BarraFiltros
          busca={{
            rotulo: 'Buscar cliente',
            placeholder: 'Nome, CPF/CNPJ, telefone ou placa',
            valor: filtro.q,
            aoMudar: (valor) => mudar('q', valor),
          }}
          total={dados?.total}
        >
          <FiltroSelect rotulo="Situação" value={filtro.ativo} onChange={(e) => mudar('ativo', e.target.value)}>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
            <option value="">Todos</option>
          </FiltroSelect>
          <FiltroSelect rotulo="Tipo" value={filtro.tipo} onChange={(e) => mudar('tipo', e.target.value)}>
            <option value="">PF e PJ</option>
            <option value="PF">Pessoa física</option>
            <option value="PJ">Pessoa jurídica</option>
          </FiltroSelect>
        </BarraFiltros>

        {!buscando && pagina === 1 && !!recentes.data?.length && (
          <section aria-label="Clientes recentes" className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-texto-suave">Recentes</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {recentes.data.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => aoEscolher(c)}
                  aria-label={`Escolher ${c.nome}`}
                  className="rounded-md border border-borda px-3 py-2 text-left text-sm hover:border-primaria hover:bg-primaria-suave focus:outline-none focus-visible:ring-2 focus-visible:ring-primaria"
                >
                  <ClienteDoOrcamento cliente={c} />
                  <span className="mt-0.5 block truncate text-xs text-texto-suave">
                    {[c.cpfCnpj && formatarDocumento(c.cpfCnpj), c.cidade].filter(Boolean).join(' · ') || c.tipo}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        {lista.isError && <Alerta>{lista.error.message}</Alerta>}
        {!dados ? (
          <Carregando />
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            <Tabela>
              <Cabecalho>
                <Th>Nome / Razão social</Th>
                <Th>Tipo</Th>
                <Th>CPF/CNPJ</Th>
                <Th>Telefone</Th>
                <Th>Cidade</Th>
                <Th>Placas</Th>
                <Th>Situação</Th>
              </Cabecalho>
              <tbody>
                {dados.itens.length === 0 && <LinhaVazia colunas={7}>Nenhum cliente encontrado.</LinhaVazia>}
                {dados.itens.map((c) => {
                  const contato = c.whatsapp ?? c.telefone;
                  return (
                    <Linha key={c.id} className="cursor-pointer hover:bg-primaria-suave">
                      <Td className="min-w-52">
                        <button
                          type="button"
                          className="text-left hover:text-primaria"
                          onClick={() => aoEscolher(c)}
                          aria-label={`Escolher ${c.nome}`}
                        >
                          <ClienteDoOrcamento cliente={c} />
                        </button>
                      </Td>
                      <Td suave onClick={() => aoEscolher(c)}>
                        {c.tipo}
                      </Td>
                      <Td suave className="whitespace-nowrap tabular-nums" onClick={() => aoEscolher(c)}>
                        {formatarDocumento(c.cpfCnpj)}
                      </Td>
                      <Td suave className="whitespace-nowrap tabular-nums" onClick={() => aoEscolher(c)}>
                        {contato ? formatarTelefone(contato) : '—'}
                      </Td>
                      <Td suave className="whitespace-nowrap" onClick={() => aoEscolher(c)}>
                        {c.cidade ?? '—'}
                      </Td>
                      <Td suave className="text-xs" onClick={() => aoEscolher(c)}>
                        {c.placas.length ? c.placas.map(formatarPlaca).join(', ') : '—'}
                      </Td>
                      <Td onClick={() => aoEscolher(c)}>
                        <Selo ponto tom={c.ativo ? 'sucesso' : 'neutro'}>
                          {c.ativo ? 'Ativo' : 'Inativo'}
                        </Selo>
                      </Td>
                    </Linha>
                  );
                })}
              </tbody>
            </Tabela>
          </div>
        )}
        {dados && (
          <Paginacao
            pagina={pagina}
            total={dados.total}
            porPagina={POR_PAGINA_JANELA}
            aoMudar={setPagina}
            carregando={lista.isFetching}
          />
        )}
      </div>
    </Janela>
  );
}
