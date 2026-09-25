-- Índices de trigramas (pg_trgm, criado na 0012) para as buscas por trecho ("contém"/"começa com", sem
-- diferenciar maiúsculas) das listas. Sem eles, `ilike '%texto%'` lê a tabela inteira.
-- Ficam fora do schema.ts, como o materiais_descricao_trgm: o Drizzle não descreve operator class de GIN.
CREATE INDEX "clientes_nome_trgm" ON "clientes" USING gin ("nome" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clientes_cpf_cnpj_trgm" ON "clientes" USING gin ("cpf_cnpj" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clientes_telefone_trgm" ON "clientes" USING gin ("telefone" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clientes_whatsapp_trgm" ON "clientes" USING gin ("whatsapp" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "veiculos_placa_trgm" ON "veiculos" USING gin ("placa" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "veiculos_marca_trgm" ON "veiculos" USING gin ("marca" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "veiculos_modelo_trgm" ON "veiculos" USING gin ("modelo" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "materiais_sku_trgm" ON "materiais" USING gin ("sku" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "materiais_codigo_fabricante_trgm" ON "materiais" USING gin ("codigo_fabricante" gin_trgm_ops);--> statement-breakpoint
-- Busca de vendedores por nome (o nome é do usuário) e por matrícula.
CREATE INDEX "users_nome_trgm" ON "users" USING gin ("nome" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "vendedores_matricula_trgm" ON "vendedores" USING gin ("matricula" gin_trgm_ops);
