import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import './index.css';
import { Categorias } from './pages/Categorias';
import { Depositos } from './pages/Depositos';
import { EditarMaterial } from './pages/EditarMaterial';
import { Marcas } from './pages/Marcas';
import { MaterialDetalhe } from './pages/MaterialDetalhe';
import { Materiais } from './pages/Materiais';
import { NovoMaterial } from './pages/NovoMaterial';
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
import { Perfil } from './pages/Perfil';
import { Entrar } from './pages/Entrar';
import { Configuracoes } from './pages/Configuracoes';
import { EditarCliente } from './pages/EditarCliente';
import { EditarVeiculo } from './pages/EditarVeiculo';
import { ListasCadastro } from './pages/ListasCadastro';
import { Relatorios } from './pages/Relatorios';
import { Usuarios } from './pages/Usuarios';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

const router = createBrowserRouter([
  { path: '/entrar', element: <Entrar /> },
  {
    element: <Layout />,
    children: [
      { index: true, element: <Inicio /> },
      { path: '/clientes/novo', element: <NovoCliente /> },
      { path: '/veiculos/novo', element: <NovoVeiculo /> },
      { path: '/clientes', element: <Clientes /> },
      { path: '/clientes/:id', element: <ClienteDetalhe /> },
      { path: '/clientes/:id/editar', element: <EditarCliente /> },
      { path: '/veiculos/:id/editar', element: <EditarVeiculo /> },
      { path: '/materiais', element: <Materiais /> },
      { path: '/materiais/novo', element: <NovoMaterial /> },
      { path: '/materiais/categorias', element: <Categorias /> },
      { path: '/materiais/marcas', element: <Marcas /> },
      { path: '/materiais/depositos', element: <Depositos /> },
      { path: '/materiais/:id', element: <MaterialDetalhe /> },
      { path: '/materiais/:id/editar', element: <EditarMaterial /> },
      { path: '/tabelas-preco', element: <TabelasPreco /> },
      { path: '/precos', element: <ListaPrecos /> },
      { path: '/os', element: <EmBreve titulo="Ordens de serviço" /> },
      { path: '/estoque', element: <Estoque /> },
      { path: '/financeiro', element: <EmBreve titulo="Financeiro" /> },
      { path: '/relatorios', element: <Relatorios /> },
      { path: '/usuarios', element: <Usuarios /> },
      { path: '/perfil', element: <Perfil /> },
      { path: '/configuracoes', element: <Configuracoes /> },
      { path: '/configuracoes/funcoes', element: <Funcoes /> },
      { path: '/configuracoes/cadastros', element: <ListasCadastro /> },
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
