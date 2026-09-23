import { zodResolver } from '@hookform/resolvers/zod';
import { cadastroOficinaSchema, loginSchema, type Sessao } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import type { z } from 'zod';
import { Alerta, Botao, Campo, Cartao, Input } from '../components/ui';
import { api } from '../lib/api';
import { aplicarErrosDaApi } from '../lib/formulario';
import { chaveSessao } from '../lib/sessao';

function useEntrarNaSessao() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (sessao: Sessao) => {
    queryClient.setQueryData(chaveSessao, sessao);
    navigate('/clientes');
  };
}

const Moldura = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
  <div className="flex min-h-screen items-center justify-center p-4">
    <Cartao className="w-full max-w-sm p-6">
      <div className="mb-6 text-center">
        <div className="text-2xl font-bold text-marca-700">MobiOS</div>
        <p className="text-sm text-slate-500">{titulo}</p>
      </div>
      {children}
    </Cartao>
  </div>
);

export function Entrar() {
  const entrar = useEntrarNaSessao();
  const form = useForm<z.input<typeof loginSchema>, unknown, z.output<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  const login = useMutation({
    mutationFn: (dados: z.output<typeof loginSchema>) => api<Sessao>('/auth/login', { method: 'POST', body: dados }),
    onSuccess: entrar,
  });
  const erros = form.formState.errors;

  return (
    <Moldura titulo="Entre na sua oficina">
      <form className="space-y-4" onSubmit={form.handleSubmit((d) => login.mutate(d))}>
        <Alerta>{login.isError && aplicarErrosDaApi(login.error, form.setError)}</Alerta>
        <Campo rotulo="E-mail" erro={erros.email}>
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </Campo>
        <Campo rotulo="Senha" erro={erros.senha}>
          <Input type="password" autoComplete="current-password" {...form.register('senha')} />
        </Campo>
        <Botao type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </Botao>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Ainda não tem conta?{' '}
        <Link to="/criar-conta" className="text-marca-600 hover:underline">
          Cadastre sua oficina
        </Link>
      </p>
    </Moldura>
  );
}

export function CriarConta() {
  const entrar = useEntrarNaSessao();
  const form = useForm<z.input<typeof cadastroOficinaSchema>, unknown, z.output<typeof cadastroOficinaSchema>>({
    resolver: zodResolver(cadastroOficinaSchema),
  });
  const cadastro = useMutation({
    mutationFn: (dados: z.output<typeof cadastroOficinaSchema>) => api<Sessao>('/auth/cadastro', { method: 'POST', body: dados }),
    onSuccess: entrar,
  });
  const erros = form.formState.errors;

  return (
    <Moldura titulo="Cadastre sua oficina">
      <form className="space-y-4" onSubmit={form.handleSubmit((d) => cadastro.mutate(d))}>
        <Alerta>{cadastro.isError && aplicarErrosDaApi(cadastro.error, form.setError)}</Alerta>
        <Campo rotulo="Nome da oficina" erro={erros.nomeOficina}>
          <Input {...form.register('nomeOficina')} />
        </Campo>
        <Campo rotulo="CNPJ (opcional)" erro={erros.cnpj}>
          <Input inputMode="numeric" {...form.register('cnpj')} />
        </Campo>
        <Campo rotulo="Seu nome" erro={erros.nome}>
          <Input autoComplete="name" {...form.register('nome')} />
        </Campo>
        <Campo rotulo="E-mail" erro={erros.email}>
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </Campo>
        <Campo rotulo="Senha" erro={erros.senha}>
          <Input type="password" autoComplete="new-password" {...form.register('senha')} />
        </Campo>
        <Botao type="submit" className="w-full" disabled={cadastro.isPending}>
          {cadastro.isPending ? 'Criando…' : 'Criar conta'}
        </Botao>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Já tem conta?{' '}
        <Link to="/entrar" className="text-marca-600 hover:underline">
          Entrar
        </Link>
      </p>
    </Moldura>
  );
}
