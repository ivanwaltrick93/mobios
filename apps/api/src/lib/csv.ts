/**
 * CSV no padrão que o Excel em português abre direto: separador ";", CRLF e BOM UTF-8
 * (sem o BOM o Excel mostra acentos quebrados).
 */
const BOM = '﻿';

function celula(valor: string): string {
  // Proteção contra "CSV injection": o Excel executa células que começam com = + - @ como fórmula.
  const seguro = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
  return /[";\r\n]/.test(seguro) ? `"${seguro.replaceAll('"', '""')}"` : seguro;
}

export function gerarCsv(colunas: { chave: string; titulo: string }[], linhas: Record<string, string>[]): string {
  const cabecalho = colunas.map((c) => celula(c.titulo)).join(';');
  const corpo = linhas.map((l) => colunas.map((c) => celula(l[c.chave] ?? '')).join(';'));
  return BOM + [cabecalho, ...corpo].join('\r\n') + '\r\n';
}
