import { IMPORTACAO_TAMANHO_MAXIMO, type ColunaImportacao, type ResultadoImportacao } from '@mobios/shared';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../db/client.js';
import { lerCsv, type LinhaCsv } from './csv.js';
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
