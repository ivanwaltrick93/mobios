import { IMPORTACAO_TAMANHO_MAXIMO, type ColunaImportacao, type ResultadoImportacao } from '@mobios/shared';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { Tx } from '../db/client.js';
import { lerCsv, lerData, type LinhaCsv } from './csv.js';
import { ErroHttp, traduzirErro } from './erros.js';

// Importação em massa por planilha CSV: o arquivo vem como texto no corpo (Content-Type text/csv),
// é lido em memória (nada vai para o disco) e cada linha é gravada de forma independente.

/** Registrar no plugin que recebe planilhas. */
export function aceitarUploadDeCsv(app: FastifyInstance) {
  app.addContentTypeParser(
    'text/csv',
    { parseAs: 'string', bodyLimit: IMPORTACAO_TAMANHO_MAXIMO },
    (_req, corpo, feito) => feito(null, corpo),
  );
}

/** Lê o corpo do upload conferindo as colunas obrigatórias (400 com a mensagem do problema). */
export function lerPlanilhaEnviada(corpo: unknown, colunas: ColunaImportacao[]): LinhaCsv[] {
  if (typeof corpo !== 'string') throw new ErroHttp(415, 'Envie um arquivo CSV.');
  try {
    return lerCsv(
      corpo,
      colunas.filter((c) => c.obrigatoria).map((c) => c.nome),
    );
  } catch (e) {
    throw new ErroHttp(400, (e as Error).message);
  }
}

/**
 * Grava as linhas válidas e relata as demais (decisão do produto: importar o que estiver certo).
 * Cada linha roda num SAVEPOINT: se ela falhar, só ela é desfeita. Erro inesperado interrompe tudo (500).
 */
export async function importarLinhas(
  tx: Tx,
  linhas: LinhaCsv[],
  gravarLinha: (tx: Tx, linha: LinhaCsv) => Promise<'importada' | 'ignorada'>,
): Promise<ResultadoImportacao> {
  const resultado: ResultadoImportacao = { linhas: linhas.length, importadas: 0, ignoradas: 0, erros: [] };
  for (const linha of linhas) {
    try {
      const situacao = await tx.transaction((savepoint) => gravarLinha(savepoint, linha));
      if (situacao === 'importada') resultado.importadas++;
      else resultado.ignoradas++;
    } catch (e) {
      const conhecido = traduzirErro(e);
      if (!conhecido) throw e;
      resultado.erros.push({ linha: linha.numero, mensagem: conhecido.erro });
    }
  }
  return resultado;
}

// ---------- Leitura de valores das planilhas ----------

/** Texto comparável para nomes de listas e categorias: sem acento, minúsculo e sem espaços sobrando. */
export const comparavel = (texto: string) =>
  texto.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();

/** "sim/não" de planilha (também s/n, x, 1/0, true/false). Vazio = `undefined` (usa o padrão do cadastro). */
export function lerSimNao(texto: string, coluna: string): boolean | undefined {
  const t = comparavel(texto);
  if (!t) return undefined;
  if (['sim', 's', 'x', '1', 'true', 'verdadeiro'].includes(t)) return true;
  if (['nao', 'n', '0', 'false', 'falso'].includes(t)) return false;
  throw new ErroHttp(400, `${coluna}: use "sim" ou "não" (recebido "${texto}").`);
}

/** Data dd/mm/aaaa (ou aaaa-mm-dd) em ISO; vazio = `null`. */
export function lerDataPlanilha(texto: string, coluna: string): string | null {
  if (!texto.trim()) return null;
  const data = lerData(texto);
  if (!data) throw new ErroHttp(400, `${coluna}: data "${texto}" inválida, use dd/mm/aaaa.`);
  return data;
}

/**
 * Valida a linha com o MESMO schema do cadastro manual. Erro vira uma mensagem por coluna da planilha
 * (`coluna` traduz o caminho do campo, ex.: ['enderecos', 0, 'cep'] → "cep").
 */
export function validarLinha<S extends z.ZodType>(
  schema: S,
  dados: unknown,
  coluna: (caminho: PropertyKey[]) => string,
): z.output<S> {
  const resultado = schema.safeParse(dados);
  if (resultado.success) return resultado.data;
  // Uma mensagem por coluna (a primeira): "cep: Informe o CEP", sem repetir "CEP inválido" logo depois.
  const porColuna = new Map<string, string>();
  for (const i of resultado.error.issues) if (!porColuna.has(coluna(i.path))) porColuna.set(coluna(i.path), i.message);
  throw new ErroHttp(400, [...porColuna].map(([nome, mensagem]) => `${nome}: ${mensagem}`).join('; '));
}

/** Nome de campo em camelCase → coluna da planilha em snake_case (codigoBarras → codigo_barras). */
export const colunaDoCampo = (campo: PropertyKey) => String(campo).replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);

/**
 * Registro repetido no mesmo arquivo: a segunda ocorrência vira erro apontando a primeira.
 * Guarde um `Map` por importação e chame para cada linha com a chave do registro (CPF, SKU...).
 */
export function exigirPrimeiraVez(vistos: Map<string, number>, chave: string, linha: number, rotulo: string) {
  const anterior = vistos.get(chave);
  if (anterior) throw new ErroHttp(400, `${rotulo} repetido na planilha (já aparece na linha ${anterior}).`);
  vistos.set(chave, linha);
}
