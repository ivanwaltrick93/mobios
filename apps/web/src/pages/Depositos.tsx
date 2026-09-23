import { mascaraCodigo, type Deposito } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Warehouse } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AbasMateriais } from '../components/AbasMateriais';
import { Alerta, Botao, BotaoLink, Campo, Cartao, Input, Marcador, Select, Selo, TextoSuave, Titulo, Vazio } from '../components/ui';
import { api } from '../lib/api';
import { useOpcoes } from '../lib/cadastro';
import { useDepositos } from '../lib/materiais';
import { usePode } from '../lib/sessao';

/** Depósitos: só o cadastro do local. Saldo e movimentação chegam com o módulo de estoque. */
export function Depositos() {
  const pode = usePode();
  const editar = pode('materiais', 'editar');
  const depositos = useDepositos();
  const [edicao, setEdicao] = useState<Deposito | 'novo' | null>(null);
  const queryClient = useQueryClient();
  const acao = useMutation({
    mutationFn: ({ d, tipo }: { d: Deposito; tipo: 'status' | 'excluir' }) =>
      tipo === 'excluir' ? api(`/depositos/${d.id}`, { method: 'DELETE' }) : api(`/depositos/${d.id}/status`, { method: 'PATCH', body: { ativo: !d.ativo } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['depositos'] }),
  });

  if (!pode('materiais')) return <Alerta>Você não tem permissão para acessar os materiais.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo acao={editar && !edicao && <Botao onClick={() => setEdicao('novo')}>Novo depósito</Botao>}>Materiais</Titulo>
      <AbasMateriais />
      <TextoSuave>Locais onde os materiais ficam guardados (loja, oficina, garantia...). O saldo por depósito chega com o módulo de estoque.</TextoSuave>
      {edicao === 'novo' && (
        <Cartao>
          <EditorDeposito aoConcluir={() => setEdicao(null)} />
        </Cartao>
      )}
      <Alerta>{acao.isError && acao.error.message}</Alerta>
      {depositos.data?.length === 0 && !edicao ? (
        <Vazio icone={<Warehouse />} titulo="Nenhum depósito cadastrado" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {depositos.data?.map((d) =>
            edicao !== 'novo' && edicao?.id === d.id ? (
              <Cartao key={d.id} className="p-5 md:col-span-2">
                <EditorDeposito deposito={d} aoConcluir={() => setEdicao(null)} />
              </Cartao>
            ) : (
              <Cartao key={d.id} className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-xs font-semibold text-texto-suave">{d.codigo}</span>
                    <h3 className="font-semibold text-texto">{d.nome}</h3>
                  </div>
                  <span className="flex gap-1">
                    <Selo tom="primario">{d.tipoNome}</Selo>
                    {!d.ativo && <Selo>Inativo</Selo>}
                  </span>
                </div>
                {d.descricao && <TextoSuave>{d.descricao}</TextoSuave>}
                <div className="flex flex-wrap gap-1">
                  {d.permiteVenda && <Selo>Venda</Selo>}
                  {d.permiteUsoOs && <Selo>Uso em O.S.</Selo>}
                  {d.permiteTransferencia && <Selo>Transferência</Selo>}
                </div>
                {editar && !edicao && (
                  <div className="mt-auto flex gap-4 border-t border-borda pt-3 text-sm">
                    <BotaoLink onClick={() => setEdicao(d)}>Editar</BotaoLink>
                    <BotaoLink onClick={() => acao.mutate({ d, tipo: 'status' })}>{d.ativo ? 'Inativar' : 'Reativar'}</BotaoLink>
                    <BotaoLink perigo className="ml-auto" onClick={() => confirm(`Excluir o depósito ${d.nome}?`) && acao.mutate({ d, tipo: 'excluir' })}>
                      Excluir
                    </BotaoLink>
                  </div>
                )}
              </Cartao>
            ),
          )}
        </div>
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
    mutationFn: () => api(deposito ? `/depositos/${deposito.id}` : '/depositos', { method: deposito ? 'PUT' : 'POST', body: { ...dados, versao: deposito?.versao } }),
    onSuccess: () => (queryClient.invalidateQueries({ queryKey: ['depositos'] }), queryClient.invalidateQueries({ queryKey: ['opcoes'] }), aoConcluir()),
  });
  const enviar = (e: FormEvent) => (e.preventDefault(), salvar.mutate());
  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Campo rotulo="Código *">
          <Input autoFocus placeholder="LOJA-01" value={dados.codigo} onChange={(e) => setDados({ ...dados, codigo: mascaraCodigo(e.target.value) })} />
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
        <Marcador rotulo="Permite venda" checked={dados.permiteVenda} onChange={(e) => setDados({ ...dados, permiteVenda: e.target.checked })} />
        <Marcador rotulo="Permite uso em O.S." checked={dados.permiteUsoOs} onChange={(e) => setDados({ ...dados, permiteUsoOs: e.target.checked })} />
        <Marcador rotulo="Permite transferência" checked={dados.permiteTransferencia} onChange={(e) => setDados({ ...dados, permiteTransferencia: e.target.checked })} />
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
