import { zodResolver } from '@hookform/resolvers/zod';
import { usuarioAtualizarSchema, usuarioCriarSchema, type Funcao, type Usuario } from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm, type Control, type FieldValues, type Path } from 'react-hook-form';
import { Link } from 'react-router';
import type { z } from 'zod';
import { Avatar } from '../components/Avatar';
import { FotoUsuario } from '../components/FotoUsuario';
import { Alerta, Botao, BotaoLink, Cabecalho, Campo, Cartao, Input, Linha, Selo, Tabela, Td, TextoSuave, Th, Titulo } from '../components/ui';
import { api } from '../lib/api';
import { aplicarErrosDaApi } from '../lib/formulario';
import { chaveSessao, useAdmin, useSessao } from '../lib/sessao';

const chave = ['usuarios'];
export const chaveFuncoes = ['funcoes'];

const useFuncoes = () => useQuery({ queryKey: chaveFuncoes, queryFn: () => api<Funcao[]>('/funcoes') });

/**
 * Caixas de seleção das funções ATIVAS. `fixa`: função que não pode ser desmarcada
 * (o Administrador na própria conta, para a oficina nunca ficar sem admin).
 */
function SeletorFuncoes<T extends FieldValues>({ control, nome, fixa }: { control: Control<T>; nome: Path<T>; fixa?: string }) {
  const funcoes = useFuncoes();
  const ativas = funcoes.data?.filter((f) => f.ativa) ?? [];
  return (
    <Controller
      control={control}
      name={nome}
      render={({ field, fieldState }) => {
        const marcadas: string[] = field.value ?? [];
        const alternar = (id: string) => field.onChange(marcadas.includes(id) ? marcadas.filter((x) => x !== id) : [...marcadas, id]);
        return (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-texto">Funções</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {ativas.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={marcadas.includes(f.id)} disabled={f.id === fixa} onChange={() => alternar(f.id)} />
                  {f.nome}
                  {f.admin && <span className="text-xs text-texto-suave">(acesso total)</span>}
                </label>
              ))}
            </div>
            {fieldState.error?.message ? (
              <span className="text-xs text-perigo">{fieldState.error.message}</span>
            ) : (
              <span className="text-xs text-texto-suave">
                Com mais de uma função, vale o maior acesso de cada módulo.{' '}
                <Link to="/configuracoes/funcoes" className="text-primaria hover:underline">
                  Configurar funções
                </Link>
              </span>
            )}
          </fieldset>
        );
      }}
    />
  );
}

export function Usuarios() {
  const sessao = useSessao();
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const admin = useAdmin();
  const usuarios = useQuery({ queryKey: chave, queryFn: () => api<Usuario[]>('/usuarios'), enabled: admin });

  if (!admin) return <Alerta>Apenas o Administrador pode gerenciar usuários.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo acao={!novo && <Botao onClick={() => setNovo(true)}>Novo usuário</Botao>}>Usuários</Titulo>

      {novo && (
        <Cartao>
          <h2 className="mb-4 font-medium">Novo usuário</h2>
          <NovoUsuario aoConcluir={() => setNovo(false)} />
        </Cartao>
      )}

      <Tabela>
        <Cabecalho>
          <Th>Nome</Th>
          <Th>E-mail</Th>
          <Th>Funções</Th>
          <Th>Status</Th>
          <Th />
        </Cabecalho>
        <tbody>
          {usuarios.data?.map((u) =>
            editando === u.id ? (
              <Linha key={u.id} className="bg-superficie-alt">
                <Td colSpan={5} className="p-4">
                  <EditarUsuario usuario={u} proprio={u.id === sessao.data?.usuario.id} aoConcluir={() => setEditando(null)} />
                </Td>
              </Linha>
            ) : (
              <Linha key={u.id}>
                <Td>
                  <span className="flex items-center gap-3 font-medium">
                    <Avatar nome={u.nome} usuarioId={u.id} fotoVersao={u.fotoVersao} tamanho="sm" />
                    {u.nome}
                  </span>
                </Td>
                <Td suave>{u.email}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {u.funcoes.map((f) => (
                      <Selo key={f.id} tom={f.ativa ? 'primario' : 'neutro'}>
                        {f.nome}
                        {!f.ativa && ' (desativada)'}
                      </Selo>
                    ))}
                    {u.funcoes.length === 0 && <span className="text-sm text-texto-suave">—</span>}
                  </div>
                </Td>
                <Td>
                  <Selo tom={u.ativo ? 'sucesso' : 'neutro'}>{u.ativo ? 'Ativo' : 'Desativado'}</Selo>
                </Td>
                <Td className="text-right">
                  <BotaoLink onClick={() => setEditando(u.id)}>Editar</BotaoLink>
                </Td>
              </Linha>
            ),
          )}
        </tbody>
      </Tabela>
    </div>
  );
}

