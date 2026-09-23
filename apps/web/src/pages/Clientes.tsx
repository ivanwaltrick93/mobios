import type { Cliente } from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Botao, Cartao, Input } from '../components/ui';
import { api } from '../lib/api';
import { formatarDocumento } from '../lib/formatos';
import { ClienteForm } from './ClienteForm';

export function Clientes() {
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');
  const [novo, setNovo] = useState(false);
  const clientes = useQuery({
    queryKey: ['clientes', busca],
    queryFn: () => api<{ itens: Cliente[]; total: number }>(`/clientes?${new URLSearchParams({ q: busca })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Clientes</h1>
        {!novo && <Botao onClick={() => setNovo(true)}>Novo cliente</Botao>}
      </div>

      {novo && (
        <Cartao>
          <h2 className="mb-4 font-medium">Novo cliente</h2>
          <ClienteForm aoSalvar={(c) => navigate(`/clientes/${c.id}`)} aoCancelar={() => setNovo(false)} />
        </Cartao>
      )}

      <Input placeholder="Buscar por nome, CPF/CNPJ ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />

      <Cartao className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">CPF/CNPJ</th>
              <th className="px-4 py-3 font-medium">Telefone</th>
            </tr>
          </thead>
          <tbody>
            {clientes.data?.itens.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link to={`/clientes/${c.id}`} className="font-medium text-marca-600 hover:underline">
                    {c.nome}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{formatarDocumento(c.cpfCnpj)}</td>
                <td className="px-4 py-3 text-slate-600">{c.telefone ?? '—'}</td>
              </tr>
            ))}
            {clientes.data?.itens.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                  {busca ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Cartao>
      {clientes.data && <p className="text-xs text-slate-500">{clientes.data.total} cliente(s)</p>}
    </div>
  );
}
