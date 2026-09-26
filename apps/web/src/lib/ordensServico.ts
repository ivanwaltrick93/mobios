import {
  calcularItem,
  formatarHoras,
  formatarQuantidade,
  horasParaMinutos,
  mascaraMoeda,
  moedaParaCentavos,
  paraMilesimos,
  quantidadeParaNumero,
  type FormaPrecoServico,
  type ItemOs,
  type ItemOsInput,
  type MecanicoParaOs,
  type OrdemServico,
  type TipoItemPreco,
  type Unidade,
  type VendedorParaOrcamento,
} from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** Rotas de apoio da O.S. (clientes, veículos, itens com preço, vendedores e mecânicos). */
export const APOIO_OS = '/ordens-servico/apoio';

export const useOrdemServico = (id: string) =>
  useQuery({ queryKey: ['ordens-servico', id], queryFn: () => api<OrdemServico>(`/ordens-servico/${id}`) });

export const useMecanicosOs = (habilitado = true) =>
  useQuery({
    queryKey: ['ordens-servico', 'apoio', 'mecanicos'],
    queryFn: () => api<MecanicoParaOs[]>(`${APOIO_OS}/mecanicos`),
    enabled: habilitado,
  });

export const useVendedoresOs = () =>
  useQuery({
    queryKey: ['ordens-servico', 'apoio', 'vendedores'],
    queryFn: () => api<VendedorParaOrcamento[]>(`${APOIO_OS}/vendedores`),
  });

// ---------- Item avulso (docs/modulos/ORDENS_SERVICO.md §4): digitado na hora, preço final, sem desconto ----------

/** Avulso na tela: quantidade, horas e preço como texto (como a pessoa digita). */
export type LinhaAvulsa = {
  chave: string;
  id?: string;
  tipo: TipoItemPreco;
  descricao: string;
  /** Peça avulsa. */
  unidade: Unidade;
  /** Serviço avulso. */
  formaPreco: FormaPrecoServico;
  quantidade: string;
  horas: string;
  preco: string;
};

export const avulsoNovo = (tipo: TipoItemPreco): LinhaAvulsa => ({
  chave: crypto.randomUUID(),
  tipo,
  descricao: '',
  unidade: 'UN',
  formaPreco: 'fechado',
  quantidade: '1',
  horas: '',
  preco: '',
});

export const avulsoDoItem = (i: ItemOs): LinhaAvulsa => ({
  chave: i.id,
  id: i.id,
  tipo: i.tipo,
  descricao: i.descricao,
  // Serviço avulso grava "UN"/"H"; a unidade só vale para a peça.
  unidade: (i.tipo === 'material' ? i.unidade : 'UN') as Unidade,
  formaPreco: i.formaPreco ?? 'fechado',
  quantidade: i.quantidade != null ? formatarQuantidade(i.quantidade) : '',
  horas: i.tempoMinutos != null ? formatarHoras(i.tempoMinutos) : '',
  preco: mascaraMoeda(String(i.precoUnitarioCentavos)),
});

const porHora = (l: LinhaAvulsa) => l.tipo === 'servico' && l.formaPreco === 'hora';

/** Descrição, quantidade (ou horas) e preço informados: pronto para gravar. */
export const avulsoValido = (l: LinhaAvulsa) =>
  l.descricao.trim() !== '' &&
  moedaParaCentavos(l.preco) != null &&
  (porHora(l) ? !!horasParaMinutos(l.horas) : !!quantidadeParaNumero(l.quantidade));

/** Total do avulso: preço digitado × quantidade (ou horas), sem desconto. */
export function totalDoAvulso(l: LinhaAvulsa) {
  const preco = moedaParaCentavos(l.preco) ?? 0;
  return calcularItem(
    preco,
    preco,
    porHora(l)
      ? { tempoMinutos: horasParaMinutos(l.horas) || 0 }
      : { quantidadeMilesimos: paraMilesimos(quantidadeParaNumero(l.quantidade) ?? 0) },
  ).totalCentavos;
}

export const avulsoParaApi = (l: LinhaAvulsa): ItemOsInput => ({
  id: l.id,
  avulso: true,
  tipo: l.tipo,
  descricao: l.descricao,
  ...(l.tipo === 'material' ? { unidade: l.unidade } : { formaPreco: l.formaPreco }),
  ...(porHora(l) ? { tempoMinutos: l.horas } : { quantidade: quantidadeParaNumero(l.quantidade) ?? 0 }),
  precoUnitarioCentavos: moedaParaCentavos(l.preco) ?? 0,
});
