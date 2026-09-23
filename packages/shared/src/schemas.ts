import { z } from 'zod';
import { acessosSchema, funcaoResumoSchema } from './acessos.js';
import { cepValido, chassiValido, cnpjValido, cpfValido, normalizarChassi, normalizarDocumento, normalizarPlaca, placaValida, renavamValido, somenteDigitos, telefoneValido } from './documentos.js';
import { hojeIso } from './formatos.js';

// Mensagens padrão do Zod em português, no front e no back.
z.config(z.locales.pt());

const textoOpcional = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullish();

// ---------- Auth e usuários ----------

// Normaliza antes de validar: e-mails colados costumam vir com espaços ou maiúsculas.
const emailSchema = z.string().trim().toLowerCase().pipe(z.email('E-mail inválido'));
// Limite superior evita que senhas gigantes sejam usadas para sobrecarregar o hash.
const senhaSchema = z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').max(128, 'Senha longa demais');

export const loginSchema = z.object({
  email: emailSchema,
  senha: z.string().min(1, 'Informe a senha').max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

// ---------- Aparência (cores parametrizáveis por oficina) ----------

const corHex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB')
  .transform((v) => v.toLowerCase());

/**
 * Tokens do style guide configuráveis por oficina. null = padrão do style guide;
 * nas cores de texto, null = automático (maior contraste com o fundo).
 */
export const CAMPOS_TEMA = [
  'corPrimaria',
  'corMenu',
  'corBotaoPrimario',
  'corBotaoPrimarioTexto',
  'corBotaoSecundario',
  'corBotaoSecundarioTexto',
] as const;
export type CampoTema = (typeof CAMPOS_TEMA)[number];

/** Tema salvo. Sem transformações: é usado em respostas. */
export const temaSchema = z.object(Object.fromEntries(CAMPOS_TEMA.map((c) => [c, z.string().nullable()])) as Record<CampoTema, z.ZodNullable<z.ZodString>>);
export type Tema = z.infer<typeof temaSchema>;

/** Entrada do formulário de aparência: valida e normaliza as cores. */
export const temaInputSchema = z.object(Object.fromEntries(CAMPOS_TEMA.map((c) => [c, corHex.nullable()])) as Record<CampoTema, z.ZodNullable<typeof corHex>>);

export const TEMA_VAZIO: Tema = Object.fromEntries(CAMPOS_TEMA.map((c) => [c, null])) as Tema;

/** Padrões do style guide (quando o campo do tema é null). */
export const TEMA_PADRAO = { corPrimaria: '#1d4ed8', corMenu: '#ffffff', corBotaoSecundario: '#ffffff' } as const;

/** Marca da oficina exibida antes do login (cores, logo e nome: nada sensível). */
export const aparenciaPublicaSchema = z.object({
  oficinaId: z.string().nullable(),
  nome: z.string().nullable(),
  tema: temaSchema,
  logoVersao: z.string().nullable(),
});
export type AparenciaPublica = z.infer<typeof aparenciaPublicaSchema>;

// Imagens enviadas (logo da oficina, fotos da equipe). SVG fica de fora: pode conter scripts.
export const IMAGEM_TIPOS = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const IMAGEM_TAMANHO_MAXIMO = 1024 * 1024; // 1 MB

export const sessaoSchema = z.object({
  usuario: z.object({ id: z.uuid(), nome: z.string(), email: z.string(), fotoVersao: z.string().nullable(), admin: z.boolean(), funcoes: z.array(funcaoResumoSchema) }),
  /** Nível efetivo por módulo (maior entre as funções ativas; tudo, para o admin). */
  acessos: acessosSchema,
  // logoVersao: null = sem logo; senão, muda a cada troca (usado na URL para renovar o cache).
  oficina: z.object({ id: z.uuid(), nome: z.string(), tema: temaSchema, logoVersao: z.string().nullable() }),
});
export type Sessao = z.infer<typeof sessaoSchema>;

export const usuarioSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
  email: z.string(),
  /** null = sem foto; senão, muda a cada troca (renova o cache). */
  fotoVersao: z.string().nullable(),
  /** Inclui funções desativadas (sem efeito até serem reativadas), para o admin enxergar. */
  funcoes: z.array(funcaoResumoSchema.extend({ ativa: z.boolean() })),
  ativo: z.boolean(),
  criadoEm: z.coerce.date(),
});
export type Usuario = z.infer<typeof usuarioSchema>;

