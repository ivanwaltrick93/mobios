import { formatarDocumento, formatarTelefone, type ClienteResumo } from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { useValorAdiado } from '../lib/busca';
import { Input, Selo, TextoSuave } from './ui';

/** Busca de cliente por nome, CPF/CNPJ ou telefone. `ignorar`: cliente que não deve aparecer (ex.: o dono atual). */
export function BuscaCliente({ aoEscolher, ignorar }: { aoEscolher: (c: ClienteResumo) => void; ignorar?: string }) {
  const [busca, setBusca] = useState('');
  // A lista acompanha o que foi digitado depois de uma pausa (uma requisição por busca, não por tecla).
  const termo = useValorAdiado(busca);
  const resultados = useQuery({
    queryKey: ['clientes', 'busca', termo],
    queryFn: ({ signal }) =>
      api<{ itens: ClienteResumo[]; total: number }>(`/clientes?${new URLSearchParams({ q: termo, porPagina: '8' })}`, {
        signal,
      }),
    enabled: termo.trim().length >= 2,
    placeholderData: keepPreviousData,
  });
  const itens = resultados.data?.itens.filter((c) => c.id !== ignorar);

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-texto-suave" />
        <Input
          autoFocus
          className="pl-9"
          placeholder="Nome, placa, CPF/CNPJ ou telefone (ao menos 2 letras)"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>
      <ul className="mt-2 divide-y divide-borda">
        {busca.trim().length >= 2 &&
          itens?.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-2 px-2 py-3 text-left hover:bg-superficie-alt"
                onClick={() => aoEscolher(c)}
              >
                <span className="flex items-center gap-2 font-medium">
                  {c.nome}
                  {!c.ativo && <Selo>Inativo</Selo>}
                </span>
                <span className="text-sm text-texto-suave">
                  {formatarDocumento(c.cpfCnpj)} · {formatarTelefone(c.whatsapp ?? c.telefone)}
                </span>
              </button>
            </li>
          ))}
      </ul>
      {busca.trim().length >= 2 && itens?.length === 0 && (
        <TextoSuave className="mt-3">Nenhum cliente encontrado.</TextoSuave>
      )}
    </div>
  );
}
