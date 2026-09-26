import { zodResolver } from '@hookform/resolvers/zod';
import {
  COLUNAS_IMPORTACAO_VENDEDORES,
  EVENTOS_VENDEDOR,
  formatarDataIso,
  formatarTelefone,
  hojeIso,
  mascaraTelefone,
  ORIGENS_EVENTO_VENDEDOR,
  SITUACOES_VENDEDOR,
  vendedorInputSchema,
  type UsuarioDoVendedor,
  type UsuarioElegivel,
  type Vendedor,
  type VendedorEvento,
  type VendedorResumo,
} from '@mobios/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Plus } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ImportarCsv } from '../components/ImportarCsv';
import {
  Abas,
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
  InputMascara,
  Janela,
  Linha,
  LinhaVazia,
  Paginacao,
  POR_PAGINA,
  Select,
  Selo,
  Tabela,
  Td,
  TextoSuave,
  Th,
  Titulo,
} from '../components/ui';
import { api } from '../lib/api';
import { aplicarErrosDaApi } from '../lib/formulario';
import { useAdmin } from '../lib/sessao';

type Situacao = keyof typeof SITUACOES_VENDEDOR;

const dataHora = (d: Date | string) => new Date(d).toLocaleString('pt-BR');

/** Vendedores (Equipe → Vendedores): exclusivo do Administrador. Não há exclusão, só inativação. */
export function Vendedores() {
  const admin = useAdmin();
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<Situacao>('ativos');
  const [pagina, setPagina] = useState(1);
  const [painel, setPainel] = useState<'novo' | 'importacao' | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [vendo, setVendo] = useState<string | null>(null);
  const parametros = new URLSearchParams({
    q: busca,
    situacao,
    pagina: String(pagina),
    porPagina: String(POR_PAGINA),
  });
  const lista = useQuery({
    queryKey: ['vendedores', 'lista', parametros.toString()],
    queryFn: ({ signal }) => api<{ itens: VendedorResumo[]; total: number }>(`/vendedores?${parametros}`, { signal }),
    placeholderData: keepPreviousData,
    enabled: admin,
  });
  const status = useMutation({
    mutationFn: (v: VendedorResumo) =>
      api(`/vendedores/${v.id}/status`, { method: 'PATCH', body: { ativo: !v.ativo } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendedores'] }),
  });

  if (!admin) return <Alerta>Apenas o Administrador pode gerenciar vendedores.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo
        acao={
          <div className="flex flex-wrap gap-2">
            <Botao variante="secundario" onClick={() => setPainel(painel === 'importacao' ? null : 'importacao')}>
              <FileUp className="mr-1.5 size-4" aria-hidden /> Importar planilha
            </Botao>
            <Botao onClick={() => setPainel(painel === 'novo' ? null : 'novo')}>
              <Plus className="mr-1.5 size-4" aria-hidden /> Novo vendedor
            </Botao>
          </div>
        }
      >
        Vendedores
      </Titulo>
      <TextoSuave>
        Todo vendedor é um usuário ativo com uma função que tenha o parâmetro Vendedor (Configurações → Funções e
        permissões). Nome e e-mail vêm do usuário. Se o usuário for desativado ou perder essa função, o vendedor é
        inativado automaticamente.
      </TextoSuave>

      {painel === 'novo' && (
        <Cartao className="p-5">
          <h2 className="mb-4 font-medium">Novo vendedor</h2>
          <FormVendedor aoConcluir={() => setPainel(null)} />
        </Cartao>
      )}
      {painel === 'importacao' && (
        <ImportarCsv
          titulo="Importar vendedores"
          colunas={COLUNAS_IMPORTACAO_VENDEDORES}
          url="/vendedores/importar"
          nomeModelo="modelo-vendedores.csv"
          aoConcluir={() => queryClient.invalidateQueries({ queryKey: ['vendedores'] })}
          aoFechar={() => setPainel(null)}
        />
      )}

      <div className="grid gap-3 md:grid-cols-[1fr_12rem] md:items-center">
        <CampoBusca
          rotulo="Buscar vendedores"
          placeholder="Código, nome ou matrícula"
          valor={busca}
          aoMudar={(valor) => {
            setBusca(valor);
            setPagina(1);
          }}
        />
        <Select
          aria-label="Situação"
          value={situacao}
          onChange={(e) => {
            setSituacao(e.target.value as Situacao);
            setPagina(1);
          }}
        >
          {Object.entries(SITUACOES_VENDEDOR).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </Select>
      </div>

      <Alerta>{status.isError && status.error.message}</Alerta>
      <Tabela>
        <Cabecalho>
          <Th>Código</Th>
          <Th>Nome</Th>
          <Th>Matrícula</Th>
          <Th>Situação</Th>
          <Th />
        </Cabecalho>
        <tbody>
          {lista.data?.itens.map((v) =>
            editando === v.id ? (
              <tr key={v.id}>
                <td colSpan={5} className="bg-superficie-alt p-4">
                  <EditarVendedor id={v.id} aoConcluir={() => setEditando(null)} />
                </td>
              </tr>
            ) : (
              <Fragment key={v.id}>
                <Linha className="hover:bg-superficie-alt">
                  <Td className="whitespace-nowrap font-mono text-xs font-semibold">{v.codigo}</Td>
                  <Td className="font-medium text-texto">{v.nome}</Td>
                  <Td suave>{v.matricula ?? '—'}</Td>
                  <Td>{v.ativo ? <Selo tom="sucesso">Ativo</Selo> : <Selo>Inativo</Selo>}</Td>
                  <Td className="text-right whitespace-nowrap">
                    <span className="flex items-center justify-end gap-4 text-sm">
                      <BotaoVisualizar
                        aberto={vendo === v.id}
                        aoClicar={() => setVendo(vendo === v.id ? null : v.id)}
                      />
                      {!editando && (
                        <>
                          <BotaoLink onClick={() => setEditando(v.id)}>Editar</BotaoLink>
                          <BotaoLink disabled={status.isPending} onClick={() => status.mutate(v)}>
                            {v.ativo ? 'Inativar' : 'Reativar'}
                          </BotaoLink>
                        </>
                      )}
                    </span>
                  </Td>
                </Linha>
                {vendo === v.id && (
                  <tr>
                    <td colSpan={5} className="px-4 pb-4">
                      <DetalhesVendedor id={v.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ),
          )}
          {lista.data?.itens.length === 0 && (
            <LinhaVazia colunas={5}>
              {busca || situacao !== 'ativos'
                ? 'Nenhum vendedor encontrado com esses filtros.'
                : 'Nenhum vendedor cadastrado. Use "Novo vendedor" ou importe uma planilha.'}
            </LinhaVazia>
          )}
        </tbody>
      </Tabela>
      {lista.data && (
        <Paginacao pagina={pagina} total={lista.data.total} aoMudar={setPagina} carregando={lista.isFetching} />
      )}
    </div>
  );
}

const useVendedor = (id: string) =>
  useQuery({ queryKey: ['vendedores', id], queryFn: () => api<Vendedor>(`/vendedores/${id}`) });

/** Detalhes na linha da tabela: dados do vendedor e, em outra aba, o log de alterações. */
function DetalhesVendedor({ id }: { id: string }) {
  const vendedor = useVendedor(id);
  const [aba, setAba] = useState<'dados' | 'log'>('dados');
  const [usuarioAberto, setUsuarioAberto] = useState(false);

  if (vendedor.isError) return <Alerta>{vendedor.error.message}</Alerta>;
  if (!vendedor.data) return <TextoSuave>Carregando…</TextoSuave>;
  const v = vendedor.data;

  return (
    <div className="space-y-3">
      <Abas
        abas={[
          { id: 'dados', rotulo: 'Dados' },
          { id: 'log', rotulo: 'Log de alterações' },
        ]}
        atual={aba}
        aoTrocar={setAba}
      />
      {aba === 'dados' ? (
        <Detalhes
          itens={[
            { rotulo: 'Código', valor: v.codigo },
            { rotulo: 'Nome', valor: v.usuario.nome },
            { rotulo: 'E-mail', valor: v.usuario.email },
            { rotulo: 'WhatsApp', valor: formatarTelefone(v.whatsapp) },
            { rotulo: 'Matrícula', valor: v.matricula ?? '—' },
            { rotulo: 'Funcionário desde', valor: formatarDataIso(v.funcionarioDesde) },
            { rotulo: 'Situação', valor: v.ativo ? 'Ativo' : 'Inativo' },
            {
              rotulo: 'Usuário vinculado',
              valor: (
                <BotaoLink onClick={() => setUsuarioAberto(true)}>
                  Código {v.usuario.codigo} — {v.usuario.nome}
                </BotaoLink>
              ),
            },
            { rotulo: 'Cadastrado', valor: `${dataHora(v.criadoEm)} por ${v.criadoPor ?? '—'}` },
            { rotulo: 'Última alteração', valor: `${dataHora(v.atualizadoEm)} por ${v.atualizadoPor ?? '—'}` },
          ]}
        />
      ) : (
        <LogVendedor id={v.id} />
      )}
      {usuarioAberto && <JanelaUsuario usuario={v.usuario} aoFechar={() => setUsuarioAberto(false)} />}
    </div>
  );
}

/** Dados do usuário vinculado, só para consulta (a edição fica em Equipe → Usuários). */
function JanelaUsuario({ usuario, aoFechar }: { usuario: UsuarioDoVendedor; aoFechar: () => void }) {
  return (
    <Janela titulo={`Usuário ${usuario.codigo}`} aoFechar={aoFechar}>
      <Detalhes
        itens={[
          { rotulo: 'Código', valor: usuario.codigo },
          { rotulo: 'Nome', valor: usuario.nome },
          { rotulo: 'E-mail', valor: usuario.email },
          { rotulo: 'Funções', valor: usuario.funcoes.join(', ') || '—' },
          { rotulo: 'Situação', valor: usuario.ativo ? 'Ativo' : 'Desativado' },
          { rotulo: 'Cadastrado em', valor: dataHora(usuario.criadoEm) },
        ]}
      />
    </Janela>
  );
}

/** Log de alterações: uma linha por campo alterado, com antes, depois, quem e quando. */
function LogVendedor({ id }: { id: string }) {
  const eventos = useQuery({
    queryKey: ['vendedores', id, 'eventos'],
    queryFn: () => api<VendedorEvento[]>(`/vendedores/${id}/eventos`),
  });
  if (eventos.isError) return <Alerta>{eventos.error.message}</Alerta>;
  if (!eventos.data) return <TextoSuave>Carregando…</TextoSuave>;

  return (
    <Tabela>
      <Cabecalho>
        <Th>Data e hora</Th>
        <Th>Alteração</Th>
        <Th>Campo</Th>
        <Th>Antes</Th>
        <Th>Depois</Th>
        <Th>Por</Th>
      </Cabecalho>
      <tbody>
        {eventos.data.flatMap((e) =>
          e.alteracoes.map((a, i) => (
            <Linha key={`${e.id}-${i}`}>
              <Td suave className="whitespace-nowrap">
                {dataHora(e.criadoEm)}
              </Td>
              <Td>
                {EVENTOS_VENDEDOR[e.evento]}
                <span className="block text-xs text-texto-suave">
                  {ORIGENS_EVENTO_VENDEDOR[e.origem]}
                  {e.motivo && `: ${e.motivo}`}
                </span>
              </Td>
              <Td className="whitespace-nowrap">{a.campo}</Td>
              <Td suave>{a.antes ?? '—'}</Td>
              <Td>{a.depois ?? '—'}</Td>
              <Td suave className="whitespace-nowrap">
                {e.usuario ?? '—'}
              </Td>
            </Linha>
          )),
        )}
      </tbody>
    </Tabela>
  );
}

function EditarVendedor({ id, aoConcluir }: { id: string; aoConcluir: () => void }) {
  const vendedor = useVendedor(id);
  if (vendedor.isError) return <Alerta>{vendedor.error.message}</Alerta>;
  if (!vendedor.data) return <TextoSuave>Carregando…</TextoSuave>;
  return <FormVendedor vendedor={vendedor.data} aoConcluir={aoConcluir} />;
}

type Entrada = z.input<typeof vendedorInputSchema>;
type Saida = z.output<typeof vendedorInputSchema>;

function FormVendedor({ vendedor, aoConcluir }: { vendedor?: Vendedor; aoConcluir: () => void }) {
  const queryClient = useQueryClient();
  const elegiveis = useQuery({
    queryKey: ['vendedores', 'usuarios-elegiveis', vendedor?.id ?? 'novo'],
    queryFn: () =>
      api<UsuarioElegivel[]>(`/vendedores/usuarios-elegiveis${vendedor ? `?vendedorId=${vendedor.id}` : ''}`),
  });
  const form = useForm<Entrada, unknown, Saida>({
    resolver: zodResolver(vendedorInputSchema),
    mode: 'onTouched',
    defaultValues: {
      usuarioId: vendedor?.usuario.id ?? '',
      whatsapp: mascaraTelefone(vendedor?.whatsapp ?? ''),
      matricula: vendedor?.matricula ?? '',
      funcionarioDesde: vendedor?.funcionarioDesde ?? '',
    },
  });
  const salvar = useMutation({
    mutationFn: (dados: Saida) =>
      api<Vendedor>(vendedor ? `/vendedores/${vendedor.id}` : '/vendedores', {
        method: vendedor ? 'PUT' : 'POST',
        body: dados,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendedores'] });
      aoConcluir();
    },
  });
  const erros = form.formState.errors;
  const usuarioId = form.watch('usuarioId');
  // O usuário atual pode não ser mais elegível (ex.: vendedor inativo por usuário desativado): mostra mesmo assim.
  const opcoes = [
    ...(vendedor && !elegiveis.data?.some((u) => u.id === vendedor.usuario.id) ? [vendedor.usuario] : []),
    ...(elegiveis.data ?? []),
  ];
  const escolhido = opcoes.find((u) => u.id === usuarioId);

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit((d) => salvar.mutate(d))}>
      <Alerta>{salvar.isError && aplicarErrosDaApi(salvar.error, form.setError)}</Alerta>
      <div className="grid gap-3 md:grid-cols-3">
        <Campo rotulo="Código">
          <Input value={vendedor?.codigo ?? 'Gerado ao salvar'} disabled />
        </Campo>
        <div className="md:col-span-2">
          <Campo
            rotulo="Usuário *"
            erro={erros.usuarioId}
            dica={
              elegiveis.data?.length === 0 && !vendedor
                ? 'Nenhum usuário disponível: todos já são vendedores ou não têm função com o parâmetro Vendedor.'
                : undefined
            }
          >
            <Select autoFocus {...form.register('usuarioId')}>
              <option value="">Escolha o usuário</option>
              {opcoes.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.codigo} — {u.nome}
                </option>
              ))}
            </Select>
          </Campo>
        </div>
        <Campo rotulo="E-mail (do usuário)">
          <Input value={escolhido?.email ?? ''} disabled placeholder="Escolha o usuário" />
        </Campo>
        <Campo rotulo="WhatsApp *" erro={erros.whatsapp}>
          <InputMascara
            type="tel"
            placeholder="(00) 00000-0000"
            registro={form.register('whatsapp')}
            mascara={mascaraTelefone}
          />
        </Campo>
        <Campo rotulo="Matrícula" erro={erros.matricula}>
          <Input maxLength={30} {...form.register('matricula')} />
        </Campo>
        <Campo rotulo="Funcionário desde" erro={erros.funcionarioDesde}>
          <Input type="date" max={hojeIso()} {...form.register('funcionarioDesde')} />
        </Campo>
      </div>
      <div className="flex gap-2">
        <Botao type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : vendedor ? 'Salvar' : 'Cadastrar vendedor'}
        </Botao>
        <Botao type="button" variante="secundario" onClick={aoConcluir}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
