import { zodResolver } from '@hookform/resolvers/zod';
import { veiculoInputSchema, type Cliente, type Veiculo } from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import type { z } from 'zod';
import { Alerta, Botao, Campo, Cartao, Input } from '../components/ui';
import { api, ErroApi } from '../lib/api';
import { formatarDocumento, formatarPlaca } from '../lib/formatos';
import { aplicarErrosDaApi } from '../lib/formulario';
import { ClienteForm } from './ClienteForm';

export function ClienteDetalhe() {
  const { id } = useParams() as { id: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState(false);
  const cliente = useQuery({ queryKey: ['clientes', id], queryFn: () => api<Cliente>(`/clientes/${id}`) });
  const excluir = useMutation({
    mutationFn: () => api(`/clientes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      navigate('/clientes');
    },
  });

  if (cliente.isPending) return <p className="text-slate-500">Carregando…</p>;
  if (cliente.isError) return <Alerta>{cliente.error.message}</Alerta>;
  const c = cliente.data;

  return (
    <div className="space-y-6">
      <Link to="/clientes" className="text-sm text-marca-600 hover:underline">
        ← Clientes
      </Link>

      <Cartao>
        {editando ? (
          <ClienteForm cliente={c} aoSalvar={() => setEditando(false)} aoCancelar={() => setEditando(false)} />
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold">{c.nome}</h1>
              <p className="text-sm text-slate-600">
                {c.tipo === 'PF' ? 'CPF' : 'CNPJ'}: {formatarDocumento(c.cpfCnpj)} · Tel.: {c.telefone ?? '—'} · E-mail: {c.email ?? '—'}
              </p>
              {c.observacoes && <p className="text-sm text-slate-500">{c.observacoes}</p>}
            </div>
            <div className="flex gap-2">
              <Botao variante="secundario" onClick={() => setEditando(true)}>
                Editar
              </Botao>
              <Botao
                variante="perigo"
                disabled={excluir.isPending}
                onClick={() => confirm(`Excluir o cliente ${c.nome}?`) && excluir.mutate()}
              >
                Excluir
              </Botao>
            </div>
          </div>
        )}
        {excluir.isError && (
          <div className="mt-4">
            <Alerta>{excluir.error instanceof ErroApi && excluir.error.status === 409 ? 'Este cliente tem veículos cadastrados. Remova-os antes de excluir.' : excluir.error.message}</Alerta>
          </div>
        )}
      </Cartao>

      <Veiculos clienteId={id} />
    </div>
  );
}

type Entrada = z.input<typeof veiculoInputSchema>;
type Saida = z.output<typeof veiculoInputSchema>;

function Veiculos({ clienteId }: { clienteId: string }) {
  const queryClient = useQueryClient();
  const [novo, setNovo] = useState(false);
  const chave = ['veiculos', clienteId];
  const veiculos = useQuery({ queryKey: chave, queryFn: () => api<Veiculo[]>(`/veiculos?clienteId=${clienteId}`) });

  const form = useForm<Entrada, unknown, Saida>({ resolver: zodResolver(veiculoInputSchema), defaultValues: { clienteId } });
  const salvar = useMutation({
    mutationFn: (dados: Saida) => api<Veiculo>('/veiculos', { method: 'POST', body: dados }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chave });
      form.reset({ clienteId });
      setNovo(false);
    },
  });
  const remover = useMutation({
    mutationFn: (id: string) => api(`/veiculos/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chave }),
  });
  const erros = form.formState.errors;

  return (
    <Cartao>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-medium">Veículos</h2>
        {!novo && <Botao onClick={() => setNovo(true)}>Adicionar veículo</Botao>}
      </div>

      {novo && (
        <form className="mb-6 grid gap-4 rounded-md bg-slate-50 p-4 md:grid-cols-4" onSubmit={form.handleSubmit((d) => salvar.mutate(d))}>
          <div className="md:col-span-4">
            <Alerta>{salvar.isError && aplicarErrosDaApi(salvar.error, form.setError)}</Alerta>
          </div>
          <Campo rotulo="Placa" erro={erros.placa}>
            <Input className="uppercase" {...form.register('placa')} />
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
              Salvar veículo
            </Botao>
            <Botao type="button" variante="secundario" onClick={() => setNovo(false)}>
              Cancelar
            </Botao>
          </div>
        </form>
      )}

      {veiculos.data?.length === 0 && !novo && <p className="text-sm text-slate-500">Nenhum veículo cadastrado.</p>}
      <ul className="divide-y divide-slate-100">
        {veiculos.data?.map((v) => (
          <li key={v.id} className="flex items-center justify-between py-3 text-sm">
            <div>
              <span className="mr-3 rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-white">{formatarPlaca(v.placa)}</span>
              <span className="font-medium">
                {v.marca} {v.modelo}
              </span>
              <span className="text-slate-500">
                {v.ano ? ` · ${v.ano}` : ''}
                {v.cor ? ` · ${v.cor}` : ''}
                {v.kmAtual != null ? ` · ${v.kmAtual.toLocaleString('pt-BR')} km` : ''}
              </span>
            </div>
            <button
              className="text-xs text-red-600 hover:underline"
              onClick={() => confirm(`Remover o veículo ${formatarPlaca(v.placa)}?`) && remover.mutate(v.id)}
            >
              Remover
            </button>
          </li>
        ))}
      </ul>
    </Cartao>
  );
}
