import { LISTAS_OPCOES, type ListaOpcoes, type Opcao, type SugestoesVeiculo } from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const chaveOpcoes = (lista: ListaOpcoes) => ['opcoes', lista] as const;

/** Página de cada lista em Configurações (uma por lista, no submenu). */
export const PAGINAS_LISTAS: { lista: ListaOpcoes; para: string; rotulo: string }[] = (
  [
    ['origens', '/configuracoes/origens'],
    ['relacionamentos', '/configuracoes/relacionamentos'],
    ['cargos', '/configuracoes/cargos'],
    ['tiposMaterial', '/configuracoes/tipos-material'],
    ['tiposDeposito', '/configuracoes/tipos-deposito'],
  ] as const
).map(([lista, para]) => ({ lista, para, rotulo: LISTAS_OPCOES[lista].titulo }));

/** Itens de uma lista editável da oficina (origem, relacionamento). */
export const useOpcoes = (lista: ListaOpcoes) =>
  useQuery({ queryKey: chaveOpcoes(lista), queryFn: () => api<Opcao[]>(`/opcoes/${lista}`) });

/** Marcas e modelos já cadastrados na oficina (sugestão do formulário de veículo). */
export const useSugestoesVeiculo = (marca: string) =>
  useQuery({
    queryKey: ['veiculos', 'sugestoes', marca.trim().toLowerCase()],
    queryFn: () => api<SugestoesVeiculo>(`/veiculos/sugestoes?${new URLSearchParams({ marca: marca.trim() })}`),
    staleTime: 60_000,
  });

export type EnderecoViaCep = { logradouro: string; bairro: string; cidade: string; uf: string };

/**
 * Consulta o CEP no ViaCEP (serviço público e gratuito). Só o CEP sai do navegador.
 * Devolve null se o CEP não existir ou o serviço estiver fora do ar: o preenchimento fica manual.
 */
export async function buscarCep(cep: string): Promise<EnderecoViaCep | null> {
  const digitos = cep.replace(/\D/g, '');
  if (digitos.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digitos}/json/`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const dados = await res.json();
    if (dados.erro) return null;
    return {
      logradouro: dados.logradouro ?? '',
      bairro: dados.bairro ?? '',
      cidade: dados.localidade ?? '',
      uf: dados.uf ?? '',
    };
  } catch {
    return null;
  }
}
