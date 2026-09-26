import type { Categoria } from '@mobios/shared';
import { COLUNAS_IMPORTACAO_CATEGORIAS, mascaraCodigo } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUp, FolderTree } from 'lucide-react';
import { Fragment, useState, type FormEvent } from 'react';
import { ImportarCsv } from '../components/ImportarCsv';
import {
  Alerta,
  Botao,
  BotaoLink,
  BotaoVisualizar,
  Cabecalho,
  Campo,
  Detalhes,
  Input,
  Linha,
  Select,
  Selo,
  Tabela,
  Td,
  TextoSuave,
  Th,
  Titulo,
  Vazio,
} from '../components/ui';
import { api } from '../lib/api';
import { arvoreCategorias, descendentes, useCategorias } from '../lib/materiais';
import { usePode } from '../lib/sessao';

type Edicao = { categoria?: Categoria; paiId: string | null } | null;

/** Árvore de categorias (Peças › Motor › Filtros). Categoria em uso não é excluída: é inativada. */
export function Categorias() {
  const pode = usePode();
  const editar = pode('materiais', 'editar');
  const categorias = useCategorias();
  const [edicao, setEdicao] = useState<Edicao>(null);
  const [vendo, setVendo] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const arvore = arvoreCategorias(categorias.data);
  const queryClient = useQueryClient();
  const acao = useMutation({
    mutationFn: ({ c, tipo }: { c: Categoria; tipo: 'status' | 'excluir' }) =>
      tipo === 'excluir'
        ? api(`/categorias/${c.id}`, { method: 'DELETE' })
        : api(`/categorias/${c.id}/status`, { method: 'PATCH', body: { ativo: !c.ativa } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categorias'] }),
  });

  if (!pode('materiais')) return <Alerta>Você não tem permissão para acessar os produtos.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo
        acao={
          editar &&
          !edicao && (
            <div className="flex flex-wrap gap-2">
              <Botao variante="secundario" onClick={() => setImportando(!importando)}>
                <FileUp className="mr-1.5 size-4" aria-hidden /> Importar planilha
              </Botao>
              <Botao onClick={() => setEdicao({ paiId: null })}>Nova categoria</Botao>
            </div>
          )
        }
      >
        Categorias
      </Titulo>
      {importando && (
        <ImportarCsv
          titulo="Importar categorias"
          colunas={COLUNAS_IMPORTACAO_CATEGORIAS}
          url="/categorias/importar"
          nomeModelo="modelo-categorias.csv"
          aoConcluir={() => queryClient.invalidateQueries({ queryKey: ['categorias'] })}
          aoFechar={() => setImportando(false)}
        />
      )}
      <TextoSuave>
        Organize os produtos em níveis (ex.: Peças › Motor › Filtros). Ao filtrar por uma categoria, as subcategorias
        entram junto.
      </TextoSuave>
      {edicao && !edicao.categoria && !edicao.paiId && (
        <EditorCategoria edicao={edicao} todas={categorias.data ?? []} aoConcluir={() => setEdicao(null)} />
      )}
      <Alerta>{acao.isError && acao.error.message}</Alerta>

      {arvore.length === 0 && !edicao ? (
        <Vazio icone={<FolderTree />} titulo="Nenhuma categoria cadastrada">
          Todo produto precisa de uma categoria. Comece pelas principais: Peças, Pneus, Lubrificantes...
        </Vazio>
      ) : (
        <Tabela>
          <Cabecalho>
            <Th>Nome</Th>
            <Th>Código</Th>
            <Th className="text-right">Produtos</Th>
            <Th>Status</Th>
            <Th />
          </Cabecalho>
          <tbody>
            {arvore.map((c) => (
              <Fragment key={c.id}>
                <Linha className="hover:bg-superficie-alt">
                  <Td style={{ paddingLeft: `${1 + c.nivel * 1.5}rem` }}>
                    <span className={`font-medium ${c.ativa ? 'text-texto' : 'text-texto-suave line-through'}`}>
                      {c.nome}
                    </span>
                  </Td>
                  <Td suave className="font-mono text-xs">
                    {c.codigo ?? '—'}
                  </Td>
                  <Td suave className="text-right">
                    {c.materiais}
                  </Td>
                  <Td>{c.ativa ? <Selo tom="sucesso">Ativa</Selo> : <Selo>Inativa</Selo>}</Td>
                  <Td className="text-right whitespace-nowrap">
                    <span className="flex items-center justify-end gap-4 text-sm">
                      <BotaoVisualizar
                        aberto={vendo === c.id}
                        aoClicar={() => setVendo(vendo === c.id ? null : c.id)}
                      />
                      {editar && !edicao && (
                        <>
                          <BotaoLink onClick={() => setEdicao({ paiId: c.id })}>+ Subcategoria</BotaoLink>
                          <BotaoLink onClick={() => setEdicao({ categoria: c, paiId: c.categoriaPaiId })}>
                            Editar
                          </BotaoLink>
                          <BotaoLink onClick={() => acao.mutate({ c, tipo: 'status' })}>
                            {c.ativa ? 'Inativar' : 'Reativar'}
                          </BotaoLink>
                          <BotaoLink
                            perigo
                            onClick={() =>
                              confirm(`Excluir a categoria ${c.nome}?`) && acao.mutate({ c, tipo: 'excluir' })
                            }
                          >
                            Excluir
                          </BotaoLink>
                        </>
                      )}
                    </span>
                  </Td>
                </Linha>
                {vendo === c.id && (
                  <tr>
                    <td colSpan={5} className="px-4 pb-4">
                      <Detalhes
                        itens={[
                          { rotulo: 'Caminho', valor: c.caminho },
                          { rotulo: 'Código', valor: c.codigo ?? '—' },
                          { rotulo: 'Descrição', valor: c.descricao ?? '—' },
                          { rotulo: 'Produtos nesta categoria', valor: c.materiais },
                          { rotulo: 'Status', valor: c.ativa ? 'Ativa' : 'Inativa' },
                        ]}
                      />
                    </td>
                  </tr>
                )}
                {edicao && (edicao.categoria?.id === c.id || (!edicao.categoria && edicao.paiId === c.id)) && (
                  <tr>
                    <td colSpan={5} className="px-4 pb-4">
                      <EditorCategoria
                        edicao={edicao}
                        todas={categorias.data ?? []}
                        aoConcluir={() => setEdicao(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </Tabela>
      )}
    </div>
  );
}

function EditorCategoria({
  edicao,
  todas,
  aoConcluir,
}: {
  edicao: NonNullable<Edicao>;
  todas: Categoria[];
  aoConcluir: () => void;
}) {
  const queryClient = useQueryClient();
  const c = edicao.categoria;
  const [dados, setDados] = useState({
    nome: c?.nome ?? '',
    codigo: c?.codigo ?? '',
    descricao: c?.descricao ?? '',
    categoriaPaiId: edicao.paiId ?? '',
  });
  const salvar = useMutation({
    mutationFn: () =>
      api(c ? `/categorias/${c.id}` : '/categorias', {
        method: c ? 'PUT' : 'POST',
        body: { ...dados, versao: c?.versao },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] });
      aoConcluir();
    },
  });
  // Pai possível: ativa (ou a atual) e que não seja a própria categoria nem uma descendente dela.
  const proibidos = c ? descendentes(todas, c.id) : new Set<string>();
  const pais = arvoreCategorias(todas).filter((p) => !proibidos.has(p.id) && (p.ativa || p.id === edicao.paiId));
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate();
  };

  return (
    <form onSubmit={enviar} className="space-y-3 rounded-md border border-borda bg-superficie-alt p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <Campo rotulo="Nome *">
            <Input autoFocus value={dados.nome} onChange={(e) => setDados({ ...dados, nome: e.target.value })} />
          </Campo>
        </div>
        <Campo rotulo="Código" dica="Opcional, único">
          <Input value={dados.codigo} onChange={(e) => setDados({ ...dados, codigo: mascaraCodigo(e.target.value) })} />
        </Campo>
        <Campo rotulo="Dentro de">
          <Select value={dados.categoriaPaiId} onChange={(e) => setDados({ ...dados, categoriaPaiId: e.target.value })}>
            <option value="">(nível principal)</option>
            {pais.map((p) => (
              <option key={p.id} value={p.id}>
                {'   '.repeat(p.nivel)}
                {p.nome}
              </option>
            ))}
          </Select>
        </Campo>
        <div className="md:col-span-4">
          <Campo rotulo="Descrição">
            <Input value={dados.descricao} onChange={(e) => setDados({ ...dados, descricao: e.target.value })} />
          </Campo>
        </div>
      </div>
      <Alerta>{salvar.isError && salvar.error.message}</Alerta>
      <div className="flex gap-2">
        <Botao type="submit" disabled={salvar.isPending || dados.nome.trim().length < 2}>
          {c ? 'Salvar' : 'Cadastrar categoria'}
        </Botao>
        <Botao type="button" variante="secundario" onClick={aoConcluir}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
