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

export const COLUNAS_IMPORTACAO_PRECOS: ColunaImportacao[] = [
  { nome: 'tabela', obrigatoria: true, descricao: 'Código da tabela de preço', exemplo: 'VAREJO' },
  { nome: 'sku', obrigatoria: true, descricao: 'SKU do material (precisa estar cadastrado)', exemplo: 'FIL-001' },
  {
    nome: 'preco',
    obrigatoria: true,
    descricao: 'Valor em reais, com vírgula decimal e sem separador de milhar',
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

export const COLUNAS_IMPORTACAO_ESTOQUE: ColunaImportacao[] = [
  { nome: 'sku', obrigatoria: true, descricao: 'SKU do material (precisa estar cadastrado)', exemplo: 'FIL-001' },
  { nome: 'deposito', obrigatoria: true, descricao: 'Código do depósito (precisa estar cadastrado)', exemplo: 'LOJA' },
  {
    nome: 'disponivel',
    obrigatoria: true,
    descricao: 'Saldo final disponível (substitui o atual), com vírgula decimal',
    exemplo: '12',
  },
  {
    nome: 'reservado',
    obrigatoria: false,
    descricao: 'Saldo final reservado. Vazio = mantém o reservado atual',
    exemplo: '0',
  },
  {
    nome: 'motivo',
    obrigatoria: false,
    descricao: 'Motivo registrado no histórico. Vazio = "Importação de planilha"',
    exemplo: 'Inventário de dezembro',
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
