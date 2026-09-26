import { z } from 'zod';

/**
 * Controle de acesso configurável por oficina (Configurações → Funções e permissões).
 * Cada função tem um nível por módulo; o usuário recebe o MAIOR nível entre as suas funções ativas.
 * A função Administrador é fixa: acesso total e exclusividade sobre usuários, funções e configurações.
 */

export const NIVEIS = ['consultar', 'editar'] as const;
export const nivelSchema = z.enum(NIVEIS);
export type Nivel = z.infer<typeof nivelSchema>;

export const nomesNivel: Record<Nivel | 'nenhum', string> = {
  nenhum: 'Sem acesso',
  consultar: 'Consultar',
  editar: 'Editar',
};

export const MODULOS = [
  {
    id: 'clientes',
    nome: 'Clientes e veículos',
    niveis: ['consultar', 'editar'],
    disponivel: true,
    descricao: 'Editar = cadastrar e alterar clientes e veículos.',
  },
  {
    id: 'orcamentos',
    nome: 'Orçamentos',
    niveis: ['consultar', 'editar'],
    disponivel: true,
    descricao: 'Editar = montar, negociar, emitir, marcar como enviado, gerar nova versão e cancelar orçamentos.',
  },
  {
    id: 'aprovar_orcamentos',
    nome: 'Aprovar orçamentos',
    niveis: ['editar'],
    disponivel: true,
    descricao: 'Editar = registrar a aprovação ou a recusa do cliente em orçamentos emitidos.',
  },
  {
    id: 'aprovacao_comercial',
    nome: 'Aprovação comercial',
    niveis: ['consultar', 'editar'],
    disponivel: true,
    descricao:
      'Consultar = ver as aprovações comerciais e o histórico. Editar = aprovar e reprovar descontos até a alçada ' +
      'da função (Configurações → Alçadas de desconto).',
  },
  {
    id: 'os',
    nome: 'Ordem de Serviço',
    niveis: ['consultar', 'editar'],
    disponivel: false,
    descricao: 'Editar = abrir O.S., diagnóstico, solicitar peças, execução e entrega.',
  },
  {
    id: 'pecas_os',
    nome: 'Peças na O.S.',
    niveis: ['editar'],
    disponivel: false,
    descricao: 'Editar = adicionar/separar peças em O.S. aberta, com baixa no estoque.',
  },
  {
    id: 'materiais',
    nome: 'Produtos',
    niveis: ['consultar', 'editar'],
    disponivel: true,
    descricao: 'Editar = cadastrar produtos, categorias, marcas e depósitos.',
  },
  {
    id: 'servicos',
    nome: 'Serviços',
    niveis: ['consultar', 'editar'],
    disponivel: true,
    descricao: 'Editar = cadastrar serviços (mão de obra). Os preços dos serviços seguem o módulo Preços.',
  },
  {
    id: 'precos',
    nome: 'Preços',
    niveis: ['consultar', 'editar'],
    disponivel: true,
    descricao: 'Editar = tabelas de preço e novas vigências de preço.',
  },
  {
    id: 'custos',
    nome: 'Custos e margem',
    niveis: ['consultar', 'editar'],
    disponivel: true,
    descricao:
      'Consultar = ver o PMC (preço médio de compra) no cadastro de produto e a análise de margem na aprovação ' +
      'comercial. Editar = alterar o PMC. Informação interna: não aparece para o vendedor.',
  },
  {
    id: 'estoque',
    nome: 'Estoque',
    niveis: ['consultar', 'editar'],
    disponivel: true,
    descricao:
      'Consultar = ver saldos por depósito. Editar = ajustar saldos (e, no futuro, entradas e venda no balcão).',
  },
  {
    id: 'recebimentos',
    nome: 'Recebimentos',
    niveis: ['consultar', 'editar'],
    disponivel: false,
    descricao: 'Editar = registrar pagamentos, na O.S. ou no Financeiro.',
  },
  {
    id: 'financeiro',
    nome: 'Financeiro',
    niveis: ['consultar', 'editar'],
    disponivel: false,
    descricao: 'Contas, caixa e faturamento. Consultar mostra o faturado na página inicial.',
  },
  {
    id: 'relatorios',
    nome: 'Relatórios',
    niveis: ['consultar'],
    disponivel: true,
    descricao: 'Consultar = visualizar e extrair em CSV.',
  },
] as const satisfies readonly {
  id: string;
  nome: string;
  niveis: readonly Nivel[];
  disponivel: boolean;
  descricao: string;
}[];

export type ModuloId = (typeof MODULOS)[number]['id'];
export const MODULO_IDS = MODULOS.map((m) => m.id) as [ModuloId, ...ModuloId[]];
export const moduloSchema = z.enum(MODULO_IDS);

/** Nível por módulo; null = sem acesso. */
export type Acessos = Record<ModuloId, Nivel | null>;

export const acessosSchema = z.object(
  Object.fromEntries(MODULO_IDS.map((id) => [id, nivelSchema.nullable()])) as Record<
    ModuloId,
    z.ZodNullable<typeof nivelSchema>
  >,
);

