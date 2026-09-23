import { formatarDocumento, type Cliente } from '@mobios/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Botao, Cabecalho, Cartao, Input, Linha, LinhaVazia, Tabela, Td, TextoSuave, Th, Titulo } from '../components/ui';
import { api } from '../lib/api';
import { ClienteForm } from './ClienteForm';

export function Clientes() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState('');
  const [novo, setNovo] = useState(false);
  const clientes = useQuery({
    queryKey: ['clientes', busca],
    queryFn: () => api<{ itens: Cliente[]; total: number }>(`/clientes?${new URLSearchParams({ q: busca })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      <Titulo acao={!novo && <Botao onClick={() => setNovo(true)}>Novo cliente</Botao>}>Clientes</Titulo>

      {novo && (
        <Cartao>
          <h2 className="mb-4 font-medium">Novo cliente</h2>
          <ClienteForm
            aoSalvar={(c) => {
              queryClient.invalidateQueries({ queryKey: ['painel'] });
              navigate(`/clientes/${c.id}`);
            }}
            aoCancelar={() => setNovo(false)}
          />
        </Cartao>
      )}

      <Input placeholder="Buscar por nome, CPF/CNPJ ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />

      <Tabela>
        <Cabecalho>
          <Th>Nome</Th>
          <Th>CPF/CNPJ</Th>
          <Th>Telefone</Th>
        </Cabecalho>
        <tbody>
          {clientes.data?.itens.map((c) => (
            <Linha key={c.id} className="hover:bg-superficie-alt">
              <Td>
                <Link to={`/clientes/${c.id}`} className="font-medium text-primaria hover:underline">
                  {c.nome}
                </Link>
              </Td>
              <Td suave>{formatarDocumento(c.cpfCnpj)}</Td>
              <Td suave>{c.telefone ?? '—'}</Td>
            </Linha>
          ))}
          {clientes.data?.itens.length === 0 && (
            <LinhaVazia colunas={3}>{busca ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}</LinhaVazia>
          )}
        </tbody>
      </Tabela>
      {clientes.data && <TextoSuave className="text-xs">{clientes.data.total} cliente(s)</TextoSuave>}
    </div>
  );
}
