export class ErroApi extends Error {
  constructor(
    public status: number,
    message: string,
    public campos?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function api<T>(caminho: string, opcoes: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${caminho}`, {
    method: opcoes.method ?? 'GET',
    credentials: 'same-origin',
    headers: opcoes.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opcoes.body !== undefined ? JSON.stringify(opcoes.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErroApi(res.status, dados.erro ?? 'Não foi possível concluir a operação', dados.campos);
  return dados as T;
}
