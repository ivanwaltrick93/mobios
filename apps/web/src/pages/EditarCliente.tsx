import type { Cliente } from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Alerta, Cartao, TextoSuave, Titulo } from '../components/ui';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';
import { ClienteForm } from './ClienteForm';

/** Edição do cliente nas mesmas etapas do cadastro (`?etapa=2` abre direto em Endereço). */
export function EditarCliente() {
  const { id } = useParams() as { id: string };
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const permitido = usePode()('clientes', 'editar');
  const cliente = useQuery({ queryKey: ['clientes', id], queryFn: () => api<Cliente>(`/clientes/${id}`) });

  if (!permitido) return <Alerta>Você não tem permissão para alterar clientes.</Alerta>;
  if (cliente.isPending) return <TextoSuave>Carregando…</TextoSuave>;
  if (cliente.isError) return <Alerta>{cliente.error.message}</Alerta>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Titulo>Editar {cliente.data.nome}</Titulo>
      <Cartao>
        <ClienteForm cliente={cliente.data} etapaInicial={Number(params.get('etapa')) || 0} aoSalvar={() => navigate(`/clientes/${id}`)} aoCancelar={() => navigate(-1)} />
      </Cartao>
    </div>
  );
}
