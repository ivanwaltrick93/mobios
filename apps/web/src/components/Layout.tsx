import { nomesPapel, type Papel } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { useSessao } from '../lib/sessao';
import { aplicarTema, urlLogo } from '../lib/tema';
import { LogoMobiOS, Rodape } from './Marca';

const menu: { para: string; rotulo: string; papeis?: Papel[] }[] = [
  { para: '/', rotulo: 'Início' },
  { para: '/clientes', rotulo: 'Clientes e veículos' },
  { para: '/os', rotulo: 'Ordens de serviço' },
  { para: '/estoque', rotulo: 'Estoque' },
  { para: '/financeiro', rotulo: 'Financeiro' },
  { para: '/relatorios', rotulo: 'Relatórios', papeis: ['admin', 'atendente', 'financeiro'] },
  { para: '/usuarios', rotulo: 'Usuários', papeis: ['admin'] },
  { para: '/configuracoes', rotulo: 'Configurações', papeis: ['admin'] },
];

export function Layout() {
  const sessao = useSessao();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const tema = sessao.data?.oficina.tema;

  useEffect(() => {
    if (tema) aplicarTema(tema);
  }, [tema]);

  const sair = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.clear();
      // A tela de login aplica a marca pública da oficina.
      navigate('/entrar');
    },
  });

  if (sessao.isPending) return <div className="p-8 text-texto-suave">Carregando…</div>;
  if (sessao.isError) return <Navigate to="/entrar" replace />;
  const { usuario, oficina } = sessao.data;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-menu-borda bg-menu text-menu-texto md:w-60 md:border-r md:border-b-0">
        <div className="px-5 py-4">
          {oficina.logoVersao ? (
            <img src={urlLogo(oficina.logoVersao)} alt={oficina.nome} className="mb-1 max-h-14 max-w-full object-contain" />
          ) : (
            <LogoMobiOS herdarCor />
          )}
          <div className="truncate text-xs opacity-75">{oficina.nome}</div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
          {menu
            .filter((item) => !item.papeis || item.papeis.includes(usuario.papel))
            .map((item) => (
              <NavLink
                key={item.para}
                to={item.para}
                end={item.para === '/'}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-md border-l-4 px-3 py-2 text-sm ${
                    isActive ? 'border-primaria bg-menu-ativo font-semibold' : 'border-transparent opacity-85 hover:bg-menu-ativo hover:opacity-100'
                  }`
                }
              >
                {item.rotulo}
              </NavLink>
            ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-borda bg-superficie px-6 py-3 text-sm">
          <span className="text-texto">
            {usuario.nome} <span className="text-texto-suave">· {nomesPapel[usuario.papel]}</span>
          </span>
          <button className="text-primaria hover:underline" onClick={() => sair.mutate()}>
            Sair
          </button>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-8">
          <Outlet />
        </main>
        <Rodape />
      </div>
    </div>
  );
}