const funcoesIdsSchema = z.array(z.uuid()).min(1, 'Escolha ao menos uma função').transform((ids) => [...new Set(ids)]);

export const usuarioCriarSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome'),
  email: emailSchema,
  funcoes: funcoesIdsSchema,
  senha: senhaSchema,
});
export type UsuarioCriarInput = z.input<typeof usuarioCriarSchema>;

/** Edição pelo admin. Senha vazia = manter a atual. O e-mail não muda (é a chave de login). */
export const usuarioAtualizarSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome'),
  funcoes: funcoesIdsSchema,
  ativo: z.boolean(),
  novaSenha: z.union([z.literal(''), senhaSchema]).nullish().transform((v) => v || null),
});
export type UsuarioAtualizarInput = z.input<typeof usuarioAtualizarSchema>;

// ---------- Listas configuráveis por oficina (Configurações → Cadastros) ----------

export const LISTAS_OPCOES = {
  origens: { titulo: 'Origem do cliente', descricao: 'Como o cliente conheceu a oficina.' },
  relacionamentos: { titulo: 'Tipo de relacionamento', descricao: 'Perfil comercial do cliente.' },
  cargos: { titulo: 'Função do responsável (PJ)', descricao: 'Papel da pessoa que responde pela empresa cliente.' },
} as const;
export type ListaOpcoes = keyof typeof LISTAS_OPCOES;
export const listaOpcoesSchema = z.enum(['origens', 'relacionamentos', 'cargos']);

/** Itens criados em toda oficina nova (as migrações 0009 e 0011 aplicam o mesmo às que já existiam). */
export const OPCOES_PADRAO: Record<ListaOpcoes, string[]> = {
  origens: ['Indicação', 'Site', 'Campanha', 'Loja', 'Concessionária'],
  relacionamentos: ['Consumidor final', 'Empresa', 'Frota', 'Seguradora'],
  cargos: ['Sócio / Proprietário', 'Gestor de frota', 'Financeiro', 'Compras', 'Motorista'],
};

/** `clientes`: quantos clientes usam o item (no caso de função do responsável, clientes com algum responsável nela). */
export const opcaoSchema = z.object({ id: z.uuid(), nome: z.string(), ativa: z.boolean(), clientes: z.number() });
export type Opcao = z.infer<typeof opcaoSchema>;

export const opcaoInputSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome').max(60, 'Nome longo demais'),
  ativa: z.boolean(),
});
export type OpcaoInput = z.input<typeof opcaoInputSchema>;

// ---------- Clientes ----------

const chaves = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

/** Vendido/Inativo: continua no histórico, mas não recebe O.S. nova até ser reativado. */
export const STATUS_VEICULO = { ativo: 'Ativo', vendido: 'Vendido', inativo: 'Inativo' } as const;
export type StatusVeiculo = keyof typeof STATUS_VEICULO;

export const SEXOS = { masculino: 'Masculino', feminino: 'Feminino', outro: 'Outro', nao_informado: 'Prefiro não informar' } as const;
export type Sexo = keyof typeof SEXOS;

export const TIPOS_ENDERECO = { residencial: 'Residencial', comercial: 'Comercial', outro: 'Outro' } as const;
export type TipoEndereco = keyof typeof TIPOS_ENDERECO;

/** Finalidades que um endereço de PJ pode acumular (a sede pode ser faturamento e cobrança ao mesmo tempo). */
export const FINALIDADES_PJ = { faturamento: 'Faturamento', entrega: 'Entrega', cobranca: 'Cobrança' } as const;

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;
export const PAIS_PADRAO = 'Brasil';

/** Select vazio do formulário vira null. */
const vazioComoNulo = (v: unknown) => (v === '' || v === undefined ? null : v);

const telefoneSchema = (rotulo: string) =>
  z
    .string({ error: `Informe o ${rotulo}` })
    .trim()
    .min(1, `Informe o ${rotulo}`)
    .refine(telefoneValido, `${rotulo[0]!.toUpperCase()}${rotulo.slice(1)} inválido: use DDD + número`)
    .transform(somenteDigitos);

