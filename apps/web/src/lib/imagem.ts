import { IMAGEM_TAMANHO_MAXIMO, IMAGEM_TIPOS } from '@mobios/shared';

/** Checagem rápida no navegador; a API valida de novo pelos bytes do arquivo. */
export function validarImagem(arquivo: File): string | null {
  if (!(IMAGEM_TIPOS as readonly string[]).includes(arquivo.type))
    return 'Formato não suportado. Use PNG, JPEG ou WebP.';
  return null;
}

/**
 * Reduz a foto (ex.: 4 MB do celular) para no máximo `lado` px em JPEG antes de enviar:
 * poupa espaço no banco, onde as imagens ficam guardadas.
 */
export async function reduzirImagem(arquivo: File, lado = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; // JPEG não tem transparência
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
  if (!blob || blob.size > IMAGEM_TAMANHO_MAXIMO) throw new Error('Não foi possível reduzir a imagem para até 1 MB.');
  return blob;
}
