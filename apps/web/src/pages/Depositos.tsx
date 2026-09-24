import { mascaraCodigo, type Deposito } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Warehouse } from 'lucide-react';
import { Fragment, useState, type FormEvent } from 'react';
import {
  Alerta,
  Botao,
  BotaoLink,
  BotaoVisualizar,
  Cabecalho,
  Campo,
  Cartao,
  Detalhes,
  Input,
  Linha,
  Marcador,
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
import { useOpcoes } from '../lib/cadastro';
import { useDepositos } from '../lib/materiais';
import { usePode } from '../lib/sessao';

/** Usos permitidos no depósito, para a tabela e os detalhes. */
const usosDeposito = (d: Deposito) =>
  [d.permiteVenda && 'Venda', d.permiteUsoOs && 'Uso em O.S.', d.permiteTransferencia && 'Transferência'].filter(
    (uso): uso is string => !!uso,
  );

/** Depósitos: só o cadastro do local. Saldo e movimentação chegam com o módulo de estoque. */
export function Depositos() {
  const pode = usePode();
  const editar = pode('materiais', 'editar');
  const depositos = useDepositos();
  const [edicao, setEdicao] = useState<Deposito | 'novo' | null>(null);
  const [vendo, setVendo] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const acao = useMutation({
    mutationFn: ({ d, tipo }: { d: Deposito; tipo: 'status' | 'excluir' }) =>
      tipo === 'excluir'
        ? api(`/depositos/${d.id}`, { method: 'DELETE' })
        : api(`/depositos/${d.id}/status`, { method: 'PATCH', body: { ativo: !d.ativo } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['depositos'] }),
  });

  if (!pode('materiais')) return <Alerta>Você não tem permissão para acessar os materiais.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo acao={editar && !edicao && <Botao onClick={() => setEdicao('novo')}>Novo depósito</Botao>}>
        Depósitos
      </Titulo>
      <TextoSuave>
        Locais onde os materiais ficam guardados (loja, oficina, garantia...). O saldo por depósito chega com o módulo
        de estoque.
      </TextoSuave>
      {edicao === 'novo' && (
        <Cartao>
          <EditorDeposito aoConcluir={() => setEdicao(null)} />
        </Cartao>
      )}
      <Alerta>{acao.isError && acao.error.message}</Alerta>
      {depositos.data?.length === 0 && !edicao ? (
        <Vazio icone={<Warehouse />} titulo="Nenhum depósito cadastrado" />
      ) : (
        <Tabela>
          <Cabecalho>
            <Th>Código</Th>
            <Th>Nome</Th>
            <Th>Tipo</Th>
            <Th>Permite</Th>
            <Th>Status</Th>
            <Th />
          </Cabecalho>
          <tbody>
            {depositos.data?.map((d) =>
              edicao !== 'novo' && edicao?.id === d.id ? (
                <tr key={d.id}>
                  <td colSpan={6} className="p-4">
                    <EditorDeposito deposito={d} aoConcluir={() => setEdicao(null)} />
                  </td>
                </tr>
              ) : (
                <Fragment key={d.id}>
                  <Linha className="hover:bg-superficie-alt">
                    <Td className="whitespace-nowrap font-mono text-xs font-semibold">{d.codigo}</Td>
                    <Td className="font-medium text-texto">{d.nome}</Td>
                    <Td suave>{d.tipoNome}</Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {usosDeposito(d).map((uso) => (
                          <Selo key={uso}>{uso}</Selo>
                        ))}
                      </span>
                    </Td>
                    <Td>{d.ativo ? <Selo tom="sucesso">Ativo</Selo> : <Selo>Inativo</Selo>}</Td>
                    <Td className="text-right whitespace-nowrap">
                      <span className="flex items-center justify-end gap-4 text-sm">
                        <BotaoVisualizar
                          aberto={vendo === d.id}
                          aoClicar={() => setVendo(vendo === d.id ? null : d.id)}
                        />
                        {editar && !edicao && (
                          <>
                            <BotaoLink onClick={() => setEdicao(d)}>Editar</BotaoLink>
                            <BotaoLink onClick={() => acao.mutate({ d, tipo: 'status' })}>
                              {d.ativo ? 'Inativar' : 'Reativar'}
                            </BotaoLink>
                            <BotaoLink
                              perigo
                              onClick={() =>
                                confirm(`Excluir o depósito ${d.nome}?`) && acao.mutate({ d, tipo: 'excluir' })
                              }
                            >
                              Excluir
                            </BotaoLink>
                          </>
                        )}
                      </span>
                    </Td>
                  </Linha>
                  {vendo === d.id && (
                    <tr>
                      <td colSpan={6} className="px-4 pb-4">
                        <Detalhes
                          itens={[
                            { rotulo: 'Código', valor: d.codigo },
                            { rotulo: 'Nome', valor: d.nome },
                            { rotulo: 'Tipo', valor: d.tipoNome },
                            { rotulo: 'Descrição', valor: d.descricao ?? '—' },
                            { rotulo: 'Permite', valor: usosDeposito(d).join(', ') || 'Nenhum uso marcado' },
                            { rotulo: 'Status', valor: d.ativo ? 'Ativo' : 'Inativo' },
                            {
                              rotulo: 'Cadastrado',
                              valor: `${new Date(d.criadoEm).toLocaleString('pt-BR')} por ${d.criadoPor ?? '—'}`,
                            },
                            {
                              rotulo: 'Última alteração',
                              valor: `${new Date(d.atualizadoEm).toLocaleString('pt-BR')} por ${d.atualizadoPor ?? '—'}`,
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ),
            )}
          </tbody>
        </Tabela>
      )}
    </div>
  );
}

function EditorDeposito({ deposito, aoConcluir }: { deposito?: Deposito; aoConcluir: () => void }) {
  const queryClient = useQueryClient();
  const tipos = useOpcoes('tiposDeposito');
  const [dados, setDados] = useState({
    codigo: deposito?.codigo ?? '',
    nome: deposito?.nome ?? '',
    descricao: deposito?.descricao ?? '',
    tipoId: deposito?.tipoId ?? '',
    permiteVenda: deposito?.permiteVenda ?? true,
    permiteUsoOs: deposito?.permiteUsoOs ?? true,
    permiteTransferencia: deposito?.permiteTransferencia ?? true,
  });
  const salvar = useMutation({
    mutationFn: () =>
      api(deposito ? `/depositos/${deposito.id}` : '/depositos', {
        method: deposito ? 'PUT' : 'POST',
        body: { ...dados, versao: deposito?.versao },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['depositos'] });
      queryClient.invalidateQueries({ queryKey: ['opcoes'] });
      aoConcluir();
    },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate();
  };
  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Campo rotulo="Código *">
          <Input
            autoFocus
            placeholder="LOJA-01"
            value={dados.codigo}
            onChange={(e) => setDados({ ...dados, codigo: mascaraCodigo(e.target.value) })}
          />
        </Campo>
        <div className="md:col-span-2">
          <Campo rotulo="Nome *">
            <Input value={dados.nome} onChange={(e) => setDados({ ...dados, nome: e.target.value })} />
          </Campo>
        </div>
        <Campo rotulo="Tipo *">
          <Select value={dados.tipoId} onChange={(e) => setDados({ ...dados, tipoId: e.target.value })}>
            <option value="">—</option>
            {tipos.data
              ?.filter((t) => t.ativa || t.id === deposito?.tipoId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
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
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Marcador
          rotulo="Permite venda"
          checked={dados.permiteVenda}
          onChange={(e) => setDados({ ...dados, permiteVenda: e.target.checked })}
        />
        <Marcador
          rotulo="Permite uso em O.S."
          checked={dados.permiteUsoOs}
          onChange={(e) => setDados({ ...dados, permiteUsoOs: e.target.checked })}
        />
        <Marcador
          rotulo="Permite transferência"
          checked={dados.permiteTransferencia}
          onChange={(e) => setDados({ ...dados, permiteTransferencia: e.target.checked })}
        />
      </div>
      <Alerta>{salvar.isError && salvar.error.message}</Alerta>
      <div className="flex gap-2">
        <Botao type="submit" disabled={salvar.isPending}>
          {deposito ? 'Salvar' : 'Cadastrar depósito'}
        </Botao>
        <Botao type="button" variante="secundario" onClick={aoConcluir}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
