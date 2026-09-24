import {
  IMPORTACAO_LINHAS_MAXIMAS,
  IMPORTACAO_TAMANHO_MAXIMO,
  type ColunaImportacao,
  type ResultadoImportacao,
} from '@mobios/shared';
import { useMutation } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { useRef } from 'react';
import { api } from '../lib/api';
import { Alerta, Botao, Cabecalho, Cartao, Linha, Selo, Tabela, Td, TextoSuave, Th } from './ui';

/**
 * Importação em massa por planilha CSV: mostra as colunas aceitas (vindas do shared, as mesmas que a API
 * confere), oferece um modelo para baixar, envia o arquivo e mostra o resultado linha a linha.
 */
export function ImportarCsv({
  titulo,
  colunas,
  url,
  nomeModelo,
  aoConcluir,
  aoFechar,
}: {
  titulo: string;
  colunas: ColunaImportacao[];
  /** Rota da API que recebe o CSV (ex.: /precos/importar). */
  url: string;
  nomeModelo: string;
  aoConcluir: () => void;
  aoFechar: () => void;
}) {
  const arquivo = useRef<HTMLInputElement>(null);
  const importar = useMutation({
    mutationFn: (planilha: File) => {
      if (planilha.size > IMPORTACAO_TAMANHO_MAXIMO) throw new Error('O arquivo passa de 1 MB. Divida a planilha.');
      return api<ResultadoImportacao>(url, { method: 'POST', arquivo: { conteudo: planilha, tipo: 'text/csv' } });
    },
    onSuccess: aoConcluir,
  });
  const resultado = importar.data;

  return (
    <Cartao className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-texto">{titulo}</h2>
          <TextoSuave>
            A <strong>primeira linha é sempre o cabeçalho</strong>, com os nomes das colunas abaixo (sem acento ou
            maiúsculas, tanto faz; colunas a mais são ignoradas). Salve como CSV separado por ponto e vírgula, com
            vírgula decimal e sem separador de milhar. Até {IMPORTACAO_LINHAS_MAXIMAS.toLocaleString('pt-BR')} linhas ou
            1 MB por arquivo.
          </TextoSuave>
        </div>
        <Botao type="button" variante="secundario" onClick={aoFechar}>
          Fechar
        </Botao>
      </div>

      <Tabela>
        <Cabecalho>
          <Th>Coluna</Th>
          <Th>Obrigatória</Th>
          <Th>O que informar</Th>
          <Th>Exemplo</Th>
        </Cabecalho>
        <tbody>
          {colunas.map((c) => (
            <Linha key={c.nome}>
              <Td className="font-mono text-xs font-semibold">{c.nome}</Td>
              <Td>{c.obrigatoria ? <Selo tom="primario">Sim</Selo> : <Selo>Não</Selo>}</Td>
              <Td suave>{c.descricao}</Td>
              <Td suave className="whitespace-nowrap">
                {c.exemplo || '—'}
              </Td>
            </Linha>
          ))}
        </tbody>
      </Tabela>

      <div className="flex flex-wrap gap-2">
        <Botao type="button" variante="secundario" onClick={() => baixarModelo(colunas, nomeModelo)}>
          <Download className="mr-1.5 size-4" aria-hidden /> Baixar modelo
        </Botao>
        <input
          ref={arquivo}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const escolhido = e.target.files?.[0];
            if (escolhido) importar.mutate(escolhido);
            e.target.value = '';
          }}
        />
        <Botao type="button" disabled={importar.isPending} onClick={() => arquivo.current?.click()}>
          <Upload className="mr-1.5 size-4" aria-hidden /> {importar.isPending ? 'Importando…' : 'Escolher planilha'}
        </Botao>
      </div>

      <Alerta>{importar.isError && importar.error.message}</Alerta>
      {resultado && <ResultadoDaImportacao resultado={resultado} />}
    </Cartao>
  );
}

function ResultadoDaImportacao({ resultado }: { resultado: ResultadoImportacao }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-sm">
        <Selo tom="sucesso">{resultado.importadas} gravada(s)</Selo>
        {resultado.ignoradas > 0 && <Selo>{resultado.ignoradas} sem alteração</Selo>}
        {resultado.erros.length > 0 && <Selo tom="alerta">{resultado.erros.length} com erro</Selo>}
        <TextoSuave>de {resultado.linhas} linha(s) lida(s).</TextoSuave>
      </div>
      {resultado.erros.length > 0 && (
        <>
          <TextoSuave>
            As linhas abaixo não foram gravadas. Corrija na planilha e importe só elas de novo (as demais já estão
            salvas).
          </TextoSuave>
          <Tabela>
            <Cabecalho>
              <Th className="w-24">Linha</Th>
              <Th>Problema</Th>
            </Cabecalho>
            <tbody>
              {resultado.erros.map((e) => (
                <Linha key={e.linha}>
                  <Td className="font-mono">{e.linha}</Td>
                  <Td>{e.mensagem}</Td>
                </Linha>
              ))}
            </tbody>
          </Tabela>
        </>
      )}
    </div>
  );
}

/** Gera no navegador o modelo (cabeçalho + uma linha de exemplo), no formato do Excel pt-BR. */
function baixarModelo(colunas: ColunaImportacao[], nome: string) {
  const conteudo = `\uFEFF${colunas.map((c) => c.nome).join(';')}\r\n${colunas.map((c) => c.exemplo).join(';')}\r\n`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }));
  link.download = nome;
  link.click();
  URL.revokeObjectURL(link.href);
}
