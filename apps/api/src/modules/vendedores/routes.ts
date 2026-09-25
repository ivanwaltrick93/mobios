import {
  COLUNAS_IMPORTACAO_VENDEDORES,
  idParamSchema,
  resultadoImportacaoSchema,
  statusInputSchema,
  usuarioElegivelSchema,
  usuariosElegiveisQuerySchema,
  vendedorEventoSchema,
  vendedorFiltroSchema,
  vendedorInputSchema,
  vendedorResumoSchema,
  vendedorSchema,
  type Vendedor,
} from '@mobios/shared';
import { and, asc, count, desc, eq, ilike, inArray, ne, notInArray, or, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { funcoes, usuarioFuncoes, users, vendedores, vendedoresEventos } from '../../db/schema.js';
import { nomeUsuario } from '../../lib/cadastro.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import {
  aceitarUploadDeCsv,
  colunaDoCampo,
  exigirPrimeiraVez,
  importarLinhas,
  lerDataPlanilha,
  lerPlanilhaEnviada,
  lerSimNao,
  validarLinha,
} from '../../lib/importacao.js';
import {
  compararVendedor,
  exigirUsuarioVendedor,
  registrarEvento,
  rotuloUsuario,
  usuariosHabilitados,
  type RetratoVendedor,
} from './regras.js';

type DadosVendedor = z.output<typeof vendedorInputSchema>;
type Origem = 'cadastro' | 'importacao';

async function carregar(tx: Tx, id: string): Promise<Vendedor> {
  const [vendedor] = await tx
    .select({
      id: vendedores.id,
      codigo: vendedores.codigo,
      matricula: vendedores.matricula,
      whatsapp: vendedores.whatsapp,
      funcionarioDesde: vendedores.funcionarioDesde,
      ativo: vendedores.ativo,
      criadoEm: vendedores.criadoEm,
      atualizadoEm: vendedores.atualizadoEm,
      criadoPor: nomeUsuario('vendedores', 'criado_por'),
      atualizadoPor: nomeUsuario('vendedores', 'atualizado_por'),
      usuario: {
        id: users.id,
        codigo: users.codigo,
        nome: users.nome,
        email: users.email,
        ativo: users.ativo,
        criadoEm: users.criadoEm,
      },
    })
    .from(vendedores)
    .innerJoin(users, eq(users.id, vendedores.usuarioId))
    .where(eq(vendedores.id, id));
  if (!vendedor) throw naoEncontrado('Vendedor');
  const funcoesDoUsuario = await tx
    .select({ nome: funcoes.nome })
    .from(usuarioFuncoes)
    .innerJoin(funcoes, and(eq(funcoes.id, usuarioFuncoes.funcaoId), eq(funcoes.ativa, true)))
    .where(eq(usuarioFuncoes.usuarioId, vendedor.usuario.id))
    .orderBy(asc(funcoes.nome));
  return { ...vendedor, usuario: { ...vendedor.usuario, funcoes: funcoesDoUsuario.map((f) => f.nome) } };
}

async function criarVendedor(tx: Tx, dados: DadosVendedor, ativo: boolean, origem: Origem, responsavelId: string) {
  const usuario = await exigirUsuarioVendedor(tx, dados.usuarioId);
  const [criado] = await tx
    .insert(vendedores)
    .values({ ...dados, ativo, criadoPor: responsavelId, atualizadoPor: responsavelId })
    .returning({ id: vendedores.id });
  await registrarEvento(tx, {
    vendedorId: criado!.id,
    evento: 'criado',
    origem,
    alteracoes: compararVendedor(null, { ...dados, usuario: rotuloUsuario(usuario), ativo }),
    usuarioId: responsavelId,
  });
  return criado!.id;
}

/**
 * Altera o vendedor e registra no log só o que mudou. `ativo` ausente mantém a situação. Trocar o usuário ou
 * reativar exige usuário ativo e com função de vendedor. Sem mudança = 'ignorada' (nada é gravado).
 */
