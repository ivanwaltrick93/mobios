import { IMAGEM_TAMANHO_MAXIMO, IMAGEM_TIPOS } from '@mobios/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ErroHttp } from './erros.js';

// Imagens guardadas no banco (logo da oficina, fotos da equipe): mesmas regras para todas.

type TipoImagem = (typeof IMAGEM_TIPOS)[number];

/** Identifica o tipo real pelos primeiros bytes (não confia no Content-Type nem no nome do arquivo). */
export function detectarTipoImagem(b: Buffer): TipoImagem | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  return null;
}

/** O upload chega como o próprio arquivo no corpo (sem multipart). Registrar no plugin que recebe imagens. */
export function aceitarUploadDeImagem(app: FastifyInstance) {
  app.addContentTypeParser(
    [...IMAGEM_TIPOS],
    { parseAs: 'buffer', bodyLimit: IMAGEM_TAMANHO_MAXIMO },
    (_req, corpo, feito) => feito(null, corpo),
  );
}

/** Valida o corpo do upload e devolve os valores prontos para gravar. */
export function lerImagemEnviada(corpo: unknown) {
  if (!Buffer.isBuffer(corpo) || corpo.length === 0) throw new ErroHttp(400, 'Envie um arquivo de imagem.');
  const tipo = detectarTipoImagem(corpo);
  if (!tipo) throw new ErroHttp(415, 'Formato não suportado. Use PNG, JPEG ou WebP.');
  return { conteudo: corpo, tipo, tamanho: corpo.length, atualizadoEm: new Date() };
}

type ImagemGuardada = { conteudo: Buffer; tipo: string; atualizadoEm: Date };

/** Responde com a imagem (ou 404), com cache por versão/ETag. */
export function responderImagem(
  req: FastifyRequest,
  reply: FastifyReply,
  imagem: ImagemGuardada | undefined,
  ausente: string,
) {
  if (!imagem) return reply.code(404).send({ erro: ausente });
  const etag = `"${imagem.atualizadoEm.getTime()}"`;
  reply.header('ETag', etag).header('Cache-Control', 'private, max-age=31536000, immutable');
  if (req.headers['if-none-match'] === etag) return reply.code(304).send();
  return reply.type(imagem.tipo).send(imagem.conteudo);
}