function useAoSalvar(aoConcluir: () => void) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: chave });
    queryClient.invalidateQueries({ queryKey: chaveFuncoes }); // contagem de usuários por função
    queryClient.invalidateQueries({ queryKey: chaveSessao }); // se editou a própria conta
    aoConcluir();
  };
}

function NovoUsuario({ aoConcluir }: { aoConcluir: () => void }) {
  const aoSalvar = useAoSalvar(aoConcluir);
  const form = useForm<z.input<typeof usuarioCriarSchema>, unknown, z.output<typeof usuarioCriarSchema>>({
    resolver: zodResolver(usuarioCriarSchema),
    defaultValues: { funcoes: [] },
  });
  const salvar = useMutation({
    mutationFn: (dados: z.output<typeof usuarioCriarSchema>) => api<Usuario>('/usuarios', { method: 'POST', body: dados }),
    onSuccess: aoSalvar,
  });
  const erros = form.formState.errors;

  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={form.handleSubmit((d) => salvar.mutate(d))}>
      <div className="md:col-span-2">
        <Alerta>{salvar.isError && aplicarErrosDaApi(salvar.error, form.setError)}</Alerta>
      </div>
      <Campo rotulo="Nome" erro={erros.nome}>
        <Input autoComplete="off" {...form.register('nome')} />
      </Campo>
      <Campo rotulo="E-mail (login)" erro={erros.email}>
        <Input type="email" autoComplete="off" {...form.register('email')} />
      </Campo>
      <div className="md:col-span-2">
        <SeletorFuncoes control={form.control} nome="funcoes" />
      </div>
      <Campo rotulo="Senha inicial (mín. 8 caracteres)" erro={erros.senha}>
        <Input type="password" autoComplete="new-password" {...form.register('senha')} />
      </Campo>
      <div className="flex gap-2 md:col-span-2">
        <Botao type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Cadastrar usuário'}
        </Botao>
        <Botao type="button" variante="secundario" onClick={aoConcluir}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}

function EditarUsuario({ usuario, proprio, aoConcluir }: { usuario: Usuario; proprio: boolean; aoConcluir: () => void }) {
  const aoSalvar = useAoSalvar(aoConcluir);
  const funcaoAdmin = usuario.funcoes.find((f) => f.admin && f.ativa)?.id;
  const form = useForm<z.input<typeof usuarioAtualizarSchema>, unknown, z.output<typeof usuarioAtualizarSchema>>({
    resolver: zodResolver(usuarioAtualizarSchema),
    // Só funções ativas vão no formulário; vínculos com funções desativadas são mantidos pela API.
    defaultValues: { nome: usuario.nome, funcoes: usuario.funcoes.filter((f) => f.ativa).map((f) => f.id), ativo: usuario.ativo, novaSenha: '' },
  });
  const salvar = useMutation({
    mutationFn: (dados: z.output<typeof usuarioAtualizarSchema>) => api<Usuario>(`/usuarios/${usuario.id}`, { method: 'PUT', body: dados }),
    onSuccess: aoSalvar,
  });
  const erros = form.formState.errors;
  const desativadas = usuario.funcoes.filter((f) => !f.ativa);

  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={form.handleSubmit((d) => salvar.mutate(d))}>
      <div className="md:col-span-2 space-y-4">
        <FotoUsuario usuarioId={usuario.id} nome={usuario.nome} fotoVersao={usuario.fotoVersao} />
        <TextoSuave>{usuario.email}</TextoSuave>
        <Alerta>{salvar.isError && aplicarErrosDaApi(salvar.error, form.setError)}</Alerta>
      </div>
      <Campo rotulo="Nome" erro={erros.nome}>
        <Input {...form.register('nome')} />
      </Campo>
      <Campo rotulo="Nova senha (deixe em branco para manter)" erro={erros.novaSenha}>
        <Input type="password" autoComplete="new-password" {...form.register('novaSenha')} />
      </Campo>
      <div className="md:col-span-2">
        {/* Na própria conta, o Administrador fica travado (a API também bloqueia). */}
        <SeletorFuncoes control={form.control} nome="funcoes" fixa={proprio ? funcaoAdmin : undefined} />
        {desativadas.length > 0 && (
          <TextoSuave className="mt-2 text-xs">
            Também tem {desativadas.map((f) => f.nome).join(', ')} (desativada: sem efeito até ser reativada).
          </TextoSuave>
        )}
      </div>
      {!proprio && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...form.register('ativo')} />
          Acesso ativo
        </label>
      )}
      <div className="flex gap-2 md:col-span-2">
        <Botao type="submit" disabled={salvar.isPending}>
          Salvar
        </Botao>
        <Botao type="button" variante="secundario" onClick={aoConcluir}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
