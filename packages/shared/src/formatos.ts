export function formatarDocumento(doc: string | null): string {
  if (!doc) return '—';
  if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (doc.length === 14) return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}

export const formatarPlaca = (placa: string) => (/^[A-Z]{3}\d{4}$/.test(placa) ? `${placa.slice(0, 3)}-${placa.slice(3)}` : placa);

const FUSO = 'America/Sao_Paulo';

export const formatarData = (data: Date) => data.toLocaleDateString('pt-BR', { timeZone: FUSO });

/** Data de hoje (Brasília) em AAAA-MM-DD, para nomes de arquivo e filtros. */
export const hojeIso = () => new Date().toLocaleDateString('en-CA', { timeZone: FUSO });
