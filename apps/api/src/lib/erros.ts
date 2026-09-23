import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

/** Erro de regra de negócio com status HTTP e mensagem exibível ao usuário. */
export class ErroHttp extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const naoEncontrado = (o: string) => new ErroHttp(404, `${o} não encontrado`);

type ErroPg = { code?: string; constraint_name?: string };

function erroPostgres(err: unknown): ErroPg | undefined {
  // O Drizzle embrulha o erro do driver em `cause`.
  const e = (err as { cause?: unknown })?.cause ?? err;
  return typeof (e as ErroPg)?.code === 'string' ? (e as ErroPg) : undefined;
}

const mensagensUnicidade: Record<string, string> = {
  users_email_index: 'Já existe uma conta com este e-mail',
  clientes_tenant_id_cpf_cnpj_index: 'Já existe um cliente com este CPF/CNPJ',
  veiculos_tenant_id_placa_index: 'Já existe um veículo com esta placa',
  funcoes_nome_unico: 'Já existe uma função com este nome',
  origens_cliente_nome_unico: 'Já existe um item com este nome',
  relacionamentos_cliente_nome_unico: 'Já existe um item com este nome',
  cargos_responsavel_nome_unico: 'Já existe um item com este nome',
  tipos_material_nome_unico: 'Já existe um item com este nome',
  tipos_deposito_nome_unico: 'Já existe um item com este nome',
  materiais_sku_unico: 'Já existe um material com este SKU',
  materiais_codigo_barras_unico: 'Já existe um material com este código de barras',
  categorias_codigo_unico: 'Já existe uma categoria com este código',
  categorias_nome_unico: 'Já existe uma categoria com este nome neste nível',
  marcas_codigo_unico: 'Já existe uma marca com este código',
  marcas_nome_unico: 'Já existe uma marca com este nome',
  depositos_codigo_unico: 'Já existe um depósito com este código',
  depositos_nome_unico: 'Já existe um depósito com este nome',
  tabelas_preco_codigo_unico: 'Já existe uma tabela de preço com este código',
  tabelas_preco_nome_unico: 'Já existe uma tabela de preço com este nome',
  // Duas pessoas criando o primeiro saldo do mesmo material no mesmo depósito ao mesmo tempo.
  estoques_material_id_deposito_id_pk:
    'O saldo foi alterado por outra pessoa enquanto você editava. Recarregue e refaça o ajuste.',
  veiculos_tenant_id_chassi_index: 'Já existe um veículo com este chassi',
};

/** Violações de CHECK/trigger com mensagem própria (as demais caem em "Dados inválidos"). */
const mensagensCheck: Record<string, string> = {
  categorias_sem_ciclo: 'Uma categoria não pode ficar abaixo dela mesma nem de uma subcategoria sua.',
  categorias_pai_diferente: 'Uma categoria não pode ser pai dela mesma.',
  materiais_precos_vigencia_valida: 'O fim da vigência deve ser igual ou posterior ao início.',
  materiais_precos_valor_positivo: 'O preço não pode ser negativo.',
  estoques_disponivel_positivo: 'O disponível não pode ser negativo.',
  estoques_reservado_positivo: 'O reservado não pode ser negativo.',
};

export function registrarTratamentoDeErros(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      const campos: Record<string, string> = {};
      for (const v of err.validation) {
        const campo = v.instancePath.replace(/^\//, '').replaceAll('/', '.') || '_';
        campos[campo] ??= v.message ?? 'Valor inválido';
      }
      return reply.code(400).send({ erro: 'Dados inválidos', campos });
    }
    if (err instanceof ErroHttp) return reply.code(err.status).send({ erro: err.message });

    const pg = erroPostgres(err);
    if (pg?.code === '23505') {
      return reply.code(409).send({ erro: mensagensUnicidade[pg.constraint_name ?? ''] ?? 'Registro duplicado' });
    }
    if (pg?.code === '23514') {
      return reply.code(400).send({ erro: mensagensCheck[pg.constraint_name ?? ''] ?? 'Dados inválidos' });
    }
    // Constraint EXCLUDE: duas vigências do mesmo material e tabela no mesmo período.
    if (pg?.code === '23P01') {
      return reply
        .code(409)
        .send({ erro: 'Já existe preço deste material nesta tabela em parte do período informado.' });
    }
    if (pg?.code === '23503') {
      return reply.code(409).send({ erro: 'Registro vinculado a outros dados ou referência inexistente' });
    }
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ erro: 'Arquivo grande demais.' });
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE')
      return reply.code(415).send({ erro: 'Formato de arquivo não suportado.' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ erro: err.message });

    req.log.error(err);
    return reply.code(500).send({ erro: 'Erro interno' });
  });
}
