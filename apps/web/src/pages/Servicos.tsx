import { COLUNAS_IMPORTACAO_SERVICOS, formatarCodigoServico, type ServicoResumo } from '@mobios/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Plus, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ImportarCsv } from '../components/ImportarCsv';
import {
  Alerta,
  Botao,
  BotaoVisualizar,
  Cabecalho,
  CampoBusca,
  classesBotao,
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
import { useOpcoes } from '../lib/cadastro';
import { usePode } from '../lib/sessao';

/** Serviços (Ofertas → Serviços): lista com código, nome e situação; o detalhe tem os dados e os preços. */
export function Servicos() {
  const pode = usePode();
  const [filtro, setFiltro] = useState({ q: '', classificacaoId: '', ativo: 'true' });
  const [pagina, setPagina] = useState(1);
  const [importando, setImportando] = useState(false);
  const queryClient = useQueryClient();
  const classificacoes = useOpcoes('classificacoesServico');
  const parametros = new URLSearchParams(
    Object.entries({ ...filtro, pagina: String(pagina), porPagina: String(POR_PAGINA) }).filter(([, v]) => v),
  );
  const servicos = useQuery({
    queryKey: ['servicos', parametros.toString()],
    queryFn: () => api<{ itens: ServicoResumo[]; total: number }>(`/servicos?${parametros}`),
    placeholderData: keepPreviousData,
  });
  const mudar = (campo: keyof typeof filtro, valor: string) => {
    setFiltro((f) => ({ ...f, [campo]: valor }));
    setPagina(1);
  };
  const dados = servicos.data;

  if (!pode('servicos')) return <Alerta>Você não tem permissão para acessar os serviços.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo
        acao={
          pode('servicos', 'editar') && (
            <div className="flex flex-wrap gap-2">
              <Botao variante="secundario" onClick={() => setImportando(!importando)}>
                <FileUp className="mr-1.5 size-4" aria-hidden /> Importar planilha
              </Botao>
              <Link to="/servicos/novo" className={classesBotao('primario')}>
                <Plus className="mr-1.5 size-4" aria-hidden /> Novo serviço
              </Link>
            </div>
          )
        }
      >
        Serviços
      </Titulo>

      {importando && (
        <ImportarCsv
          titulo="Importar serviços"
          colunas={COLUNAS_IMPORTACAO_SERVICOS}
          url="/servicos/importar"
          nomeModelo="modelo-servicos.csv"
          aoConcluir={() => queryClient.invalidateQueries({ queryKey: ['servicos'] })}
          aoFechar={() => setImportando(false)}
        />
      )}

      <div className="space-y-3">
        <CampoBusca
          rotulo="Buscar serviços"
          placeholder="Código ou nome do serviço"
          valor={filtro.q}
          aoMudar={(valor) => mudar('q', valor)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            aria-label="Classificação"
            value={filtro.classificacaoId}
            onChange={(e) => mudar('classificacaoId', e.target.value)}
          >
            <option value="">Todas as classificações</option>
            {classificacoes.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Select>
          <Select aria-label="Situação" value={filtro.ativo} onChange={(e) => mudar('ativo', e.target.value)}>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
            <option value="">Ativos e inativos</option>
          </Select>
        </div>
      </div>

      {dados && dados.itens.length === 0 ? (
        <Vazio
          icone={<Wrench />}
          titulo={filtro.q || filtro.classificacaoId ? 'Nenhum serviço encontrado' : 'Nenhum serviço cadastrado ainda'}
        />
      ) : (
        <Tabela>
          <Cabecalho>
            <Th>Código</Th>
            <Th>Nome</Th>
            <Th>Situação</Th>
            <Th />
          </Cabecalho>
          <tbody>
            {dados?.itens.map((s) => (
              <Linha key={s.id} className="hover:bg-superficie-alt">
                <Td className="whitespace-nowrap font-mono text-xs font-semibold">{formatarCodigoServico(s.codigo)}</Td>
                <Td>
                  <Link to={`/servicos/${s.id}`} className="font-medium text-texto hover:text-primaria">
                    {s.nome}
                  </Link>
                </Td>
                <Td>{s.ativo ? <Selo tom="sucesso">Ativo</Selo> : <Selo>Inativo</Selo>}</Td>
                <Td className="text-right">
                  <BotaoVisualizar para={`/servicos/${s.id}`} />
                </Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      )}

      {dados && <Paginacao pagina={pagina} total={dados.total} aoMudar={setPagina} carregando={servicos.isFetching} />}
    </div>
  );
}
