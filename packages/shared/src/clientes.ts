import { z } from 'zod';
import { cepValido, cnpjValido, cpfValido, normalizarDocumento, somenteDigitos } from './documentos.js';
import { hojeIso } from './formatos.js';
import { somarDias } from './orcamentos.js';
import {
  chaves,
  dataPassadaOpcional,
  emailSchema,
  telefoneSchema,
  textoObrigatorio,
  textoOpcional,
  vazioComoNulo,
} from './schemas.js';
import { STATUS_VEICULO } from './veiculos.js';

// ---------- Clientes ----------

export const SEXOS = {
  masculino: 'Masculino',
  feminino: 'Feminino',
  outro: 'Outro',
  nao_informado: 'Prefiro não informar',
} as const;
export type Sexo = keyof typeof SEXOS;

export const TIPOS_ENDERECO = { residencial: 'Residencial', comercial: 'Comercial', outro: 'Outro' } as const;
export type TipoEndereco = keyof typeof TIPOS_ENDERECO;

/** Finalidades que um endereço de PJ pode acumular (a sede pode ser faturamento e cobrança ao mesmo tempo). */
export const FINALIDADES_PJ = { faturamento: 'Faturamento', entrega: 'Entrega', cobranca: 'Cobrança' } as const;

export const UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;
export const PAIS_PADRAO = 'Brasil';

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
    pais: z
      .string()
      .trim()
      .max(60)
      .optional()
      .transform((v) => v || PAIS_PADRAO),
    principal: z.boolean().default(false),
    faturamento: z.boolean().default(false),
    entrega: z.boolean().default(false),
    cobranca: z.boolean().default(false),
  })
  .superRefine((e, ctx) => {
    // CEP e UF só são validados no formato brasileiro quando o endereço é no Brasil.
    if (e.pais.toLowerCase() !== PAIS_PADRAO.toLowerCase()) return;
    if (!cepValido(e.cep)) ctx.addIssue({ code: 'custom', path: ['cep'], message: 'CEP inválido' });
    if (!(UFS as readonly string[]).includes(e.uf))
      ctx.addIssue({ code: 'custom', path: ['uf'], message: 'Escolha o estado' });
  })
  .transform((e) =>
    e.pais.toLowerCase() === PAIS_PADRAO.toLowerCase() ? { ...e, cep: somenteDigitos(e.cep), pais: PAIS_PADRAO } : e,
  );
export type EnderecoInput = z.input<typeof enderecoInputSchema>;

/** Pessoa que responde pela empresa cliente (PJ). */
export const responsavelInputSchema = z.object({
  nome: z.string({ error: 'Informe o nome' }).trim().min(2, 'Informe o nome').max(120, 'Nome longo demais'),
  telefone: telefoneSchema('telefone'),
  telefoneWhatsapp: z.boolean().default(false),
  email: z
    .union([z.literal(''), emailSchema])
    .nullish()
    .transform((v) => v || null),
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
          ctx.addIssue({
            code: 'custom',
            message: n === 11 ? 'CPF inválido' : n === 14 ? 'CNPJ inválido' : 'Documento inválido',
          });
        }
      }),
    rgIe: textoOpcional.refine((v) => !v || v.length <= 20, 'Máximo de 20 caracteres'),
    dataNascimento: dataPassadaOpcional,
    sexo: z.preprocess(vazioComoNulo, z.enum(chaves(SEXOS)).nullable()),
    telefone: telefoneSchema('telefone'),
    whatsapp: telefoneSchema('WhatsApp'),
    email: z
      .union([z.literal(''), emailSchema])
      .nullish()
      .transform((v) => v || null),
    observacoes: textoOpcional.refine((v) => !v || v.length <= 2000, 'Máximo de 2.000 caracteres'),
    clienteDesde: z.iso
      .date('Informe a data')
      .refine((v) => v >= '1900-01-01' && v <= hojeIso(), 'Data fora do intervalo permitido'),
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
    if (c.tipo === 'PF' && tamanho !== 11)
      ctx.addIssue({ code: 'custom', path: ['cpfCnpj'], message: 'Pessoa física: informe um CPF' });
    if (c.tipo === 'PJ' && tamanho !== 14)
      ctx.addIssue({ code: 'custom', path: ['cpfCnpj'], message: 'Pessoa jurídica: informe um CNPJ' });
    if (c.tipo === 'PJ' && c.responsaveis.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['responsaveis'],
        message: 'Cadastre ao menos um responsável pela empresa',
      });
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
      responsaveis: pf
        ? []
        : c.responsaveis.map((r, i) => ({
            ...r,
            principal: c.responsaveis.some((x) => x.principal) ? r.principal : i === 0,
          })),
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
  veiculos: z.array(
    z.object({
      id: z.uuid(),
      placa: z.string(),
      marca: z.string(),
      modelo: z.string(),
      status: z.enum(chaves(STATUS_VEICULO)),
    }),
  ),
  totalVeiculos: z.number(),
  clienteDesde: z.string().nullable(),
  /** Cidade/UF do endereço principal. */
  cidade: z.string().nullable(),
  /** Dias até o próximo aniversário (0 = hoje); null sem data de nascimento (PJ ou não informada). */
  diasAteAniversario: z.number().nullable(),
});
export type ClienteResumo = z.infer<typeof clienteResumoSchema>;

