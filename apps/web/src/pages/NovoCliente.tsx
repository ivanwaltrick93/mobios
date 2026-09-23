import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Cartao, Titulo } from '../components/ui';
import { ClienteForm } from './ClienteForm';

export function NovoCliente() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
