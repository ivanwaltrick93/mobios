export function formatarDocumento(doc: string | null): string {
  if (!doc) return '—';
  if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  // CNPJ numérico ou alfanumérico: a máscara é a mesma.
  if (doc.length === 14) return doc.replace(/([0-9A-Z]{2})([0-9A-Z]{3})([0-9A-Z]{3})([0-9A-Z]{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}

export const formatarPlaca = (placa: string) => (/^[A-Z]{3}\d{4}$/.test(placa) ? `${placa.slice(0, 3)}-${placa.slice(3)}` : placa);

const FUSO = 'America/Sao_Paulo';

export const formatarData = (data: Date) => data.toLocaleDateString('pt-BR', { timeZone: FUSO });

/** Data de hoje (Brasília) em AAAA-MM-DD, para nomes de arquivo e filtros. */
export const hojeIso = () => new Date().toLocaleDateString('en-CA', { timeZone: FUSO });

/** Valores monetários são guardados em centavos (inteiro). */
export const formatarMoeda = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatarTelefone(tel: string | null): string {
  if (!tel) return '—';
  if (tel.length === 11) return tel.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (tel.length === 10) return tel.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return tel;
}

export const formatarCep = (cep: string) => (/^\d{8}$/.test(cep) ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep);

/** Data sem hora (AAAA-MM-DD) em DD/MM/AAAA, sem passar por fuso horário. */
export const formatarDataIso = (data: string | null) => (data ? data.split('-').reverse().join('/') : '—');

/** Quantidade em estoque: até 3 casas, sem zeros sobrando (12 · 20,5 · 0,25). */
export const formatarQuantidade = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
