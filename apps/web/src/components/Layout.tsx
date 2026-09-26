import { temAcesso, type ModuloId } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Home,
  LogOut,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Tags,
  UserCog,
  UserRound,
  Users,
  Wallet,
  Warehouse,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { PAGINAS_LISTAS } from '../lib/cadastro';
import { useSessao } from '../lib/sessao';
import { aplicarTema, urlLogo } from '../lib/tema';
import { ContextoTrilha } from '../lib/trilha';
import { Avatar } from './Avatar';
import { MarcaMobiOS, Rodape } from './Marca';
import { Suspenso } from './ui';
import { Voltar } from './Voltar';

// Itens aparecem conforme o acesso do usuário ao módulo (Configurações → Funções e permissões).
type ItemMenu = {
  para: string;
  rotulo: string;
  icone: LucideIcon;
  modulo?: ModuloId;
  somenteAdmin?: boolean;
  /** Também aparece para o vendedor ativo, mesmo sem o módulo na matriz (ex.: Orçamentos). */
  paraVendedor?: boolean;
  /** Submenu que abre e fecha (collapse) no menu lateral. Filho com `modulo` só aparece para quem o acessa. */
  filhos?: { para: string; rotulo: string; modulo?: ModuloId }[];
};

const menu: ItemMenu[] = [
  { para: '/', rotulo: 'Início', icone: Home },
  {
    para: '/clientes',
    rotulo: 'Clientes',
    icone: Users,
    modulo: 'clientes',
    filhos: [
      { para: '/clientes', rotulo: 'Clientes' },
      { para: '/veiculos', rotulo: 'Veículos' },
    ],
  },
  { para: '/orcamentos', rotulo: 'Orçamentos', icone: FileText, modulo: 'orcamentos', paraVendedor: true },
  { para: '/aprovacoes-comerciais', rotulo: 'Aprovações comerciais', icone: BadgeCheck, modulo: 'aprovacao_comercial' },
  {
    para: '/materiais',
    rotulo: 'Ofertas',
    icone: Package,
    filhos: [
      { para: '/materiais', rotulo: 'Produtos', modulo: 'materiais' },
      { para: '/servicos', rotulo: 'Serviços', modulo: 'servicos' },
      { para: '/materiais/categorias', rotulo: 'Categorias', modulo: 'materiais' },
      { para: '/materiais/marcas', rotulo: 'Marcas', modulo: 'materiais' },
      { para: '/materiais/depositos', rotulo: 'Depósitos', modulo: 'materiais' },
    ],
  },
  {
    para: '/precos',
    rotulo: 'Política Comercial',
    icone: Tags,
    modulo: 'precos',
    filhos: [
      { para: '/precos', rotulo: 'Linhas de Preço' },
      { para: '/tabelas-preco', rotulo: 'Tabelas de Preço' },
    ],
  },
  { para: '/estoque', rotulo: 'Estoque', icone: Warehouse, modulo: 'estoque' },
  { para: '/os', rotulo: 'Ordens de serviço', icone: ClipboardList, modulo: 'os', paraVendedor: true },
  { para: '/financeiro', rotulo: 'Financeiro', icone: Wallet, modulo: 'financeiro' },
  { para: '/relatorios', rotulo: 'Relatórios', icone: BarChart3, modulo: 'relatorios' },
  {
    para: '/usuarios',
    rotulo: 'Equipe',
    icone: UserCog,
    somenteAdmin: true,
    filhos: [
      { para: '/usuarios', rotulo: 'Usuários' },
      { para: '/vendedores', rotulo: 'Vendedores' },
    ],
  },
];

/** Separada, no pé do menu lateral. */
const configuracoes: ItemMenu = {
  para: '/configuracoes',
  rotulo: 'Configurações',
  icone: Settings,
  somenteAdmin: true,
  filhos: [
    { para: '/configuracoes', rotulo: 'Aparência e logo' },
    { para: '/configuracoes/funcoes', rotulo: 'Funções e permissões' },
    { para: '/configuracoes/alcadas', rotulo: 'Alçadas de desconto' },
    ...PAGINAS_LISTAS.map(({ para, rotulo }) => ({ para, rotulo })),
  ],
};

const CHAVE_RECOLHIDO = 'mobios.menu.recolhido';

/** Preferência do usuário (só conveniência): se o navegador bloquear, o menu começa aberto. */
function lerRecolhido() {
  try {
    return localStorage.getItem(CHAVE_RECOLHIDO) === '1';
  } catch {
    return false;
  }
}

/** Filho do menu que corresponde à página atual: o de caminho mais longo que a contém. */
function filhoAtual<F extends { para: string }>(filhos: F[], pathname: string): F | undefined {
  return filhos
    .filter((f) => pathname === f.para || pathname.startsWith(`${f.para}/`))
    .sort((a, b) => b.para.length - a.para.length)[0];
}

