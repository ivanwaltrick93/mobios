import {
  clienteInputSchema,
  clienteResumoSchema,
  clienteSchema,
  idParamSchema,
  normalizarDocumento,
  normalizarPlaca,
  clienteFiltroSchema,
  DIAS_ANIVERSARIO_SEMANA,
  hojeIso,
  pendenciasCliente,
  type Cliente,
  type ClienteDados,
  type ClienteResumo,
} from '@mobios/shared';
import { and, asc, count, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import {
  cargosResponsavel,
  clienteEnderecos,
  clienteResponsaveis,
  clientes,
  origensCliente,
  relacionamentosCliente,
} from '../../db/schema.js';
import { excluirSeNaoUsado, validarReferencia } from '../../lib/cadastro.js';
import { naoEncontrado } from '../../lib/erros.js';

// Correlação escrita à mão: dentro da subconsulta o Drizzle não qualifica as colunas.
const temEndereco = sql<boolean>`exists (select 1 from cliente_enderecos e where e.cliente_id = "clientes"."id")`;
const temResponsavel = sql<boolean>`exists (select 1 from cliente_responsaveis r where r.cliente_id = "clientes"."id")`;

type VeiculoResumo = ClienteResumo['veiculos'][number];

// Até 4 veículos por cliente (principal primeiro) para os cartões; o total vem à parte.
const veiculosResumo = sql<VeiculoResumo[]>`(select coalesce(json_agg(x), '[]'::json) from (
  select v.id, v.placa, v.marca, v.modelo, v.status from veiculos v
  where v.cliente_id = "clientes"."id" order by v.principal desc, v.placa limit 4) x)`;
const totalVeiculos = sql<number>`(select count(*) from veiculos v where v.cliente_id = "clientes"."id")`.mapWith(
  Number,
);

/** Dias até o próximo aniversário (função do banco, migração 0016), contando a partir de hoje em Brasília. */
export const diasAteAniversario = () =>
  sql<number | null>`dias_ate_aniversario(${clientes.dataNascimento}, ${hojeIso()}::date)`;

const cidadePrincipal = sql<string | null>`(select e.cidade || '/' || e.uf from cliente_enderecos e
  where e.cliente_id = "clientes"."id" order by e.principal desc, e.criado_em limit 1)`;

/** Colunas da lista (e base do detalhe). Função: o aniversário depende do dia da consulta. */
const colunasResumo = () => ({
  id: clientes.id,
  tipo: clientes.tipo,
  nome: clientes.nome,
  cpfCnpj: clientes.cpfCnpj,
  telefone: clientes.telefone,
  whatsapp: clientes.whatsapp,
  ativo: clientes.ativo,
  temEndereco,
  temResponsavel,
  veiculos: veiculosResumo,
  totalVeiculos,
  clienteDesde: clientes.clienteDesde,
  cidade: cidadePrincipal,
  diasAteAniversario: diasAteAniversario(),
});

const colunasEndereco = {
  id: clienteEnderecos.id,
  tipo: clienteEnderecos.tipo,
  cep: clienteEnderecos.cep,
  logradouro: clienteEnderecos.logradouro,
  numero: clienteEnderecos.numero,
  complemento: clienteEnderecos.complemento,
  bairro: clienteEnderecos.bairro,
  cidade: clienteEnderecos.cidade,
  uf: clienteEnderecos.uf,
  pais: clienteEnderecos.pais,
  principal: clienteEnderecos.principal,
  faturamento: clienteEnderecos.faturamento,
  entrega: clienteEnderecos.entrega,
  cobranca: clienteEnderecos.cobranca,
};

type BasePendencias = {
  tipo: 'PF' | 'PJ';
  cpfCnpj: string | null;
  telefone: string | null;
  whatsapp: string | null;
  temEndereco: boolean;
  temResponsavel: boolean;
};
const comPendencias = <T extends BasePendencias>({ temEndereco, temResponsavel, ...c }: T) => ({
  ...c,
  pendencias: pendenciasCliente(c, temEndereco, temResponsavel),
});

async function carregarCliente(tx: Tx, id: string): Promise<Cliente> {
  const [linha] = await tx
    .select({
      ...colunasResumo(),
      rgIe: clientes.rgIe,
      dataNascimento: clientes.dataNascimento,
      sexo: clientes.sexo,
      email: clientes.email,
      observacoes: clientes.observacoes,
      clienteDesde: clientes.clienteDesde,
      origemId: clientes.origemId,
      origemNome: origensCliente.nome,
      relacionamentoId: clientes.relacionamentoId,
      relacionamentoNome: relacionamentosCliente.nome,
      criadoEm: clientes.criadoEm,
    })
    .from(clientes)
    .leftJoin(origensCliente, eq(origensCliente.id, clientes.origemId))
    .leftJoin(relacionamentosCliente, eq(relacionamentosCliente.id, clientes.relacionamentoId))
    .where(eq(clientes.id, id));
  if (!linha) throw naoEncontrado('Cliente');
  const enderecos = await tx
    .select(colunasEndereco)
    .from(clienteEnderecos)
    .where(eq(clienteEnderecos.clienteId, id))
    .orderBy(sql`${clienteEnderecos.principal} desc`, asc(clienteEnderecos.criadoEm), asc(clienteEnderecos.id));
  const responsaveis = await tx
    .select({
      id: clienteResponsaveis.id,
      nome: clienteResponsaveis.nome,
      telefone: clienteResponsaveis.telefone,
      telefoneWhatsapp: clienteResponsaveis.telefoneWhatsapp,
      email: clienteResponsaveis.email,
      cargoId: clienteResponsaveis.cargoId,
      cargoNome: cargosResponsavel.nome,
      principal: clienteResponsaveis.principal,
    })
    .from(clienteResponsaveis)
    .innerJoin(cargosResponsavel, eq(cargosResponsavel.id, clienteResponsaveis.cargoId))
    .where(eq(clienteResponsaveis.clienteId, id))
    .orderBy(sql`${clienteResponsaveis.principal} desc`, asc(clienteResponsaveis.nome), asc(clienteResponsaveis.id));
  return { ...comPendencias(linha), enderecos, responsaveis };
}

/**
 * Origem e relacionamento escolhidos precisam estar ativos. Na edição, o cliente pode manter o item
 * que já tinha, mesmo que tenha sido desativado depois.
 */
async function validarOpcoes(
  tx: Tx,
  dados: { origemId: string | null; relacionamentoId: string | null },
  atual?: { origemId: string | null; relacionamentoId: string | null },
) {
  await validarReferencia(
    tx,
    origensCliente,
    origensCliente.ativa,
    dados.origemId,
    atual?.origemId,
    'Origem do cliente',
  );
  await validarReferencia(
    tx,
    relacionamentosCliente,
    relacionamentosCliente.ativa,
    dados.relacionamentoId,
    atual?.relacionamentoId,
    'Tipo de relacionamento',
  );
}

async function gravarEnderecos(tx: Tx, clienteId: string, enderecos: ClienteDados['enderecos']) {
  // Os endereços são regravados juntos com o cliente (mesma transação): nada referencia endereço por id.
  await tx.delete(clienteEnderecos).where(eq(clienteEnderecos.clienteId, clienteId));
  await tx.insert(clienteEnderecos).values(enderecos.map((e) => ({ ...e, clienteId })));
}

/**
 * Responsáveis (PJ) também são regravados juntos com o cliente. A função de cada um precisa estar ativa,
 * exceto as que o cliente já usava (podem ter sido desativadas depois).
 */
async function gravarResponsaveis(tx: Tx, clienteId: string, responsaveis: ClienteDados['responsaveis']) {
  const atuais = (
    await tx
      .select({ cargoId: clienteResponsaveis.cargoId })
      .from(clienteResponsaveis)
      .where(eq(clienteResponsaveis.clienteId, clienteId))
  ).map((r) => r.cargoId);
  for (const cargoId of new Set(responsaveis.map((r) => r.cargoId))) {
    const jaUsada = atuais.includes(cargoId) ? cargoId : null;
    await validarReferencia(tx, cargosResponsavel, cargosResponsavel.ativa, cargoId, jaUsada, 'Função do responsável');
  }
  await tx.delete(clienteResponsaveis).where(eq(clienteResponsaveis.clienteId, clienteId));
  if (responsaveis.length) await tx.insert(clienteResponsaveis).values(responsaveis.map((r) => ({ ...r, clienteId })));
}

// O tenant_id não aparece em nenhum filtro abaixo: quem garante o isolamento é o RLS via withTenant().
export const clientesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('clientes'));
  const editar = { onRequest: app.exigirAcesso('clientes', 'editar') };

  app.get(
    '/',
    {
      schema: {
        querystring: clienteFiltroSchema,
        response: { 200: z.object({ itens: z.array(clienteResumoSchema), total: z.number() }) },
      },
    },
    async (req) => {
      const { q, ativo, tipo, desde, ate, origemId, relacionamentoId, aniversario, pagina, porPagina } = req.query;
      const digitos = q?.replace(/\D/g, '');
      const documento = q ? normalizarDocumento(q) : '';
      // Placa sem hífen e em maiúsculas: no balcão o cliente chega com o carro, e a placa leva ao dono.
      const placa = q ? normalizarPlaca(q) : '';
      const busca = q
        ? or(
            ilike(clientes.nome, `%${q}%`),
            // Documento guardado sem pontuação e em maiúsculas (o CNPJ pode ter letras).
            ...(documento ? [ilike(clientes.cpfCnpj, `%${documento}%`)] : []),
            ...(digitos ? [ilike(clientes.telefone, `%${digitos}%`), ilike(clientes.whatsapp, `%${digitos}%`)] : []),
            ...(placa.length >= 3
              ? [
                  sql`exists (select 1 from veiculos v where v.cliente_id = "clientes"."id" and v.placa like ${`%${placa}%`})`,
                ]
              : []),
          )
        : undefined;
      const dias = diasAteAniversario();
      const filtro = and(
        busca,
        ativo ? eq(clientes.ativo, ativo === 'true') : undefined,
        tipo ? eq(clientes.tipo, tipo) : undefined,
        desde ? gte(clientes.clienteDesde, desde) : undefined,
        ate ? lte(clientes.clienteDesde, ate) : undefined,
        origemId ? eq(clientes.origemId, origemId) : undefined,
        relacionamentoId ? eq(clientes.relacionamentoId, relacionamentoId) : undefined,
        aniversario === 'hoje' ? sql`${dias} = 0` : undefined,
        aniversario === 'semana' ? sql`${dias} <= ${DIAS_ANIVERSARIO_SEMANA}` : undefined,
      );
      return withTenant(req.user.tid, async (tx) => {
        const linhas = await tx
          .select(colunasResumo())
          .from(clientes)
          .where(filtro)
          // Filtrando aniversariantes, os mais próximos primeiro.
          .orderBy(...(aniversario ? [asc(dias)] : []), asc(clientes.nome), asc(clientes.id))
          .limit(porPagina)
          .offset((pagina - 1) * porPagina);
        const [{ total }] = (await tx.select({ total: count() }).from(clientes).where(filtro)) as [{ total: number }];
        return { itens: linhas.map(comPendencias), total };
      });
    },
  );

  app.get('/:id', { schema: { params: idParamSchema, response: { 200: clienteSchema } } }, async (req) =>
    withTenant(req.user.tid, (tx) => carregarCliente(tx, req.params.id)),
  );

  app.post(
    '/',
    { ...editar, schema: { body: clienteInputSchema, response: { 201: clienteSchema } } },
    async (req, reply) => {
      const { enderecos, responsaveis, ...dados } = req.body;
      const cliente = await withTenant(req.user.tid, async (tx) => {
        await validarOpcoes(tx, dados);
        const [{ id }] = (await tx.insert(clientes).values(dados).returning({ id: clientes.id })) as [{ id: string }];
        await gravarEnderecos(tx, id, enderecos);
        await gravarResponsaveis(tx, id, responsaveis);
        return carregarCliente(tx, id);
      });
      return reply.code(201).send(cliente);
    },
  );

  app.put(
    '/:id',
    { ...editar, schema: { params: idParamSchema, body: clienteInputSchema, response: { 200: clienteSchema } } },
    async (req) => {
      const { enderecos, responsaveis, ...dados } = req.body;
      return withTenant(req.user.tid, async (tx) => {
        const [atual] = await tx
          .select({ origemId: clientes.origemId, relacionamentoId: clientes.relacionamentoId })
          .from(clientes)
          .where(eq(clientes.id, req.params.id))
          .for('update');
        if (!atual) throw naoEncontrado('Cliente');
        await validarOpcoes(tx, dados, atual);
        await tx.update(clientes).set(dados).where(eq(clientes.id, req.params.id));
        await gravarEnderecos(tx, req.params.id, enderecos);
        await gravarResponsaveis(tx, req.params.id, responsaveis);
        return carregarCliente(tx, req.params.id);
      });
    },
  );

  /** Endereços e responsáveis saem junto (cascade); veículos não (FK RESTRICT): transferir ou remover antes. */
  app.delete('/:id', { ...editar, schema: { params: idParamSchema } }, async (req, reply) => {
    await withTenant(req.user.tid, (tx) =>
      excluirSeNaoUsado(
        tx,
        clientes,
        req.params.id,
        'Cliente',
        'Este cliente tem veículos e não pode ser excluído. Transfira ou remova os veículos, ou inative o cliente.',
      ),
    );
    return reply.code(204).send();
  });
};
