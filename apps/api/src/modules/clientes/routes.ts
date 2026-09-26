import {
  clienteInputSchema,
  clienteResumoSchema,
  clienteSchema,
  idParamSchema,
  normalizarDocumento,
  normalizarPlaca,
  clienteFiltroSchema,
  COLUNAS_IMPORTACAO_CLIENTES,
  DIAS_ANIVERSARIO_SEMANA,
  hojeIso,
  LISTAS_OPCOES,
  pendenciasCliente,
  resultadoImportacaoSchema,
  type Cliente,
  type ClienteDados,
  type ClienteInput,
  type ClienteResumo,
  type TipoEndereco,
} from '@mobios/shared';
import { and, asc, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
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
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import {
  aceitarUploadDeCsv,
  colunaDoCampo,
  comparavel,
  exigirPrimeiraVez,
  importarLinhas,
  lerDataPlanilha,
  lerPlanilhaEnviada,
  lerSimNao,
  validarLinha,
} from '../../lib/importacao.js';

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

/**
 * Busca de cliente por nome, CPF/CNPJ, telefone/WhatsApp ou placa de um veículo dele (lista de clientes e janela de
 * escolha do orçamento). Usa as colunas de `clientes` sem apelido.
 */
export function buscaDeCliente(q: string) {
  const digitos = q.replace(/\D/g, '');
  const documento = normalizarDocumento(q);
  // Placa sem hífen e em maiúsculas: no balcão o cliente chega com o carro, e a placa leva ao dono.
  const placa = normalizarPlaca(q);
  return or(
    ilike(clientes.nome, `%${q}%`),
    // Documento guardado sem pontuação e em maiúsculas (o CNPJ pode ter letras).
    ...(documento ? [ilike(clientes.cpfCnpj, `%${documento}%`)] : []),
    ...(digitos ? [ilike(clientes.telefone, `%${digitos}%`), ilike(clientes.whatsapp, `%${digitos}%`)] : []),
    ...(placa.length >= 3
      ? [sql`exists (select 1 from veiculos v where v.cliente_id = "clientes"."id" and v.placa like ${`%${placa}%`})`]
      : []),
  )!;
}

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

/** Novo cliente com endereços e responsáveis (mesmas regras na tela e na importação). */
async function criarCliente(tx: Tx, { enderecos, responsaveis, ...dados }: ClienteDados) {
  await validarOpcoes(tx, dados);
  const [{ id }] = (await tx.insert(clientes).values(dados).returning({ id: clientes.id })) as [{ id: string }];
  await gravarEnderecos(tx, id, enderecos);
  await gravarResponsaveis(tx, id, responsaveis);
  return id;
}

/** Alteração: regrava endereços e responsáveis junto; itens de lista que o cliente já usava continuam válidos. */
async function atualizarCliente(tx: Tx, id: string, { enderecos, responsaveis, ...dados }: ClienteDados) {
  const [atual] = await tx
    .select({ origemId: clientes.origemId, relacionamentoId: clientes.relacionamentoId })
    .from(clientes)
    .where(eq(clientes.id, id))
    .for('update');
  if (!atual) throw naoEncontrado('Cliente');
  await validarOpcoes(tx, dados, atual);
  await tx.update(clientes).set(dados).where(eq(clientes.id, id));
  await gravarEnderecos(tx, id, enderecos);
  await gravarResponsaveis(tx, id, responsaveis);
}

// ---------- Importação por planilha ----------

type ListaDeOpcoes = typeof origensCliente | typeof relacionamentosCliente | typeof cargosResponsavel;

/** Itens de uma lista da oficina pelo nome (sem acento e sem diferenciar maiúsculas). */
async function idsPorNome(tx: Tx, tabela: ListaDeOpcoes) {
  const itens = await tx.select({ id: tabela.id, nome: tabela.nome }).from(tabela);
  return new Map(itens.map((i) => [comparavel(i.nome), i.id]));
}

/** Colunas da planilha que apontam para listas de Configurações. */
const LISTA_DA_COLUNA = { origem: 'origens', relacionamento: 'relacionamentos', responsavel_funcao: 'cargos' } as const;

/**
 * Monta a entrada do cadastro a partir da linha. Colunas ausentes do arquivo mantêm o valor do cliente
 * existente; o endereço da linha substitui o principal e o responsável da linha (PJ) substitui o principal.
 */
function clienteDaLinha(
  valores: Record<string, string>,
  listas: Record<keyof typeof LISTA_DA_COLUNA, Map<string, string>>,
  atual?: Cliente,
): ClienteInput {
  const valor = (coluna: string) => valores[coluna] ?? '';
  const temColuna = (coluna: string) => coluna in valores;
  const texto = (coluna: string, atualValor: string | null | undefined) =>
    temColuna(coluna) ? valor(coluna) : (atualValor ?? '');
  const itemDaLista = (coluna: keyof typeof listas, atualId: string | null | undefined) => {
    if (!temColuna(coluna)) return atualId ?? null;
    if (!valor(coluna)) return null;
    const id = listas[coluna].get(comparavel(valor(coluna)));
    if (!id)
      throw new ErroHttp(
        400,
        `${coluna}: "${valor(coluna)}" não está na lista (Configurações → ${LISTAS_OPCOES[LISTA_DA_COLUNA[coluna]].titulo}).`,
      );
    return id;
  };
  const tipo = valor('tipo').toUpperCase() as 'PF' | 'PJ';

  const principal = atual?.enderecos.find((e) => e.principal);
  const endereco = {
    ...(principal && semId(principal)),
    tipo: (valor('tipo_endereco').toLowerCase() ||
      principal?.tipo ||
      (tipo === 'PJ' ? 'comercial' : 'residencial')) as TipoEndereco,
    cep: valor('cep'),
    logradouro: valor('logradouro'),
    numero: valor('numero'),
    complemento: texto('complemento', principal?.complemento),
    bairro: valor('bairro'),
    cidade: valor('cidade'),
    uf: valor('uf'),
    principal: true,
  };
  const enderecos = atual ? [endereco, ...atual.enderecos.filter((e) => !e.principal).map(semId)] : [endereco];

  const temResponsavel = ['responsavel_nome', 'responsavel_funcao', 'responsavel_telefone'].some((c) => valor(c));
  const responsavel = temResponsavel && {
    nome: valor('responsavel_nome'),
    cargoId: itemDaLista('responsavel_funcao', undefined) ?? '',
    telefone: valor('responsavel_telefone'),
    telefoneWhatsapp: lerSimNao(valor('responsavel_whatsapp'), 'responsavel_whatsapp') ?? false,
    email: valor('responsavel_email'),
    principal: true,
  };
  const outrosResponsaveis = (atual?.responsaveis ?? [])
    .filter((r) => !responsavel || !r.principal)
    .map(({ id: _id, cargoNome: _cargo, ...r }) => r);
  const responsaveis = responsavel ? [responsavel, ...outrosResponsaveis] : outrosResponsaveis;

  return {
    tipo,
    nome: valor('nome'),
    cpfCnpj: valor('cpf_cnpj'),
    telefone: valor('telefone'),
    whatsapp: valor('whatsapp'),
    email: texto('email', atual?.email),
    rgIe: texto('rg_ie', atual?.rgIe),
    dataNascimento: temColuna('data_nascimento')
      ? lerDataPlanilha(valor('data_nascimento'), 'data_nascimento')
      : (atual?.dataNascimento ?? null),
    sexo: (temColuna('sexo') ? valor('sexo').toLowerCase() : atual?.sexo) || null,
    clienteDesde: lerDataPlanilha(valor('cliente_desde'), 'cliente_desde') ?? atual?.clienteDesde ?? hojeIso(),
    origemId: itemDaLista('origem', atual?.origemId),
    relacionamentoId: itemDaLista('relacionamento', atual?.relacionamentoId),
    ativo: lerSimNao(valor('ativo'), 'ativo') ?? atual?.ativo ?? true,
    observacoes: texto('observacoes', atual?.observacoes),
    enderecos,
    responsaveis,
  } as ClienteInput;
}

const semId = <T extends { id: string }>({ id: _id, ...resto }: T) => resto;

/** Caminho do campo no cadastro → coluna da planilha, para a mensagem de erro apontar o que corrigir. */
function colunaDoCliente([campo, , subcampo]: PropertyKey[]): string {
  if (campo === 'enderecos') return subcampo === 'tipo' ? 'tipo_endereco' : subcampo ? String(subcampo) : 'endereço';
  if (campo === 'responsaveis') {
    const coluna = { cargoId: 'funcao', telefoneWhatsapp: 'whatsapp' }[String(subcampo)] ?? String(subcampo ?? 'nome');
    return `responsavel_${coluna}`;
  }
  return { origemId: 'origem', relacionamentoId: 'relacionamento' }[String(campo)] ?? colunaDoCampo(campo!);
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
  aceitarUploadDeCsv(app);

  app.get(
    '/',
    {
      schema: {
        querystring: clienteFiltroSchema,
        response: { 200: z.object({ itens: z.array(clienteResumoSchema), total: z.number() }) },
      },
    },
    async (req) => {
      const {
        q,
        ativo,
        tipo,
        desde,
        ate,
        origemId,
        relacionamentoId,
        aniversario,
        ordenar,
        direcao,
        pagina,
        porPagina,
      } = req.query;
      const busca = q ? buscaDeCliente(q) : undefined;
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
          // Filtrando aniversariantes, os mais próximos primeiro; depois a coluna escolhida e o nome, para desempatar.
          .orderBy(
            ...(aniversario ? [asc(dias)] : []),
            (direcao === 'desc' ? desc : asc)(ordenar === 'clienteDesde' ? clientes.clienteDesde : clientes.nome),
            asc(clientes.nome),
            asc(clientes.id),
          )
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
      const cliente = await withTenant(req.user.tid, async (tx) =>
        carregarCliente(tx, await criarCliente(tx, req.body)),
      );
      return reply.code(201).send(cliente);
    },
  );

  app.put(
    '/:id',
    { ...editar, schema: { params: idParamSchema, body: clienteInputSchema, response: { 200: clienteSchema } } },
    async (req) => {
      return withTenant(req.user.tid, async (tx) => {
        await atualizarCliente(tx, req.params.id, req.body);
        return carregarCliente(tx, req.params.id);
      });
    },
  );

  /**
   * Clientes em massa por CSV (colunas em COLUNAS_IMPORTACAO_CLIENTES): uma linha por cliente, validada pelo
   * mesmo schema do cadastro. CPF/CNPJ já cadastrado atualiza o cliente. Grava as válidas e relata as demais.
   */
  app.post('/importar', { ...editar, schema: { response: { 200: resultadoImportacaoSchema } } }, async (req) => {
    const linhas = lerPlanilhaEnviada(req.body, COLUNAS_IMPORTACAO_CLIENTES);
    return withTenant(req.user.tid, async (tx) => {
      // Listas da oficina lidas uma vez: a planilha traz os nomes, o cadastro guarda os ids.
      const listas = {
        origem: await idsPorNome(tx, origensCliente),
        relacionamento: await idsPorNome(tx, relacionamentosCliente),
        responsavel_funcao: await idsPorNome(tx, cargosResponsavel),
      };
      const vistos = new Map<string, number>();
      return importarLinhas(tx, linhas, async (savepoint, { numero, valores }) => {
        const documento = normalizarDocumento(valores.cpf_cnpj ?? '');
        if (documento) exigirPrimeiraVez(vistos, documento, numero, `CPF/CNPJ ${valores.cpf_cnpj}`);
        const [existente] = documento
          ? await savepoint.select({ id: clientes.id }).from(clientes).where(eq(clientes.cpfCnpj, documento))
          : [];
        const atual = existente ? await carregarCliente(savepoint, existente.id) : undefined;
        const dados = validarLinha(clienteInputSchema, clienteDaLinha(valores, listas, atual), colunaDoCliente);
        if (atual) await atualizarCliente(savepoint, atual.id, dados);
        else await criarCliente(savepoint, dados);
        return 'importada';
      });
    });
  });

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