const dataPassadaOpcional = z
  .union([z.literal(''), z.iso.date('Data inválida')])
  .nullish()
  .transform((v) => v || null)
  .refine((v) => !v || (v >= '1900-01-01' && v <= hojeIso()), 'Data fora do intervalo permitido');

const textoObrigatorio = (msg: string, max = 120) => z.string({ error: msg }).trim().min(1, msg).max(max, 'Texto longo demais');

export const enderecoInputSchema = z
  .object({
    tipo: z.enum(chaves(TIPOS_ENDERECO), 'Escolha o tipo de endereço'),
    cep: textoObrigatorio('Informe o CEP', 12),
    logradouro: textoObrigatorio('Informe o logradouro', 150),
    numero: textoObrigatorio('Informe o número (ou S/N)', 10),
    complemento: textoOpcional,
    bairro: textoObrigatorio('Informe o bairro', 100),
    cidade: textoObrigatorio('Informe a cidade', 100),
    uf: textoObrigatorio('Informe o estado', 30).transform((v) => v.toUpperCase()),
    pais: z.string().trim().max(60).optional().transform((v) => v || PAIS_PADRAO),
    principal: z.boolean().default(false),
    faturamento: z.boolean().default(false),
    entrega: z.boolean().default(false),
    cobranca: z.boolean().default(false),
  })
  .superRefine((e, ctx) => {
    // CEP e UF só são validados no formato brasileiro quando o endereço é no Brasil.
    if (e.pais.toLowerCase() !== PAIS_PADRAO.toLowerCase()) return;
    if (!cepValido(e.cep)) ctx.addIssue({ code: 'custom', path: ['cep'], message: 'CEP inválido' });
    if (!(UFS as readonly string[]).includes(e.uf)) ctx.addIssue({ code: 'custom', path: ['uf'], message: 'Escolha o estado' });
  })
  .transform((e) => (e.pais.toLowerCase() === PAIS_PADRAO.toLowerCase() ? { ...e, cep: somenteDigitos(e.cep), pais: PAIS_PADRAO } : e));
export type EnderecoInput = z.input<typeof enderecoInputSchema>;

/** Pessoa que responde pela empresa cliente (PJ). */
export const responsavelInputSchema = z.object({
  nome: z.string({ error: 'Informe o nome' }).trim().min(2, 'Informe o nome').max(120, 'Nome longo demais'),
  telefone: telefoneSchema('telefone'),
  telefoneWhatsapp: z.boolean().default(false),
  email: z.union([z.literal(''), emailSchema]).nullish().transform((v) => v || null),
  cargoId: z.uuid('Escolha a função'),
  principal: z.boolean().default(false),
});
export type ResponsavelInput = z.input<typeof responsavelInputSchema>;

