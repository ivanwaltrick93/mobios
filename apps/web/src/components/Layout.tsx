import { temAcesso, type ModuloId } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { PAGINAS_LISTAS } from '../lib/cadastro';
import { useSessao } from '../lib/sessao';
import { aplicarTema, urlLogo } from '../lib/tema';
import { Voltar } from './Voltar';
import { Avatar } from './Avatar';
import { LogoMobiOS, Rodape } from './Marca';

// Itens aparecem conforme o acesso do usuário ao módulo (Configurações → Funções e permissões).
type ItemMenu = {
  para: string;
  rotulo: string;
  modulo?: ModuloId;
  somenteAdmin?: boolean;
  /** Submenu que abre e fecha (collapse) no menu lateral. Filho com `modulo` só aparece para quem o acessa. */
  filhos?: { para: string; rotulo: string; modulo?: ModuloId }[];
};

const menu: ItemMenu[] = [
  { para: '/', rotulo: 'Início' },
  {
    para: '/clientes',
    rotulo: 'Clientes',
    modulo: 'clientes',
    filhos: [
      { para: '/clientes', rotulo: 'Clientes' },
      { para: '/veiculos', rotulo: 'Veículos' },
    ],
  },
  {
    para: '/materiais',
    rotulo: 'Ofertas',
    filhos: [
      { para: '/materiais', rotulo: 'Materiais', modulo: 'materiais' },
      { para: '/servicos', rotulo: 'Serviços', modulo: 'servicos' },
      { para: '/materiais/categorias', rotulo: 'Categorias', modulo: 'materiais' },
      { para: '/materiais/marcas', rotulo: 'Marcas', modulo: 'materiais' },
      { para: '/materiais/depositos', rotulo: 'Depósitos', modulo: 'materiais' },
    ],
  },
  {
    para: '/precos',
    rotulo: 'Política Comercial',
    modulo: 'precos',
    filhos: [
      { para: '/precos', rotulo: 'Linhas de Preço' },
      { para: '/tabelas-preco', rotulo: 'Tabelas de Preço' },
    ],
  },
  { para: '/estoque', rotulo: 'Estoque', modulo: 'estoque' },
  { para: '/os', rotulo: 'Ordens de serviço', modulo: 'os' },
  { para: '/financeiro', rotulo: 'Financeiro', modulo: 'financeiro' },
  { para: '/relatorios', rotulo: 'Relatórios', modulo: 'relatorios' },
  {
    para: '/usuarios',
    rotulo: 'Equipe',
    somenteAdmin: true,
    filhos: [
      { para: '/usuarios', rotulo: 'Usuários' },
      { para: '/vendedores', rotulo: 'Vendedores' },
    ],
  },
  {
    para: '/configuracoes',
    rotulo: 'Configurações',
    somenteAdmin: true,
    filhos: [
      { para: '/configuracoes', rotulo: 'Aparência e logo' },
      { para: '/configuracoes/funcoes', rotulo: 'Funções e permissões' },
      ...PAGINAS_LISTAS.map(({ para, rotulo }) => ({ para, rotulo })),
    ],
  },
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
  const visivel = (modulo?: ModuloId) => !modulo || temAcesso(sessao.data.acessos, modulo);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-menu-borda bg-menu text-menu-texto md:w-60 md:border-r md:border-b-0">
        <div className="px-5 py-4">
          {oficina.logoVersao ? (
            <img
              src={urlLogo(oficina.logoVersao)}
              alt={oficina.nome}
              className="mb-1 max-h-14 max-w-full object-contain"
            />
          ) : (
            <LogoMobiOS herdarCor />
          )}
          <div className="truncate text-xs opacity-75">{oficina.nome}</div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
          {menu
            .filter((item) => (item.somenteAdmin ? usuario.admin : visivel(item.modulo)))
            .map((item) => ({ ...item, filhos: item.filhos?.filter((f) => visivel(f.modulo)) }))
            // Grupo sem nenhum filho acessível some do menu.
            .filter((item) => !item.filhos || item.filhos.length > 0)
            .map((item) =>
              item.filhos ? (
                <GrupoMenu key={item.para} rotulo={item.rotulo} filhos={item.filhos} />
              ) : (
                <NavLink
                  key={item.para}
                  to={item.para}
                  end={item.para === '/'}
                  className={({ isActive }) => classeItem(isActive)}
                >
                  {item.rotulo}
                </NavLink>
              ),
            )}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-borda bg-superficie px-6 py-3 text-sm">
          <Voltar raizes={[...menu.flatMap((m) => [m.para, ...(m.filhos ?? []).map((f) => f.para)]), '/perfil']} />
          <span className="flex-1" />
          <Link
            to="/perfil"
            className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 hover:bg-superficie-alt"
            title="Meu perfil"
          >
            <Avatar nome={usuario.nome} usuarioId={usuario.id} fotoVersao={usuario.fotoVersao} tamanho="sm" />
            <span className="text-texto">
              {usuario.nome}{' '}
              {usuario.funcoes.length > 0 && (
                <span className="text-texto-suave">· {usuario.funcoes.map((f) => f.nome).join(', ')}</span>
              )}
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

const classeItem = (ativo: boolean) =>
  `whitespace-nowrap rounded-md border-l-4 px-3 py-2 text-sm ${
    ativo
      ? 'border-primaria bg-menu-ativo font-semibold'
      : 'border-transparent opacity-85 hover:bg-menu-ativo hover:opacity-100'
  }`;

/** Item com submenu: abre e fecha ao clicar; fica aberto enquanto uma das páginas dele estiver na tela. */
function GrupoMenu({ rotulo, filhos }: { rotulo: string; filhos: { para: string; rotulo: string }[] }) {
  const { pathname } = useLocation();
  // Página atual = o filho de caminho mais longo que a contém (/materiais/marcas não acende /materiais).
  const atual = filhos.filter((f) => pathname.startsWith(f.para)).sort((a, b) => b.para.length - a.para.length)[0];
  const dentro = !!atual;
  const [aberto, setAberto] = useState(dentro);
  useEffect(() => {
    if (dentro) setAberto(true);
  }, [dentro]);

  return (
    <div className="flex gap-1 md:flex-col">
      <button
        type="button"
        aria-expanded={aberto}
        onClick={() => setAberto(!aberto)}
        className={`flex items-center justify-between gap-2 text-left ${classeItem(dentro && !aberto)}`}
      >
        {rotulo}
        <ChevronDown className={`size-4 transition ${aberto ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {aberto && (
        <div className="flex gap-1 md:flex-col md:pl-3">
          {filhos.map((f) => (
            <Link
              key={f.para}
              to={f.para}
              aria-current={f === atual ? 'page' : undefined}
              className={classeItem(f === atual)}
            >
              {f.rotulo}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
