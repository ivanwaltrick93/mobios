import { readdirSync, readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db, withTenant } from './db/client.js';
import { cliente, novaOficina, veiculo } from './testes/apoio.js';

// Isolamento entre oficinas (RLS): toda tabela de negócio com tenant_id tem RLS ativo.

describe('isolamento entre oficinas (RLS)', () => {
  it('uma oficina não enxerga nem altera dados de outra', async () => {
    const a = await novaOficina('Oficina A');
    const b = await novaOficina('Oficina B');

    const clienteA = (await a.chamar('POST', '/api/clientes', cliente({ nome: 'Cliente da A' }))).json();

    expect((await b.chamar('GET', '/api/clientes')).json()).toEqual({ itens: [], total: 0 });
    expect((await b.chamar('GET', `/api/clientes/${clienteA.id}`)).statusCode).toBe(404);
    expect((await b.chamar('PUT', `/api/clientes/${clienteA.id}`, cliente({ nome: 'Invadido' }))).statusCode).toBe(404);
    expect((await b.chamar('DELETE', `/api/clientes/${clienteA.id}`)).statusCode).toBe(404);

    // FK composta impede vincular um veículo ao cliente de outra oficina.
    const invasao = await b.chamar('POST', '/api/veiculos', veiculo(clienteA.id));
    expect(invasao.statusCode).toBe(409);

    const listaA = (await a.chamar('GET', '/api/clientes')).json();
    expect(listaA.itens.map((c: { nome: string }) => c.nome)).toEqual(['Cliente da A']);
  });

  it('sem tenant definido, o banco não devolve nenhuma linha', async () => {
    for (const tabela of [
      'clientes',
      'veiculos',
      'users',
      'tenant_logos',
      'tenant_aparencia',
      'funcoes',
      'funcao_permissoes',
      'usuario_funcoes',
      'usuario_fotos',
      'cliente_enderecos',
      'origens_cliente',
      'relacionamentos_cliente',
      'cliente_responsaveis',
      'cargos_responsavel',
      'tipos_material',
      'tipos_deposito',
      'categorias',
      'marcas',
      'materiais',
      'depositos',
      'tabelas_preco',
      'materiais_precos',
      'precos_eventos',
      'estoques',
      'estoque_ajustes',
      'precos_padrao',
      'precos_padrao_eventos',
      'servicos',
      'classificacoes_servico',
      'orcamentos',
      'orcamento_itens',
      'orcamentos_eventos',
      'alcadas_desconto',
      'alcadas_desconto_eventos',
      'aprovacoes_comerciais',
      'aprovacoes_comerciais_eventos',
      'materiais_pmc_eventos',
      'ordens_servico',
      'os_itens',
      'os_eventos',
      'os_mecanicos',
      'os_checklist',
      'os_fotos',
      'os_item_mecanicos',
      'os_solicitacoes_peca',
    ]) {
      const linhas = await db.execute(sql`select count(*)::int as n from ${sql.identifier(tabela)}`);
      expect(linhas[0]!.n, tabela).toBe(0);
    }
  });

  it('toda tabela com tenant_id tem RLS ativo', async () => {
    const semRls = await db.execute(sql`
      select c.relname from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
      where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
        and not c.relrowsecurity`);
    expect(semRls.map((r) => r.relname)).toEqual([]);
  });
});

// Busca por trecho (migração 0028): funções SECURITY DEFINER que filtram a oficina por app.tenant_id, porque ILIKE
// direto na consulta não usa índice sob o RLS (docs/performance/DATABASE.md §Busca).
describe('busca por trecho sob RLS', () => {
  const FUNCOES = [
    'busca_clientes',
    'busca_veiculos',
    'busca_materiais',
    'busca_servicos',
    'busca_vendedores',
    'busca_orcamentos',
    'busca_ordens_servico',
  ];
  const oficina = async (a: Awaited<ReturnType<typeof novaOficina>>) =>
    (await a.chamar('GET', '/api/auth/sessao')).json().oficina.id as string;

  it('a busca de uma oficina não encontra os cadastros de outra, mesmo com o mesmo nome', async () => {
    const a = await novaOficina('Oficina Busca A');
    const b = await novaOficina('Oficina Busca B');
    const nome = `Homônimo ${Math.random().toString(36).slice(2, 8)}`;
    const deA = (await a.chamar('POST', '/api/clientes', cliente({ nome }))).json();
    const deB = (await b.chamar('POST', '/api/clientes', cliente({ nome }))).json();

    const buscaA = (await a.chamar('GET', `/api/clientes?q=${encodeURIComponent(nome)}`)).json();
    expect(buscaA.itens.map((c: { id: string }) => c.id)).toEqual([deA.id]);
    const buscaB = (await b.chamar('GET', `/api/clientes?q=${encodeURIComponent(nome)}`)).json();
    expect(buscaB.itens.map((c: { id: string }) => c.id)).toEqual([deB.id]);

    // A própria função, chamada direto: só ids da oficina corrente, e nada sem oficina definida.
    const ids = async (tenant: string | null) =>
      (
        (await (tenant
          ? withTenant(tenant, (tx) => tx.execute(sql`select busca_clientes(${`%${nome}%`}, null, null, null) as id`))
          : db.execute(sql`select busca_clientes(${`%${nome}%`}, null, null, null) as id`))) as unknown as {
          id: string;
        }[]
      ).map((r) => r.id);
    expect(await ids(await oficina(a))).toEqual([deA.id]);
    expect(await ids(await oficina(b))).toEqual([deB.id]);
    expect(await ids(null)).toEqual([]);
  });

  it('as funções rodam com search_path fixo e só a aplicação pode executá-las', async () => {
    const linhas = (await db.execute(sql`
      select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as config,
        has_function_privilege('mobios_app', p.oid, 'execute') as app,
        exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as publico
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'busca\_%'
      order by p.proname`)) as unknown as {
      proname: string;
      prosecdef: boolean;
      config: string;
      app: boolean;
      publico: boolean;
    }[];
    expect(linhas.map((l) => l.proname).sort()).toEqual([...FUNCOES].sort());
    for (const l of linhas) {
      expect(l, l.proname).toMatchObject({
        prosecdef: true,
        config: 'search_path=public, pg_temp',
        app: true,
        publico: false,
      });
    }
  });

  it('nenhuma rota filtra tabela de negócio com ILIKE direto (sob o RLS, ele não usa índice)', () => {
    // Exceção consciente: a lista de aprovações comerciais busca no nome do cliente guardado no pedido, tabela
    // pequena por oficina e sem índice de trigramas.
    const permitido = ['aprovacoes-comerciais/routes.ts'];
    const raiz = new URL('./modules/', import.meta.url);
    const arquivos = readdirSync(raiz, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    const comIlike = arquivos.filter(
      (f) => !permitido.includes(f) && /\bilike\(|\bILIKE\b/.test(readFileSync(new URL(f, raiz), 'utf8')),
    );
    expect(comIlike).toEqual([]);
  });
});
