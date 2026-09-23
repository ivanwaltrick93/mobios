import { formatarTelefone } from '@mobios/shared';
import { MessageCircle } from 'lucide-react';
import { Selo } from './ui';

/** Selo de cadastro incompleto, listando o que falta (registros anteriores às regras atuais). */
export function SeloPendencias({ pendencias }: { pendencias: string[] }) {
  if (pendencias.length === 0) return null;
  return (
    <Selo tom="alerta" titulo={`Falta: ${pendencias.join(', ')}. Complete antes de abrir O.S.`}>
      Cadastro incompleto
    </Selo>
  );
}

/** Abre a conversa no WhatsApp (wa.me) com o número do cliente. */
export function LinkWhatsApp({ numero, className = '' }: { numero: string; className?: string }) {
  return (
    <a
      href={`https://wa.me/55${numero}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 text-sm text-sucesso hover:underline ${className}`}
      title="Abrir conversa no WhatsApp"
    >
      <MessageCircle className="size-4" aria-hidden />
      {formatarTelefone(numero)}
    </a>
  );
}
