import { usePode } from '../lib/sessao';
import { formatarDocumento, type Cliente } from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alerta, BotaoLink, Cartao, Input, TextoSuave, Titulo } from '../components/ui';
import { api } from '../lib/api';
import { VeiculoForm } from './VeiculoForm';

/** Atalho do balcão: escolher o cliente e cadastrar o veículo, sem passar pela lista de clientes. */
export function NovoVeiculo() {
  const permitido = usePode()('clientes', 'editar');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const clienteId = params.get('clienteId');
  const [busca, setBusca] = useState('');

  const cliente = useQuery({ queryKey: ['clientes', clienteId], queryFn: () => api<Cliente>(`/clientes/${clienteId}`), enabled: !!clienteId });
  const resultados = useQuery({
    queryKey: ['clientes', 'busca', busca],
    queryFn: () => api<{ itens: Cliente[]; total: number }>(`/clientes?${new URLSearchParams({ q: busca, porPagina: '8' })}`),
    enabled: !clienteId && busca.trim().length >= 2,
    placeholderData: keepPreviousData,
  });

  if (!permitido) return <Alerta>Você não tem permissão para cadastrar veículos.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo>Novo veículo</Titulo>

      {!clienteId ? (
        <Cartao>
          <h2 className="mb-1 font-medium">1. De quem é o veículo?</h2>
          <TextoSuave className="mb-4">Busque o cliente pelo nome, CPF/CNPJ ou telefone.</TextoSuave>
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-texto-suave" />
            <Input autoFocus className="pl-9" placeholder="Digite ao menos 2 letras" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <ul className="mt-2 divide-y divide-borda">
            {resultados.data?.itens.map((c) => (
              <li key={c.id}>
                <button className="flex w-full items-center justify-between px-2 py-3 text-left hover:bg-superficie-alt" onClick={() => setParams({ clienteId: c.id })}>
                  <span className="font-medium">{c.nome}</span>
                  <span className="text-sm text-texto-suave">
                    {formatarDocumento(c.cpfCnpj)} · {c.telefone ?? 'sem telefone'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {resultados.data?.itens.length === 0 && <TextoSuave className="mt-3">Nenhum cliente encontrado.</TextoSuave>}
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
          <VeiculoForm clienteId={clienteId} aoSalvar={() => navigate(`/clientes/${clienteId}`)} aoCancelar={() => navigate(-1)} />
        </Cartao>
      )}
    </div>
  );
}
