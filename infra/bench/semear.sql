-- Dados sintéticos para benchmark (docs/performance/DATABASE.md §Benchmark). Roda SÓ no banco mobios_bench,
-- como dono (mobios), depois das migrações. Nunca no banco de uso nem no de testes.
--
-- Perfil: 1 oficina grande (a do admin criado pela migração), 5 médias e 100 pequenas, para medir o efeito de
-- uma oficina muito grande sobre as outras (tenant skew). Gatilhos desligados (session_replication_role) só
-- para a carga em massa: os dados já nascem consistentes, e CHECK/UNIQUE continuam valendo.

\set ON_ERROR_STOP on
select current_database() = 'mobios_bench' as banco_certo \gset
\if :banco_certo
\else
  \echo 'Este script só roda no banco mobios_bench.'
  \quit
\endif

set session_replication_role = replica;
set synchronous_commit = off;

create or replace function pg_temp.semear(
  p_tenant uuid,
  p_clientes int,
  p_orcamentos int,
  p_materiais int,
  p_servicos int,
  p_vendedores int
) returns void language plpgsql as $$
declare
  v_admin uuid;
  v_tipo_material uuid;
  v_tipo_deposito uuid;
  v_categoria uuid;
  v_tabela uuid;
begin
  perform set_config('app.tenant_id', p_tenant::text, true);

  -- Usuário admin (a oficina grande já tem; as outras ganham um sem senha válida: não entram pela tela).
  select id into v_admin from users where tenant_id = p_tenant order by codigo limit 1;
  if v_admin is null then
    insert into users (tenant_id, nome, email, senha_hash, codigo)
    values (p_tenant, 'Admin', 'admin-' || p_tenant || '@bench.local', 'sem-login', 1)
    returning id into v_admin;
  end if;

  select id into v_tipo_material from tipos_material where tenant_id = p_tenant limit 1;
  if v_tipo_material is null then
    insert into tipos_material (tenant_id, nome, codigo) values (p_tenant, 'Peça', 1) returning id into v_tipo_material;
  end if;
  select id into v_tipo_deposito from tipos_deposito where tenant_id = p_tenant limit 1;
  if v_tipo_deposito is null then
    insert into tipos_deposito (tenant_id, nome, codigo) values (p_tenant, 'Loja', 1) returning id into v_tipo_deposito;
  end if;
  insert into categorias (tenant_id, codigo, nome) values (p_tenant, 'GERAL', 'Geral') returning id into v_categoria;
  insert into tabelas_preco (tenant_id, codigo, nome, padrao) values (p_tenant, '01', 'Varejo', true)
  returning id into v_tabela;

  insert into depositos (tenant_id, codigo, nome, tipo_id)
  select p_tenant, 'D' || d, 'Depósito ' || d, v_tipo_deposito from generate_series(1, 3) d;

  -- Vendedores (cada um com o próprio usuário).
  create temp table ven as
  with u as (
    insert into users (tenant_id, nome, email, senha_hash, codigo)
    select p_tenant, 'Vendedor ' || i, 'vendedor-' || i || '-' || p_tenant || '@bench.local', 'sem-login', 100 + i
    from generate_series(1, p_vendedores) i
    returning id
  )
  select row_number() over () - 1 as idx, id from u;
  create temp table vend as
  with v as (
    insert into vendedores (tenant_id, codigo, usuario_id, whatsapp)
    select p_tenant, idx + 1, id, '48999990000' from ven
    returning id
  )
  select row_number() over () - 1 as idx, id from v;

  -- Produtos: descrições com palavras comuns do ramo, para a busca por trecho encontrar resultados realistas.
  create temp table mat as
  with m as (
    insert into materiais (tenant_id, sku, descricao, tipo_id, categoria_id, unidade, codigo_fabricante, pmc_centavos)
    select p_tenant,
      'SKU' || lpad(i::text, 7, '0'),
      (array['FILTRO DE OLEO','FILTRO DE AR','PASTILHA DE FREIO','DISCO DE FREIO','AMORTECEDOR','VELA DE IGNICAO',
             'CORREIA DENTADA','OLEO MOTOR 5W30','BOMBA DAGUA','EMBREAGEM KIT','LAMPADA H4','PALHETA LIMPADOR'])
        [1 + i % 12] || ' ' || (array['BOSCH','MANN','FRAS-LE','COFAP','NGK','GATES','MOBIL','SKF','VALEO','OSRAM'])
        [1 + (i / 12) % 10] || ' ' || (i % 997),
      v_tipo_material, v_categoria, 'UN',
      upper(substr(md5(i::text), 1, 8)),
      1000 + (i * 37) % 50000
    from generate_series(1, p_materiais) i
    returning id, pmc_centavos
  )
  select row_number() over () - 1 as idx, id, pmc_centavos, 2000 + (row_number() over () * 53) % 90000 as preco from m;

  insert into materiais_precos (tenant_id, material_id, tabela_preco_id, preco_centavos, data_inicio)
  select p_tenant, id, v_tabela, preco, date '2025-01-01' from mat;

  insert into estoques (tenant_id, material_id, deposito_id, disponivel)
  select p_tenant, m.id, d.id, (m.idx % 40)
  from mat m cross join depositos d
  where d.tenant_id = p_tenant and (m.idx + right(d.codigo, 1)::int) % 3 <> 0;

  create temp table ser as
  with s as (
    insert into servicos (tenant_id, codigo, nome, forma_preco, tempo_minutos)
    select p_tenant, i,
      (array['TROCA DE OLEO','ALINHAMENTO','BALANCEAMENTO','REVISAO','DIAGNOSTICO','TROCA DE PASTILHA'])[1 + i % 6]
        || ' ' || i,
      case when i % 3 = 0 then 'hora' else 'fechado' end::forma_preco_servico,
      case when i % 3 = 0 then 60 end
    from generate_series(1, p_servicos) i
    returning id, forma_preco
  )
  select row_number() over () - 1 as idx, id, forma_preco, 5000 + (row_number() over () * 71) % 30000 as preco from s;

  insert into materiais_precos (tenant_id, servico_id, tabela_preco_id, preco_centavos, data_inicio)
  select p_tenant, id, v_tabela, preco, date '2025-01-01' from ser;

  -- Clientes (PF), com endereço principal e ao menos um veículo.
  create temp table cli as
  with c as (
    insert into clientes (tenant_id, tipo, nome, cpf_cnpj, telefone, whatsapp, cliente_desde, data_nascimento)
    select p_tenant, 'PF',
      (array['Ana','Bruno','Carla','Diego','Eduarda','Felipe','Gabriela','Henrique','Isabela','João','Karina',
             'Lucas','Mariana','Nicolas','Olivia','Pedro','Rafaela','Samuel','Tatiana','Vinicius'])[1 + i % 20]
        || ' ' || (array['Silva','Souza','Oliveira','Santos','Pereira','Costa','Rodrigues','Almeida','Nascimento',
             'Lima','Araújo','Fernandes','Carvalho','Gomes','Martins','Rocha','Ribeiro','Alves','Monteiro','Mendes'])
             [1 + (i / 20) % 20]
        || ' ' || (array['Junior','Filho','Neto','Sobrinho','da Luz','do Carmo','Prado','Moura','Teixeira','Barros'])
             [1 + (i / 400) % 10],
      lpad(i::text, 11, '0'),
      '48' || lpad(((i::bigint * 7919) % 100000000)::text, 8, '0'),
      '489' || lpad(((i::bigint * 104729) % 100000000)::text, 8, '0'),
      date '2015-01-01' + (i % 3650),
      date '1960-01-01' + (i * 13) % 16000
    from generate_series(1, p_clientes) i
    returning id
  )
  select row_number() over () - 1 as idx, id from c;

  insert into cliente_enderecos (tenant_id, cliente_id, tipo, cep, logradouro, numero, bairro, cidade, uf, principal)
  select p_tenant, id, 'residencial', '88015100', 'Rua ' || idx, (idx % 900)::text, 'Centro',
    (array['Florianópolis','São José','Palhoça','Joinville','Blumenau'])[1 + idx % 5], 'SC', true
  from cli;

  -- Placa única por oficina a partir do índice (formato Mercosul LLLNLNN).
  create temp table vei as
  with v as (
    insert into veiculos (tenant_id, cliente_id, placa, marca, modelo, ano_fabricacao, ano_modelo, principal)
    select p_tenant, c.id,
      chr(65 + (i / 26000) % 26) || chr(65 + (i / 676000) % 26) || chr(65 + (i / 17576000) % 26)
        || (i % 10)::text || chr(65 + (i / 10) % 26) || lpad(((i / 260) % 100)::text, 2, '0'),
      (array['Fiat','Volkswagen','Chevrolet','Ford','Toyota','Honda','Hyundai','Renault'])[1 + i % 8],
      (array['Uno','Gol','Onix','Ka','Corolla','Civic','HB20','Sandero','Argo','Polo'])[1 + (i / 8) % 10],
      2005 + i % 20, 2005 + i % 20,
      i < p_clientes
    from generate_series(0, p_clientes + p_clientes / 5 - 1) i
    join cli c on c.idx = i % p_clientes
    returning id, cliente_id
  )
  select row_number() over () - 1 as idx, id, cliente_id from v;

  -- Orçamentos (versão 1), com situação variada e datas nos últimos dois anos.
  create temp table orc as
  with base as (
    select i,
      (array['aprovado','aprovado','aprovado','aprovado','aprovado','emitido','emitido','enviado','recusado',
             'rascunho','cancelado','reprovado_comercialmente','aguardando_aprovacao_comercial'])[1 + i % 13]
        ::status_orcamento as status,
      now() - ((i::bigint * 7919) % 730) * interval '1 day' - (i % 86400) * interval '1 second' as criado
    from generate_series(1, p_orcamentos) i
  ), o as (
    insert into orcamentos (tenant_id, numero, status, cliente_id, veiculo_id, vendedor_id, tabela_preco_id,
      validade_ate, precos_em, criado_por, atualizado_por, criado_em, atualizado_em, emitido_em, aprovado_em)
    select p_tenant, b.i, b.status, v.cliente_id, v.id, vd.id, v_tabela,
      case when b.status in ('emitido','enviado','aprovado','recusado') then (b.criado + interval '7 days')::date end,
      b.criado::date, v_admin, v_admin, b.criado, b.criado,
      case when b.status in ('emitido','enviado','aprovado','recusado') then b.criado + interval '1 hour' end,
      case when b.status = 'aprovado' then b.criado + interval '2 days' end
    from base b
    join vei v on v.idx = (b.i * 31) % (select count(*) from vei)
    join vend vd on vd.idx = b.i % p_vendedores
    returning id, criado_em
  )
  select row_number() over () - 1 as idx, id, criado_em from o;

  -- Itens: 4 produtos (alguns com desconto) e 1 serviço por orçamento.
  insert into orcamento_itens (tenant_id, orcamento_id, ordem, tipo, material_id, codigo, descricao, unidade,
    multiplo, quantidade, preco_tabela_centavos, preco_unitario_centavos, desconto_percentual, bruto_centavos,
    desconto_centavos, total_centavos, pmc_centavos)
  select p_tenant, o.id, n, 'material', m.id, 'SKU', 'Produto', 'UN', 1, q,
    m.preco, m.preco - m.preco * d / 10000, nullif(d, 0), m.preco * q, m.preco * d / 10000 * q,
    m.preco * q - m.preco * d / 10000 * q, m.pmc_centavos
  from orc o
  cross join generate_series(1, 4) n
  cross join lateral (select 1 + (o.idx + n) % 4 as q, case when (o.idx + n) % 5 = 0 then 500 else 0 end as d) x
  join mat m on m.idx = (o.idx * 4 + n * 7919) % (select count(*) from mat);

  insert into orcamento_itens (tenant_id, orcamento_id, ordem, tipo, servico_id, codigo, descricao, unidade,
    forma_preco, multiplo, quantidade, tempo_minutos, preco_tabela_centavos, preco_unitario_centavos,
    bruto_centavos, desconto_centavos, total_centavos)
  select p_tenant, o.id, 5, 'servico', s.id, '000001', 'Serviço', case when s.forma_preco = 'hora' then 'H' else 'UN' end,
    s.forma_preco, case when s.forma_preco = 'hora' then 60 else 1 end,
    case when s.forma_preco = 'hora' then null else 1 end,
    case when s.forma_preco = 'hora' then 60 end,
    s.preco, s.preco, s.preco, 0, s.preco
  from orc o
  join ser s on s.idx = o.idx % (select count(*) from ser);

  update orcamentos o set subtotal_centavos = t.bruto, desconto_centavos = t.desconto, total_centavos = t.total
  from (
    select orcamento_id, sum(bruto_centavos) bruto, sum(desconto_centavos) desconto, sum(total_centavos) total
    from orcamento_itens where tenant_id = p_tenant group by orcamento_id
  ) t
  where o.id = t.orcamento_id;

  insert into orcamentos_eventos (tenant_id, orcamento_id, evento, detalhe, usuario_id, criado_em)
  select p_tenant, o.id, e.evento::evento_orcamento, 'Carga de benchmark', v_admin, o.criado_em + e.atraso
  from orc o
  cross join (values ('criado', interval '0'), ('alterado', interval '10 minutes')) e(evento, atraso);

  -- Aprovações comerciais: as pendentes e as reprovadas correspondem às situações dos orçamentos.
  insert into aprovacoes_comerciais (tenant_id, tipo_documento, orcamento_id, documento_numero, documento_versao,
    cliente_nome, subtotal_centavos, desconto_centavos, total_centavos, percentual, solicitante_id,
    alcada_solicitante, status, decidido_por, alcada_decisor, decidido_em, justificativa, snapshot, criado_em)
  select p_tenant, 'orcamento', o.id, 'ORC-' || lpad(o.numero::text, 10, '0'), 1, c.nome, o.subtotal_centavos,
    greatest(o.desconto_centavos, 1), o.subtotal_centavos - greatest(o.desconto_centavos, 1), 1500, u.id, 500,
    case when o.status = 'aguardando_aprovacao_comercial' then 'pendente' else 'reprovada' end::status_aprovacao_comercial,
    case when o.status = 'reprovado_comercialmente' then v_admin end,
    case when o.status = 'reprovado_comercialmente' then 10000 end,
    case when o.status = 'reprovado_comercialmente' then o.criado_em + interval '1 day' end,
    case when o.status = 'reprovado_comercialmente' then 'Desconto acima do permitido.' end,
    '{}'::jsonb, o.criado_em
  from orcamentos o
  join clientes c on c.id = o.cliente_id
  join vendedores vd on vd.id = o.vendedor_id
  join users u on u.id = vd.usuario_id
  where o.tenant_id = p_tenant and o.status in ('aguardando_aprovacao_comercial', 'reprovado_comercialmente');

  -- Contadores coerentes com os códigos gerados (novos cadastros pela API continuam a sequência).
  insert into contadores (tenant_id, chave, valor) values
    (p_tenant, 'orcamentos', p_orcamentos), (p_tenant, 'servicos', p_servicos),
    (p_tenant, 'vendedores', p_vendedores), (p_tenant, 'usuarios', 100 + p_vendedores)
  on conflict (tenant_id, chave) do update set valor = greatest(contadores.valor, excluded.valor);

  drop table ven, vend, mat, ser, cli, vei, orc;
end;
$$;

\timing on
\echo 'Oficina grande (a do admin criado pela migração)'
begin;
select pg_temp.semear((select id from tenants order by criado_em limit 1), 200000, 300000, 30000, 300, 20);
commit;

\echo '5 oficinas médias'
begin;
with t as (insert into tenants (nome) select 'Oficina média ' || i from generate_series(1, 5) i returning id)
select pg_temp.semear(id, 20000, 30000, 5000, 100, 5) from t;
commit;

\echo '100 oficinas pequenas'
begin;
with t as (insert into tenants (nome) select 'Oficina pequena ' || i from generate_series(1, 100) i returning id)
select pg_temp.semear(id, 300, 200, 500, 30, 2) from t;
commit;

set session_replication_role = origin;
vacuum analyze;
