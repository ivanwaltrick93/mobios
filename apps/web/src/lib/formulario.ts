import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ErroApi } from './api';

/** Respostas de erro cujos campos já foram marcados no formulário. */
const aplicados = new WeakSet<ErroApi>();

/**
 * Mostra nos campos os erros de validação devolvidos pela API; devolve a mensagem geral. `campos` troca o nome do
 * campo da API pelo do formulário (ex.: `sku` → `codigo`). É chamada durante a renderização, por isso marca os
 * campos uma vez só por resposta: `setError` redesenha o formulário, e repetir a cada desenho entraria em laço.
 */
export function aplicarErrosDaApi<T extends FieldValues>(
  erro: unknown,
  setError: UseFormSetError<T>,
  campos: Partial<Record<string, Path<T>>> = {},
): string {
  if (!(erro instanceof ErroApi)) return 'Erro de conexão. Tente novamente.';
  if (!aplicados.has(erro)) {
    aplicados.add(erro);
    for (const [campo, mensagem] of Object.entries(erro.campos ?? {}))
      setError(campos[campo] ?? (campo as Path<T>), { message: mensagem });
  }
  return erro.message;
}
