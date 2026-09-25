import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Alerta, Botao, Janela, TextoSuave } from './base';

/**
 * Confirmação de ação (ConfirmationDialog), no lugar do confirm() do navegador. `perigo`: botão vermelho
 * (excluir, remover). `children`: campos extras (ex.: motivo).
 */
export function Confirmacao({
  titulo,
  mensagem,
  rotuloConfirmar,
  perigo = false,
  carregando = false,
  erro,
  aoConfirmar,
  aoFechar,
  children,
}: {
  titulo: string;
  mensagem: ReactNode;
  rotuloConfirmar: string;
  perigo?: boolean;
  carregando?: boolean;
  erro?: string | false | null;
  aoConfirmar: () => void;
  aoFechar: () => void;
  children?: ReactNode;
}) {
  return (
    <Janela titulo={titulo} aoFechar={aoFechar}>
      <div className="space-y-4">
        <TextoSuave>{mensagem}</TextoSuave>
        {children}
        <Alerta>{erro}</Alerta>
        <div className="flex justify-end gap-2">
          <Botao variante="secundario" onClick={aoFechar}>
            Voltar
          </Botao>
          <Botao variante={perigo ? 'perigo' : 'primario'} disabled={carregando} onClick={aoConfirmar}>
            {rotuloConfirmar}
          </Botao>
        </div>
      </div>
    </Janela>
  );
}

type TomNotificacao = 'sucesso' | 'info' | 'alerta';
type Notificacao = { id: number; mensagem: string; tom: TomNotificacao };

const ContextoNotificacoes = createContext<(mensagem: string, tom?: TomNotificacao) => void>(() => {});

/** `useNotificar()('Cliente excluído.')`: aviso rápido no canto da tela, que some sozinho (Toast). */
export const useNotificar = () => useContext(ContextoNotificacoes);

const ESTILO: Record<TomNotificacao, { classe: string; icone: typeof Info }> = {
  sucesso: { classe: 'text-sucesso', icone: CheckCircle2 },
  info: { classe: 'text-info', icone: Info },
  alerta: { classe: 'text-alerta', icone: TriangleAlert },
};

let proximoId = 0;

/** Provedor das notificações (uma vez, em main.tsx). */
export function ProvedorNotificacoes({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Notificacao[]>([]);
  const remover = (id: number) => setLista((l) => l.filter((n) => n.id !== id));
  const notificar = useCallback((mensagem: string, tom: TomNotificacao = 'sucesso') => {
    const id = ++proximoId;
    setLista((l) => [...l.slice(-2), { id, mensagem, tom }]);
    setTimeout(() => setLista((l) => l.filter((n) => n.id !== id)), 4000);
  }, []);
  return (
    <ContextoNotificacoes.Provider value={notificar}>
      {children}
      <div aria-live="polite" className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {lista.map((n) => {
          const { classe, icone: Icone } = ESTILO[n.tom];
          return (
            <div
              key={n.id}
              role="status"
              className="flex items-start gap-2 rounded-md border border-borda bg-superficie p-3 text-sm shadow-lg"
            >
              <Icone className={`mt-0.5 size-4 shrink-0 ${classe}`} aria-hidden />
              <span className="flex-1 text-texto">{n.mensagem}</span>
              <button
                type="button"
                aria-label="Fechar aviso"
                onClick={() => remover(n.id)}
                className="text-texto-suave hover:text-texto"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ContextoNotificacoes.Provider>
  );
}
