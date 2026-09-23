import { useNavigate } from 'react-router';
import { Alerta, Cartao, Titulo } from '../components/ui';
import { usePode } from '../lib/sessao';
import { MaterialForm } from './MaterialForm';

export function NovoMaterial() {
  const pode = usePode();
  const navigate = useNavigate();
  if (!pode('materiais', 'editar')) return <Alerta>Você não tem permissão para cadastrar materiais.</Alerta>;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Titulo>Novo material</Titulo>
      <Cartao>
        {/* Depois de cadastrar, o próximo passo natural é informar os preços. */}
        <MaterialForm
          aoSalvar={(m) => navigate(`/materiais/${m.id}${pode('precos') ? '?aba=precos' : ''}`)}
          aoCancelar={() => navigate(-1)}
        />
      </Cartao>
    </div>
  );
}
