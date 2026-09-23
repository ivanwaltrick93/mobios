import { Cartao } from '../components/ui';

export const EmBreve = ({ titulo }: { titulo: string }) => (
  <Cartao>
    <h1 className="text-xl font-semibold">{titulo}</h1>
    <p className="mt-2 text-sm text-slate-500">Módulo previsto no roadmap (docs/ARQUITETURA.md).</p>
  </Cartao>
);
