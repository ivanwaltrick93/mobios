import { zodResolver } from '@hookform/resolvers/zod';
import { veiculoInputSchema, type Veiculo } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Alerta, Botao, Campo, Input } from '../components/ui';
import { api } from '../lib/api';
import { aplicarErrosDaApi } from '../lib/formulario';

type Entrada = z.input<typeof veiculoInputSchema>;
type Saida = z.output<typeof veiculoInputSchema>;

/** Cadastro de veículo de um cliente. Usado no detalhe do cliente e no atalho "Novo veículo". */
export function VeiculoForm({ clienteId, aoSalvar, aoCancelar }: { clienteId: string; aoSalvar: (v: Veiculo) => void; aoCancelar: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<Entrada, unknown, Saida>({ resolver: zodResolver(veiculoInputSchema), defaultValues: { clienteId } });
  const salvar = useMutation({
    mutationFn: (dados: Saida) => api<Veiculo>('/veiculos', { method: 'POST', body: dados }),
    onSuccess: (veiculo) => {
      queryClient.invalidateQueries({ queryKey: ['veiculos', clienteId] });
      queryClient.invalidateQueries({ queryKey: ['painel'] });
      aoSalvar(veiculo);
    },
  });
  const erros = form.formState.errors;

  return (
    <form className="grid gap-4 md:grid-cols-4" onSubmit={form.handleSubmit((d) => salvar.mutate(d))}>
      <div className="md:col-span-4">
        <Alerta>{salvar.isError && aplicarErrosDaApi(salvar.error, form.setError)}</Alerta>
      </div>
      <Campo rotulo="Placa" erro={erros.placa}>
        <Input className="uppercase" autoFocus {...form.register('placa')} />
      </Campo>
      <Campo rotulo="Marca" erro={erros.marca}>
        <Input {...form.register('marca')} />
      </Campo>
      <Campo rotulo="Modelo" erro={erros.modelo}>
        <Input {...form.register('modelo')} />
      </Campo>
      <Campo rotulo="Ano" erro={erros.ano}>
        <Input type="number" {...form.register('ano')} />
      </Campo>
      <Campo rotulo="Cor" erro={erros.cor}>
        <Input {...form.register('cor')} />
      </Campo>
      <Campo rotulo="Km atual" erro={erros.kmAtual}>
        <Input type="number" {...form.register('kmAtual')} />
      </Campo>
      <div className="md:col-span-2">
        <Campo rotulo="Chassi" erro={erros.chassi}>
          <Input className="uppercase" {...form.register('chassi')} />
        </Campo>
      </div>
      <div className="flex gap-2 md:col-span-4">
        <Botao type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar veículo'}
        </Botao>
        <Botao type="button" variante="secundario" onClick={aoCancelar}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
