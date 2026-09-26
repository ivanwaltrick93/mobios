// Benchmark das rotas críticas contra o banco mobios_bench (docs/performance/DATABASE.md §Benchmark).
// Sobe a API em processo (app.inject, sem rede), entra como admin da oficina grande, como vendedor e como admin de
// uma oficina pequena, e mede cada cenário: p50/p95 da requisição inteira e quantas consultas SQL ela faz
// (pg_stat_statements). Uso, em apps/api, depois de `sh infra/bench/preparar.sh`:
//
//   pnpm bench [--saida arquivo.json] [--filtro texto] [--repeticoes 15]
//
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chamar as chamarComo, dono, encerrar, ids, percentil, type Sessao } from './ambiente.js';

const { values: opcoes } = parseArgs({
  options: {
    saida: { type: 'string' },
    filtro: { type: 'string' },
    repeticoes: { type: 'string', default: '15' },
  },
});

const cenarios: { nome: string; sessao: Sessao; url: string }[] = [
  { nome: 'autenticação (GET /alcadas/minha)', sessao: 'admin', url: '/api/alcadas/minha' },
  { nome: 'orçamentos: 1ª página', sessao: 'admin', url: '/api/orcamentos?pagina=1&porPagina=20' },
  { nome: 'orçamentos: página 1000', sessao: 'admin', url: '/api/orcamentos?pagina=1000&porPagina=20' },
  { nome: 'orçamentos: busca "silva"', sessao: 'admin', url: '/api/orcamentos?q=silva&porPagina=20' },
  { nome: 'orçamentos: busca pelo número', sessao: 'admin', url: '/api/orcamentos?q=ORC-0000123456' },
  { nome: 'orçamentos: situação aprovado', sessao: 'admin', url: '/api/orcamentos?situacao=aprovado&porPagina=20' },
  { nome: 'orçamentos: do vendedor', sessao: 'vendedor', url: '/api/orcamentos?pagina=1&porPagina=20' },
  { nome: 'orçamento: detalhe', sessao: 'admin', url: `/api/orcamentos/${ids.orcamento}` },
  { nome: 'clientes: 1ª página', sessao: 'admin', url: '/api/clientes?pagina=1&porPagina=20' },
  { nome: 'clientes: busca "silva"', sessao: 'admin', url: '/api/clientes?q=silva&porPagina=20' },
  { nome: 'clientes: busca "mariana prado"', sessao: 'admin', url: '/api/clientes?q=mariana%20prado' },
  { nome: 'clientes: busca por telefone', sessao: 'admin', url: '/api/clientes?q=4899123' },
  { nome: 'veículos: busca "onix"', sessao: 'admin', url: '/api/veiculos/lista?q=onix&porPagina=20' },
  { nome: 'produtos: busca "pastilha"', sessao: 'admin', url: '/api/materiais?q=pastilha&porPagina=20' },
  { nome: 'produtos: busca por SKU', sessao: 'admin', url: '/api/materiais?q=SKU00123' },
  {
    nome: 'orçamento: busca de itens "filtro"',
    sessao: 'admin',
    url: `/api/orcamentos/apoio/itens?q=filtro&tabelaPrecoId=${ids.tabela}`,
  },
  { nome: 'estoque: 1ª página', sessao: 'admin', url: '/api/estoque?pagina=1&porPagina=20' },
  { nome: 'estoque: busca "amortecedor"', sessao: 'admin', url: '/api/estoque?q=amortecedor&porPagina=20' },
  { nome: 'preços: 1ª página', sessao: 'admin', url: `/api/precos/linhas?tabelaPrecoId=${ids.tabela}&porPagina=20` },
  {
    nome: 'preços: busca "correia"',
    sessao: 'admin',
    url: `/api/precos/linhas?tabelaPrecoId=${ids.tabela}&q=correia&porPagina=20`,
  },
  { nome: 'painel (mês)', sessao: 'admin', url: '/api/painel?periodo=mes' },
  { nome: 'painel do vendedor (mês)', sessao: 'vendedor', url: '/api/painel?periodo=mes' },
  {
    nome: 'aprovações: pendentes',
    sessao: 'admin',
    url: '/api/aprovacoes-comerciais?status=pendente&porPagina=20',
  },
  {
    nome: 'relatório de clientes (prévia, 1 ano)',
    sessao: 'admin',
    url: '/api/relatorios/clientes?de=2025-01-01&ate=2025-12-31',
  },
  { nome: 'oficina pequena: orçamentos', sessao: 'pequena', url: '/api/orcamentos?pagina=1&porPagina=20' },
  { nome: 'oficina pequena: busca "silva"', sessao: 'pequena', url: '/api/clientes?q=silva&porPagina=20' },
  {
    nome: 'oficina pequena: preços',
    sessao: 'pequena',
    url: `/api/precos/linhas?tabelaPrecoId=${ids.tabelaPequena}&porPagina=20`,
  },
];

const repeticoes = Number(opcoes.repeticoes);
const resultados: { nome: string; p50: number; p95: number; consultas: number; status: number }[] = [];

for (const c of cenarios.filter((x) => !opcoes.filtro || x.nome.includes(opcoes.filtro))) {
  const chamar = () => chamarComo(c.sessao, c.url);
  // Aquece o cache do Postgres e os planos antes de medir.
  for (let i = 0; i < 3; i++) await chamar();
  await dono`select pg_stat_statements_reset()`;
  const tempos: number[] = [];
  let status = 0;
  for (let i = 0; i < repeticoes; i++) {
    const inicio = performance.now();
    const res = await chamar();
    tempos.push(performance.now() - inicio);
    status = res.statusCode;
  }
  const [{ chamadas }] = (await dono`select coalesce(sum(calls), 0)::int as chamadas from pg_stat_statements s
    join pg_roles r on r.oid = s.userid where r.rolname = 'mobios_app'
    and s.dbid = (select oid from pg_database where datname = 'mobios_bench')`) as unknown as [{ chamadas: number }];
  tempos.sort((a, b) => a - b);
  resultados.push({
    nome: c.nome,
    p50: Math.round(percentil(tempos, 50) * 10) / 10,
    p95: Math.round(percentil(tempos, 95) * 10) / 10,
    consultas: Math.round((chamadas / repeticoes) * 10) / 10,
    status,
  });
}

console.log('| Cenário | p50 (ms) | p95 (ms) | Consultas SQL | HTTP |\n|---|---:|---:|---:|---:|');
for (const r of resultados) console.log(`| ${r.nome} | ${r.p50} | ${r.p95} | ${r.consultas} | ${r.status} |`);
if (opcoes.saida) writeFileSync(opcoes.saida, JSON.stringify(resultados, null, 2));

await encerrar();