export const clienteInputSchema = z
  .object({
    tipo: z.enum(['PF', 'PJ']).default('PF'),
    nome: z.string().trim().min(2, 'Informe o nome').max(150, 'Nome longo demais'),
    // Validado no próprio campo (e não só no objeto) para o formulário em etapas conferir já na 1ª etapa.
    cpfCnpj: z
      .string({ error: 'Informe o documento' })
      .trim()
      .min(1, 'Informe o documento')
      .superRefine((v, ctx) => {
        const n = normalizarDocumento(v).length;
        if (n === 11 ? !cpfValido(v) : n === 14 ? !cnpjValido(v) : true) {
          ctx.addIssue({ code: 'custom', message: n === 11 ? 'CPF inválido' : n === 14 ? 'CNPJ inválido' : 'Documento inválido' });
        }
      }),
    rgIe: textoOpcional.refine((v) => !v || v.length <= 20, 'Máximo de 20 caracteres'),
    dataNascimento: dataPassadaOpcional,
    sexo: z.preprocess(vazioComoNulo, z.enum(chaves(SEXOS)).nullable()),
    telefone: telefoneSchema('telefone'),
    whatsapp: telefoneSchema('WhatsApp'),
    email: z.union([z.literal(''), emailSchema]).nullish().transform((v) => v || null),
    observacoes: textoOpcional.refine((v) => !v || v.length <= 2000, 'Máximo de 2.000 caracteres'),
    clienteDesde: z.iso.date('Informe a data').refine((v) => v >= '1900-01-01' && v <= hojeIso(), 'Data fora do intervalo permitido'),
    origemId: z.preprocess(vazioComoNulo, z.uuid().nullable()),
    relacionamentoId: z.preprocess(vazioComoNulo, z.uuid().nullable()),
    ativo: z.boolean().default(true),
    enderecos: z
      .array(enderecoInputSchema, 'Cadastre ao menos um endereço')
      .min(1, 'Cadastre ao menos um endereço')
      .max(20, 'Máximo de 20 endereços')
      .refine((lista) => lista.filter((e) => e.principal).length <= 1, 'Marque apenas um endereço como principal'),
    responsaveis: z
      .array(responsavelInputSchema)
      .max(20, 'Máximo de 20 responsáveis')
      .refine((lista) => lista.filter((r) => r.principal).length <= 1, 'Marque apenas um responsável como principal')
      .default([]),
  })
  .superRefine((c, ctx) => {
    // O documento já é válido (campo); aqui só confere se combina com o tipo de cliente.
    const tamanho = normalizarDocumento(c.cpfCnpj).length;
    if (c.tipo === 'PF' && tamanho !== 11) ctx.addIssue({ code: 'custom', path: ['cpfCnpj'], message: 'Pessoa física: informe um CPF' });
    if (c.tipo === 'PJ' && tamanho !== 14) ctx.addIssue({ code: 'custom', path: ['cpfCnpj'], message: 'Pessoa jurídica: informe um CNPJ' });
    if (c.tipo === 'PJ' && c.responsaveis.length === 0) ctx.addIssue({ code: 'custom', path: ['responsaveis'], message: 'Cadastre ao menos um responsável pela empresa' });
  })
  .transform((c) => {
    const pf = c.tipo === 'PF';
    const temPrincipal = c.enderecos.some((e) => e.principal);
    return {
      ...c,
      cpfCnpj: normalizarDocumento(c.cpfCnpj),
      // Nascimento e sexo só fazem sentido para PF; finalidades de faturamento/entrega/cobrança, só para PJ.
      dataNascimento: pf ? c.dataNascimento : null,
      sexo: pf ? c.sexo : null,
      enderecos: c.enderecos.map((e, i) => ({
        ...e,
        principal: temPrincipal ? e.principal : i === 0,
        faturamento: !pf && e.faturamento,
        entrega: !pf && e.entrega,
        cobranca: !pf && e.cobranca,
      })),
      // Responsáveis só existem na PJ; sem principal marcado, o primeiro assume.
      responsaveis: pf ? [] : c.responsaveis.map((r, i) => ({ ...r, principal: c.responsaveis.some((x) => x.principal) ? r.principal : i === 0 })),
    };
  });
export type ClienteInput = z.input<typeof clienteInputSchema>;
export type ClienteDados = z.output<typeof clienteInputSchema>;

export const enderecoSchema = z.object({
  id: z.uuid(),
  tipo: z.enum(chaves(TIPOS_ENDERECO)),
  cep: z.string(),
  logradouro: z.string(),
  numero: z.string(),
  complemento: z.string().nullable(),
  bairro: z.string(),
  cidade: z.string(),
  uf: z.string(),
  pais: z.string(),
  principal: z.boolean(),
  faturamento: z.boolean(),
  entrega: z.boolean(),
  cobranca: z.boolean(),
});
export type Endereco = z.infer<typeof enderecoSchema>;

export const responsavelSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
  telefone: z.string(),
  telefoneWhatsapp: z.boolean(),
  email: z.string().nullable(),
  cargoId: z.uuid(),
  cargoNome: z.string(),
  principal: z.boolean(),
});
export type Responsavel = z.infer<typeof responsavelSchema>;

/**
 * Campos obrigatórios que faltam no cadastro (registros anteriores às regras atuais).
 * Cadastro incompleto não impede consultar, mas impede abrir O.S. até ser completado.
 */
