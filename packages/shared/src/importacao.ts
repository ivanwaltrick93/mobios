import { z } from 'zod';

/*
 * Importação em massa por planilha CSV (preços e estoque). A primeira linha é sempre o cabeçalho;
 * as colunas são reconhecidas pelo nome. Estas listas alimentam a tela (instruções e modelo) e a API
 * (colunas obrigatórias), para as duas nunca divergirem.
 */

export type ColunaImportacao = {
  nome: string;
  obrigatoria: boolean;
  descricao: string;
  exemplo: string;
};

/** Limites por arquivo (conferidos na API). */
export const IMPORTACAO_TAMANHO_MAXIMO = 1024 * 1024;
export const IMPORTACAO_LINHAS_MAXIMAS = 5000;

/**
 * Preços de materiais e serviços: `tipo` diz de qual é a linha e `codigo` traz o SKU do material ou o código do
 * serviço. A coluna antiga `sku` continua aceita no lugar de `codigo` (linha de material).
 */
export const COLUNAS_IMPORTACAO_PRECOS: ColunaImportacao[] = [
  { nome: 'tabela', obrigatoria: true, descricao: 'Código da tabela de preço', exemplo: 'VAREJO' },
  {
    nome: 'tipo',
    obrigatoria: false,
    descricao: 'produto ou servico. Vazio = produto',
    exemplo: 'material',
  },
  {
    nome: 'codigo',
    obrigatoria: false,
    descricao: 'SKU do produto ou código do serviço (precisa estar cadastrado). A coluna "sku" também é aceita',
    exemplo: 'FIL-001',
  },
  {
    nome: 'preco',
    obrigatoria: true,
    descricao: 'Valor em reais, com vírgula decimal e sem separador de milhar. Serviço no valor-hora: valor da hora',
    exemplo: '150,00',
  },
  {
    nome: 'inicio',
    obrigatoria: false,
    descricao: 'Início da vigência (dd/mm/aaaa, hoje ou depois). Vazio = preço padrão, sem vigência',
    exemplo: '01/12/2026',
  },
  {
    nome: 'fim',
    obrigatoria: false,
    descricao: 'Fim da vigência (dd/mm/aaaa). Vazio = sem data de fim',
    exemplo: '',
  },
];

/** Linhas de Preço: a tabela vem da tela; a coluna `tabela` só é preciso quando a linha é de outra tabela. */
export const COLUNAS_IMPORTACAO_LINHAS_PRECO: ColunaImportacao[] = COLUNAS_IMPORTACAO_PRECOS.map((c) =>
  c.nome === 'tabela'
    ? { ...c, obrigatoria: false, descricao: 'Código da tabela de preço. Vazio = tabela selecionada na tela' }
    : c,
);

const SIM_NAO = 'sim ou não';

/**
 * Clientes: uma linha por cliente, com um endereço (o principal) e, na PJ, um responsável (o principal).
 * CPF/CNPJ já cadastrado = atualiza o cliente (colunas ausentes do arquivo não mudam; o endereço e o
 * responsável da linha substituem os principais, e os demais ficam como estão).
 */
