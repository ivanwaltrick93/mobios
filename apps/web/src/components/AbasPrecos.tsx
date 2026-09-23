import { NavLink } from 'react-router';

const abas = [
  { para: '/precos', rotulo: 'Lista de preços' },
  { para: '/tabelas-preco', rotulo: 'Tabelas de preço' },
];

export function AbasPrecos() {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-borda" aria-label="Preços">
      {abas.map((a) => (
        <NavLink
          key={a.para}
          to={a.para}
          end
          className={({ isActive }) =>
            `-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm ${isActive ? 'border-primaria font-medium text-primaria' : 'border-transparent text-texto-suave hover:text-texto'}`
          }
        >
          {a.rotulo}
        </NavLink>
      ))}
    </nav>
  );
}
