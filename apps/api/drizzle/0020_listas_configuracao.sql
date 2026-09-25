-- Listas de Configurações viram tabelas parametrizáveis: código automático e imutável (sequência por oficina e
-- por lista, via contadores/proximo_codigo da 0018) e descrição opcional. Itens atuais: código pela ordem de cadastro.
ALTER TABLE "origens_cliente" ADD COLUMN "codigo" integer;
--> statement-breakpoint
ALTER TABLE "origens_cliente" ADD COLUMN "descricao" text;
--> statement-breakpoint
UPDATE origens_cliente l SET codigo = n.codigo
FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY criado_em, nome) AS codigo FROM origens_cliente) n
WHERE l.id = n.id;
--> statement-breakpoint
INSERT INTO contadores (tenant_id, chave, valor)
SELECT tenant_id, 'origens_cliente', max(codigo) FROM origens_cliente GROUP BY tenant_id;
--> statement-breakpoint
ALTER TABLE "origens_cliente" ALTER COLUMN "codigo" SET DEFAULT proximo_codigo('origens_cliente');
--> statement-breakpoint
ALTER TABLE "origens_cliente" ALTER COLUMN "codigo" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "origens_cliente_codigo_unico" ON "origens_cliente" USING btree ("tenant_id","codigo");
--> statement-breakpoint
CREATE TRIGGER origens_cliente_codigo_imutavel BEFORE UPDATE OF codigo ON origens_cliente
  FOR EACH ROW EXECUTE FUNCTION impedir_troca_de_codigo();
--> statement-breakpoint
ALTER TABLE "relacionamentos_cliente" ADD COLUMN "codigo" integer;
--> statement-breakpoint
ALTER TABLE "relacionamentos_cliente" ADD COLUMN "descricao" text;
--> statement-breakpoint
UPDATE relacionamentos_cliente l SET codigo = n.codigo
FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY criado_em, nome) AS codigo FROM relacionamentos_cliente) n
WHERE l.id = n.id;
--> statement-breakpoint
INSERT INTO contadores (tenant_id, chave, valor)
SELECT tenant_id, 'relacionamentos_cliente', max(codigo) FROM relacionamentos_cliente GROUP BY tenant_id;
--> statement-breakpoint
ALTER TABLE "relacionamentos_cliente" ALTER COLUMN "codigo" SET DEFAULT proximo_codigo('relacionamentos_cliente');
--> statement-breakpoint
ALTER TABLE "relacionamentos_cliente" ALTER COLUMN "codigo" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "relacionamentos_cliente_codigo_unico" ON "relacionamentos_cliente" USING btree ("tenant_id","codigo");
--> statement-breakpoint
CREATE TRIGGER relacionamentos_cliente_codigo_imutavel BEFORE UPDATE OF codigo ON relacionamentos_cliente
  FOR EACH ROW EXECUTE FUNCTION impedir_troca_de_codigo();
--> statement-breakpoint
ALTER TABLE "cargos_responsavel" ADD COLUMN "codigo" integer;
--> statement-breakpoint
ALTER TABLE "cargos_responsavel" ADD COLUMN "descricao" text;
--> statement-breakpoint
UPDATE cargos_responsavel l SET codigo = n.codigo
FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY criado_em, nome) AS codigo FROM cargos_responsavel) n
WHERE l.id = n.id;
--> statement-breakpoint
INSERT INTO contadores (tenant_id, chave, valor)
SELECT tenant_id, 'cargos_responsavel', max(codigo) FROM cargos_responsavel GROUP BY tenant_id;
--> statement-breakpoint
ALTER TABLE "cargos_responsavel" ALTER COLUMN "codigo" SET DEFAULT proximo_codigo('cargos_responsavel');
--> statement-breakpoint
ALTER TABLE "cargos_responsavel" ALTER COLUMN "codigo" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "cargos_responsavel_codigo_unico" ON "cargos_responsavel" USING btree ("tenant_id","codigo");
--> statement-breakpoint
CREATE TRIGGER cargos_responsavel_codigo_imutavel BEFORE UPDATE OF codigo ON cargos_responsavel
  FOR EACH ROW EXECUTE FUNCTION impedir_troca_de_codigo();
--> statement-breakpoint
ALTER TABLE "tipos_material" ADD COLUMN "codigo" integer;
--> statement-breakpoint
ALTER TABLE "tipos_material" ADD COLUMN "descricao" text;
--> statement-breakpoint
UPDATE tipos_material l SET codigo = n.codigo
FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY criado_em, nome) AS codigo FROM tipos_material) n
WHERE l.id = n.id;
--> statement-breakpoint
INSERT INTO contadores (tenant_id, chave, valor)
SELECT tenant_id, 'tipos_material', max(codigo) FROM tipos_material GROUP BY tenant_id;
--> statement-breakpoint
ALTER TABLE "tipos_material" ALTER COLUMN "codigo" SET DEFAULT proximo_codigo('tipos_material');
--> statement-breakpoint
ALTER TABLE "tipos_material" ALTER COLUMN "codigo" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "tipos_material_codigo_unico" ON "tipos_material" USING btree ("tenant_id","codigo");
--> statement-breakpoint
CREATE TRIGGER tipos_material_codigo_imutavel BEFORE UPDATE OF codigo ON tipos_material
  FOR EACH ROW EXECUTE FUNCTION impedir_troca_de_codigo();
--> statement-breakpoint
ALTER TABLE "tipos_deposito" ADD COLUMN "codigo" integer;
--> statement-breakpoint
ALTER TABLE "tipos_deposito" ADD COLUMN "descricao" text;
--> statement-breakpoint
UPDATE tipos_deposito l SET codigo = n.codigo
FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY criado_em, nome) AS codigo FROM tipos_deposito) n
WHERE l.id = n.id;
--> statement-breakpoint
INSERT INTO contadores (tenant_id, chave, valor)
SELECT tenant_id, 'tipos_deposito', max(codigo) FROM tipos_deposito GROUP BY tenant_id;
--> statement-breakpoint
ALTER TABLE "tipos_deposito" ALTER COLUMN "codigo" SET DEFAULT proximo_codigo('tipos_deposito');
--> statement-breakpoint
ALTER TABLE "tipos_deposito" ALTER COLUMN "codigo" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "tipos_deposito_codigo_unico" ON "tipos_deposito" USING btree ("tenant_id","codigo");
--> statement-breakpoint
CREATE TRIGGER tipos_deposito_codigo_imutavel BEFORE UPDATE OF codigo ON tipos_deposito
  FOR EACH ROW EXECUTE FUNCTION impedir_troca_de_codigo();
