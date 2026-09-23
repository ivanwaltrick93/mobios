import { CAMPOS_TEMA, TEMA_VAZIO, type Tema } from '@mobios/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Tx } from '../db/client.js';
import { tenantAparencia, tenantLogos } from '../db/schema.js';
import { responderImagem } from './imagem.js';

// Marca da oficina (tema + logo). Sempre dentro de withTenant: o RLS escolhe a linha da oficina.

const colunasTema = Object.fromEntries(CAMPOS_TEMA.map((c) => [c, tenantAparencia[c]])) as {
  [K in keyof Tema]: (typeof tenantAparencia)[K];
};

export async function lerTema(tx: Tx): Promise<Tema> {
  const [tema] = await tx.select(colunasTema).from(tenantAparencia);
  return tema ?? TEMA_VAZIO;
}

export async function salvarTema(tx: Tx, tema: Tema): Promise<Tema> {
  const valores = { ...tema, atualizadoEm: new Date() };
  const [salvo] = await tx
    .insert(tenantAparencia)
    .values(valores)
    .onConflictDoUpdate({ target: tenantAparencia.tenantId, set: valores })
    .returning(colunasTema);
  return salvo!;
}

export async function lerVersaoLogo(tx: Tx): Promise<string | null> {
  const [logo] = await tx.select({ atualizadoEm: tenantLogos.atualizadoEm }).from(tenantLogos);
  return logo ? String(logo.atualizadoEm.getTime()) : null;
}

/** Responde com a imagem do logo (ou 404), com cache por versão/ETag. */
export async function enviarLogo(tx: Tx, req: FastifyRequest, reply: FastifyReply) {
  const [logo] = await tx
    .select({ conteudo: tenantLogos.conteudo, tipo: tenantLogos.tipo, atualizadoEm: tenantLogos.atualizadoEm })
    .from(tenantLogos);
  return responderImagem(req, reply, logo, 'Nenhum logo cadastrado');
}
