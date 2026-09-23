import type { Cliente, Veiculo } from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { Placa } from '../components/Placa';
import { Alerta, Cartao, TextoSuave, Titulo } from '../components/ui';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';
import { VeiculoForm } from './VeiculoForm';

export function EditarVeiculo() {
  const { id } = useParams() as { id: string };
  const navigate = useNavigate();
  const permitido = usePode()('clientes', 'editar');
  const veiculo = useQuery({ queryKey: ['veiculos', 'item', id], queryFn: () => api<Veiculo>(`/veiculos/${id}`) });
  const clienteId = veiculo.data?.clienteId;
  const cliente = useQuery({ queryKey: ['clientes', clienteId], queryFn: () => api<Cliente>(`/clientes/${clienteId}`), enabled: !!clienteId });

  if (!permitido) return <Alerta>Você não tem permissão para alterar veículos.</Alerta>;
  if (veiculo.isPending) return <TextoSuave>Carregando…</TextoSuave>;
  if (veiculo.isError) return <Alerta>{veiculo.error.message}</Alerta>;
  const voltar = () => navigate(`/clientes/${veiculo.data.clienteId}?aba=veiculos`);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Placa placa={veiculo.data.placa} tamanho="lg" />
        <div>
          <Titulo>
            {veiculo.data.marca} {veiculo.data.modelo}
          </Titulo>
          <TextoSuave>de {cliente.data?.nome ?? '…'}</TextoSuave>
        </div>
      </div>
      <Cartao>
        <VeiculoForm clienteId={veiculo.data.clienteId} veiculo={veiculo.data} aoSalvar={voltar} aoCancelar={voltar} />
      </Cartao>
    </div>
  );
}
