import { zodResolver } from '@hookform/resolvers/zod';
import { alterarSenhaFormSchema } from '@mobios/shared';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FotoUsuario } from '../components/FotoUsuario';
import { Alerta, Botao, Campo, Cartao, Input, Secao, Selo, TextoSuave, Titulo } from '../components/ui';
import { api } from '../lib/api';
import { aplicarErrosDaApi } from '../lib/formulario';
import { useSessao } from '../lib/sessao';

/** Dados do próprio usuário. A foto e a senha podem ser trocadas aqui; o restante é mantido pelo Administrador. */
export function Perfil() {
  const { data } = useSessao();
  if (!data) return null;
  const { usuario } = data;
  return (
    <div className="space-y-6">
      <Titulo>Meu perfil</Titulo>
      <Cartao className="space-y-6 p-6">
        <FotoUsuario usuarioId={usuario.id} nome={usuario.nome} fotoVersao={usuario.fotoVersao} />
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-texto-suave">Nome</dt>
            <dd className="font-medium">{usuario.nome}</dd>
          </div>
          <div>
            <dt className="text-sm text-texto-suave">E-mail (login)</dt>
            <dd className="font-medium">{usuario.email}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="mb-1 text-sm text-texto-suave">Funções</dt>
            <dd className="flex flex-wrap gap-1">
              {usuario.funcoes.map((f) => (
                <Selo key={f.id} tom="primario">
                  {f.nome}
                </Selo>
              ))}
            </dd>
          </div>
        </dl>
        <TextoSuave>Para mudar nome, e-mail ou funções, fale com o Administrador.</TextoSuave>
      </Cartao>
      <Cartao className="p-6">
        <AlterarSenha />
      </Cartao>
    </div>
  );
}

type SenhaEntrada = z.input<typeof alterarSenhaFormSchema>;
type SenhaSaida = z.output<typeof alterarSenhaFormSchema>;

/** Troca da própria senha: pede a atual e a nova duas vezes (a confirmação não vai para a API). */
function AlterarSenha() {
  const form = useForm<SenhaEntrada, unknown, SenhaSaida>({
    resolver: zodResolver(alterarSenhaFormSchema),
    defaultValues: { senhaAtual: '', novaSenha: '', confirmacao: '' },
    mode: 'onTouched',
  });
  const salvar = useMutation({
    mutationFn: ({ senhaAtual, novaSenha }: SenhaSaida) =>
      api('/auth/senha', { method: 'POST', body: { senhaAtual, novaSenha } }),
    onSuccess: () => form.reset(),
  });
  const erros = form.formState.errors;

  return (
    <Secao titulo="Alterar senha">
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit((d) => salvar.mutate(d))}>
        <Alerta>{salvar.isError && aplicarErrosDaApi(salvar.error, form.setError)}</Alerta>
        <div className="grid gap-4 md:grid-cols-3">
          <Campo rotulo="Senha atual" erro={erros.senhaAtual}>
            <Input type="password" autoComplete="current-password" {...form.register('senhaAtual')} />
          </Campo>
          <Campo rotulo="Nova senha" dica="Pelo menos 8 caracteres" erro={erros.novaSenha}>
            <Input type="password" autoComplete="new-password" {...form.register('novaSenha')} />
          </Campo>
          <Campo rotulo="Confirme a nova senha" erro={erros.confirmacao}>
            <Input type="password" autoComplete="new-password" {...form.register('confirmacao')} />
          </Campo>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Botao type="submit" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Alterar senha'}
          </Botao>
          {salvar.isSuccess && !form.formState.isDirty && <p className="text-sm text-sucesso">Senha alterada.</p>}
        </div>
      </form>
    </Secao>
  );
}
