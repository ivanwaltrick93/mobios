import { zodResolver } from '@hookform/resolvers/zod';
import { nomesPapel, papelSchema, usuarioAtualizarSchema, usuarioCriarSchema, type Usuario } from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Alerta, Botao, BotaoLink, Cabecalho, Campo, Cartao, Input, Linha, Select, Selo, Tabela, Td, TextoSuave, Th, Titulo } from '../components/ui';
import { api } from '../lib/api';
import { aplicarErrosDaApi } from '../lib/formulario';
import { useSessao } from '../lib/sessao';

const chave = ['usuarios'];

const OpcoesPapel = () =>
  papelSchema.options.map((p) => (
    <option key={p} value={p}>
      {nomesPapel[p]}
    </option>
  ));

export function Usuarios() {
  const sessao = useSessao();
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const admin = sessao.data?.usuario.papel === 'admin';
  const usuarios = useQuery({ queryKey: chave, queryFn: () => api<Usuario[]>('/usuarios'), enabled: admin });

  if (!admin) return <Alerta>Apenas administradores podem gerenciar usuários.</Alerta>;

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
          <Th>Função</Th>
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
                <Td className="font-medium">{u.nome}</Td>
                <Td suave>{u.email}</Td>
                <Td suave>{nomesPapel[u.papel]}</Td>
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

function NovoUsuario({ aoConcluir }: { aoConcluir: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<z.input<typeof usuarioCriarSchema>, unknown, z.output<typeof usuarioCriarSchema>>({
    resolver: zodResolver(usuarioCriarSchema),
    defaultValues: { papel: 'atendente' },
  });
  const salvar = useMutation({
    mutationFn: (dados: z.output<typeof usuarioCriarSchema>) => api<Usuario>('/usuarios', { method: 'POST', body: dados }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chave });
      aoConcluir();
    },
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
      <Campo rotulo="Função" erro={erros.papel}>
        <Select {...form.register('papel')}>
          <OpcoesPapel />
        </Select>
      </Campo>
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
  const queryClient = useQueryClient();
  const form = useForm<z.input<typeof usuarioAtualizarSchema>, unknown, z.output<typeof usuarioAtualizarSchema>>({
    resolver: zodResolver(usuarioAtualizarSchema),
    defaultValues: { nome: usuario.nome, papel: usuario.papel, ativo: usuario.ativo, novaSenha: '' },
  });
  const salvar = useMutation({
    mutationFn: (dados: z.output<typeof usuarioAtualizarSchema>) => api<Usuario>(`/usuarios/${usuario.id}`, { method: 'PUT', body: dados }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chave });
      queryClient.invalidateQueries({ queryKey: ['sessao'] });
      aoConcluir();
    },
  });
  const erros = form.formState.errors;

  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={form.handleSubmit((d) => salvar.mutate(d))}>
      <div className="md:col-span-2">
        <TextoSuave>{usuario.email}</TextoSuave>
        <Alerta>{salvar.isError && aplicarErrosDaApi(salvar.error, form.setError)}</Alerta>
      </div>
      <Campo rotulo="Nome" erro={erros.nome}>
        <Input {...form.register('nome')} />
      </Campo>
      <Campo rotulo="Função" erro={erros.papel}>
        {/* O próprio admin não pode se rebaixar nem se desativar (a API também bloqueia).
            Os campos não são renderizados, e o formulário envia os valores de defaultValues. */}
        {proprio ? (
          <TextoSuave className="py-2">{nomesPapel[usuario.papel]} (sua conta)</TextoSuave>
        ) : (
          <Select {...form.register('papel')}>
            <OpcoesPapel />
          </Select>
        )}
      </Campo>
      <Campo rotulo="Nova senha (deixe em branco para manter)" erro={erros.novaSenha}>
        <Input type="password" autoComplete="new-password" {...form.register('novaSenha')} />
      </Campo>
      {!proprio && (
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
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
