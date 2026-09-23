import type { Cliente } from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { BuscaCliente } from '../components/BuscaCliente';
import { Alerta, BotaoLink, Cartao, TextoSuave, Titulo } from '../components/ui';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';
import { VeiculoForm } from './VeiculoForm';

/** Atalho do balcão: escolher o cliente e cadastrar o veículo, sem passar pela lista de clientes. */
export function NovoVeiculo() {
  const permitido = usePode()('clientes', 'editar');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const clienteId = params.get('clienteId');
  const cliente = useQuery({ queryKey: ['clientes', clienteId], queryFn: () => api<Cliente>(`/clientes/${clienteId}`), enabled: !!clienteId });

  if (!permitido) return <Alerta>Você não tem permissão para cadastrar veículos.</Alerta>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Titulo>Novo veículo</Titulo>

      {!clienteId ? (
        <Cartao>
          <h2 className="mb-1 font-medium">1. De quem é o veículo?</h2>
          <TextoSuave className="mb-4">Busque o cliente pelo nome, placa, CPF/CNPJ ou telefone.</TextoSuave>
          <BuscaCliente aoEscolher={(c) => setParams({ clienteId: c.id })} />
          <TextoSuave className="mt-4">
            Cliente novo?{' '}
            <Link to="/clientes/novo" className="text-primaria hover:underline">
              Cadastre o cliente primeiro
            </Link>
            .
          </TextoSuave>
        </Cartao>
      ) : (
        <Cartao>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">
              2. Veículo de <span className="text-primaria">{cliente.data?.nome ?? '…'}</span>
            </h2>
            <BotaoLink onClick={() => setParams({})}>Trocar cliente</BotaoLink>
          </div>
          <VeiculoForm clienteId={clienteId} aoSalvar={() => navigate(`/clientes/${clienteId}?aba=veiculos`)} aoCancelar={() => navigate(-1)} />
        </Cartao>
      )}
    </div>
  );
}
