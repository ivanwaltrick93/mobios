import { LISTAS_OPCOES, opcaoInputSchema, type ListaOpcoes, type Opcao } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AbasConfiguracoes } from '../components/AbasConfiguracoes';
import { Alerta, Botao, BotaoLink, Cartao, Input, Selo, TextoSuave, Titulo } from '../components/ui';
import { api } from '../lib/api';
import { chaveOpcoes, useOpcoes } from '../lib/cadastro';
import { useAdmin } from '../lib/sessao';

/** Configurações → Cadastros: listas editáveis usadas nos cadastros de clientes, materiais e depósitos. */
export function ListasCadastro() {
  const admin = useAdmin();
  if (!admin) return <Alerta>Você não tem permissão para alterar as configurações.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo>Configurações</Titulo>
      <AbasConfiguracoes />
      <TextoSuave>
        Opções que a equipe escolhe nos cadastros de clientes, materiais e depósitos. Um item desativado deixa de
        aparecer para novos cadastros, mas continua nos registros que já o usam.
      </TextoSuave>
      <div className="grid gap-6 lg:grid-cols-2">
        {(Object.keys(LISTAS_OPCOES) as ListaOpcoes[]).map((lista) => (
          <Lista key={lista} lista={lista} />
        ))}
      </div>
    </div>
  );
}

function Lista({ lista }: { lista: ListaOpcoes }) {
  const queryClient = useQueryClient();
  const opcoes = useOpcoes(lista);
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = useMutation({
    mutationFn: ({ id, ...dados }: { id?: string; nome: string; ativa: boolean }) =>
      api<Opcao>(id ? `/opcoes/${lista}/${id}` : `/opcoes/${lista}`, {
        method: id ? 'PUT' : 'POST',
        body: opcaoInputSchema.parse(dados),
      }),
    onSuccess: (_, dados) => {
      queryClient.invalidateQueries({ queryKey: chaveOpcoes(lista) });
      if (!dados.id) setNovo('');
      setEditando(null);
      setErro(null);
    },
    onError: (e) => setErro(e.message),
  });

  function enviar(dados: { id?: string; nome: string; ativa: boolean }) {
    const validado = opcaoInputSchema.safeParse(dados);
    if (!validado.success) return setErro(validado.error.issues[0]!.message);
    salvar.mutate(dados);
  }

  const { titulo, descricao } = LISTAS_OPCOES[lista];

  return (
    <Cartao>
      <h2 className="text-lg font-medium">{titulo}</h2>
      <TextoSuave className="mb-4">{descricao}</TextoSuave>

      <ul className="divide-y divide-borda">
        {opcoes.data?.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            {editando?.id === o.id ? (
              <form
                className="flex flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  enviar({ id: o.id, nome: editando.nome, ativa: o.ativa });
                }}
              >
                <Input
                  autoFocus
                  value={editando.nome}
                  onChange={(e) => setEditando({ id: o.id, nome: e.target.value })}
                />
                <Botao type="submit" disabled={salvar.isPending}>
                  Salvar
                </Botao>
                <Botao type="button" variante="secundario" onClick={() => setEditando(null)}>
                  Cancelar
                </Botao>
              </form>
            ) : (
              <>
                <span className="flex items-center gap-2">
                  <span className={o.ativa ? '' : 'text-texto-suave line-through'}>{o.nome}</span>
                  {!o.ativa && <Selo>Desativado</Selo>}
                  <span className="text-xs text-texto-suave">
                    {o.usos} {LISTAS_OPCOES[lista].uso}
                  </span>
                </span>
                <span className="flex gap-4">
                  <BotaoLink onClick={() => setEditando({ id: o.id, nome: o.nome })}>Renomear</BotaoLink>
                  <BotaoLink
                    disabled={salvar.isPending}
                    onClick={() => enviar({ id: o.id, nome: o.nome, ativa: !o.ativa })}
                  >
                    {o.ativa ? 'Desativar' : 'Reativar'}
                  </BotaoLink>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          enviar({ nome: novo, ativa: true });
        }}
      >
        <Input placeholder="Novo item" value={novo} onChange={(e) => setNovo(e.target.value)} />
        <Botao type="submit" disabled={salvar.isPending || !novo.trim()}>
          Adicionar
        </Botao>
      </form>
      <div className="mt-3">
        <Alerta>{erro}</Alerta>
      </div>
    </Cartao>
  );
}
