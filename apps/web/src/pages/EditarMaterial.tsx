import type { Material } from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { Alerta, Cartao, TextoSuave, Titulo } from '../components/ui';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';
import { MaterialForm } from './MaterialForm';

export function EditarMaterial() {
  const { id } = useParams() as { id: string };
  const navigate = useNavigate();
  const permitido = usePode()('materiais', 'editar');
  const material = useQuery({ queryKey: ['materiais', id], queryFn: () => api<Material>(`/materiais/${id}`) });
  if (!permitido) return <Alerta>Você não tem permissão para alterar produtos.</Alerta>;
  if (material.isPending) return <TextoSuave>Carregando…</TextoSuave>;
  if (material.isError) return <Alerta>{material.error.message}</Alerta>;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Titulo>
        Editar {material.data.sku} — {material.data.descricao}
      </Titulo>
      <Cartao>
        <MaterialForm
          material={material.data}
          aoSalvar={() => navigate(`/materiais/${id}`)}
          aoCancelar={() => navigate(-1)}
        />
      </Cartao>
    </div>
  );
}