export const COLUNAS_IMPORTACAO_CLIENTES: ColunaImportacao[] = [
  { nome: 'tipo', obrigatoria: true, descricao: 'PF (pessoa física) ou PJ (pessoa jurídica)', exemplo: 'PF' },
  { nome: 'nome', obrigatoria: true, descricao: 'Nome ou razão social', exemplo: 'Maria da Silva' },
  {
    nome: 'cpf_cnpj',
    obrigatoria: true,
    descricao: 'CPF (PF) ou CNPJ (PJ), com ou sem pontuação. Já cadastrado = atualiza o cliente',
    exemplo: '529.982.247-25',
  },
  { nome: 'telefone', obrigatoria: true, descricao: 'Com DDD', exemplo: '(48) 3222-1000' },
  { nome: 'whatsapp', obrigatoria: true, descricao: 'Com DDD', exemplo: '(48) 99999-0000' },
  { nome: 'email', obrigatoria: false, descricao: 'E-mail', exemplo: 'maria@email.com' },
  { nome: 'rg_ie', obrigatoria: false, descricao: 'RG (PF) ou inscrição estadual (PJ)', exemplo: '' },
  { nome: 'data_nascimento', obrigatoria: false, descricao: 'Só PF (dd/mm/aaaa)', exemplo: '15/03/1985' },
  {
    nome: 'sexo',
    obrigatoria: false,
    descricao: 'Só PF: masculino, feminino, outro ou nao_informado',
    exemplo: 'feminino',
  },
  {
    nome: 'cliente_desde',
    obrigatoria: false,
    descricao: 'dd/mm/aaaa. Vazio = hoje (cliente novo)',
    exemplo: '10/01/2024',
  },
  {
    nome: 'origem',
    obrigatoria: false,
    descricao: 'Nome da origem, como em Configurações → Origem do cliente',
    exemplo: 'Indicação',
  },
  {
    nome: 'relacionamento',
    obrigatoria: false,
    descricao: 'Nome do tipo de relacionamento, como em Configurações → Tipo de relacionamento',
    exemplo: '',
  },
  { nome: 'ativo', obrigatoria: false, descricao: `${SIM_NAO}. Vazio = sim`, exemplo: 'sim' },
  { nome: 'observacoes', obrigatoria: false, descricao: 'Texto livre', exemplo: '' },
  {
    nome: 'tipo_endereco',
    obrigatoria: false,
    descricao: 'residencial, comercial ou outro. Vazio = residencial (PF) ou comercial (PJ)',
    exemplo: 'residencial',
  },
  { nome: 'cep', obrigatoria: true, descricao: 'CEP do endereço principal', exemplo: '88015-100' },
  { nome: 'logradouro', obrigatoria: true, descricao: 'Rua, avenida...', exemplo: 'Rua Felipe Schmidt' },
  { nome: 'numero', obrigatoria: true, descricao: 'Número (ou S/N)', exemplo: '100' },
  { nome: 'complemento', obrigatoria: false, descricao: 'Complemento', exemplo: 'Sala 2' },
  { nome: 'bairro', obrigatoria: true, descricao: 'Bairro', exemplo: 'Centro' },
  { nome: 'cidade', obrigatoria: true, descricao: 'Cidade', exemplo: 'Florianópolis' },
  { nome: 'uf', obrigatoria: true, descricao: 'Sigla do estado', exemplo: 'SC' },
  { nome: 'responsavel_nome', obrigatoria: false, descricao: 'Obrigatório na PJ', exemplo: '' },
  {
    nome: 'responsavel_funcao',
    obrigatoria: false,
    descricao: 'Obrigatório na PJ: nome da função, como em Configurações → Função do responsável',
    exemplo: '',
  },
  { nome: 'responsavel_telefone', obrigatoria: false, descricao: 'Obrigatório na PJ, com DDD', exemplo: '' },
  {
    nome: 'responsavel_whatsapp',
    obrigatoria: false,
    descricao: `O telefone do responsável é WhatsApp? ${SIM_NAO}`,
    exemplo: '',
  },
  { nome: 'responsavel_email', obrigatoria: false, descricao: 'E-mail do responsável', exemplo: '' },
];

