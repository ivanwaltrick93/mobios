import type { RelatorioDescricao, RelatorioId, RelatorioPrevia } from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alerta, Botao, Cabecalho, Campo, Cartao, Input, Linha, LinhaVazia, Tabela, Td, TextoSuave, Th, Titulo } from '../components/ui';
import { api, ErroApi } from '../lib/api';

async function baixarCsv(id: RelatorioId, filtro: URLSearchParams) {
  // fetch + blob (em vez de um <a href>) para mostrar na tela eventuais erros da API.
  const res = await fetch(`/api/relatorios/${id}/csv?${filtro}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const dados = await res.json().catch(() => ({}));
    throw new ErroApi(res.status, dados.erro ?? 'Não foi possível gerar o arquivo');
  }
  const nome = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `${id}.csv`;
  const url = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: nome });
  link.click();
  URL.revokeObjectURL(url);
}

export function Relatorios() {
  const lista = useQuery({ queryKey: ['relatorios'], queryFn: () => api<RelatorioDescricao[]>('/relatorios') });
  const [selecionado, setSelecionado] = useState<RelatorioId | null>(null);
  const atual = lista.data?.find((r) => r.id === selecionado) ?? lista.data?.[0];

  if (lista.isError) return <Alerta>{lista.error.message}</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo>Relatórios</Titulo>
      <TextoSuave>Escolha um relatório, filtre pelo período de cadastro e baixe em CSV (abre direto no Excel).</TextoSuave>

      <div className="grid gap-3 md:grid-cols-3">
        {lista.data?.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelecionado(r.id)}
            className={`rounded-lg border p-4 text-left transition ${
              atual?.id === r.id ? 'border-primaria bg-primaria-suave' : 'border-borda bg-superficie hover:border-borda-forte'
            }`}
          >
            <div className={`font-medium ${atual?.id === r.id ? 'text-primaria' : 'text-texto'}`}>{r.titulo}</div>
            <TextoSuave className="mt-1">{r.descricao}</TextoSuave>
          </button>
        ))}
      </div>

      {atual && <Extracao key={atual.id} relatorio={atual} />}
    </div>
  );
}

function Extracao({ relatorio }: { relatorio: RelatorioDescricao }) {
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [baixando, setBaixando] = useState(false);
  const [erroDownload, setErroDownload] = useState<string | null>(null);
  const filtro = new URLSearchParams({ de, ate });

  const previa = useQuery({
    queryKey: ['relatorios', relatorio.id, de, ate],
    queryFn: () => api<RelatorioPrevia>(`/relatorios/${relatorio.id}?${filtro}`),
  });

  async function baixar() {
    setBaixando(true);
    setErroDownload(null);
    try {
      await baixarCsv(relatorio.id, filtro);
    } catch (e) {
      setErroDownload(e instanceof Error ? e.message : 'Erro ao baixar');
    } finally {
      setBaixando(false);
    }
  }

  return (
    <div className="space-y-4">
      <Cartao>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-44">
            <Campo rotulo="Cadastrados de">
              <Input type="date" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} />
            </Campo>
          </div>
          <div className="w-44">
            <Campo rotulo="até">
              <Input type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} />
            </Campo>
          </div>
          {(de || ate) && (
            <Botao variante="secundario" onClick={() => (setDe(''), setAte(''))}>
              Limpar período
            </Botao>
          )}
          <Botao className="ml-auto" disabled={baixando || previa.data?.total === 0} onClick={baixar}>
            {baixando ? 'Gerando…' : 'Baixar CSV'}
          </Botao>
        </div>
        <div className="mt-3">
          <Alerta>{erroDownload ?? (previa.isError && previa.error.message)}</Alerta>
        </div>
      </Cartao>

      {previa.data && (
        <>
          <TextoSuave>
            {previa.data.total.toLocaleString('pt-BR')} registro(s)
            {previa.data.total > previa.data.linhas.length && ` · prévia dos primeiros ${previa.data.linhas.length}; o CSV traz todos`}
          </TextoSuave>
          <Tabela>
            <Cabecalho>
              {previa.data.colunas.map((c) => (
                <Th key={c.chave}>{c.titulo}</Th>
              ))}
            </Cabecalho>
            <tbody>
              {previa.data.linhas.map((l, i) => (
                <Linha key={i}>
                  {previa.data.colunas.map((c, j) => (
                    <Td key={c.chave} suave={j > 0} className="whitespace-nowrap">
                      {l[c.chave] || '—'}
                    </Td>
                  ))}
                </Linha>
              ))}
              {previa.data.linhas.length === 0 && <LinhaVazia colunas={previa.data.colunas.length}>Nenhum registro no período.</LinhaVazia>}
            </tbody>
          </Tabela>
        </>
      )}
    </div>
  );
}
