-- Busca por trecho com índice sob RLS (docs/performance/DATABASE.md §Busca).
--
-- Problema: ILIKE/LIKE não são "leakproof", e o Postgres não usa como condição de índice um filtro não leakproof
-- antes da política de RLS. Para a aplicação (mobios_app, sujeita ao RLS), os índices de trigramas da 0019 nunca
-- eram usados: toda busca lia todas as linhas da oficina.
--
-- Solução: funções SECURITY DEFINER (rodam como o dono das tabelas, fora do RLS) que filtram a oficina
-- EXPLICITAMENTE por app.tenant_id e devolvem só ids. A consulta da rota continua sujeita ao RLS
-- (`id in (select busca_x(...))`): mesmo que uma função errasse o filtro, nenhum dado de outra oficina seria lido.
-- Sem app.tenant_id definido, o filtro é NULL e nada é devolvido.
--
-- Índices: os de trigramas passam a ser GIN compostos (tenant_id, coluna), com btree_gin para o uuid. O índice
-- só de trigramas cobre todas as oficinas: numa oficina pequena, "silva" percorria as ocorrências das outras.
-- Os padrões (%texto%, TEXTO%) são montados na API, como antes; parâmetro NULL = critério não usado.

CREATE EXTENSION IF NOT EXISTS btree_gin;--> statement-breakpoint

DROP INDEX IF EXISTS "clientes_nome_trgm";--> statement-breakpoint
DROP INDEX IF EXISTS "clientes_cpf_cnpj_trgm";--> statement-breakpoint
DROP INDEX IF EXISTS "clientes_telefone_trgm";--> statement-breakpoint
DROP INDEX IF EXISTS "clientes_whatsapp_trgm";--> statement-breakpoint
DROP INDEX IF EXISTS "veiculos_placa_trgm";--> statement-breakpoint
DROP INDEX IF EXISTS "veiculos_marca_trgm";--> statement-breakpoint
DROP INDEX IF EXISTS "veiculos_modelo_trgm";--> statement-breakpoint
DROP INDEX IF EXISTS "materiais_sku_trgm";--> statement-breakpoint
DROP INDEX IF EXISTS "materiais_codigo_fabricante_trgm";--> statement-breakpoint
DROP INDEX IF EXISTS "materiais_descricao_trgm";--> statement-breakpoint
DROP INDEX IF EXISTS "servicos_nome_trgm";--> statement-breakpoint
DROP INDEX IF EXISTS "users_nome_trgm";--> statement-breakpoint
DROP INDEX IF EXISTS "vendedores_matricula_trgm";--> statement-breakpoint

