import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { ErroApi } from './lib/api';
import { PAGINAS_LISTAS } from './lib/cadastro';
import './index.css';
import { Categorias } from './pages/Categorias';
import { Depositos } from './pages/Depositos';
import { EditarMaterial } from './pages/EditarMaterial';
import { Marcas } from './pages/Marcas';
import { MaterialDetalhe } from './pages/MaterialDetalhe';
import { Materiais } from './pages/Materiais';
import { NovoMaterial } from './pages/NovoMaterial';
import { ServicoDetalhe } from './pages/ServicoDetalhe';
import { EditarServico, NovoServico } from './pages/ServicoForm';
import { Servicos } from './pages/Servicos';
import { TabelaPrecoDetalhe } from './pages/TabelaPrecoDetalhe';
import { TabelasPreco } from './pages/TabelasPreco';
import { ListaPrecos } from './pages/ListaPrecos';
import { Estoque } from './pages/Estoque';
import { ClienteDetalhe } from './pages/ClienteDetalhe';
import { Clientes } from './pages/Clientes';
import { EmBreve } from './pages/EmBreve';
import { Funcoes } from './pages/Funcoes';
import { Inicio } from './pages/Inicio';
import { NovoCliente } from './pages/NovoCliente';
import { NovoVeiculo } from './pages/NovoVeiculo';
import { OrcamentoDetalhe } from './pages/OrcamentoDetalhe';
import { EditarOrcamento, NovoOrcamento } from './pages/OrcamentoForm';
import { Orcamentos } from './pages/Orcamentos';
import { Perfil } from './pages/Perfil';
import { Entrar } from './pages/Entrar';
import { Configuracoes } from './pages/Configuracoes';
import { EditarCliente } from './pages/EditarCliente';
import { EditarVeiculo } from './pages/EditarVeiculo';
import { ListaConfiguracao } from './pages/ListaConfiguracao';
import { Relatorios } from './pages/Relatorios';
import { Usuarios } from './pages/Usuarios';
import { Veiculos } from './pages/Veiculos';
import { Vendedores } from './pages/Vendedores';

/**
 * Sessão expirada ou acesso desativado no meio do uso (401 fora da tela de login): descarta os dados
 * em cache do usuário e volta para o login, em vez de cada tela mostrar o erro.
 */
function aoErroDaApi(erro: unknown) {
  if (erro instanceof ErroApi && erro.status === 401 && router.state.location.pathname !== '/entrar') {
    queryClient.clear();
    void router.navigate('/entrar', { replace: true });
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: aoErroDaApi }),
  mutationCache: new MutationCache({ onError: aoErroDaApi }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Erro 4xx (sem permissão, não encontrado, sessão expirada) não melhora com nova tentativa.
      retry: (falhas, erro) => !(erro instanceof ErroApi && erro.status < 500) && falhas < 3,
    },
  },
});

const router = createBrowserRouter([
  { path: '/entrar', element: <Entrar /> },
  {
    element: <Layout />,
    children: [
      { index: true, element: <Inicio /> },
      { path: '/clientes/novo', element: <NovoCliente /> },
      { path: '/veiculos', element: <Veiculos /> },
      { path: '/veiculos/novo', element: <NovoVeiculo /> },
      { path: '/clientes', element: <Clientes /> },
      { path: '/clientes/:id', element: <ClienteDetalhe /> },
      { path: '/clientes/:id/editar', element: <EditarCliente /> },
      { path: '/veiculos/:id/editar', element: <EditarVeiculo /> },
      { path: '/orcamentos', element: <Orcamentos /> },
      { path: '/orcamentos/novo', element: <NovoOrcamento /> },
      { path: '/orcamentos/:id', element: <OrcamentoDetalhe /> },
      { path: '/orcamentos/:id/editar', element: <EditarOrcamento /> },
      { path: '/materiais', element: <Materiais /> },
      { path: '/materiais/novo', element: <NovoMaterial /> },
      { path: '/materiais/categorias', element: <Categorias /> },
      { path: '/materiais/marcas', element: <Marcas /> },
      { path: '/materiais/depositos', element: <Depositos /> },
      { path: '/materiais/:id', element: <MaterialDetalhe /> },
      { path: '/materiais/:id/editar', element: <EditarMaterial /> },
      { path: '/servicos', element: <Servicos /> },
      { path: '/servicos/novo', element: <NovoServico /> },
      { path: '/servicos/:id', element: <ServicoDetalhe /> },
      { path: '/servicos/:id/editar', element: <EditarServico /> },
      { path: '/tabelas-preco', element: <TabelasPreco /> },
      { path: '/tabelas-preco/:id', element: <TabelaPrecoDetalhe /> },
      { path: '/precos', element: <ListaPrecos /> },
      { path: '/os', element: <EmBreve titulo="Ordens de serviço" /> },
      { path: '/estoque', element: <Estoque /> },
      { path: '/financeiro', element: <EmBreve titulo="Financeiro" /> },
      { path: '/relatorios', element: <Relatorios /> },
      { path: '/usuarios', element: <Usuarios /> },
      { path: '/vendedores', element: <Vendedores /> },
      { path: '/perfil', element: <Perfil /> },
      { path: '/configuracoes', element: <Configuracoes /> },
      { path: '/configuracoes/funcoes', element: <Funcoes /> },
      ...PAGINAS_LISTAS.map(({ lista, para }) => ({
        path: para,
        element: <ListaConfiguracao key={lista} lista={lista} />,
      })),
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
