import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

/**
 * "Voltar" do topo de todas as páginas (exceto o Início).
 * Páginas raiz (itens do menu e Meu perfil) voltam para o Início; as demais, para a página anterior.
 * Sem página anterior no app (link aberto direto), sobe um nível no caminho: /clientes/123 → /clientes.
 */
export function Voltar({ raizes }: { raizes: string[] }) {
  const { pathname, key } = useLocation();
  const navigate = useNavigate();
  if (pathname === '/') return null;

  const raiz = raizes.includes(pathname);
  function voltar() {
    if (raiz) return navigate('/');
    // key "default" = primeira página aberta nesta aba: não há para onde voltar no app.
    if (key !== 'default') return navigate(-1);
    const pai = pathname.replace(/\/[^/]+\/?$/, '') || '/';
    navigate(pai === '/veiculos' ? '/clientes' : pai);
  }

  return (
    <button
      type="button"
      onClick={voltar}
      title={raiz ? 'Voltar ao Início' : 'Voltar à página anterior'}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-primaria hover:bg-superficie-alt"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Voltar
    </button>
  );
}
