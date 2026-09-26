export class ErroApi extends Error {
  constructor(
    public status: number,
    message: string,
    public campos?: Record<string, string>,
  ) {
    super(message);
  }
}

type OpcoesApi = {
  method?: string;
  /** Corpo JSON. */
  body?: unknown;
  /** Arquivo enviado como o próprio corpo (imagem, planilha CSV), com o tipo informado. */
  arquivo?: { conteudo: Blob; tipo: string };
  /** Cancela a requisição (TanStack Query passa o `signal` quando a busca muda antes da resposta). */
  signal?: AbortSignal;
};

export async function api<T>(caminho: string, { method = 'GET', body, arquivo, signal }: OpcoesApi = {}): Promise<T> {
  const res = await fetch(`/api${caminho}`, {
    method,
    signal,
    credentials: 'same-origin',
    headers: arquivo
      ? { 'Content-Type': arquivo.tipo }
      : body !== undefined
        ? { 'Content-Type': 'application/json' }
        : undefined,
    body: arquivo ? arquivo.conteudo : body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErroApi(res.status, dados.erro ?? 'Não foi possível concluir a operação', dados.campos);
  return dados as T;
}
