import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import './index.css';
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
      { path: '/os', element: <EmBreve titulo="Ordens de serviço" /> },
      { path: '/estoque', element: <EmBreve titulo="Estoque" /> },
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