/** AppShell: menu lateral (recolhível), topo com trilha e usuário, e o conteúdo da página em largura fluida. */
export function Layout() {
  const sessao = useSessao();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tema = sessao.data?.oficina.tema;
  const [recolhido, setRecolhido] = useState(lerRecolhido);
  const [menuMovel, setMenuMovel] = useState(false);
  const [ultimoTrilha, setUltimoTrilha] = useState<string | null>(null);

  useEffect(() => {
    if (tema) aplicarTema(tema);
  }, [tema]);
  // No celular, o menu fecha ao trocar de página.
  useEffect(() => setMenuMovel(false), [pathname]);

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
  const permitidos = (itens: ItemMenu[]) =>
    itens
      .filter((item) =>
        item.somenteAdmin
          ? usuario.admin
          : visivel(item.modulo) || (item.paraVendedor === true && !!sessao.data.vendedorId),
      )
      .map((item) => ({ ...item, filhos: item.filhos?.filter((f) => visivel(f.modulo)) }))
      // Grupo sem nenhum filho acessível some do menu.
      .filter((item) => !item.filhos || item.filhos.length > 0);
  const itens = permitidos(menu);
  const rodape = permitidos([configuracoes]);
  const todos = [...menu, configuracoes];

  const alternarRecolhido = () => {
    const novo = !recolhido;
    setRecolhido(novo);
    try {
      localStorage.setItem(CHAVE_RECOLHIDO, novo ? '1' : '0');
    } catch {
      /* sem armazenamento: só não lembra a escolha */
    }
  };

  const lateral = (compacto: boolean) => (
    <div className="flex h-full flex-col">
      <div className={`flex h-12 items-center border-b border-menu-borda ${compacto ? 'justify-center' : 'px-4'}`}>
        {compacto ? (
          <MarcaMobiOS className="size-6" titulo={oficina.nome} />
        ) : oficina.logoVersao ? (
          <img src={urlLogo(oficina.logoVersao)} alt={oficina.nome} className="max-h-8 max-w-full object-contain" />
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <MarcaMobiOS className="size-6 shrink-0" />
            <span className="truncate text-sm font-semibold">{oficina.nome}</span>
          </span>
        )}
      </div>
      <nav aria-label="Menu principal" className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {itens.map((item) => (
          <ItemLateral key={item.para} item={item} compacto={compacto} />
        ))}
      </nav>
      <div className="space-y-0.5 border-t border-menu-borda p-2">
        {rodape.map((item) => (
          <ItemLateral key={item.para} item={item} compacto={compacto} />
        ))}
        <button
          type="button"
          onClick={alternarRecolhido}
          title={compacto ? 'Expandir menu' : 'Recolher menu'}
          aria-label={compacto ? 'Expandir menu' : 'Recolher menu'}
          className={`hidden w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm opacity-75 hover:bg-menu-ativo hover:opacity-100 md:flex ${
            compacto ? 'justify-center' : ''
          }`}
        >
          {compacto ? (
            <PanelLeftOpen className="size-4" aria-hidden />
          ) : (
            <>
              <PanelLeftClose className="size-4" aria-hidden /> Recolher menu
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <ContextoTrilha.Provider value={setUltimoTrilha}>
      <div className="flex min-h-screen">
        <aside
          className={`sticky top-0 hidden h-screen shrink-0 border-r border-menu-borda bg-menu text-menu-texto transition-[width] md:block ${
            recolhido ? 'w-14' : 'w-56'
          }`}
        >
          {lateral(recolhido)}
        </aside>
        {menuMovel && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              aria-label="Fechar menu"
              className="absolute inset-0 bg-texto/40"
              onClick={() => setMenuMovel(false)}
            />
            <aside className="relative h-full w-64 bg-menu text-menu-texto shadow-xl">{lateral(false)}</aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-borda bg-superficie px-3 md:px-5">
            <button
              type="button"
              aria-label="Abrir menu"
              className="rounded-md p-1.5 text-texto-suave hover:bg-superficie-alt md:hidden"
              onClick={() => setMenuMovel(true)}
            >
              {menuMovel ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
            </button>
            <Voltar raizes={[...todos.flatMap((m) => [m.para, ...(m.filhos ?? []).map((f) => f.para)]), '/perfil']} />
            <Trilha itens={todos} extra={ultimoTrilha} />
            <span className="flex-1" />
            <Suspenso
              gatilho={({ aberto, alternar }) => (
                <button
                  type="button"
                  aria-expanded={aberto}
                  onClick={alternar}
                  className="flex items-center gap-2 rounded-full py-0.5 pr-2 pl-0.5 hover:bg-superficie-alt"
                >
                  <Avatar nome={usuario.nome} usuarioId={usuario.id} fotoVersao={usuario.fotoVersao} tamanho="sm" />
                  <span className="hidden text-left leading-tight sm:block">
                    <span className="block text-sm text-texto">{usuario.nome}</span>
                    {usuario.funcoes.length > 0 && (
                      <span className="block text-xs text-texto-suave">
                        {usuario.funcoes.map((f) => f.nome).join(', ')}
                      </span>
                    )}
                  </span>
                  <ChevronDown className="size-4 text-texto-suave" aria-hidden />
                </button>
              )}
            >
              {(fechar) => (
                <div className="text-sm">
                  <Link
                    to="/perfil"
                    onClick={fechar}
                    className="flex items-center gap-2 rounded px-2.5 py-1.5 hover:bg-superficie-alt"
                  >
                    <UserRound className="size-4" aria-hidden /> Meu perfil
                  </Link>
                  <button
                    type="button"
                    onClick={() => sair.mutate()}
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left hover:bg-superficie-alt"
                  >
                    <LogOut className="size-4" aria-hidden /> Sair
                  </button>
                </div>
              )}
            </Suspenso>
          </header>
          <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 md:px-6 md:py-5">
            <Outlet />
          </main>
          <Rodape />
        </div>
      </div>
    </ContextoTrilha.Provider>
  );
}

/** Trilha (breadcrumb) do topo: área do menu › página › registro aberto (definido pela página com useTrilha). */
function Trilha({ itens, extra }: { itens: ItemMenu[]; extra: string | null }) {
  const { pathname } = useLocation();
  if (pathname === '/') return null;
  const partes: { rotulo: string; para?: string }[] = [];
  for (const item of itens) {
    const filho = item.filhos ? filhoAtual(item.filhos, pathname) : undefined;
    if (filho) {
      if (filho.rotulo !== item.rotulo) partes.push({ rotulo: item.rotulo });
      partes.push(filho);
      break;
    }
    if (!item.filhos && item.para !== '/' && (pathname === item.para || pathname.startsWith(`${item.para}/`))) {
      partes.push(item);
      break;
    }
  }
  if (pathname === '/perfil') partes.push({ rotulo: 'Meu perfil' });
  if (extra) partes.push({ rotulo: extra });
  if (!partes.length) return null;
  return (
    <nav aria-label="Trilha" className="hidden min-w-0 items-center gap-1 text-sm sm:flex">
      {partes.map((p, n) => {
        const ultimo = n === partes.length - 1;
        return (
          <span key={`${p.rotulo}-${n}`} className="flex min-w-0 items-center gap-1">
            {n > 0 && <ChevronRight className="size-3.5 shrink-0 text-texto-suave" aria-hidden />}
            {p.para && !ultimo ? (
              <Link to={p.para} className="truncate text-texto-suave hover:text-primaria">
                {p.rotulo}
              </Link>
            ) : (
              <span className={`truncate ${ultimo ? 'font-medium text-texto' : 'text-texto-suave'}`}>{p.rotulo}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

const classeItem = (ativo: boolean, compacto: boolean) =>
  `flex w-full items-center gap-2.5 rounded-md py-2 text-sm ${compacto ? 'justify-center px-0' : 'px-2.5'} ${
    ativo ? 'bg-menu-ativo font-semibold' : 'opacity-85 hover:bg-menu-ativo hover:opacity-100'
  }`;

/** Item do menu lateral. Grupo: abre e fecha; recolhido, o ícone leva à primeira página do grupo. */
function ItemLateral({ item, compacto }: { item: ItemMenu; compacto: boolean }) {
  const { pathname } = useLocation();
  const Icone = item.icone;
  const atual = item.filhos ? filhoAtual(item.filhos, pathname) : undefined;
  const dentro = !!atual;
  const [aberto, setAberto] = useState(dentro);
  useEffect(() => {
    if (dentro) setAberto(true);
  }, [dentro]);
  const icone = <Icone className={`size-4 shrink-0 ${dentro ? 'text-primaria' : ''}`} aria-hidden />;

  if (!item.filhos)
    return (
      <NavLink
        to={item.para}
        end={item.para === '/'}
        title={compacto ? item.rotulo : undefined}
        className={({ isActive }) => classeItem(isActive, compacto)}
      >
        {({ isActive }) => (
          <>
            <Icone className={`size-4 shrink-0 ${isActive ? 'text-primaria' : ''}`} aria-hidden />
            {!compacto && <span className="truncate">{item.rotulo}</span>}
          </>
        )}
      </NavLink>
    );

  if (compacto)
    return (
      <Link to={item.filhos[0]!.para} title={item.rotulo} className={classeItem(dentro, true)}>
        {icone}
      </Link>
    );

  return (
    <div>
      <button
        type="button"
        aria-expanded={aberto}
        onClick={() => setAberto(!aberto)}
        className={classeItem(dentro && !aberto, false)}
      >
        {icone}
        <span className="flex-1 truncate text-left">{item.rotulo}</span>
        <ChevronDown className={`size-4 shrink-0 opacity-60 transition ${aberto ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {aberto && (
        <div className="mt-0.5 ml-4 space-y-0.5 border-l border-menu-borda pl-2">
          {item.filhos.map((f) => (
            <Link
              key={f.para}
              to={f.para}
              aria-current={f === atual ? 'page' : undefined}
              className={`block truncate rounded-md px-2.5 py-1.5 text-sm ${
                f === atual ? 'bg-menu-ativo font-semibold' : 'opacity-85 hover:bg-menu-ativo hover:opacity-100'
              }`}
            >
              {f.rotulo}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