async function atualizarVendedor(
  tx: Tx,
  id: string,
  dados: DadosVendedor & { ativo?: boolean },
  origem: Origem,
  responsavelId: string,
): Promise<'importada' | 'ignorada'> {
  const [atual] = await tx
    .select({
      usuarioId: vendedores.usuarioId,
      matricula: vendedores.matricula,
      whatsapp: vendedores.whatsapp,
      funcionarioDesde: vendedores.funcionarioDesde,
      ativo: vendedores.ativo,
      usuarioCodigo: users.codigo,
      usuarioNome: users.nome,
    })
    .from(vendedores)
    .innerJoin(users, eq(users.id, vendedores.usuarioId))
    .where(eq(vendedores.id, id))
    .for('update', { of: vendedores });
  if (!atual) throw naoEncontrado('Vendedor');

  const ativo = dados.ativo ?? atual.ativo;
  const usuarioAtual = rotuloUsuario({ codigo: atual.usuarioCodigo, nome: atual.usuarioNome });
  let usuario = usuarioAtual;
  if (dados.usuarioId !== atual.usuarioId || (ativo && !atual.ativo)) {
    usuario = rotuloUsuario(await exigirUsuarioVendedor(tx, dados.usuarioId));
  }
  const antes: RetratoVendedor = { ...atual, usuario: usuarioAtual };
  const alteracoes = compararVendedor(antes, { ...dados, usuario, ativo });
  if (alteracoes.length === 0) return 'ignorada';

  await tx
    .update(vendedores)
    .set({
      usuarioId: dados.usuarioId,
      matricula: dados.matricula,
      whatsapp: dados.whatsapp,
      funcionarioDesde: dados.funcionarioDesde,
      ativo,
      atualizadoPor: responsavelId,
    })
    .where(eq(vendedores.id, id));
  const soSituacao = alteracoes.length === 1 && alteracoes[0]!.campo === 'Situação';
  await registrarEvento(tx, {
    vendedorId: id,
    evento: soSituacao ? (ativo ? 'reativado' : 'inativado') : 'alterado',
    origem,
    alteracoes,
    usuarioId: responsavelId,
  });
  return 'importada';
}

