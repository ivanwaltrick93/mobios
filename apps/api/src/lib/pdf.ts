import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import pdfmake from 'pdfmake';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

// PDFs gerados no servidor (pdfmake, MIT; fonte Inter, SIL OFL), inteiros em memória: nada é gravado em disco
// (Kubernetes-ready, ARQUITETURA §9). O pdfmake não lê arquivo local nem baixa URL: imagens entram como data URL.

const require = createRequire(import.meta.url);
let configurado = false;

/** Sistema de arquivos em memória do pdfmake (existe no Node, mas falta nos tipos de @types/pdfmake). */
const arquivosEmMemoria = (pdfmake as unknown as { virtualfs: { writeFileSync(nome: string, dados: Buffer): void } })
  .virtualfs;

/** Carrega a Inter (WOFF, do pacote @fontsource/inter) no sistema de arquivos virtual do pdfmake, uma vez. */
function configurar() {
  if (configurado) return;
  for (const peso of [400, 700])
    arquivosEmMemoria.writeFileSync(
      `inter-${peso}.woff`,
      readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${peso}-normal.woff`)),
    );
  pdfmake.setFonts({
    Inter: {
      normal: 'inter-400.woff',
      bold: 'inter-700.woff',
      italics: 'inter-400.woff',
      bolditalics: 'inter-700.woff',
    },
  });
  // Nenhum acesso externo: o documento só usa o que vem nele (dados e imagens em data URL).
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy(() => false);
  configurado = true;
}

/** Gera o PDF (Buffer) a partir da definição do documento, com a Inter como fonte padrão. */
export async function gerarPdf(documento: TDocumentDefinitions): Promise<Buffer> {
  configurar();
  const pdf = pdfmake.createPdf({ ...documento, defaultStyle: { font: 'Inter', ...documento.defaultStyle } });
  return pdf.getBuffer();
}

/** Imagem guardada no banco como data URL para o PDF (o pdfmake aceita PNG e JPEG; WebP fica de fora). */
export const imagemParaPdf = (imagem: { conteudo: Buffer; tipo: string } | undefined) =>
  imagem && (imagem.tipo === 'image/png' || imagem.tipo === 'image/jpeg')
    ? `data:${imagem.tipo};base64,${imagem.conteudo.toString('base64')}`
    : undefined;