export function pendenciasCliente(
  c: { tipo: 'PF' | 'PJ'; cpfCnpj: string | null; telefone: string | null; whatsapp: string | null },
  temEndereco: boolean,
  temResponsavel: boolean,
): string[] {
  const faltando: string[] = [];
  if (!c.cpfCnpj) faltando.push('CPF/CNPJ');
  if (!c.telefone) faltando.push('telefone');
  if (!c.whatsapp) faltando.push('WhatsApp');
  if (!temEndereco) faltando.push('endereço');
  if (c.tipo === 'PJ' && !temResponsavel) faltando.push('responsável');
  return faltando;
}

export const clienteResumoSchema = z.object({
  id: z.uuid(),
  tipo: z.enum(['PF', 'PJ']),
  nome: z.string(),
  cpfCnpj: z.string().nullable(),
  telefone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  ativo: z.boolean(),
  pendencias: z.array(z.string()),
  /** Até 4 veículos (principal primeiro), para os cartões da lista; o total vem em `totalVeiculos`. */
  veiculos: z.array(z.object({ id: z.uuid(), placa: z.string(), marca: z.string(), modelo: z.string(), status: z.enum(chaves(STATUS_VEICULO)) })),
  totalVeiculos: z.number(),
});
export type ClienteResumo = z.infer<typeof clienteResumoSchema>;

export const clienteSchema = clienteResumoSchema.extend({
  rgIe: z.string().nullable(),
  dataNascimento: z.string().nullable(),
  sexo: z.enum(chaves(SEXOS)).nullable(),
  email: z.string().nullable(),
  observacoes: z.string().nullable(),
  clienteDesde: z.string(),
  origemId: z.uuid().nullable(),
  origemNome: z.string().nullable(),
  relacionamentoId: z.uuid().nullable(),
  relacionamentoNome: z.string().nullable(),
  enderecos: z.array(enderecoSchema),
  responsaveis: z.array(responsavelSchema),
  criadoEm: z.coerce.date(),
});
export type Cliente = z.infer<typeof clienteSchema>;

// ---------- Veículos ----------

export const COMBUSTIVEIS = { flex: 'Flex', gasolina: 'Gasolina', etanol: 'Etanol', diesel: 'Diesel', gnv: 'GNV', eletrico: 'Elétrico', hibrido: 'Híbrido' } as const;
export type Combustivel = keyof typeof COMBUSTIVEIS;


const anoAtual = new Date().getFullYear();

/** Número inteiro opcional vindo de formulário: campo vazio vira null (e não 0). */
const inteiroOpcional = (min: number, max?: number) =>
  z.preprocess(
    // Aceita o valor com máscara (ex.: km "125.000").
    (v) => (v === '' || v == null ? null : typeof v === 'string' ? v.replace(/\D/g, '') || null : v),
    z.coerce
      .number()
      .int()
      .min(min)
      .max(max ?? Number.MAX_SAFE_INTEGER)
      .nullable(),
  );

const ano = (msg: string, max: number) =>
  z.preprocess(
    (v) => (v === '' || v == null ? undefined : Number(v)),
    z.number({ error: msg }).int(msg).min(1900, 'Ano inválido').max(max, 'Ano inválido'),
  );

const veiculoCampos = z.object({
  placa: z.string({ error: 'Informe a placa' }).refine(placaValida, 'Placa inválida').transform(normalizarPlaca),
  renavam: textoOpcional.refine((v) => !v || renavamValido(v), 'Renavam inválido').transform((v) => (v ? somenteDigitos(v).padStart(11, '0') : null)),
  chassi: textoOpcional.refine((v) => !v || chassiValido(v), 'Chassi inválido: 17 caracteres, sem I, O e Q').transform((v) => (v ? normalizarChassi(v) : null)),
  marca: textoObrigatorio('Informe a marca', 60),
  modelo: textoObrigatorio('Informe o modelo', 80),
  versao: textoOpcional,
  anoFabricacao: ano('Informe o ano de fabricação', anoAtual + 1),
  anoModelo: ano('Informe o ano modelo', anoAtual + 2),
  cor: textoOpcional,
  combustivel: z.preprocess(vazioComoNulo, z.enum(chaves(COMBUSTIVEIS)).nullable()),
  kmAtual: inteiroOpcional(0).optional().transform((v) => v ?? null),
  principal: z.boolean().default(false),
  status: z.enum(chaves(STATUS_VEICULO)).default('ativo'),
});

