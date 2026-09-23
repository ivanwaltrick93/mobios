import type { Categoria, Deposito, Marca, TabelaPreco } from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const useCategorias = () =>
  useQuery({ queryKey: ['categorias'], queryFn: () => api<Categoria[]>('/categorias') });
export const useMarcas = () => useQuery({ queryKey: ['marcas'], queryFn: () => api<Marca[]>('/marcas') });
export const useDepositos = () => useQuery({ queryKey: ['depositos'], queryFn: () => api<Deposito[]>('/depositos') });
export const useTabelasPreco = (habilitado = true) =>
  useQuery({ queryKey: ['tabelas-preco'], queryFn: () => api<TabelaPreco[]>('/tabelas-preco'), enabled: habilitado });

export type NoCategoria = Categoria & { nivel: number; caminho: string };

/** Árvore de categorias em ordem de exibição (pai antes dos filhos, irmãs por nome), com nível e caminho. */
export function arvoreCategorias(lista: Categoria[] = []): NoCategoria[] {
  const filhos = new Map<string | null, Categoria[]>();
  for (const c of lista) filhos.set(c.categoriaPaiId, [...(filhos.get(c.categoriaPaiId) ?? []), c]);
  const saida: NoCategoria[] = [];
  const visitar = (pai: string | null, nivel: number, prefixo: string) => {
    for (const c of (filhos.get(pai) ?? []).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))) {
      const caminho = prefixo ? `${prefixo} › ${c.nome}` : c.nome;
      saida.push({ ...c, nivel, caminho });
      visitar(c.id, nivel + 1, caminho);
    }
  };
  visitar(null, 0, '');
  return saida;
}

/** Ids da categoria e de todas as descendentes (para não oferecer uma descendente como pai). */
export function descendentes(lista: Categoria[], id: string): Set<string> {
  const ids = new Set([id]);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const c of lista) {
      if (c.categoriaPaiId && ids.has(c.categoriaPaiId) && !ids.has(c.id)) {
        ids.add(c.id);
        mudou = true;
      }
    }
  }
  return ids;
}
