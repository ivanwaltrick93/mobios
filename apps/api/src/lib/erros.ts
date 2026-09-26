import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

/**
 * Erro de regra de negócio com status HTTP e mensagem exibível ao usuário.
 * `campos` (opcional) aponta o campo do formulário com problema, como na validação do schema.
 */
export class ErroHttp extends Error {
  constructor(
    public status: number,
    message: string,
    public campos?: Record<string, string>,
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
  os_checklist_item_unico: 'Há itens repetidos no checklist',
  funcoes_nome_unico: 'Já existe uma função com este nome',
  alcadas_desconto_funcao_unica: 'A alçada desta função foi alterada por outra pessoa. Recarregue a página.',
  aprovacoes_comerciais_uma_pendente: 'Este documento já tem uma aprovação comercial pendente. Recarregue a página.',
  origens_cliente_nome_unico: 'Já existe um item com este nome',
  relacionamentos_cliente_nome_unico: 'Já existe um item com este nome',
  cargos_responsavel_nome_unico: 'Já existe um item com este nome',
  tipos_material_nome_unico: 'Já existe um item com este nome',
  tipos_deposito_nome_unico: 'Já existe um item com este nome',
  materiais_sku_unico: 'Já existe um produto com este SKU',
  materiais_codigo_barras_unico: 'Já existe um produto com este código de barras',
  categorias_codigo_unico: 'Já existe uma categoria com este código',
  categorias_nome_unico: 'Já existe uma categoria com este nome neste nível',
  marcas_codigo_unico: 'Já existe uma marca com este código',
  marcas_nome_unico: 'Já existe uma marca com este nome',
  depositos_codigo_unico: 'Já existe um depósito com este código',
  depositos_nome_unico: 'Já existe um depósito com este nome',
  tabelas_preco_codigo_unico: 'Já existe uma tabela de preço com este código',
  tabelas_preco_nome_unico: 'Já existe uma tabela de preço com este nome',
  // Duas pessoas criando o primeiro saldo do mesmo material no mesmo depósito ao mesmo tempo.
  precos_padrao_unico: 'O preço padrão foi alterado por outra pessoa. Recarregue e refaça a alteração.',
  precos_padrao_servico_unico: 'O preço padrão foi alterado por outra pessoa. Recarregue e refaça a alteração.',
  estoques_material_id_deposito_id_pk:
    'O saldo foi alterado por outra pessoa enquanto você editava. Recarregue e refaça o ajuste.',
  veiculos_tenant_id_chassi_index: 'Já existe um veículo com este chassi',
  vendedores_usuario_unico: 'Este usuário já está vinculado a outro vendedor',
  vendedores_matricula_unico: 'Já existe um vendedor com esta matrícula',
  tabelas_preco_padrao_unico: 'Outra tabela foi marcada como padrão ao mesmo tempo. Recarregue a página.',
  // Duas pessoas gerando a nova versão do mesmo orçamento ao mesmo tempo.
  orcamentos_uma_versao_viva: 'Este orçamento já tem uma versão em aberto. Recarregue a página.',
  orcamentos_numero_versao_unico: 'Este orçamento já tem uma versão em aberto. Recarregue a página.',
};

/** Violações de CHECK/trigger com mensagem própria (as demais caem em "Dados inválidos"). */
const mensagensCheck: Record<string, string> = {
  categorias_sem_ciclo: 'Uma categoria não pode ficar abaixo dela mesma nem de uma subcategoria sua.',
  categorias_pai_diferente: 'Uma categoria não pode ser pai dela mesma.',
  materiais_precos_vigencia_valida: 'O fim da vigência deve ser igual ou posterior ao início.',
  materiais_precos_valor_positivo: 'O preço não pode ser negativo.',
  precos_padrao_valor_positivo: 'O preço não pode ser negativo.',
  estoques_disponivel_positivo: 'O disponível não pode ser negativo.',
  estoques_reservado_positivo: 'O reservado não pode ser negativo.',
  servicos_valor_hora_com_tempo: 'No valor-hora, informe as horas de referência.',
  servicos_tempo_positivo: 'As horas devem ser maiores que zero.',
  servicos_garantia_positiva: 'A garantia não pode ser negativa.',
  materiais_multiplo_positivo: 'O múltiplo deve ser um inteiro maior que zero.',
  materiais_leadtime_positivo: 'O leadtime não pode ser negativo.',
  estoques_reservado_ate_disponivel: 'O reservado não pode ser maior que o disponível.',
  users_codigo_imutavel: 'O código do usuário não pode ser alterado.',
  funcoes_codigo_imutavel: 'O código da função não pode ser alterado.',
  vendedores_codigo_imutavel: 'O código do vendedor não pode ser alterado.',
  tabelas_preco_padrao_ativa: 'A tabela padrão não pode ser inativada. Marque outra tabela como padrão antes.',
  orcamentos_numero_imutavel: 'O número e a versão do orçamento não podem ser alterados.',
  orcamento_itens_so_no_rascunho: 'Só o rascunho pode ter os itens alterados. Gere uma nova versão.',
  orcamento_itens_preco_negociado: 'O preço negociado não pode ficar acima do preço da tabela.',
  orcamento_itens_servico_sem_negociacao: 'Serviço não aceita negociação de preço.',
};

/**
 * Erros conhecidos (regra de negócio e constraints do Postgres) em status + mensagem exibível ao usuário.
 * `undefined` = erro inesperado (deve ser logado e virar 500). Usado pelo tratador central e pela
 * importação de planilhas, que relata o erro de cada linha sem interromper as demais.
 */
export function traduzirErro(
  err: unknown,
): { status: number; erro: string; campos?: Record<string, string> } | undefined {
  if (err instanceof ErroHttp) return { status: err.status, erro: err.message, campos: err.campos };
  const pg = erroPostgres(err);
  switch (pg?.code) {
    case '23505':
      return { status: 409, erro: mensagensUnicidade[pg.constraint_name ?? ''] ?? 'Registro duplicado' };
    case '23514':
      return { status: 400, erro: mensagensCheck[pg.constraint_name ?? ''] ?? 'Dados inválidos' };
    // Constraint EXCLUDE: duas vigências do mesmo material e tabela no mesmo período.
    case '23P01':
      return { status: 409, erro: 'Já existe preço deste item nesta tabela em parte do período informado.' };
    case '23503':
      return { status: 409, erro: 'Registro vinculado a outros dados ou referência inexistente' };
    default:
      return undefined;
  }
}

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
    const conhecido = traduzirErro(err);
    if (conhecido) return reply.code(conhecido.status).send({ erro: conhecido.erro, campos: conhecido.campos });

    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ erro: 'Arquivo grande demais.' });
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE')
      return reply.code(415).send({ erro: 'Formato de arquivo não suportado.' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ erro: err.message });

    req.log.error(err);
    return reply.code(500).send({ erro: 'Erro interno' });
  });
}
