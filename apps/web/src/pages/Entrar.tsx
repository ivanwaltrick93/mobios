import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, mascaraEmail, TEMA_VAZIO, type AparenciaPublica, type Sessao } from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router';
import type { z } from 'zod';
import { LogoMobiOS, Rodape } from '../components/Marca';
import { Alerta, Botao, Campo, Cartao, Input, InputMascara } from '../components/ui';
import { api } from '../lib/api';
import { aplicarErrosDaApi } from '../lib/formulario';
import { chaveSessao } from '../lib/sessao';
import { aplicarTema, urlLogoPublico } from '../lib/tema';

function useEntrarNaSessao() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (sessao: Sessao) => {
    queryClient.setQueryData(chaveSessao, sessao);
    navigate('/');
  };
}

/** Marca da oficina antes do login: `?oficina=<id>` no link ou a oficina única da instalação. */
function useMarcaPublica() {
  const [params] = useSearchParams();
  const oficina = params.get('oficina');
  const marca = useQuery({
    queryKey: ['publico', 'aparencia', oficina],
    queryFn: () => api<AparenciaPublica>(`/publico/aparencia${oficina ? `?${new URLSearchParams({ oficina })}` : ''}`),
    staleTime: 5 * 60_000,
  });
  useEffect(() => aplicarTema(marca.data?.tema ?? TEMA_VAZIO), [marca.data]);
  return marca;
}

function Moldura({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const { data: marca, isPending } = useMarcaPublica();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      {/* Enquanto carrega a marca, esconde o cartão para não "piscar" as cores padrão. */}
      <Cartao className={`w-full max-w-sm p-6 transition-opacity ${isPending ? 'opacity-0' : 'opacity-100'}`}>
        <div className="mb-6 text-center">
          {marca?.logoVersao ? (
            <img src={urlLogoPublico(marca.logoVersao, marca.oficinaId)} alt={marca.nome ?? 'Logo'} className="mx-auto mb-2 max-h-20 max-w-full object-contain" />
          ) : (
            <div className="mb-2">
              <LogoMobiOS tamanho="lg" />
            </div>
          )}
          {marca?.nome && <p className="font-medium text-texto">{marca.nome}</p>}
          <p className="text-sm text-texto-suave">{titulo}</p>
        </div>
        {children}
      </Cartao>
      <Rodape />
    </div>
  );
}

export function Entrar() {
  const entrar = useEntrarNaSessao();
  const form = useForm<z.input<typeof loginSchema>, unknown, z.output<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  const login = useMutation({
    mutationFn: (dados: z.output<typeof loginSchema>) => api<Sessao>('/auth/login', { method: 'POST', body: dados }),
    onSuccess: entrar,
  });
  const erros = form.formState.errors;

  return (
    <Moldura titulo="Sua oficina na palma da sua mão">
      <form className="space-y-4" onSubmit={form.handleSubmit((d) => login.mutate(d))}>
        <Alerta>{login.isError && aplicarErrosDaApi(login.error, form.setError)}</Alerta>
        <Campo rotulo="E-mail" erro={erros.email}>
          <InputMascara type="email" inputMode="email" autoComplete="email" registro={form.register('email')} mascara={mascaraEmail} />
        </Campo>
        <Campo rotulo="Senha" erro={erros.senha}>
          <Input type="password" autoComplete="current-password" {...form.register('senha')} />
        </Campo>
        <Botao type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </Botao>
      </form>
      <p className="mt-6 text-center text-xs text-texto-suave">Não tem acesso? Peça ao administrador da oficina.</p>
    </Moldura>
  );
}
