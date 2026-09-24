import { IMPORTACAO_LINHAS_MAXIMAS } from '@mobios/shared';

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

// ---------- Leitura (importação de planilhas) ----------

export const CSV_LINHAS_MAXIMAS = IMPORTACAO_LINHAS_MAXIMAS;

/** Linha de dados com o número que ela tem na planilha (o cabeçalho é a linha 1). */
export type LinhaCsv = { numero: number; valores: Record<string, string> };

/** Nome de coluna comparável: minúsculas, sem acento e sem espaços nas pontas. */
const normalizarColuna = (coluna: string) => coluna.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

/** Separa o texto em registros e campos, respeitando aspas (campo com separador, aspas ou quebra de linha). */
function registros(texto: string, separador: string): string[][] {
  const lista: string[][] = [];
  let registro: string[] = [];
  let campo = '';
  let entreAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') {
        entreAspas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreAspas = true;
    } else if (c === separador) {
      registro.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      registro.push(campo);
      lista.push(registro);
      registro = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo !== '' || registro.length) {
    registro.push(campo);
    lista.push(registro);
  }
  return lista;
}

/**
 * Lê um CSV como o Excel em português salva (";" — ou "," —, aspas, BOM, CRLF).
 * A primeira linha é SEMPRE o cabeçalho; colunas são reconhecidas pelo nome (sem acento e sem diferenciar
 * maiúsculas) e colunas a mais são ignoradas. Linhas em branco não contam.
 * Lança `Error` com mensagem exibível quando o arquivo não pode ser usado.
 */
export function lerCsv(texto: string, obrigatorias: readonly string[]): LinhaCsv[] {
  const semBom = texto.replace(/^\uFEFF/, '');
  const primeiraLinha = semBom.split(/\r?\n/, 1)[0] ?? '';
  const separador = primeiraLinha.includes(';') ? ';' : ',';
  const [cabecalho, ...dados] = registros(semBom, separador);
  if (!cabecalho || cabecalho.every((c) => !c.trim())) throw new Error('O arquivo está vazio.');

  const colunas = cabecalho.map(normalizarColuna);
  const faltando = obrigatorias.filter((c) => !colunas.includes(c));
  if (faltando.length) {
    throw new Error(`Colunas obrigatórias ausentes no cabeçalho (1ª linha): ${faltando.join(', ')}.`);
  }

  const linhas = dados
    .map((campos, i) => ({ numero: i + 2, campos }))
    .filter(({ campos }) => campos.some((c) => c.trim()))
    .map(({ numero, campos }) => ({
      numero,
      valores: Object.fromEntries(colunas.map((coluna, i) => [coluna, (campos[i] ?? '').trim()])),
    }));
  if (!linhas.length) throw new Error('O arquivo não tem linhas de dados depois do cabeçalho.');
  if (linhas.length > CSV_LINHAS_MAXIMAS) {
    throw new Error(`O arquivo tem ${linhas.length} linhas; o máximo por importação é ${CSV_LINHAS_MAXIMAS}.`);
  }
  return linhas;
}

/** Número de planilha: vírgula ou ponto como decimal, sem separador de milhar. `null` se não for número. */
export function lerNumero(texto: string): number | null {
  const t = texto.trim();
  return /^-?\d+([.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : null;
}

/** Data dd/mm/aaaa (Excel pt-BR) ou aaaa-mm-dd, devolvida como aaaa-mm-dd. `null` se inválida. */
export function lerData(texto: string): string | null {
  const t = texto.trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const [ano, mes, dia] = br ? [br[3], br[2], br[1]] : iso ? [iso[1], iso[2], iso[3]] : [];
  if (!ano || !mes || !dia) return null;
  const data = `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  // Recusa datas que não existem (31/02): a volta pelo Date precisa dar a mesma data.
  const lida = new Date(`${data}T00:00:00Z`);
  return !Number.isNaN(lida.getTime()) && lida.toISOString().startsWith(data) ? data : null;
}
