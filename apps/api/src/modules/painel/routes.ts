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
          semTelefone: sql<number>`count(*) filter (where ${clientes.telefone} is null)`.mapWith(Number),
          // Correlação escrita à mão: dentro da subconsulta o Drizzle não qualifica as colunas
          // e "id" seria o do veículo, não o do cliente.
          semVeiculo: sql<number>`count(*) filter (where not exists (select 1 from veiculos v where v.cliente_id = "clientes"."id"))`.mapWith(Number),
        })
        .from(clientes);
      const [v] = await tx
        .select({ total: count(), hoje: sql<number>`count(*) filter (where ${hoje(veiculos.criadoEm)})`.mapWith(Number) })
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
      if (c!.semTelefone > 0) {
        alertas.push({ nivel: 'aviso', mensagem: `${c!.semTelefone} cliente(s) sem telefone: não será possível avisar quando o veículo ficar pronto.`, link: '/clientes' });
      }
      if (c!.semVeiculo > 0) {
        alertas.push({ nivel: 'info', mensagem: `${c!.semVeiculo} cliente(s) sem veículo cadastrado.`, link: '/clientes' });
      }

      return { indicadores, alertas, modulosPendentes: ['O.S. atrasadas', 'Estoque abaixo do mínimo', 'Contas a vencer'] };
    }),
  );
};
