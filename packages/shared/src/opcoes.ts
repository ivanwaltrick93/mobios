import { z } from 'zod';
import { type ModuloId } from './acessos.js';
import { textoOpcional } from './schemas.js';

// ---------- Listas configuráveis por oficina (Configurações, uma página por lista) ----------

/**
 * Listas editáveis por oficina. `modulo`: quem acessa esse módulo consulta a lista (para preencher formulários);
 * só o admin altera. `uso`: como contar quem usa o item.
 */
export const LISTAS_OPCOES = {
  origens: {
    titulo: 'Origem do cliente',
    descricao: 'Como o cliente conheceu a oficina.',
    modulo: 'clientes',
    uso: 'cliente(s)',
  },
  relacionamentos: {
    titulo: 'Tipo de relacionamento',
    descricao: 'Perfil comercial do cliente.',
    modulo: 'clientes',
    uso: 'cliente(s)',
  },
  cargos: {
    titulo: 'Função do responsável (PJ)',
    descricao: 'Papel da pessoa que responde pela empresa cliente.',
    modulo: 'clientes',
    uso: 'cliente(s)',
  },
  tiposMaterial: {
    titulo: 'Tipo de produto',
    descricao: 'Classificação de peças, pneus, lubrificantes, insumos...',
    modulo: 'materiais',
    uso: 'produto(s)',
  },
  tiposDeposito: {
    titulo: 'Tipo de depósito',
    descricao: 'Natureza do local de armazenamento.',
    modulo: 'materiais',
    uso: 'depósito(s)',
  },
  classificacoesServico: {
    titulo: 'Classificação de serviço',
    descricao: 'Área do serviço, para filtros e relatórios.',
    modulo: 'servicos',
    uso: 'serviço(s)',
  },
} as const satisfies Record<string, { titulo: string; descricao: string; modulo: ModuloId; uso: string }>;
export type ListaOpcoes = keyof typeof LISTAS_OPCOES;
export const listaOpcoesSchema = z.enum([
  'origens',
  'relacionamentos',
  'cargos',
  'tiposMaterial',
  'tiposDeposito',
  'classificacoesServico',
]);

/** Itens criados em toda oficina nova (as migrações 0009, 0011, 0012 e 0023 aplicam o mesmo às que já existiam). */
export const OPCOES_PADRAO: Record<ListaOpcoes, string[]> = {
  origens: ['Indicação', 'Site', 'Campanha', 'Loja', 'Concessionária'],
  relacionamentos: ['Consumidor final', 'Empresa', 'Frota', 'Seguradora'],
  cargos: ['Sócio / Proprietário', 'Gestor de frota', 'Financeiro', 'Compras', 'Motorista'],
  tiposMaterial: ['Peça', 'Acessório', 'Pneu', 'Lubrificante', 'Fluido', 'Insumo', 'Outro'],
  tiposDeposito: ['Loja', 'Oficina', 'Central', 'Garantia', 'Trânsito', 'Outro'],
  classificacoesServico: [
    'Mecânica',
    'Elétrica',
    'Funilaria e pintura',
    'Alinhamento e balanceamento',
    'Revisão',
    'Diagnóstico',
    'Outro',
  ],
};

/**
 * `codigo`: sequencial por oficina e lista, gerado pelo banco e imutável.
 * `usos`: quantos registros usam o item (clientes, materiais ou depósitos; ver LISTAS_OPCOES.uso). Com uso, só inativa.
 */
export const opcaoSchema = z.object({
  id: z.uuid(),
  codigo: z.number().int(),
  nome: z.string(),
  descricao: z.string().nullable(),
  ativa: z.boolean(),
  usos: z.number(),
});
export type Opcao = z.infer<typeof opcaoSchema>;

export const opcaoInputSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome').max(60, 'Nome longo demais'),
  descricao: textoOpcional.pipe(z.string().max(200, 'Descrição longa demais').nullish()),
  ativa: z.boolean(),
});
export type OpcaoInput = z.input<typeof opcaoInputSchema>;