CREATE INDEX "clientes_nome_trgm" ON "clientes" USING gin ("tenant_id", "nome" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clientes_cpf_cnpj_trgm" ON "clientes" USING gin ("tenant_id", "cpf_cnpj" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clientes_telefone_trgm" ON "clientes" USING gin ("tenant_id", "telefone" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clientes_whatsapp_trgm" ON "clientes" USING gin ("tenant_id", "whatsapp" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "veiculos_placa_trgm" ON "veiculos" USING gin ("tenant_id", "placa" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "veiculos_marca_trgm" ON "veiculos" USING gin ("tenant_id", "marca" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "veiculos_modelo_trgm" ON "veiculos" USING gin ("tenant_id", "modelo" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "materiais_sku_trgm" ON "materiais" USING gin ("tenant_id", "sku" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "materiais_codigo_fabricante_trgm" ON "materiais" USING gin ("tenant_id", "codigo_fabricante" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "materiais_descricao_trgm" ON "materiais" USING gin ("tenant_id", "descricao" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "servicos_nome_trgm" ON "servicos" USING gin ("tenant_id", "nome" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_nome_trgm" ON "users" USING gin ("tenant_id", "nome" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "vendedores_matricula_trgm" ON "vendedores" USING gin ("tenant_id", "matricula" gin_trgm_ops);--> statement-breakpoint

-- Clientes: nome, documento, telefone/WhatsApp (trecho) e placa de um veículo do cliente.
CREATE FUNCTION busca_clientes(p_nome text, p_documento text, p_telefone text, p_placa text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM clientes
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND nome ILIKE p_nome
  UNION
  SELECT id FROM clientes
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND cpf_cnpj ILIKE p_documento
  UNION
  SELECT id FROM clientes
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND telefone ILIKE p_telefone
  UNION
  SELECT id FROM clientes
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND whatsapp ILIKE p_telefone
  UNION
  SELECT cliente_id FROM veiculos
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND placa LIKE p_placa
$$;--> statement-breakpoint

-- Veículos (lista): placa, marca, modelo e nome do dono.
CREATE FUNCTION busca_veiculos(p_placa text, p_trecho text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM veiculos
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND placa ILIKE p_placa
  UNION
  SELECT id FROM veiculos
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND marca ILIKE p_trecho
  UNION
  SELECT id FROM veiculos
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND modelo ILIKE p_trecho
  UNION
  SELECT v.id FROM veiculos v JOIN clientes c ON c.tenant_id = v.tenant_id AND c.id = v.cliente_id
  WHERE c.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND c.nome ILIKE p_trecho
$$;--> statement-breakpoint

-- Produtos: SKU e código do fabricante pelo começo, código de barras exato e descrição por trecho.
CREATE FUNCTION busca_materiais(p_prefixo text, p_codigo_barras text, p_trecho text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM materiais
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND sku ILIKE p_prefixo
  UNION
  SELECT id FROM materiais
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND codigo_fabricante ILIKE p_prefixo
  UNION
  SELECT id FROM materiais
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND codigo_barras = p_codigo_barras
  UNION
  SELECT id FROM materiais
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND descricao ILIKE p_trecho
$$;--> statement-breakpoint

-- Serviços: nome por trecho e código exato.
CREATE FUNCTION busca_servicos(p_trecho text, p_codigo integer)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM servicos
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND nome ILIKE p_trecho
  UNION
  SELECT id FROM servicos
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND codigo = p_codigo
$$;--> statement-breakpoint

-- Vendedores: nome do usuário e matrícula por trecho, código exato.
CREATE FUNCTION busca_vendedores(p_trecho text, p_codigo integer)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT v.id FROM vendedores v JOIN users u ON u.tenant_id = v.tenant_id AND u.id = v.usuario_id
  WHERE u.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND u.nome ILIKE p_trecho
  UNION
  SELECT id FROM vendedores
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND matricula ILIKE p_trecho
  UNION
  SELECT id FROM vendedores
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND codigo = p_codigo
$$;--> statement-breakpoint

-- Orçamentos: número exato, nome do cliente por trecho e placa exata do veículo.
CREATE FUNCTION busca_orcamentos(p_numero integer, p_cliente text, p_placa text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM orcamentos
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND numero = p_numero
  UNION
  SELECT o.id FROM orcamentos o JOIN clientes c ON c.tenant_id = o.tenant_id AND c.id = o.cliente_id
  WHERE c.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND c.nome ILIKE p_cliente
  UNION
  SELECT o.id FROM orcamentos o JOIN veiculos v ON v.tenant_id = o.tenant_id AND v.id = o.veiculo_id
  WHERE v.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND v.placa = p_placa
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION busca_clientes(text, text, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION busca_veiculos(text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION busca_materiais(text, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION busca_servicos(text, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION busca_vendedores(text, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION busca_orcamentos(integer, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION busca_clientes(text, text, text, text) TO mobios_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION busca_veiculos(text, text) TO mobios_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION busca_materiais(text, text, text) TO mobios_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION busca_servicos(text, integer) TO mobios_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION busca_vendedores(text, integer) TO mobios_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION busca_orcamentos(integer, text, text) TO mobios_app;