/** Materiais: SKU já cadastrado = atualiza o material (colunas ausentes do arquivo não mudam). */
export const COLUNAS_IMPORTACAO_MATERIAIS: ColunaImportacao[] = [
  { nome: 'sku', obrigatoria: true, descricao: 'Código do produto. Já cadastrado = atualiza', exemplo: 'FIL-001' },
  { nome: 'descricao', obrigatoria: true, descricao: 'Descrição', exemplo: 'Filtro de óleo W712' },
  {
    nome: 'tipo',
    obrigatoria: true,
    descricao: 'Nome do tipo de produto (Configurações → Tipo de produto)',
    exemplo: 'Peça',
  },
  {
    nome: 'categoria',
    obrigatoria: true,
    descricao: 'Código da categoria ou caminho completo (ex.: Peças > Motor > Filtros)',
    exemplo: 'Peças > Filtros',
  },
  {
    nome: 'unidade',
    obrigatoria: true,
    descricao: 'UN, PC, PAR, JG, KIT, CX, L, ML, KG, G ou M',
    exemplo: 'UN',
  },
  { nome: 'marca', obrigatoria: false, descricao: 'Nome ou código da marca', exemplo: 'Mann Filter' },
  {
    nome: 'pmc',
    obrigatoria: false,
    descricao:
      'PMC (preço médio de compra) em reais, com vírgula decimal. Exige "Custos e margem" em Editar; vazio = sem PMC',
    exemplo: '',
  },
  { nome: 'descricao_curta', obrigatoria: false, descricao: 'Até 40 caracteres', exemplo: '' },
  { nome: 'codigo_fabricante', obrigatoria: false, descricao: 'Part number', exemplo: 'W712' },
  { nome: 'codigo_barras', obrigatoria: false, descricao: 'EAN/GTIN', exemplo: '7891000315507' },
  { nome: 'ncm', obrigatoria: false, descricao: '8 dígitos', exemplo: '84212300' },
  { nome: 'cest', obrigatoria: false, descricao: '7 dígitos', exemplo: '' },
  { nome: 'origem', obrigatoria: false, descricao: 'Origem fiscal de 0 a 8', exemplo: '0' },
  { nome: 'controla_estoque', obrigatoria: false, descricao: `${SIM_NAO}. Vazio = sim`, exemplo: '' },
  { nome: 'permite_venda', obrigatoria: false, descricao: `${SIM_NAO}. Vazio = sim`, exemplo: '' },
  { nome: 'permite_compra', obrigatoria: false, descricao: `${SIM_NAO}. Vazio = sim`, exemplo: '' },
  { nome: 'permite_uso_os', obrigatoria: false, descricao: `${SIM_NAO}. Vazio = sim`, exemplo: '' },
  { nome: 'controla_lote', obrigatoria: false, descricao: `${SIM_NAO}. Vazio = não`, exemplo: '' },
  { nome: 'controla_serie', obrigatoria: false, descricao: `${SIM_NAO}. Vazio = não`, exemplo: '' },
  {
    nome: 'multiplo',
    obrigatoria: false,
    descricao: 'Vendido só em múltiplos desta quantidade (caixa master), inteiro. Vazio = 1',
    exemplo: '1',
  },
  {
    nome: 'leadtime_dias',
    obrigatoria: false,
    descricao: 'Tempo de ressuprimento em dias corridos, inteiro. Vazio = 30',
    exemplo: '30',
  },
];

/**
 * Categorias: processadas na ordem do arquivo (a categoria pai pode vir numa linha anterior).
 * Mesmo código, ou mesmo nome sob o mesmo pai = atualiza a existente.
 */
export const COLUNAS_IMPORTACAO_CATEGORIAS: ColunaImportacao[] = [
  { nome: 'nome', obrigatoria: true, descricao: 'Nome da categoria', exemplo: 'Filtros' },
  { nome: 'codigo', obrigatoria: false, descricao: 'Código (único na oficina)', exemplo: 'FIL' },
  {
    nome: 'pai',
    obrigatoria: false,
    descricao: 'Código ou caminho da categoria pai (ex.: Peças > Motor). Vazio = categoria principal',
    exemplo: 'Peças',
  },
  { nome: 'descricao', obrigatoria: false, descricao: 'Descrição', exemplo: '' },
];

export const COLUNAS_IMPORTACAO_ESTOQUE: ColunaImportacao[] = [
  { nome: 'sku', obrigatoria: true, descricao: 'SKU do produto (precisa estar cadastrado)', exemplo: 'FIL-001' },
  { nome: 'deposito', obrigatoria: true, descricao: 'Código do depósito (precisa estar cadastrado)', exemplo: 'LOJA' },
  {
    nome: 'disponivel',
    obrigatoria: true,
    descricao: 'Quantidade total no depósito (substitui a atual), com vírgula decimal',
    exemplo: '12',
  },
  {
    nome: 'reservado',
    obrigatoria: false,
    descricao: 'Parte do disponível reservada (não pode passar do disponível). Vazio = mantém o reservado atual',
    exemplo: '0',
  },
  {
    nome: 'motivo',
    obrigatoria: false,
    descricao: 'Motivo registrado no histórico. Vazio = "Importação de planilha"',
    exemplo: 'Inventário de dezembro',
  },
];