const regrasVeiculo = <T extends { anoFabricacao: number; anoModelo: number }>(v: T, ctx: z.RefinementCtx) => {
  if (v.anoModelo < v.anoFabricacao || v.anoModelo > v.anoFabricacao + 1) {
    ctx.addIssue({ code: 'custom', path: ['anoModelo'], message: 'O ano modelo deve ser igual ao de fabricação ou o seguinte' });
  }
};

/** Edição: o dono não muda aqui (use a transferência). */
export const veiculoAtualizarSchema = veiculoCampos.superRefine(regrasVeiculo);
export const veiculoInputSchema = veiculoCampos.extend({ clienteId: z.uuid() }).superRefine(regrasVeiculo);
export type VeiculoInput = z.input<typeof veiculoInputSchema>;
export type VeiculoAtualizarInput = z.input<typeof veiculoAtualizarSchema>;

export const veiculoTransferirSchema = z.object({ clienteId: z.uuid('Escolha o novo proprietário') });

export function pendenciasVeiculo(v: { anoFabricacao: number | null; anoModelo: number | null }): string[] {
  const faltando: string[] = [];
  if (v.anoFabricacao == null) faltando.push('ano de fabricação');
  if (v.anoModelo == null) faltando.push('ano modelo');
  return faltando;
}

export const veiculoSchema = z.object({
  id: z.uuid(),
  clienteId: z.uuid(),
  placa: z.string(),
  renavam: z.string().nullable(),
  chassi: z.string().nullable(),
  marca: z.string(),
  modelo: z.string(),
  versao: z.string().nullable(),
  anoFabricacao: z.number().nullable(),
  anoModelo: z.number().nullable(),
  cor: z.string().nullable(),
  combustivel: z.enum(chaves(COMBUSTIVEIS)).nullable(),
  kmAtual: z.number().nullable(),
  /** Preenchida automaticamente pela O.S. (fase 1). */
  ultimaVisita: z.string().nullable(),
  principal: z.boolean(),
  status: z.enum(chaves(STATUS_VEICULO)),
  pendencias: z.array(z.string()),
});
export type Veiculo = z.infer<typeof veiculoSchema>;

export const sugestoesVeiculoSchema = z.object({ marcas: z.array(z.string()), modelos: z.array(z.string()) });
export type SugestoesVeiculo = z.infer<typeof sugestoesVeiculoSchema>;

// ---------- Utilitários ----------

export const idParamSchema = z.object({ id: z.uuid() });

export const paginacaoSchema = z.object({
  q: z.string().trim().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});

export const erroSchema = z.object({
  erro: z.string(),
  campos: z.record(z.string(), z.string()).optional(),
});

// ---------- Relatórios ----------

export const relatorioIdSchema = z.enum(['clientes', 'veiculos', 'usuarios']);
export type RelatorioId = z.infer<typeof relatorioIdSchema>;

const dataIso = z.iso.date('Data inválida');

export const relatorioFiltroSchema = z
  .object({
    de: z.union([z.literal(''), dataIso]).optional().transform((v) => v || undefined),
    ate: z.union([z.literal(''), dataIso]).optional().transform((v) => v || undefined),
  })
  .refine((f) => !f.de || !f.ate || f.de <= f.ate, { message: 'A data inicial deve ser anterior à final', path: ['ate'] });

export type RelatorioDescricao = {
  id: RelatorioId;
  titulo: string;
  descricao: string;
  colunas: { chave: string; titulo: string }[];
};

export type RelatorioPrevia = {
  colunas: { chave: string; titulo: string }[];
  linhas: Record<string, string>[];
  total: number;
};

// ---------- Painel (página inicial) ----------

export type IndicadorId = 'os_abertas' | 'faturado_hoje' | 'clientes' | 'veiculos';

export type Indicador = {
  id: IndicadorId;
  titulo: string;
  /** null = o módulo que fornece o dado ainda não existe (nunca mostrar número inventado). */
  valor: number | null;
  formato: 'numero' | 'moeda';
  detalhe: string;
  link?: string;
};

export type AlertaPainel = {
  nivel: 'aviso' | 'info';
  mensagem: string;
  link?: string;
};

export type Painel = {
  indicadores: Indicador[];
  alertas: AlertaPainel[];
  /** Módulos ainda não implementados: exibidos como "em breve". */
  modulosPendentes: string[];
};
