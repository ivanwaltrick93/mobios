import { formatarDocumento, formatarPlaca, type Cliente, type Veiculo } from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Alerta, Botao, BotaoLink, Cartao, TextoSuave } from '../components/ui';
import { api, ErroApi } from '../lib/api';

import { ClienteForm } from './ClienteForm';
import { VeiculoForm } from './VeiculoForm';

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

  if (cliente.isPending) return <TextoSuave>Carregando…</TextoSuave>;
  if (cliente.isError) return <Alerta>{cliente.error.message}</Alerta>;
  const c = cliente.data;

  return (
    <div className="space-y-6">
      <Link to="/clientes" className="text-sm text-primaria hover:underline">
        ← Clientes
      </Link>

      <Cartao>
        {editando ? (
          <ClienteForm cliente={c} aoSalvar={() => setEditando(false)} aoCancelar={() => setEditando(false)} />
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold">{c.nome}</h1>
              <p className="text-sm text-texto-suave">
                {c.tipo === 'PF' ? 'CPF' : 'CNPJ'}: {formatarDocumento(c.cpfCnpj)} · Tel.: {c.telefone ?? '—'} · E-mail: {c.email ?? '—'}
              </p>
              {c.observacoes && <TextoSuave>{c.observacoes}</TextoSuave>}
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

function Veiculos({ clienteId }: { clienteId: string }) {
  const queryClient = useQueryClient();
  const [novo, setNovo] = useState(false);
  const chave = ['veiculos', clienteId];
  const veiculos = useQuery({ queryKey: chave, queryFn: () => api<Veiculo[]>(`/veiculos?clienteId=${clienteId}`) });
  const remover = useMutation({
    mutationFn: (id: string) => api(`/veiculos/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chave });
      queryClient.invalidateQueries({ queryKey: ['painel'] });
    },
  });

  return (
    <Cartao>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-medium">Veículos</h2>
        {!novo && <Botao onClick={() => setNovo(true)}>Adicionar veículo</Botao>}
      </div>

      {novo && (
        <div className="mb-6 rounded-md bg-superficie-alt p-4">
          <VeiculoForm clienteId={clienteId} aoSalvar={() => setNovo(false)} aoCancelar={() => setNovo(false)} />
        </div>
      )}

      {veiculos.data?.length === 0 && !novo && <TextoSuave>Nenhum veículo cadastrado.</TextoSuave>}
      <ul className="divide-y divide-borda">
        {veiculos.data?.map((v) => (
          <li key={v.id} className="flex items-center justify-between py-3 text-sm">
            <div>
              <span className="mr-3 rounded bg-texto px-2 py-0.5 font-mono text-xs text-superficie">{formatarPlaca(v.placa)}</span>
              <span className="font-medium">
                {v.marca} {v.modelo}
              </span>
              <span className="text-texto-suave">
                {v.ano ? ` · ${v.ano}` : ''}
                {v.cor ? ` · ${v.cor}` : ''}
                {v.kmAtual != null ? ` · ${v.kmAtual.toLocaleString('pt-BR')} km` : ''}
              </span>
            </div>
            <BotaoLink perigo onClick={() => confirm(`Remover o veículo ${formatarPlaca(v.placa)}?`) && remover.mutate(v.id)}>
              Remover
            </BotaoLink>
          </li>
        ))}
      </ul>
    </Cartao>
  );
}
