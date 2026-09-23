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
  const p = v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 7);
  return /^[A-Z]{3}\d{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}

export const mascaraRenavam = (v: string) => digitos(v, 11);
export const mascaraChassi = (v: string) => v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 17);
export const mascaraAno = (v: string) => digitos(v, 4);

/** Quilometragem com separador de milhar (125.000). */
export function mascaraKm(v: string): string {
  const d = digitos(v, 7);
  return d ? Number(d).toLocaleString('pt-BR') : '';
}

/** E-mail: sem espaços e em minúsculas. */
export const mascaraEmail = (v: string) => v.replace(/\s/g, '').toLowerCase();
