import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ErroApi } from './api';

/** Mostra nos campos os erros de validação devolvidos pela API; devolve a mensagem geral. */
export function aplicarErrosDaApi<T extends FieldValues>(erro: unknown, setError: UseFormSetError<T>): string {
  if (!(erro instanceof ErroApi)) return 'Erro de conexão. Tente novamente.';
  for (const [campo, mensagem] of Object.entries(erro.campos ?? {})) setError(campo as Path<T>, { message: mensagem });
  return erro.message;
}
