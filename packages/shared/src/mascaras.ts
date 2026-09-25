/**
 * Máscaras aplicadas enquanto o usuário digita. Só formatam: a validação e a
 * normalização (tirar pontuação) continuam nos schemas, na API e no formulário.
 */

const digitos = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

/** Encaixa os caracteres no molde: `#` = caractere digitado; o resto é pontuação fixa. */
function aplicar(valor: string, molde: string): string {
  let saida = '';
  let i = 0;
  for (const m of molde) {
    if (i >= valor.length) break;
    if (m === '#') saida += valor[i++];
    else saida += m;
  }
  return saida;
}

export const mascaraCpf = (v: string) => aplicar(digitos(v, 11), '###.###.###-##');

/** CNPJ numérico ou alfanumérico: 12 posições com letras/números + 2 dígitos verificadores. */
export function mascaraCnpj(v: string): string {
  const limpo = v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const raiz = limpo.slice(0, 12);
  const dv = limpo.slice(12).replace(/\D/g, '').slice(0, 2);
  return aplicar(raiz + dv, '##.###.###/####-##');
}

export const mascaraDocumento = (v: string, tipo: 'PF' | 'PJ') => (tipo === 'PF' ? mascaraCpf(v) : mascaraCnpj(v));

/** (00) 0000-0000 para fixo; (00) 00000-0000 para celular. */
export function mascaraTelefone(v: string): string {
  const d = digitos(v, 11);
  return aplicar(d, d.length > 10 ? '(##) #####-####' : '(##) ####-####');
}

export const mascaraCep = (v: string) => aplicar(digitos(v, 8), '#####-###');

/** Placa antiga (ABC-1234) ou Mercosul (ABC1D23). */
export function mascaraPlaca(v: string): string {
  const p = v
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 7);
  return /^[A-Z]{3}\d{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}

export const mascaraRenavam = (v: string) => digitos(v, 11);
export const mascaraChassi = (v: string) =>
  v
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 17);
export const mascaraAno = (v: string) => digitos(v, 4);

/** Quilometragem com separador de milhar (125.000). */
export function mascaraKm(v: string): string {
  const d = digitos(v, 7);
  return d ? Number(d).toLocaleString('pt-BR') : '';
}

/** E-mail: sem espaços e em minúsculas. */
export const mascaraEmail = (v: string) => v.replace(/\s/g, '').toLowerCase();

/** Valor em reais com centavos ("1.234,56"): os dígitos digitados são os centavos. */
export function mascaraMoeda(v: string): string {
  const d = v
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, 11);
  if (!d) return '';
  return (Number(d) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "1.234,56" → 123456 (centavos). Vazio → null. */
export const moedaParaCentavos = (v: string): number | null =>
  v.replace(/\D/g, '') ? Number(v.replace(/\D/g, '')) : null;

export const mascaraNcm = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length > 6
    ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`
    : d.length > 4
      ? `${d.slice(0, 4)}.${d.slice(4)}`
      : d;
};
export const mascaraCest = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 7);
  return d.length > 5
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
    : d.length > 2
      ? `${d.slice(0, 2)}.${d.slice(2)}`
      : d;
};
/** Códigos de cadastro (SKU, código de depósito...): maiúsculas, sem espaços. */
export const mascaraCodigo = (v: string) => v.toUpperCase().replace(/\s/g, '');
export const mascaraGtin = (v: string) => v.replace(/\D/g, '').slice(0, 14);

/**
 * Quantidade: inteira para unidades que não se fracionam (UN, PC...); até 3 casas decimais para L, KG e M.
 * Digitação no padrão brasileiro ("1.234,5").
 */
export function mascaraQuantidade(v: string, fracionada: boolean): string {
  if (!fracionada) {
    const d = v
      .replace(/\D/g, '')
      .replace(/^0+(?=\d)/, '')
      .slice(0, 9);
    return d ? Number(d).toLocaleString('pt-BR') : '';
  }
  const [inteira = '', ...resto] = v.replace(/[^\d,]/g, '').split(',');
  const i = inteira.replace(/^0+(?=\d)/, '').slice(0, 9);
  const parteInteira = i ? Number(i).toLocaleString('pt-BR') : resto.length ? '0' : '';
  return resto.length ? `${parteInteira},${resto.join('').slice(0, 3)}` : parteInteira;
}

/** "1.234,5" → 1234.5. Vazio → null. */
export const quantidadeParaNumero = (v: string): number | null => {
  const limpo = v.replace(/\./g, '').replace(',', '.');
  return limpo === '' || Number.isNaN(Number(limpo)) ? null : Number(limpo);
};

/** Horas e minutos ("1:30"): até 3 dígitos de hora e 2 de minuto; o ":" entra sozinho a partir do 3º dígito. */
export function mascaraHoras(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 5);
  return d.length <= 2 ? d : `${Number(d.slice(0, -2))}:${d.slice(-2)}`;
}

/** "1:30" → 90 minutos; "2" → 120 (só horas). Formato inválido ou minutos acima de 59 → NaN. */
export function horasParaMinutos(v: string): number {
  const m = /^(\d{1,3})(?::(\d{2}))?$/.exec(v.trim());
  if (!m || Number(m[2] ?? 0) > 59) return NaN;
  return Number(m[1]) * 60 + Number(m[2] ?? 0);
}
