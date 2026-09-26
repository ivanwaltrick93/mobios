import { entregaOsInputSchema, formatarNumeroOs, idParamSchema, ordemServicoSchema, TEMA_PADRAO } from '@mobios/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { withTenant } from '../../db/client.js';
import {
  clienteEnderecos,
  clientes,
  ordensServico,
  tenantAparencia,
  tenantLogos,
  tenants,
  veiculos,
} from '../../db/schema.js';
import { ErroHttp } from '../../lib/erros.js';
import { gerarPdf, imagemParaPdf } from '../../lib/pdf.js';
import { carregarOs, exigirSituacaoOs, exigirVersaoLidaOs, travarOs } from './consulta.js';
import { documentoDaOs } from './documento.js';
import { exigirAlterar, registrarOs } from './regras.js';

// Entrega e documento da O.S. (onda 5.4; docs/modulos/ORDENS_SERVICO.md §12).

export const entregaOsRoutes: FastifyPluginAsyncZod = async (app) => {
  /**
   * Entrega ao cliente (OS-13): só da O.S. concluída; km de saída obrigatório e não menor que o de entrada. O veículo
   * fica com o maior km conhecido.
   */
  app.post(
    '/:id/entregar',
    { schema: { params: idParamSchema, body: entregaOsInputSchema, response: { 200: ordemServicoSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const os = await travarOs(tx, req.params.id, req.user);
        exigirAlterar(req.user, os);
        exigirVersaoLidaOs(os, req.body.versao);
        exigirSituacaoOs(os, ['concluida'], 'entregar');
        const { kmSaida, recebidoPor, observacoesEntrega } = req.body;
        if (kmSaida < os.kmEntrada)
          throw new ErroHttp(400, `O km de saída não pode ser menor que o de entrada (${os.kmEntrada}).`, {
            kmSaida: 'Menor que o km de entrada',
          });
        await tx
          .update(ordensServico)
          .set({
            status: 'entregue',
            kmSaida,
            recebidoPor,
            observacoesEntrega,
            entregueEm: new Date(),
            entreguePor: req.user.sub,
            atualizadoPor: req.user.sub,
            versao: os.versao + 1,
          })
          .where(eq(ordensServico.id, os.id));
        await tx
          .update(veiculos)
          .set({ kmAtual: sql`greatest(coalesce(${veiculos.kmAtual}, 0), ${kmSaida})` })
          .where(eq(veiculos.id, os.veiculoId));
        await registrarOs(tx, os.id, 'entregue', req.user.sub, {
          detalhe: `Km de saída ${kmSaida.toLocaleString('pt-BR')}${recebidoPor ? `; retirado por ${recebidoPor}` : ''}.`,
          de: 'concluida',
          para: 'entregue',
        });
        return carregarOs(tx, os.id, req.user);
      }),
  );

  /** PDF da O.S. (OS-14), gerado na hora para quem vê a O.S.; nada fica guardado. */
  app.get('/:id/pdf', { schema: { params: idParamSchema } }, async (req, reply) => {
    const dados = await withTenant(req.user.tid, async (tx) => {
      const os = await carregarOs(tx, req.params.id, req.user);
      const [oficina] = await tx
        .select({
          nome: tenants.nome,
          cnpj: tenants.cnpj,
          cor: tenantAparencia.corPrimaria,
          logo: tenantLogos.conteudo,
          logoTipo: tenantLogos.tipo,
        })
        .from(tenants)
        .leftJoin(tenantAparencia, eq(tenantAparencia.tenantId, tenants.id))
        .leftJoin(tenantLogos, eq(tenantLogos.tenantId, tenants.id))
        .where(eq(tenants.id, req.user.tid));
      const [cliente] = await tx
        .select({
          documento: clientes.cpfCnpj,
          telefone: sql<string | null>`coalesce(${clientes.whatsapp}, ${clientes.telefone})`,
          email: clientes.email,
          endereco: sql<string | null>`(select concat_ws(', ', e.logradouro, e.numero, e.complemento, e.bairro,
            e.cidade || ' - ' || e.uf) from ${clienteEnderecos} e where e.cliente_id = ${clientes.id}
            order by e.principal desc limit 1)`,
        })
        .from(clientes)
        .where(eq(clientes.id, os.cliente.id));
      const [veiculo] = await tx
        .select({
          anoFabricacao: veiculos.anoFabricacao,
          anoModelo: veiculos.anoModelo,
          cor: veiculos.cor,
          versao: veiculos.versao,
        })
        .from(veiculos)
        .where(eq(veiculos.id, os.veiculo.id));
      return { os, oficina: oficina!, cliente: cliente!, veiculo: veiculo! };
    });
    const { os, oficina, cliente, veiculo } = dados;
    const pdf = await gerarPdf(
      documentoDaOs({
        os,
        oficina: {
          nome: oficina.nome,
          cnpj: oficina.cnpj,
          cor: oficina.cor ?? TEMA_PADRAO.corPrimaria,
          logo: imagemParaPdf(
            oficina.logo && oficina.logoTipo ? { conteudo: oficina.logo, tipo: oficina.logoTipo } : undefined,
          ),
        },
        cliente,
        veiculo: {
          ano: veiculo.anoFabricacao && veiculo.anoModelo ? `${veiculo.anoFabricacao}/${veiculo.anoModelo}` : null,
          cor: veiculo.cor,
          versao: veiculo.versao,
        },
        geradoEm: new Date(),
      }),
    );
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `inline; filename="${formatarNumeroOs(os.numero)}.pdf"`)
      .header('Cache-Control', 'private, no-store')
      .send(pdf);
  });
};
