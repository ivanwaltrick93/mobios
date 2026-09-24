import { DIAS_ANIVERSARIO_SEMANA, formatarTelefone } from '@mobios/shared';
import { Cake, MessageCircle } from 'lucide-react';
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

/** Aniversário do cliente (pessoa física): hoje em destaque; nos próximos 7 dias, aviso discreto. */
export function SeloAniversario({ dias }: { dias: number | null }) {
  if (dias == null || dias > DIAS_ANIVERSARIO_SEMANA) return null;
  return (
    <Selo tom={dias === 0 ? 'primario' : 'neutro'} titulo="Uma mensagem de parabéns aproxima o cliente da oficina">
      <span className="inline-flex items-center gap-1">
        <Cake className="size-3.5" aria-hidden />
        {dias === 0 ? 'Aniversário hoje' : dias === 1 ? 'Aniversário amanhã' : `Aniversário em ${dias} dias`}
      </span>
    </Selo>
  );
}
