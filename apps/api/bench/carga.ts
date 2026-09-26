// Teste de carga concorrente contra o banco mobios_bench (docs/performance/DATABASE.md §Carga). Uma instância da
// API em processo, com o pool de conexões real (DB_POOL_MAX): N usuários da oficina grande fazem, sem pausa, a mistura
// de telas mais pesadas, enquanto um usuário de uma oficina pequena usa as telas dele. Mede vazão, latência
// (p50/p95/p99) e erros de cada grupo: responde se uma oficina muito grande degrada as outras (tenant skew).
//
//   pnpm bench:carga [--concorrencia 20] [--segundos 30]
import { parseArgs } from 'node:util';
import { chamar, encerrar, ids, percentil, type Sessao } from './ambiente.js';

const { values: opcoes } = parseArgs({
  options: {
    concorrencia: { type: 'string', default: '20' },
    segundos: { type: 'string', default: '30' },
  },
});
const concorrencia = Number(opcoes.concorrencia);
const fim = Date.now() + Number(opcoes.segundos) * 1000;

const PESADAS: { sessao: Sessao; url: string }[] = [
  { sessao: 'admin', url: '/api/orcamentos?pagina=1&porPagina=20' },
  { sessao: 'admin', url: '/api/orcamentos?q=silva&porPagina=20' },
  { sessao: 'admin', url: '/api/clientes?q=silva&porPagina=20' },
  { sessao: 'admin', url: '/api/clientes?pagina=1&porPagina=20' },
  { sessao: 'admin', url: `/api/orcamentos/${ids.orcamento}` },
  { sessao: 'admin', url: `/api/orcamentos/apoio/itens?q=filtro&tabelaPrecoId=${ids.tabela}` },
  { sessao: 'admin', url: '/api/materiais?q=pastilha&porPagina=20' },
  { sessao: 'admin', url: '/api/painel?periodo=mes' },
  { sessao: 'vendedor', url: '/api/orcamentos?pagina=1&porPagina=20' },
];
const PEQUENA: { sessao: Sessao; url: string }[] = [
  { sessao: 'pequena', url: '/api/orcamentos?pagina=1&porPagina=20' },
  { sessao: 'pequena', url: '/api/clientes?q=silva&porPagina=20' },
  { sessao: 'pequena', url: `/api/precos/linhas?tabelaPrecoId=${ids.tabelaPequena}&porPagina=20` },
  { sessao: 'pequena', url: '/api/painel?periodo=mes' },
];

type Grupo = { tempos: number[]; erros: number };

/** Um usuário: chama as telas em sequência, sem pausa, até o fim do tempo. */
async function usuario(telas: typeof PESADAS, grupo: Grupo, inicio: number) {
  for (let i = inicio; Date.now() < fim; i++) {
    const tela = telas[i % telas.length]!;
    const antes = performance.now();
    const res = await chamar(tela.sessao, tela.url);
    grupo.tempos.push(performance.now() - antes);
    if (res.statusCode >= 400) grupo.erros++;
  }
}

// Linha de base da oficina pequena, sozinha, antes da carga.
const sozinha: Grupo = { tempos: [], erros: 0 };
for (let i = 0; i < 40; i++) {
  const tela = PEQUENA[i % PEQUENA.length]!;
  const antes = performance.now();
  await chamar(tela.sessao, tela.url);
  sozinha.tempos.push(performance.now() - antes);
}

const grande: Grupo = { tempos: [], erros: 0 };
const pequena: Grupo = { tempos: [], erros: 0 };
const inicio = Date.now();
await Promise.all([
  ...Array.from({ length: concorrencia }, (_, i) => usuario(PESADAS, grande, i)),
  usuario(PEQUENA, pequena, 0),
]);
const duracao = (Date.now() - inicio) / 1000;

const resumo = (nome: string, g: Grupo, segundos?: number) => {
  const t = [...g.tempos].sort((a, b) => a - b);
  const r = (n: number) => Math.round(n * 10) / 10;
  const vazao = segundos ? `${r(t.length / segundos)}` : '—';
  return `| ${nome} | ${t.length} | ${vazao} | ${r(percentil(t, 50))} | ${r(percentil(t, 95))} | ${r(percentil(t, 99))} | ${g.erros} |`;
};

console.log(`Concorrência: ${concorrencia} usuários na oficina grande + 1 na pequena, ${Math.round(duracao)} s.`);
console.log(
  '| Grupo | Requisições | Req/s | p50 (ms) | p95 (ms) | p99 (ms) | Erros |\n|---|---:|---:|---:|---:|---:|---:|',
);
console.log(resumo('Oficina pequena, sozinha (antes)', sozinha));
console.log(resumo('Oficina grande, sob carga', grande, duracao));
console.log(resumo('Oficina pequena, durante a carga', pequena, duracao));

await encerrar();
