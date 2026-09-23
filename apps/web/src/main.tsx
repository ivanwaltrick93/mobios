import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import './index.css';
import { ClienteDetalhe } from './pages/ClienteDetalhe';
import { Clientes } from './pages/Clientes';
import { EmBreve } from './pages/EmBreve';
import { CriarConta, Entrar } from './pages/Entrar';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

const router = createBrowserRouter([
  { path: '/entrar', element: <Entrar /> },
  { path: '/criar-conta', element: <CriarConta /> },
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/clientes" replace /> },
      { path: '/clientes', element: <Clientes /> },
      { path: '/clientes/:id', element: <ClienteDetalhe /> },
      { path: '/os', element: <EmBreve titulo="Ordens de serviço" /> },
      { path: '/estoque', element: <EmBreve titulo="Estoque" /> },
      { path: '/financeiro', element: <EmBreve titulo="Financeiro" /> },
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
