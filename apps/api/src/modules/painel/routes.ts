import { temAcesso, type AlertaPainel, type Indicador, type Painel } from '@mobios/shared';
import { count, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { withTenant } from '../../db/client.js';
import { clientes, veiculos } from '../../db/schema.js';

const FUSO = 'America/Sao_Paulo';
const hoje = (coluna: PgColumn) => sql`(${coluna} at time zone ${FUSO})::date = (now() at time zone ${FUSO})::date`;

/**
 * Página inicial: indicadores e alertas calculados a partir do banco (isolados por oficina via RLS).
 * Indicadores de módulos ainda não implementados voltam com valor null — a tela mostra "em breve".
 */
export const painelRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);

  app.get('/', async (req): Promise<Painel> =>
    withTenant(req.user.tid, async (tx) => {
      const [c] = await tx
        .select({
          total: count(),
          hoje: sql<number>`count(*) filter (where ${hoje(clientes.criadoEm)})`.mapWith(Number),
          // Faltando campo obrigatório (cadastros antigos): não poderão abrir O.S. até serem completados.
          incompletos: sql<number>`count(*) filter (where ${clientes.cpfCnpj} is null or ${clientes.telefone} is null or ${clientes.whatsapp} is null
            or not exists (select 1 from cliente_enderecos e where e.cliente_id = "clientes"."id")
            or (${clientes.tipo} = 'PJ' and not exists (select 1 from cliente_responsaveis r where r.cliente_id = "clientes"."id")))`.mapWith(Number),
          // Correlação escrita à mão: dentro da subconsulta o Drizzle não qualifica as colunas
          // e "id" seria o do veículo, não o do cliente.
          semVeiculo: sql<number>`count(*) filter (where not exists (select 1 from veiculos v where v.cliente_id = "clientes"."id"))`.mapWith(Number),
        })
        .from(clientes);
      const [v] = await tx
        .select({
          total: count(),
          hoje: sql<number>`count(*) filter (where ${hoje(veiculos.criadoEm)})`.mapWith(Number),
          incompletos: sql<number>`count(*) filter (where ${veiculos.anoFabricacao} is null or ${veiculos.anoModelo} is null)`.mapWith(Number),
        })
        .from(veiculos);

      const indicadores: Indicador[] = [
        { id: 'os_abertas', titulo: 'O.S. em aberto', valor: null, formato: 'numero', detalhe: 'Disponível com o módulo de O.S.' },
        // Faturamento só para quem acessa o financeiro.
        ...(temAcesso(req.user.acessos, 'financeiro')
          ? [{ id: 'faturado_hoje', titulo: 'Faturado hoje', valor: null, formato: 'moeda', detalhe: 'Disponível com o módulo Financeiro' } as const]
          : []),
        { id: 'clientes', titulo: 'Clientes', valor: c!.total, formato: 'numero', detalhe: `${c!.hoje} cadastrado(s) hoje`, link: '/clientes' },
        { id: 'veiculos', titulo: 'Veículos', valor: v!.total, formato: 'numero', detalhe: `${v!.hoje} cadastrado(s) hoje`, link: '/clientes' },
      ];

      const alertas: AlertaPainel[] = [];
      if (c!.incompletos > 0) {
        alertas.push({ nivel: 'aviso', mensagem: `${c!.incompletos} cliente(s) com cadastro incompleto: complete antes de abrir O.S.`, link: '/clientes' });
      }
      if (v!.incompletos > 0) {
        alertas.push({ nivel: 'aviso', mensagem: `${v!.incompletos} veículo(s) com cadastro incompleto (ano de fabricação ou modelo): complete antes de abrir O.S.`, link: '/clientes' });
      }
      if (c!.semVeiculo > 0) {
        alertas.push({ nivel: 'info', mensagem: `${c!.semVeiculo} cliente(s) sem veículo cadastrado.`, link: '/clientes' });
      }

      return { indicadores, alertas, modulosPendentes: ['O.S. atrasadas', 'Estoque abaixo do mínimo', 'Contas a vencer'] };
    }),
  );
};
