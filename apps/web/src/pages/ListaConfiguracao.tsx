import { zodResolver } from '@hookform/resolvers/zod';
import { LISTAS_OPCOES, opcaoInputSchema, type ListaOpcoes, type Opcao } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import {
  Alerta,
  Botao,
  BotaoLink,
  BotaoVisualizar,
  Cabecalho,
  Campo,
  CampoBusca,
  Cartao,
  Detalhes,
  Input,
  Linha,
  LinhaVazia,
  Paginacao,
  POR_PAGINA,
  Selo,
  Tabela,
  Td,
  TextoSuave,
  Th,
  Titulo,
} from '../components/ui';
import { api } from '../lib/api';
import { chaveOpcoes, useOpcoes } from '../lib/cadastro';
import { aplicarErrosDaApi } from '../lib/formulario';
import { useAdmin } from '../lib/sessao';

/**
 * Uma lista parametrizável de Configurações (origem do cliente, tipo de material...): código automático, nome,
 * descrição e status. Excluir só o item sem uso; com uso, apenas inativar. As listas são curtas: a API devolve a
 * lista inteira (os formulários precisam dela) e a busca e a paginação acontecem aqui.
 */
export function ListaConfiguracao({ lista }: { lista: ListaOpcoes }) {
  const admin = useAdmin();
  const queryClient = useQueryClient();
  const opcoes = useOpcoes(lista);
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [vendo, setVendo] = useState<string | null>(null);
  const acao = useMutation({
    mutationFn: ({ item, tipo }: { item: Opcao; tipo: 'status' | 'excluir' }) =>
      tipo === 'excluir'
        ? api(`/opcoes/${lista}/${item.id}`, { method: 'DELETE' })
        : api(`/opcoes/${lista}/${item.id}`, {
            method: 'PUT',
            body: { nome: item.nome, descricao: item.descricao, ativa: !item.ativa },
          }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chaveOpcoes(lista) }),
  });

  if (!admin) return <Alerta>Você não tem permissão para alterar as configurações.</Alerta>;

  const { titulo, descricao, uso } = LISTAS_OPCOES[lista];
  const termo = busca.trim().toLowerCase();
  const filtrados = (opcoes.data ?? [])
    .filter((o) => !termo || String(o.codigo) === termo || o.nome.toLowerCase().includes(termo))
    .sort((a, b) => a.codigo - b.codigo);
  const itens = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  return (
    <div className="space-y-6">
      <Titulo
        acao={
          !novo && (
            <Botao onClick={() => setNovo(true)}>
              <Plus className="mr-1.5 size-4" aria-hidden /> Novo item
            </Botao>
          )
        }
      >
        {titulo}
      </Titulo>
      <TextoSuave>
        {descricao} Um item inativo deixa de aparecer para novos cadastros, mas continua nos registros que já o usam. Só
        é possível excluir um item que nenhum registro usa.
      </TextoSuave>

      {novo && (
        <Cartao className="p-5">
          <h2 className="mb-4 font-medium">Novo item</h2>
          <EditorItem lista={lista} aoConcluir={() => setNovo(false)} />
        </Cartao>
      )}

      <CampoBusca
        rotulo={`Buscar em ${titulo}`}
        placeholder="Código ou nome"
        valor={busca}
        aoMudar={(valor) => {
          setBusca(valor);
          setPagina(1);
        }}
      />

      <Alerta>{acao.isError && acao.error.message}</Alerta>
      {opcoes.isError && <Alerta>{opcoes.error.message}</Alerta>}
      <Tabela>
        <Cabecalho>
          <Th>Código</Th>
          <Th>Nome</Th>
          <Th>Descrição</Th>
          <Th className="text-right">Em uso</Th>
          <Th>Situação</Th>
          <Th />
        </Cabecalho>
        <tbody>
          {itens.map((o) =>
            editando === o.id ? (
              <tr key={o.id}>
                <td colSpan={6} className="bg-superficie-alt p-4">
                  <EditorItem lista={lista} item={o} aoConcluir={() => setEditando(null)} />
                </td>
              </tr>
            ) : (
              <Fragment key={o.id}>
                <Linha className="hover:bg-superficie-alt">
                  <Td className="whitespace-nowrap font-mono text-xs font-semibold">{o.codigo}</Td>
                  <Td className="font-medium text-texto">{o.nome}</Td>
                  <Td suave>{o.descricao ?? '—'}</Td>
                  <Td suave className="text-right whitespace-nowrap">
                    {o.usos} {uso}
                  </Td>
                  <Td>{o.ativa ? <Selo tom="sucesso">Ativo</Selo> : <Selo>Inativo</Selo>}</Td>
                  <Td className="text-right whitespace-nowrap">
                    <span className="flex items-center justify-end gap-4 text-sm">
                      <BotaoVisualizar
                        aberto={vendo === o.id}
                        aoClicar={() => setVendo(vendo === o.id ? null : o.id)}
                      />
                      {!editando && (
                        <>
                          <BotaoLink onClick={() => setEditando(o.id)}>Editar</BotaoLink>
                          <BotaoLink disabled={acao.isPending} onClick={() => acao.mutate({ item: o, tipo: 'status' })}>
                            {o.ativa ? 'Inativar' : 'Reativar'}
                          </BotaoLink>
                          {o.usos === 0 && (
                            <BotaoLink
                              perigo
                              disabled={acao.isPending}
                              onClick={() =>
                                confirm(`Excluir "${o.nome}"?`) && acao.mutate({ item: o, tipo: 'excluir' })
                              }
                            >
                              Excluir
                            </BotaoLink>
                          )}
                        </>
                      )}
                    </span>
                  </Td>
                </Linha>
                {vendo === o.id && (
                  <tr>
                    <td colSpan={6} className="px-4 pb-4">
                      <Detalhes
                        itens={[
                          { rotulo: 'Código', valor: o.codigo },
                          { rotulo: 'Nome', valor: o.nome },
                          { rotulo: 'Descrição', valor: o.descricao ?? '—' },
                          { rotulo: 'Em uso', valor: `${o.usos} ${uso}` },
                          { rotulo: 'Situação', valor: o.ativa ? 'Ativo' : 'Inativo' },
                        ]}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ),
          )}
          {opcoes.data && itens.length === 0 && (
            <LinhaVazia colunas={6}>
              {termo ? 'Nenhum item encontrado.' : 'Nenhum item cadastrado. Use "Novo item".'}
            </LinhaVazia>
          )}
        </tbody>
      </Tabela>
      <Paginacao pagina={pagina} total={filtrados.length} aoMudar={setPagina} />
    </div>
  );
}

type Entrada = z.input<typeof opcaoInputSchema>;
type Saida = z.output<typeof opcaoInputSchema>;

function EditorItem({ lista, item, aoConcluir }: { lista: ListaOpcoes; item?: Opcao; aoConcluir: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<Entrada, unknown, Saida>({
    resolver: zodResolver(opcaoInputSchema),
    mode: 'onTouched',
    defaultValues: { nome: item?.nome ?? '', descricao: item?.descricao ?? '', ativa: item?.ativa ?? true },
  });
  const salvar = useMutation({
    mutationFn: (dados: Saida) =>
      api<Opcao>(item ? `/opcoes/${lista}/${item.id}` : `/opcoes/${lista}`, {
        method: item ? 'PUT' : 'POST',
        body: dados,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chaveOpcoes(lista) });
      aoConcluir();
    },
  });
  const erros = form.formState.errors;

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit((d) => salvar.mutate(d))}>
      <Alerta>{salvar.isError && aplicarErrosDaApi(salvar.error, form.setError)}</Alerta>
      <div className="grid gap-3 md:grid-cols-[8rem_1fr_2fr]">
        <Campo rotulo="Código">
          <Input value={item?.codigo ?? 'Gerado ao salvar'} disabled />
        </Campo>
        <Campo rotulo="Nome *" erro={erros.nome}>
          <Input autoFocus maxLength={60} {...form.register('nome')} />
        </Campo>
        <Campo rotulo="Descrição" erro={erros.descricao}>
          <Input maxLength={200} {...form.register('descricao')} />
        </Campo>
      </div>
      <div className="flex gap-2">
        <Botao type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : item ? 'Salvar' : 'Cadastrar item'}
        </Botao>
        <Botao type="button" variante="secundario" onClick={aoConcluir}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