export const SEM_ACESSO: Acessos = Object.fromEntries(MODULO_IDS.map((id) => [id, null])) as Acessos;
export const ACESSO_TOTAL: Acessos = Object.fromEntries(
  MODULOS.map((m) => [m.id, m.niveis[m.niveis.length - 1]]),
) as Acessos;

const peso = (n: Nivel | null) => (n === 'editar' ? 2 : n === 'consultar' ? 1 : 0);

/** Soma das funções: o maior nível de cada módulo. */
export function combinarAcessos(lista: Partial<Acessos>[]): Acessos {
  const resultado = { ...SEM_ACESSO };
  for (const acessos of lista) {
    for (const id of MODULO_IDS) {
      const nivel = acessos[id] ?? null;
      if (peso(nivel) > peso(resultado[id])) resultado[id] = nivel;
    }
  }
  return resultado;
}

/** `editar` inclui `consultar`. */
export const temAcesso = (acessos: Acessos | undefined, modulo: ModuloId, nivel: Nivel = 'consultar') =>
  !!acessos && peso(acessos[modulo]) >= peso(nivel);

export const NOME_FUNCAO_ADMIN = 'Administrador';

/**
 * Parâmetros de função: marcam o que uma função habilita além dos níveis por módulo. A lista fica na
 * tabela global `parametros_funcao` (migração 0018); o código usa só os códigos abaixo.
 */
export const PARAMETRO_VENDEDOR = 'VENDEDOR';

/**
 * Funções criadas em toda oficina nova (matriz aprovada pelo dono do produto, docs/ENTREGAVEIS.md §1.1).
 * As migrações 0005, 0008 e 0012 aplicam o mesmo às oficinas que já existiam: mantenha tudo igual.
 */
export const FUNCOES_PADRAO: { nome: string; acessos: Partial<Acessos>; parametros?: string[] }[] = [
  {
    nome: 'Atendente',
    parametros: [PARAMETRO_VENDEDOR],
    acessos: {
      clientes: 'editar',
      orcamentos: 'editar',
      aprovar_orcamentos: 'editar',
      os: 'editar',
      pecas_os: 'editar',
      materiais: 'consultar',
      servicos: 'consultar',
      precos: 'consultar',
      estoque: 'editar',
      recebimentos: 'editar',
    },
  },
  {
    nome: 'Mecânico',
    acessos: {
      clientes: 'consultar',
      orcamentos: 'consultar',
      os: 'editar',
      materiais: 'consultar',
      servicos: 'consultar',
      estoque: 'consultar',
    },
  },
  {
    nome: 'Almoxarife',
    acessos: {
      clientes: 'consultar',
      orcamentos: 'consultar',
      os: 'consultar',
      pecas_os: 'editar',
      materiais: 'editar',
      servicos: 'consultar',
      precos: 'consultar',
      estoque: 'consultar',
    },
  },
  {
    nome: 'Financeiro',
    acessos: {
      clientes: 'consultar',
      orcamentos: 'editar',
      aprovar_orcamentos: 'editar',
      os: 'consultar',
      materiais: 'consultar',
      servicos: 'editar',
      precos: 'editar',
      recebimentos: 'editar',
      financeiro: 'editar',
      relatorios: 'consultar',
    },
  },
];

// ---------- Schemas da API ----------

export const funcaoResumoSchema = z.object({ id: z.uuid(), nome: z.string(), admin: z.boolean() });
export type FuncaoResumo = z.infer<typeof funcaoResumoSchema>;

export const parametroFuncaoSchema = z.object({ codigo: z.string(), nome: z.string(), descricao: z.string() });
export type ParametroFuncao = z.infer<typeof parametroFuncaoSchema>;

export const funcaoSchema = funcaoResumoSchema.extend({
  /** Sequencial por oficina, gerado pelo banco e imutável. */
  codigo: z.number().int(),
  descricao: z.string().nullable(),
  /** Códigos dos parâmetros marcados (ex.: VENDEDOR). */
  parametros: z.array(z.string()),
  ativa: z.boolean(),
  acessos: acessosSchema,
  usuarios: z.number(),
});
export type Funcao = z.infer<typeof funcaoSchema>;

export const funcaoInputSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da função').max(60, 'Nome longo demais'),
  descricao: z
    .string()
    .trim()
    .max(200, 'Descrição longa demais')
    .nullish()
    .transform((v) => v || null),
  ativa: z.boolean(),
  parametros: z
    .array(z.string())
    .default([])
    .transform((codigos) => [...new Set(codigos)]),
  // O nível precisa existir no módulo (ex.: Relatórios só tem "consultar").
  acessos: acessosSchema.superRefine((a, ctx) => {
    for (const m of MODULOS) {
      const nivel = a[m.id];
      if (nivel && !(m.niveis as readonly Nivel[]).includes(nivel)) {
        ctx.addIssue({ code: 'custom', path: [m.id], message: `${m.nome} não tem o nível "${nomesNivel[nivel]}"` });
      }
    }
  }),
});
export type FuncaoInput = z.input<typeof funcaoInputSchema>;
