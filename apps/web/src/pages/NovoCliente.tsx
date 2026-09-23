import { usePode } from '../lib/sessao';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Alerta, Cartao, Titulo } from '../components/ui';
import { ClienteForm } from './ClienteForm';

export function NovoCliente() {
  const permitido = usePode()('clientes', 'editar');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  if (!permitido) return <Alerta>Você não tem permissão para cadastrar clientes.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo>Novo cliente</Titulo>
      <Cartao>
        <ClienteForm
          aoSalvar={(c) => {
            queryClient.invalidateQueries({ queryKey: ['painel'] });
            // Próximo passo natural no balcão: cadastrar o veículo do cliente.
            navigate(`/clientes/${c.id}`);
          }}
          aoCancelar={() => navigate(-1)}
        />
      </Cartao>
    </div>
  );
}
