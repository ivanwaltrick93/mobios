import { useNavigate } from 'react-router';
import { Alerta, Cartao, Titulo } from '../components/ui';
import { usePode } from '../lib/sessao';
import { ClienteForm } from './ClienteForm';

export function NovoCliente() {
  const permitido = usePode()('clientes', 'editar');
  const navigate = useNavigate();
  if (!permitido) return <Alerta>Você não tem permissão para cadastrar clientes.</Alerta>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Titulo>Novo cliente</Titulo>
      <Cartao>
        <ClienteForm aoSalvar={(c) => navigate(`/clientes/${c.id}?aba=veiculos`)} aoCancelar={() => navigate(-1)} />
      </Cartao>
    </div>
  );
}
