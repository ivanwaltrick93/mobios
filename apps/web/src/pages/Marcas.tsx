import { mascaraCodigo, type Marca } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Tags } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AbasMateriais } from '../components/AbasMateriais';
import { Alerta, Botao, BotaoLink, Campo, Cartao, Input, Selo, TextoSuave, Titulo, Vazio } from '../components/ui';
import { api } from '../lib/api';
import { useMarcas } from '../lib/materiais';
import { usePode } from '../lib/sessao';

export function Marcas() {
  const pode = usePode();
  const editar = pode('materiais', 'editar');
  const marcas = useMarcas();
  const [edicao, setEdicao] = useState<Marca | 'nova' | null>(null);
  const queryClient = useQueryClient();
  const acao = useMutation({
    mutationFn: ({ m, tipo }: { m: Marca; tipo: 'status' | 'excluir' }) =>
      tipo === 'excluir'
        ? api(`/marcas/${m.id}`, { method: 'DELETE' })
        : api(`/marcas/${m.id}/status`, { method: 'PATCH', body: { ativo: !m.ativa } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['marcas'] }),
  });

  if (!pode('materiais')) return <Alerta>Você não tem permissão para acessar os materiais.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo acao={editar && !edicao && <Botao onClick={() => setEdicao('nova')}>Nova marca</Botao>}>Materiais</Titulo>
      <AbasMateriais />
      <TextoSuave>
        Fabricantes das peças (Bosch, Mann Filter, NGK...). Marca em uso não é excluída: é inativada.
      </TextoSuave>
      {edicao === 'nova' && <EditorMarca aoConcluir={() => setEdicao(null)} />}
      <Alerta>{acao.isError && acao.error.message}</Alerta>
      {marcas.data?.length === 0 && !edicao ? (
        <Vazio icone={<Tags />} titulo="Nenhuma marca cadastrada">
          A marca é opcional no material, mas ajuda a filtrar e comparar peças.
        </Vazio>
      ) : (
        <Cartao className="divide-y divide-borda p-0">
          {marcas.data?.map((m) =>
            edicao !== 'nova' && edicao?.id === m.id ? (
              <div key={m.id} className="p-4">
                <EditorMarca marca={m} aoConcluir={() => setEdicao(null)} />
              </div>
            ) : (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <span className={`font-medium ${m.ativa ? '' : 'text-texto-suave line-through'}`}>{m.nome}</span>
                  {m.codigo && <span className="font-mono text-xs text-texto-suave">{m.codigo}</span>}
                  {!m.ativa && <Selo>Inativa</Selo>}
                  <span className="text-xs text-texto-suave">{m.materiais} material(is)</span>
                </span>
                {editar && !edicao && (
                  <span className="flex gap-4">
                    <BotaoLink onClick={() => setEdicao(m)}>Editar</BotaoLink>
                    <BotaoLink onClick={() => acao.mutate({ m, tipo: 'status' })}>
                      {m.ativa ? 'Inativar' : 'Reativar'}
                    </BotaoLink>
                    <BotaoLink
                      perigo
                      onClick={() => confirm(`Excluir a marca ${m.nome}?`) && acao.mutate({ m, tipo: 'excluir' })}
                    >
                      Excluir
                    </BotaoLink>
                  </span>
                )}
              </div>
            ),
          )}
        </Cartao>
      )}
    </div>
  );
}

function EditorMarca({ marca, aoConcluir }: { marca?: Marca; aoConcluir: () => void }) {
  const queryClient = useQueryClient();
  const [dados, setDados] = useState({
    nome: marca?.nome ?? '',
    codigo: marca?.codigo ?? '',
    descricao: marca?.descricao ?? '',
  });
  const salvar = useMutation({
    mutationFn: () =>
      api(marca ? `/marcas/${marca.id}` : '/marcas', {
        method: marca ? 'PUT' : 'POST',
        body: { ...dados, versao: marca?.versao },
      }),
    onSuccess: () => (queryClient.invalidateQueries({ queryKey: ['marcas'] }), aoConcluir()),
  });
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
        <Campo rotulo="Descrição">
          <Input value={dados.descricao} onChange={(e) => setDados({ ...dados, descricao: e.target.value })} />
        </Campo>
      </div>
      <Alerta>{salvar.isError && salvar.error.message}</Alerta>
      <div className="flex gap-2">
        <Botao type="submit" disabled={salvar.isPending || !dados.nome.trim()}>
          {marca ? 'Salvar' : 'Cadastrar marca'}
        </Botao>
        <Botao type="button" variante="secundario" onClick={aoConcluir}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
