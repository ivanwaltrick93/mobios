import { temAcesso, type ModuloId } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { useSessao } from '../lib/sessao';
import { aplicarTema, urlLogo } from '../lib/tema';
import { Voltar } from './Voltar';
import { Avatar } from './Avatar';
import { LogoMobiOS, Rodape } from './Marca';

// Itens aparecem conforme o acesso do usuário ao módulo (Configurações → Funções e permissões).
/** `tambem`: outras rotas que acendem o item (ex.: telas de veículo ficam em "Clientes e veículos"). */
const menu: { para: string; rotulo: string; modulo?: ModuloId; somenteAdmin?: boolean; tambem?: string[] }[] = [
  { para: '/', rotulo: 'Início' },
  { para: '/clientes', rotulo: 'Clientes e veículos', modulo: 'clientes', tambem: ['/veiculos'] },
  { para: '/os', rotulo: 'Ordens de serviço', modulo: 'os' },
  { para: '/estoque', rotulo: 'Estoque', modulo: 'estoque' },
  { para: '/financeiro', rotulo: 'Financeiro', modulo: 'financeiro' },
  { para: '/relatorios', rotulo: 'Relatórios', modulo: 'relatorios' },
  { para: '/usuarios', rotulo: 'Equipe', somenteAdmin: true },
  { para: '/configuracoes', rotulo: 'Configurações', somenteAdmin: true },
];

export function Layout() {
  const sessao = useSessao();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
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
            .filter((item) => (item.somenteAdmin ? usuario.admin : !item.modulo || temAcesso(sessao.data.acessos, item.modulo)))
            .map((item) => (
              <NavLink
                key={item.para}
                to={item.para}
                end={item.para === '/'}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-md border-l-4 px-3 py-2 text-sm ${
                    isActive || item.tambem?.some((r) => pathname.startsWith(r)) ? 'border-primaria bg-menu-ativo font-semibold' : 'border-transparent opacity-85 hover:bg-menu-ativo hover:opacity-100'
                  }`
                }
              >
                {item.rotulo}
              </NavLink>
            ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-borda bg-superficie px-6 py-3 text-sm">
          <Voltar raizes={[...menu.map((m) => m.para), '/perfil']} />
          <span className="flex-1" />
          <Link to="/perfil" className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 hover:bg-superficie-alt" title="Meu perfil">
            <Avatar nome={usuario.nome} usuarioId={usuario.id} fotoVersao={usuario.fotoVersao} tamanho="sm" />
            <span className="text-texto">
              {usuario.nome}{' '}
              {usuario.funcoes.length > 0 && <span className="text-texto-suave">· {usuario.funcoes.map((f) => f.nome).join(', ')}</span>}
            </span>
          </Link>
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
