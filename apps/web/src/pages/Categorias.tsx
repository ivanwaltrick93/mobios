import type { Categoria } from '@mobios/shared';
import { mascaraCodigo } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderTree } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AbasMateriais } from '../components/AbasMateriais';
import {
  Alerta,
  Botao,
  BotaoLink,
  Campo,
  Cartao,
  Input,
  Select,
  Selo,
  TextoSuave,
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
  const arvore = arvoreCategorias(categorias.data);
  const queryClient = useQueryClient();
  const acao = useMutation({
    mutationFn: ({ c, tipo }: { c: Categoria; tipo: 'status' | 'excluir' }) =>
      tipo === 'excluir'
        ? api(`/categorias/${c.id}`, { method: 'DELETE' })
        : api(`/categorias/${c.id}/status`, { method: 'PATCH', body: { ativo: !c.ativa } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categorias'] }),
  });

  if (!pode('materiais')) return <Alerta>Você não tem permissão para acessar os materiais.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo acao={editar && !edicao && <Botao onClick={() => setEdicao({ paiId: null })}>Nova categoria</Botao>}>
        Materiais
      </Titulo>
      <AbasMateriais />
      <TextoSuave>
        Organize os materiais em níveis (ex.: Peças › Motor › Filtros). Ao filtrar por uma categoria, as subcategorias
        entram junto.
      </TextoSuave>
      {edicao && !edicao.categoria && !edicao.paiId && (
        <EditorCategoria edicao={edicao} todas={categorias.data ?? []} aoConcluir={() => setEdicao(null)} />
      )}
      <Alerta>{acao.isError && acao.error.message}</Alerta>

      {arvore.length === 0 && !edicao ? (
        <Vazio icone={<FolderTree />} titulo="Nenhuma categoria cadastrada">
          Todo material precisa de uma categoria. Comece pelas principais: Peças, Pneus, Lubrificantes...
        </Vazio>
      ) : (
        <Cartao className="divide-y divide-borda p-0">
          {arvore.map((c) => (
            <div key={c.id}>
              <div
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                style={{ paddingLeft: `${1 + c.nivel * 1.5}rem` }}
              >
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`font-medium ${c.ativa ? 'text-texto' : 'text-texto-suave line-through'}`}>
                    {c.nome}
                  </span>
                  {c.codigo && <span className="font-mono text-xs text-texto-suave">{c.codigo}</span>}
                  {!c.ativa && <Selo>Inativa</Selo>}
                  <span className="text-xs text-texto-suave">{c.materiais} material(is)</span>
                </span>
                {editar && !edicao && (
                  <span className="flex flex-wrap gap-4 text-sm">
                    <BotaoLink onClick={() => setEdicao({ paiId: c.id })}>+ Subcategoria</BotaoLink>
                    <BotaoLink onClick={() => setEdicao({ categoria: c, paiId: c.categoriaPaiId })}>Editar</BotaoLink>
                    <BotaoLink onClick={() => acao.mutate({ c, tipo: 'status' })}>
                      {c.ativa ? 'Inativar' : 'Reativar'}
                    </BotaoLink>
                    <BotaoLink
                      perigo
                      onClick={() => confirm(`Excluir a categoria ${c.nome}?`) && acao.mutate({ c, tipo: 'excluir' })}
                    >
                      Excluir
                    </BotaoLink>
                  </span>
                )}
              </div>
              {edicao && (edicao.categoria?.id === c.id || (!edicao.categoria && edicao.paiId === c.id)) && (
                <div className="px-4 pb-4">
                  <EditorCategoria edicao={edicao} todas={categorias.data ?? []} aoConcluir={() => setEdicao(null)} />
                </div>
              )}
            </div>
          ))}
        </Cartao>
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
    onSuccess: () => (queryClient.invalidateQueries({ queryKey: ['categorias'] }), aoConcluir()),
  });
  // Pai possível: ativa (ou a atual) e que não seja a própria categoria nem uma descendente dela.
  const proibidos = c ? descendentes(todas, c.id) : new Set<string>();
  const pais = arvoreCategorias(todas).filter((p) => !proibidos.has(p.id) && (p.ativa || p.id === edicao.paiId));
  const enviar = (e: FormEvent) => (e.preventDefault(), salvar.mutate());

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