/** Aniversário "da semana": hoje e os próximos 7 dias. */
export const DIAS_ANIVERSARIO_SEMANA = 7;

/** Aniversário (MMDD: mês × 100 + dia) de cada dia de uma janela e a distância dele a hoje, em dias. */
export type JanelaDeAniversarios = { mmdd: number; dias: number }[];

/**
 * Aniversários de hoje até `dias` à frente, para a API filtrar aniversariantes pelo índice (coluna
 * `clientes.aniversario`) em vez de calcular a distância linha a linha. Mesma regra de dias_ate_aniversario
 * (migração 0016): quem nasceu em 29/02 é lembrado em 28/02 nos anos não bissextos.
 */
export function janelaDeAniversarios(hoje: string, dias: number): JanelaDeAniversarios {
  const bissexto = (ano: number) => ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0);
  const janela = Array.from({ length: dias + 1 }, (_, i) => {
    const data = somarDias(hoje, i);
    return { mmdd: Number(data.slice(5, 7)) * 100 + Number(data.slice(8, 10)), dias: i, ano: Number(data.slice(0, 4)) };
  });
  const dia28 = janela.find((j) => j.mmdd === 228 && !bissexto(j.ano));
  return [
    ...janela.map(({ mmdd, dias: d }) => ({ mmdd, dias: d })),
    ...(dia28 ? [{ mmdd: 229, dias: dia28.dias }] : []),
  ];
}

const dataFiltro = z.union([z.literal(''), z.iso.date('Data inválida')]).optional();

/** Colunas pelas quais a lista de clientes pode ser ordenada (com índice no banco). */
export const ORDENACOES_CLIENTE = ['nome', 'clienteDesde'] as const;
export type OrdenacaoCliente = (typeof ORDENACOES_CLIENTE)[number];

/** Filtros da lista de clientes (todos opcionais; vazio = sem filtro). */
export const clienteFiltroSchema = z
  .object({
    q: z.string().trim().optional(),
    ativo: z.enum(['true', 'false', '']).optional(),
    tipo: z.enum(['PF', 'PJ', '']).optional(),
    /** Período do campo "cliente desde" (extremos inclusivos). */
    desde: dataFiltro,
    ate: dataFiltro,
    origemId: z.union([z.literal(''), z.uuid()]).optional(),
    relacionamentoId: z.union([z.literal(''), z.uuid()]).optional(),
    aniversario: z.enum(['hoje', 'semana', '']).optional(),
    /** Ordenação pela coluna da tabela (lista fechada; filtrando aniversariantes, os mais próximos vêm antes). */
    ordenar: z.enum(ORDENACOES_CLIENTE).default('nome'),
    direcao: z.enum(['asc', 'desc']).default('asc'),
    pagina: z.coerce.number().int().min(1).default(1),
    porPagina: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((f) => !f.desde || !f.ate || f.desde <= f.ate, {
    message: 'A data inicial deve ser anterior à final',
    path: ['ate'],
  });
export type ClienteFiltro = z.input<typeof clienteFiltroSchema>;

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
