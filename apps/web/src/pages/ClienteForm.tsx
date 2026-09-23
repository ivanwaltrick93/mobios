import { zodResolver } from '@hookform/resolvers/zod';
import { clienteInputSchema, type Cliente } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Alerta, Botao, Campo, Input, Select } from '../components/ui';
import { api } from '../lib/api';
import { aplicarErrosDaApi } from '../lib/formulario';

type Entrada = z.input<typeof clienteInputSchema>;
type Saida = z.output<typeof clienteInputSchema>;

export function ClienteForm({ cliente, aoSalvar, aoCancelar }: { cliente?: Cliente; aoSalvar: (c: Cliente) => void; aoCancelar: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<Entrada, unknown, Saida>({
    resolver: zodResolver(clienteInputSchema),
    defaultValues: cliente ?? { tipo: 'PF' },
  });
  const salvar = useMutation({
    mutationFn: (dados: Saida) =>
      api<Cliente>(cliente ? `/clientes/${cliente.id}` : '/clientes', { method: cliente ? 'PUT' : 'POST', body: dados }),
    onSuccess: (salvo) => {
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      aoSalvar(salvo);
    },
  });
  const erros = form.formState.errors;
  const tipo = form.watch('tipo');

  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={form.handleSubmit((d) => salvar.mutate(d))}>
      <div className="md:col-span-2">
        <Alerta>{salvar.isError && aplicarErrosDaApi(salvar.error, form.setError)}</Alerta>
      </div>
      <Campo rotulo="Tipo" erro={erros.tipo}>
        <Select {...form.register('tipo')}>
          <option value="PF">Pessoa física</option>
          <option value="PJ">Pessoa jurídica</option>
        </Select>
      </Campo>
      <Campo rotulo={tipo === 'PJ' ? 'CNPJ' : 'CPF'} erro={erros.cpfCnpj}>
        <Input inputMode="numeric" {...form.register('cpfCnpj')} />
      </Campo>
      <div className="md:col-span-2">
        <Campo rotulo={tipo === 'PJ' ? 'Razão social' : 'Nome'} erro={erros.nome}>
          <Input {...form.register('nome')} />
        </Campo>
      </div>
      <Campo rotulo="Telefone / WhatsApp" erro={erros.telefone}>
        <Input type="tel" {...form.register('telefone')} />
      </Campo>
      <Campo rotulo="E-mail" erro={erros.email}>
        <Input type="email" {...form.register('email')} />
      </Campo>
      <div className="md:col-span-2">
        <Campo rotulo="Observações" erro={erros.observacoes}>
          <Input {...form.register('observacoes')} />
        </Campo>
      </div>
      <div className="flex gap-2 md:col-span-2">
        <Botao type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Botao>
        <Botao type="button" variante="secundario" onClick={aoCancelar}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
