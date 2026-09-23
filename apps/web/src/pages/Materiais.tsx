import type { MaterialResumo } from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Package, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { AbasMateriais } from '../components/AbasMateriais';
import {
  Alerta,
  Botao,
  CampoBusca,
  Cartao,
  classesBotao,
  Select,
  Selo,
  TextoSuave,
  Titulo,
  Vazio,
} from '../components/ui';
import { api } from '../lib/api';
import { useOpcoes } from '../lib/cadastro';
import { arvoreCategorias, useCategorias, useMarcas } from '../lib/materiais';
import { usePode } from '../lib/sessao';

const POR_PAGINA = 30;

export function Materiais() {
  const pode = usePode();
  const [filtro, setFiltro] = useState({ q: '', tipoId: '', categoriaId: '', marcaId: '', ativo: 'true' });
  const [quantidade, setQuantidade] = useState(POR_PAGINA);
  const tipos = useOpcoes('tiposMaterial');
  const categorias = useCategorias();
  const marcas = useMarcas();
  const parametros = new URLSearchParams(
    Object.entries({ ...filtro, porPagina: String(Math.min(quantidade, 100)) }).filter(([, v]) => v),
  );
  const materiais = useQuery({
    queryKey: ['materiais', parametros.toString()],
    queryFn: () => api<{ itens: MaterialResumo[]; total: number }>(`/materiais?${parametros}`),
    placeholderData: keepPreviousData,
  });
  const mudar = (campo: keyof typeof filtro, valor: string) => {
    setFiltro((f) => ({ ...f, [campo]: valor }));
    setQuantidade(POR_PAGINA);
  };
  const dados = materiais.data;

  if (!pode('materiais')) return <Alerta>Você não tem permissão para acessar os materiais.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo
        acao={
          pode('materiais', 'editar') && (
            <Link to="/materiais/novo" className={classesBotao('primario')}>
              <Plus className="mr-1.5 size-4" aria-hidden /> Novo material
            </Link>
          )
        }
      >
        Materiais
      </Titulo>
      <AbasMateriais />

      <div className="space-y-3">
        <CampoBusca
          rotulo="Buscar materiais"
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
              ? 'Nenhum material encontrado'
              : 'Nenhum material cadastrado ainda'
          }
        >
          {filtro.q ? 'Confira a grafia ou busque pelo SKU ou código do fabricante.' : undefined}
        </Vazio>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {dados?.itens.map((m) => (
            <Cartao
              key={m.id}
              className="relative flex flex-col gap-2 p-4 transition hover:border-borda-forte hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="rounded bg-superficie-alt px-2 py-0.5 font-mono text-xs font-semibold text-texto">
                  {m.sku}
                </span>
                <span className="flex gap-1">
                  {!m.ativo && <Selo>Inativo</Selo>}
                  <Selo tom="primario">{m.tipoNome}</Selo>
                </span>
              </div>
              <Link
                to={`/materiais/${m.id}`}
                className="font-semibold text-texto after:absolute after:inset-0 after:rounded-lg hover:text-primaria"
              >
                {m.descricao}
              </Link>
              <p className="text-sm text-texto-suave">
                {[m.marcaNome, m.categoriaNome, m.codigoFabricante && `Fab. ${m.codigoFabricante}`, m.unidade]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </Cartao>
          ))}
        </div>
      )}

      {dados && dados.total > 0 && (
        <div className="flex flex-col items-center gap-3">
          <TextoSuave className="text-xs">
            Mostrando {dados.itens.length} de {dados.total.toLocaleString('pt-BR')} material(is)
          </TextoSuave>
          {dados.total > dados.itens.length && quantidade < 100 && (
            <Botao
              variante="secundario"
              disabled={materiais.isFetching}
              onClick={() => setQuantidade((q) => q + POR_PAGINA)}
            >
              Mostrar mais
            </Botao>
          )}
          {dados.total > dados.itens.length && quantidade >= 100 && (
            <TextoSuave className="text-xs">Refine a busca ou os filtros para ver os demais.</TextoSuave>
          )}
        </div>
      )}
    </div>
  );
}