/** Vendedores: exclusivo do Administrador (fica em Equipe). Não há exclusão, só inativação. */
export const vendedoresRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAdmin);
  aceitarUploadDeCsv(app);

  app.get(
    '/',
    {
      schema: {
        querystring: vendedorFiltroSchema,
        response: { 200: z.object({ itens: z.array(vendedorResumoSchema), total: z.number() }) },
      },
    },
    async (req) => {
      const { q, situacao, pagina, porPagina } = req.query;
      const filtros: SQL[] = [];
      if (situacao !== 'todos') filtros.push(eq(vendedores.ativo, situacao === 'ativos'));
      if (q) {
        const codigo = /^\d{1,9}$/.test(q) ? Number(q) : null;
        filtros.push(
          or(
            ilike(users.nome, `%${q}%`),
            ilike(vendedores.matricula, `%${q}%`),
            ...(codigo ? [eq(vendedores.codigo, codigo)] : []),
          )!,
        );
      }
      const onde = and(...filtros);
      return withTenant(req.user.tid, async (tx) => {
        const itens = await tx
          .select({
            id: vendedores.id,
            codigo: vendedores.codigo,
            nome: users.nome,
            matricula: vendedores.matricula,
            ativo: vendedores.ativo,
          })
          .from(vendedores)
          .innerJoin(users, eq(users.id, vendedores.usuarioId))
          .where(onde)
          .orderBy(asc(vendedores.codigo))
          .limit(porPagina)
          .offset((pagina - 1) * porPagina);
        const [{ total }] = (await tx
          .select({ total: count() })
          .from(vendedores)
          .innerJoin(users, eq(users.id, vendedores.usuarioId))
          .where(onde)) as [{ total: number }];
        return { itens, total };
      });
    },
  );

  /** Usuários que podem virar vendedor: ativos, com função de vendedor e sem vendedor (exceto o deste). */
  app.get(
    '/usuarios-elegiveis',
    { schema: { querystring: usuariosElegiveisQuerySchema, response: { 200: z.array(usuarioElegivelSchema) } } },
    async (req) =>
      withTenant(req.user.tid, (tx) => {
        const { vendedorId } = req.query;
        const vinculados = tx
          .select({ id: vendedores.usuarioId })
          .from(vendedores)
          .where(vendedorId ? ne(vendedores.id, vendedorId) : undefined);
        return tx
          .select({ id: users.id, codigo: users.codigo, nome: users.nome, email: users.email })
          .from(users)
          .where(
            and(eq(users.ativo, true), inArray(users.id, usuariosHabilitados(tx)), notInArray(users.id, vinculados)),
          )
          .orderBy(asc(users.nome));
      }),
  );

  app.get('/:id', { schema: { params: idParamSchema, response: { 200: vendedorSchema } } }, async (req) =>
    withTenant(req.user.tid, (tx) => carregar(tx, req.params.id)),
  );

  app.get(
    '/:id/eventos',
    { schema: { params: idParamSchema, response: { 200: z.array(vendedorEventoSchema) } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const [existe] = await tx
          .select({ id: vendedores.id })
          .from(vendedores)
          .where(eq(vendedores.id, req.params.id));
        if (!existe) throw naoEncontrado('Vendedor');
        return tx
          .select({
            id: vendedoresEventos.id,
            evento: vendedoresEventos.evento,
            origem: vendedoresEventos.origem,
            motivo: vendedoresEventos.motivo,
            alteracoes: vendedoresEventos.alteracoes,
            usuario: users.nome,
            criadoEm: vendedoresEventos.criadoEm,
          })
          .from(vendedoresEventos)
          .leftJoin(users, eq(users.id, vendedoresEventos.usuarioId))
          .where(eq(vendedoresEventos.vendedorId, req.params.id))
          .orderBy(desc(vendedoresEventos.criadoEm));
      }),
  );

  app.post('/', { schema: { body: vendedorInputSchema, response: { 201: vendedorSchema } } }, async (req, reply) => {
    const vendedor = await withTenant(req.user.tid, async (tx) =>
      carregar(tx, await criarVendedor(tx, req.body, true, 'cadastro', req.user.sub)),
    );
    return reply.code(201).send(vendedor);
  });

  app.put(
    '/:id',
    { schema: { params: idParamSchema, body: vendedorInputSchema, response: { 200: vendedorSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        await atualizarVendedor(tx, req.params.id, req.body, 'cadastro', req.user.sub);
        return carregar(tx, req.params.id);
      }),
  );

  app.patch(
    '/:id/status',
    { schema: { params: idParamSchema, body: statusInputSchema, response: { 200: vendedorSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const atual = await carregar(tx, req.params.id);
        await atualizarVendedor(
          tx,
          atual.id,
          {
            usuarioId: atual.usuario.id,
            matricula: atual.matricula,
            whatsapp: atual.whatsapp,
            funcionarioDesde: atual.funcionarioDesde,
            ativo: req.body.ativo,
          },
          'cadastro',
          req.user.sub,
        );
        return carregar(tx, atual.id);
      }),
  );

  /**
   * Vendedores em massa por CSV (COLUNAS_IMPORTACAO_VENDEDORES). Sem código = cadastra; código existente =
   * atualiza; colunas opcionais ausentes não mudam o vendedor. Grava as linhas válidas e relata as demais.
   */
  app.post('/importar', { schema: { response: { 200: resultadoImportacaoSchema } } }, async (req) => {
    const linhas = lerPlanilhaEnviada(req.body, COLUNAS_IMPORTACAO_VENDEDORES);
    return withTenant(req.user.tid, async (tx) => {
      // Referências lidas uma vez (não uma consulta por linha).
      const emails = [...new Set(linhas.map((l) => (l.valores.usuario_email ?? '').trim().toLowerCase()))];
      const usuariosPorEmail = new Map(
        (await tx.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, emails))).map(
          (u) => [u.email, u.id],
        ),
      );
      const cadastrados = await tx
        .select({
          id: vendedores.id,
          codigo: vendedores.codigo,
          matricula: vendedores.matricula,
          funcionarioDesde: vendedores.funcionarioDesde,
        })
        .from(vendedores);
      const existentes = new Map(cadastrados.map((v) => [v.codigo, v]));
      const codigosVistos = new Map<string, number>();
      const emailsVistos = new Map<string, number>();

      return importarLinhas(tx, linhas, async (savepoint, { numero, valores }) => {
        const valor = (coluna: string) => (valores[coluna] ?? '').trim();
        const temColuna = (coluna: string) => coluna in valores;

        const codigo = valor('codigo');
        let atual: (typeof cadastrados)[number] | undefined;
        if (codigo) {
          if (!/^\d{1,9}$/.test(codigo)) throw new ErroHttp(400, `codigo: use só números (recebido "${codigo}").`);
          exigirPrimeiraVez(codigosVistos, codigo, numero, `Código ${codigo}`);
          atual = existentes.get(Number(codigo));
          if (!atual)
            throw new ErroHttp(400, `codigo: vendedor ${codigo} não encontrado. Deixe vazio para cadastrar um novo.`);
        }

        const email = valor('usuario_email').toLowerCase();
        if (!email) throw new ErroHttp(400, 'usuario_email: informe o e-mail de login do usuário.');
        exigirPrimeiraVez(emailsVistos, email, numero, `Usuário ${email}`);
        const usuarioId = usuariosPorEmail.get(email);
        if (!usuarioId) throw new ErroHttp(400, `usuario_email: nenhum usuário desta oficina com o e-mail ${email}.`);

        const dados = validarLinha(
          vendedorInputSchema,
          {
            usuarioId,
            whatsapp: valor('whatsapp'),
            matricula: temColuna('matricula') ? valor('matricula') : atual?.matricula,
            funcionarioDesde: temColuna('funcionario_desde')
              ? lerDataPlanilha(valor('funcionario_desde'), 'funcionario_desde')
              : atual?.funcionarioDesde,
          },
          ([campo]) => (campo === 'usuarioId' ? 'usuario_email' : colunaDoCampo(campo!)),
        );
        const ativo = lerSimNao(valor('ativo'), 'ativo');
        if (atual) return atualizarVendedor(savepoint, atual.id, { ...dados, ativo }, 'importacao', req.user.sub);
        await criarVendedor(savepoint, dados, ativo ?? true, 'importacao', req.user.sub);
        return 'importada';
      });
    });
  });
};