/**
 * Vendedores: sem código = cadastra (o código é gerado); código já cadastrado = atualiza. Nome e e-mail vêm
 * do usuário vinculado. Colunas opcionais ausentes não mudam o vendedor existente.
 */
export const COLUNAS_IMPORTACAO_VENDEDORES: ColunaImportacao[] = [
  {
    nome: 'codigo',
    obrigatoria: false,
    descricao: 'Código do vendedor. Vazio = novo vendedor; já cadastrado = atualiza',
    exemplo: '',
  },
  {
    nome: 'usuario_email',
    obrigatoria: true,
    descricao: 'E-mail de login do usuário (ativo, com função de parâmetro Vendedor)',
    exemplo: 'ana@oficina.com.br',
  },
  { nome: 'whatsapp', obrigatoria: true, descricao: 'Com DDD', exemplo: '(48) 99999-0000' },
  {
    nome: 'matricula',
    obrigatoria: false,
    descricao: 'Matrícula do colaborador (única na oficina)',
    exemplo: 'M-0042',
  },
  { nome: 'funcionario_desde', obrigatoria: false, descricao: 'dd/mm/aaaa', exemplo: '01/03/2024' },
  {
    nome: 'ativo',
    obrigatoria: false,
    descricao: `${SIM_NAO}. Vazio = sim no cadastro; mantém na atualização`,
    exemplo: '',
  },
];

/** Serviços: sem código = cadastra (o código é gerado); código já cadastrado = atualiza. */
export const COLUNAS_IMPORTACAO_SERVICOS: ColunaImportacao[] = [
  {
    nome: 'codigo',
    obrigatoria: false,
    descricao: 'Código do serviço. Vazio = novo serviço; já cadastrado = atualiza',
    exemplo: '',
  },
  { nome: 'nome', obrigatoria: true, descricao: 'Nome do serviço', exemplo: 'Troca de óleo e filtro' },
  { nome: 'descricao', obrigatoria: false, descricao: 'Descrição', exemplo: '' },
  {
    nome: 'forma_preco',
    obrigatoria: false,
    descricao: 'fechado (preço do serviço) ou hora (valor-hora). Vazio = fechado',
    exemplo: 'fechado',
  },
  {
    nome: 'horas',
    obrigatoria: false,
    descricao: 'Horas de trabalho em horas:minutos (ex.: 1:30). Obrigatória no valor-hora',
    exemplo: '0:45',
  },
  {
    nome: 'classificacao',
    obrigatoria: false,
    descricao: 'Nome da classificação, como em Configurações → Classificação de serviço',
    exemplo: 'Mecânica',
  },
  { nome: 'garantia_dias', obrigatoria: false, descricao: 'Garantia em dias, inteiro', exemplo: '90' },
  { nome: 'garantia_km', obrigatoria: false, descricao: 'Garantia em km, inteiro', exemplo: '5000' },
  { nome: 'observacao', obrigatoria: false, descricao: 'Texto livre', exemplo: '' },
  {
    nome: 'ativo',
    obrigatoria: false,
    descricao: `${SIM_NAO}. Vazio = sim no cadastro; mantém na atualização`,
    exemplo: '',
  },
];

export const resultadoImportacaoSchema = z.object({
  /** Linhas de dados lidas (sem o cabeçalho e sem linhas em branco). */
  linhas: z.number(),
  importadas: z.number(),
  /** Linhas válidas que não mudavam nada (mesmo valor já gravado). */
  ignoradas: z.number(),
  /** Linhas não gravadas, com o número da linha na planilha (o cabeçalho é a linha 1). */
  erros: z.array(z.object({ linha: z.number(), mensagem: z.string() })),
});
export type ResultadoImportacao = z.infer<typeof resultadoImportacaoSchema>;
