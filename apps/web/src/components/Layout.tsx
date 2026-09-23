import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { useSessao } from '../lib/sessao';

const menu = [
  { para: '/clientes', rotulo: 'Clientes e veículos' },
  { para: '/os', rotulo: 'Ordens de serviço' },
  { para: '/estoque', rotulo: 'Estoque' },
  { para: '/financeiro', rotulo: 'Financeiro' },
];

export function Layout() {
  const sessao = useSessao();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sair = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.clear();
      navigate('/entrar');
    },
  });

  if (sessao.isPending) return <div className="p-8 text-slate-500">Carregando…</div>;
  if (sessao.isError) return <Navigate to="/entrar" replace />;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-slate-200 bg-white md:w-60 md:border-r md:border-b-0">
        <div className="px-5 py-4">
          <div className="text-lg font-bold text-marca-700">MobiOS</div>
          <div className="truncate text-xs text-slate-500">{sessao.data.oficina.nome}</div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
          {menu.map((item) => (
            <NavLink
              key={item.para}
              to={item.para}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-2 text-sm ${isActive ? 'bg-marca-50 font-medium text-marca-700' : 'text-slate-600 hover:bg-slate-100'}`
              }
            >
              {item.rotulo}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-end gap-3 border-b border-slate-200 bg-white px-6 py-3 text-sm">
          <span className="text-slate-600">{sessao.data.usuario.nome}</span>
          <button className="text-marca-600 hover:underline" onClick={() => sair.mutate()}>
            Sair
          </button>
        </header>
        <main className="mx-auto max-w-5xl p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
