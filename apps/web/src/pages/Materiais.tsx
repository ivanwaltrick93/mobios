import { COLUNAS_IMPORTACAO_MATERIAIS, type MaterialResumo } from '@mobios/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Package, Plus } from 'lucide-react';
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
import { arvoreCategorias, useCategorias, useMarcas } from '../lib/materiais';
import { usePode } from '../lib/sessao';

export function Materiais() {
  const pode = usePode();
  const [filtro, setFiltro] = useState({ q: '', tipoId: '', categoriaId: '', marcaId: '', ativo: 'true' });
  const [pagina, setPagina] = useState(1);
  const [importando, setImportando] = useState(false);
  const queryClient = useQueryClient();
  const tipos = useOpcoes('tiposMaterial');
  const categorias = useCategorias();
  const marcas = useMarcas();
  const parametros = new URLSearchParams(
    Object.entries({ ...filtro, pagina: String(pagina), porPagina: String(POR_PAGINA) }).filter(([, v]) => v),
  );
  const materiais = useQuery({
    queryKey: ['materiais', parametros.toString()],
    queryFn: () => api<{ itens: MaterialResumo[]; total: number }>(`/materiais?${parametros}`),
    placeholderData: keepPreviousData,
  });
  const mudar = (campo: keyof typeof filtro, valor: string) => {
    setFiltro((f) => ({ ...f, [campo]: valor }));
    setPagina(1);
  };
  const dados = materiais.data;

  if (!pode('materiais')) return <Alerta>Você não tem permissão para acessar os produtos.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo
        acao={
          pode('materiais', 'editar') && (
            <div className="flex flex-wrap gap-2">
              <Botao variante="secundario" onClick={() => setImportando(!importando)}>
                <FileUp className="mr-1.5 size-4" aria-hidden /> Importar planilha
              </Botao>
              <Link to="/materiais/novo" className={classesBotao('primario')}>
                <Plus className="mr-1.5 size-4" aria-hidden /> Novo produto
              </Link>
            </div>
          )
        }
      >
        Produtos
      </Titulo>

      {importando && (
        <ImportarCsv
          titulo="Importar produtos"
          colunas={COLUNAS_IMPORTACAO_MATERIAIS}
          url="/materiais/importar"
          nomeModelo="modelo-produtos.csv"
          aoConcluir={() => queryClient.invalidateQueries({ queryKey: ['materiais'] })}
          aoFechar={() => setImportando(false)}
        />
      )}

      <div className="space-y-3">
        <CampoBusca
          rotulo="Buscar produtos"
          placeholder="SKU, descrição, código do fabricante ou de barras"
          valor={filtro.q}
          aoMudar={(valor) => mudar('q', valor)}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select aria-label="Tipo" value={filtro.tipoId} onChange={(e) => mudar('tipoId', e.target.value)}>
            <option value="">Todos os tipos</option>
            {tipos.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Categoria"
            value={filtro.categoriaId}
            onChange={(e) => mudar('categoriaId', e.target.value)}
          >
            <option value="">Todas as categorias</option>
            {arvoreCategorias(categorias.data).map((c) => (
              <option key={c.id} value={c.id}>
                {'   '.repeat(c.nivel)}
                {c.nome}
              </option>
            ))}
          </Select>
          <Select aria-label="Marca" value={filtro.marcaId} onChange={(e) => mudar('marcaId', e.target.value)}>
            <option value="">Todas as marcas</option>
            {marcas.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </Select>
          <Select aria-label="Status" value={filtro.ativo} onChange={(e) => mudar('ativo', e.target.value)}>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
            <option value="">Ativos e inativos</option>
          </Select>
        </div>
      </div>

      {dados && dados.itens.length === 0 ? (
        <Vazio
          icone={<Package />}
          titulo={
            filtro.q || filtro.tipoId || filtro.categoriaId || filtro.marcaId
              ? 'Nenhum produto encontrado'
              : 'Nenhum produto cadastrado ainda'
          }
        >
          {filtro.q ? 'Confira a grafia ou busque pelo SKU ou código do fabricante.' : undefined}
        </Vazio>
      ) : (
        <Tabela>
          <Cabecalho>
            <Th>SKU</Th>
            <Th>Descrição</Th>
            <Th>Cód. fabricante</Th>
            <Th>Tipo</Th>
            <Th>Categoria</Th>
            <Th>Marca</Th>
            <Th>Un.</Th>
            <Th>Status</Th>
            <Th />
          </Cabecalho>
          <tbody>
            {dados?.itens.map((m) => (
              <Linha key={m.id} className="hover:bg-superficie-alt">
                <Td className="whitespace-nowrap font-mono text-xs font-semibold">{m.sku}</Td>
                <Td>
                  <Link to={`/materiais/${m.id}`} className="font-medium text-texto hover:text-primaria">
                    {m.descricao}
                  </Link>
                </Td>
                <Td suave>{m.codigoFabricante ?? '—'}</Td>
                <Td suave>{m.tipoNome}</Td>
                <Td suave>{m.categoriaNome}</Td>
                <Td suave>{m.marcaNome ?? '—'}</Td>
                <Td suave>{m.unidade}</Td>
                <Td>{m.ativo ? <Selo tom="sucesso">Ativo</Selo> : <Selo>Inativo</Selo>}</Td>
                <Td className="text-right">
                  <BotaoVisualizar para={`/materiais/${m.id}`} />
                </Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      )}

      {dados && <Paginacao pagina={pagina} total={dados.total} aoMudar={setPagina} carregando={materiais.isFetching} />}
    </div>
  );
}
