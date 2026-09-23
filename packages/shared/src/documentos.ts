export const somenteDigitos = (valor: string) => valor.replace(/\D/g, '');

function digitoVerificador(base: string, pesos: number[]): number {
  const soma = pesos.reduce((acc, peso, i) => acc + Number(base[i]) * peso, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cpfValido(valor: string): boolean {
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const d1 = digitoVerificador(cpf, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoVerificador(cpf, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cpf.endsWith(`${d1}${d2}`);
}

export function cnpjValido(valor: string): boolean {
  const cnpj = somenteDigitos(valor);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const d1 = digitoVerificador(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoVerificador(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj.endsWith(`${d1}${d2}`);
}

/** Placa antiga (ABC1234) ou Mercosul (ABC1D23), sem hífen e em maiúsculas. */
export const normalizarPlaca = (valor: string) => valor.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
export const placaValida = (valor: string) => /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(normalizarPlaca(valor));

/** Telefone brasileiro com DDD: fixo (10 dígitos) ou celular (11). */
export const telefoneValido = (valor: string) => /^[1-9]{2}\d{8,9}$/.test(somenteDigitos(valor));

/** Renavam: 11 dígitos (os antigos, de 9, recebem zeros à esquerda) com dígito verificador. */
export function renavamValido(valor: string): boolean {
  const digitos = somenteDigitos(valor);
  if (digitos.length < 9 || digitos.length > 11) return false;
  const renavam = digitos.padStart(11, '0');
  const soma = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2].reduce((acc, peso, i) => acc + Number(renavam[i]) * peso, 0);
  return ((soma * 10) % 11) % 10 === Number(renavam[10]);
}

/** Chassi/VIN: 17 caracteres, sem I, O e Q (que se confundem com 1 e 0). */
export const normalizarChassi = (valor: string) => valor.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
export const chassiValido = (valor: string) => /^[A-HJ-NPR-Z0-9]{17}$/.test(normalizarChassi(valor));

export const cepValido = (valor: string) => /^\d{8}$/.test(somenteDigitos(valor));
