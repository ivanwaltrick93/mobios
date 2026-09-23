import { NavLink } from 'react-router';

const abas = [
  { para: '/configuracoes', rotulo: 'Aparência e logo' },
  { para: '/configuracoes/funcoes', rotulo: 'Funções e permissões' },
];

export function AbasConfiguracoes() {
  return (
    <nav className="flex gap-1 border-b border-borda" aria-label="Seções de configurações">
      {abas.map((a) => (
        <NavLink
          key={a.para}
          to={a.para}
          end
          className={({ isActive }) =>
            `-mb-px border-b-2 px-4 py-2 text-sm ${isActive ? 'border-primaria font-medium text-primaria' : 'border-transparent text-texto-suave hover:text-texto'}`
          }
        >
          {a.rotulo}
        </NavLink>
      ))}
    </nav>
  );
}
