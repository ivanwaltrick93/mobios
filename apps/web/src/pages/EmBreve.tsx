import { Cartao, TextoSuave } from '../components/ui';

export const EmBreve = ({ titulo }: { titulo: string }) => (
  <Cartao>
    <h1 className="text-xl font-semibold">{titulo}</h1>
    <TextoSuave className="mt-2">Módulo previsto no roadmap (docs/ARQUITETURA.md).</TextoSuave>
  </Cartao>
);
