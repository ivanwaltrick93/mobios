CREATE TYPE "public"."evento_preco" AS ENUM('criado', 'alterado', 'encerrado', 'cancelado', 'reaberto');--> statement-breakpoint
CREATE TYPE "public"."unidade_medida" AS ENUM('UN', 'PC', 'PAR', 'JG', 'KIT', 'CX', 'L', 'ML', 'KG', 'G', 'M');--> statement-breakpoint
-- Módulos novos "Materiais" e "Preços": o tipo é recriado (ADD VALUE não pode ser usado na mesma transação; ver 0008).
ALTER TYPE "public"."modulo" RENAME TO "modulo_antigo";--> statement-breakpoint
CREATE TYPE "public"."modulo" AS ENUM('clientes', 'os', 'pecas_os', 'materiais', 'precos', 'estoque', 'recebimentos', 'financeiro', 'relatorios');--> statement-breakpoint
ALTER TABLE "funcao_permissoes" ALTER COLUMN "modulo" TYPE "public"."modulo" USING "modulo"::text::"public"."modulo";--> statement-breakpoint
DROP TYPE "public"."modulo_antigo";--> statement-breakpoint
CREATE TABLE "categorias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"codigo" text,
	"nome" text NOT NULL,
	"descricao" text,
	"categoria_pai_id" uuid,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_por" uuid,
	"atualizado_por" uuid,
	"versao" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categorias_tenantId_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "categorias_pai_diferente" CHECK ("categorias"."categoria_pai_id" <> "categorias"."id")
);
--> statement-breakpoint
ALTER TABLE "categorias" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "depositos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"codigo" text NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"tipo_id" uuid NOT NULL,
	"permite_venda" boolean DEFAULT true NOT NULL,
	"permite_uso_os" boolean DEFAULT true NOT NULL,
	"permite_transferencia" boolean DEFAULT true NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_por" uuid,
	"atualizado_por" uuid,
	"versao" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depositos_tenantId_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "depositos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "marcas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"codigo" text,
	"nome" text NOT NULL,
	"descricao" text,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_por" uuid,
	"atualizado_por" uuid,
	"versao" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marcas_tenantId_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "marcas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "materiais" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"sku" text NOT NULL,
	"codigo_barras" text,
	"descricao" text NOT NULL,
	"descricao_curta" text,
	"tipo_id" uuid NOT NULL,
	"categoria_id" uuid NOT NULL,
	"marca_id" uuid,
	"unidade" "unidade_medida" NOT NULL,
	"codigo_fabricante" text,
	"ncm" char(8),
	"cest" char(7),
	"origem" smallint,
	"controla_estoque" boolean DEFAULT true NOT NULL,
	"permite_venda" boolean DEFAULT true NOT NULL,
	"permite_compra" boolean DEFAULT true NOT NULL,
	"permite_uso_os" boolean DEFAULT true NOT NULL,
	"controla_lote" boolean DEFAULT false NOT NULL,
	"controla_serie" boolean DEFAULT false NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_por" uuid,
	"atualizado_por" uuid,
	"versao" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materiais_tenantId_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "materiais_origem_valida" CHECK ("materiais"."origem" between 0 and 8),
	CONSTRAINT "materiais_sku_maiusculo" CHECK ("materiais"."sku" = upper("materiais"."sku"))
);
--> statement-breakpoint
ALTER TABLE "materiais" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "materiais_precos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"tabela_preco_id" uuid NOT NULL,
	"preco_centavos" bigint NOT NULL,
	"data_inicio" date NOT NULL,
	"data_fim" date,
	"cancelado" boolean DEFAULT false NOT NULL,
	"motivo_cancelamento" text,
	"cancelado_em" timestamp with time zone,
	"cancelado_por" uuid,
	"encerrado_pelo_preco_id" uuid,
	"data_fim_anterior" date,
	"criado_por" uuid,
	"atualizado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materiais_precos_tenantId_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "materiais_precos_valor_positivo" CHECK ("materiais_precos"."preco_centavos" >= 0),
	CONSTRAINT "materiais_precos_vigencia_valida" CHECK ("materiais_precos"."data_fim" is null or "materiais_precos"."data_fim" >= "materiais_precos"."data_inicio"),
	CONSTRAINT "materiais_precos_cancelamento" CHECK (not "materiais_precos"."cancelado" or "materiais_precos"."motivo_cancelamento" is not null)
);
--> statement-breakpoint
ALTER TABLE "materiais_precos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "precos_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"preco_id" uuid NOT NULL,
	"evento" "evento_preco" NOT NULL,
	"antes" jsonb,
	"depois" jsonb,
	"usuario_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "precos_eventos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tabelas_preco" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"codigo" text NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"moeda" char(3) DEFAULT 'BRL' NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_por" uuid,
	"atualizado_por" uuid,
	"versao" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tabelas_preco_tenantId_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "tabelas_preco_moeda_iso" CHECK ("tabelas_preco"."moeda" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "tabelas_preco" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tipos_deposito" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"nome" text NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tipos_deposito_tenantId_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "tipos_deposito" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tipos_material" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"nome" text NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tipos_material_tenantId_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "tipos_material" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_tenant_id_categoria_pai_id_categorias_tenant_id_id_fk" FOREIGN KEY ("tenant_id","categoria_pai_id") REFERENCES "public"."categorias"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_tenant_id_criado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","criado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_tenant_id_atualizado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","atualizado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depositos" ADD CONSTRAINT "depositos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depositos" ADD CONSTRAINT "depositos_tenant_id_tipo_id_tipos_deposito_tenant_id_id_fk" FOREIGN KEY ("tenant_id","tipo_id") REFERENCES "public"."tipos_deposito"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depositos" ADD CONSTRAINT "depositos_tenant_id_criado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","criado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depositos" ADD CONSTRAINT "depositos_tenant_id_atualizado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","atualizado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marcas" ADD CONSTRAINT "marcas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marcas" ADD CONSTRAINT "marcas_tenant_id_criado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","criado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marcas" ADD CONSTRAINT "marcas_tenant_id_atualizado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","atualizado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materiais" ADD CONSTRAINT "materiais_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materiais" ADD CONSTRAINT "materiais_tenant_id_tipo_id_tipos_material_tenant_id_id_fk" FOREIGN KEY ("tenant_id","tipo_id") REFERENCES "public"."tipos_material"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materiais" ADD CONSTRAINT "materiais_tenant_id_categoria_id_categorias_tenant_id_id_fk" FOREIGN KEY ("tenant_id","categoria_id") REFERENCES "public"."categorias"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materiais" ADD CONSTRAINT "materiais_tenant_id_marca_id_marcas_tenant_id_id_fk" FOREIGN KEY ("tenant_id","marca_id") REFERENCES "public"."marcas"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materiais" ADD CONSTRAINT "materiais_tenant_id_criado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","criado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materiais" ADD CONSTRAINT "materiais_tenant_id_atualizado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","atualizado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materiais_precos" ADD CONSTRAINT "materiais_precos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materiais_precos" ADD CONSTRAINT "materiais_precos_tenant_id_material_id_materiais_tenant_id_id_fk" FOREIGN KEY ("tenant_id","material_id") REFERENCES "public"."materiais"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materiais_precos" ADD CONSTRAINT "materiais_precos_tenant_id_tabela_preco_id_tabelas_preco_tenant_id_id_fk" FOREIGN KEY ("tenant_id","tabela_preco_id") REFERENCES "public"."tabelas_preco"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materiais_precos" ADD CONSTRAINT "materiais_precos_tenant_id_encerrado_pelo_preco_id_materiais_precos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","encerrado_pelo_preco_id") REFERENCES "public"."materiais_precos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materiais_precos" ADD CONSTRAINT "materiais_precos_tenant_id_cancelado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cancelado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materiais_precos" ADD CONSTRAINT "materiais_precos_tenant_id_criado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","criado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materiais_precos" ADD CONSTRAINT "materiais_precos_tenant_id_atualizado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","atualizado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos_eventos" ADD CONSTRAINT "precos_eventos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos_eventos" ADD CONSTRAINT "precos_eventos_tenant_id_preco_id_materiais_precos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","preco_id") REFERENCES "public"."materiais_precos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos_eventos" ADD CONSTRAINT "precos_eventos_tenant_id_usuario_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","usuario_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tabelas_preco" ADD CONSTRAINT "tabelas_preco_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tabelas_preco" ADD CONSTRAINT "tabelas_preco_tenant_id_criado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","criado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tabelas_preco" ADD CONSTRAINT "tabelas_preco_tenant_id_atualizado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","atualizado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tipos_deposito" ADD CONSTRAINT "tipos_deposito_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tipos_material" ADD CONSTRAINT "tipos_material_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categorias_codigo_unico" ON "categorias" USING btree ("tenant_id","codigo") WHERE "categorias"."codigo" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "categorias_nome_unico" ON "categorias" USING btree ("tenant_id",coalesce("categoria_pai_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("nome"));--> statement-breakpoint
CREATE INDEX "categorias_categoria_pai_id_index" ON "categorias" USING btree ("categoria_pai_id");--> statement-breakpoint
CREATE UNIQUE INDEX "depositos_codigo_unico" ON "depositos" USING btree ("tenant_id","codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "depositos_nome_unico" ON "depositos" USING btree ("tenant_id",lower("nome"));--> statement-breakpoint
CREATE INDEX "depositos_tipo_id_index" ON "depositos" USING btree ("tipo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marcas_codigo_unico" ON "marcas" USING btree ("tenant_id","codigo") WHERE "marcas"."codigo" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "marcas_nome_unico" ON "marcas" USING btree ("tenant_id",lower("nome"));--> statement-breakpoint
CREATE UNIQUE INDEX "materiais_sku_unico" ON "materiais" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "materiais_codigo_barras_unico" ON "materiais" USING btree ("tenant_id","codigo_barras") WHERE "materiais"."codigo_barras" is not null;--> statement-breakpoint
CREATE INDEX "materiais_tenant_id_categoria_id_index" ON "materiais" USING btree ("tenant_id","categoria_id");--> statement-breakpoint
CREATE INDEX "materiais_tenant_id_marca_id_index" ON "materiais" USING btree ("tenant_id","marca_id");--> statement-breakpoint
CREATE INDEX "materiais_tenant_id_tipo_id_index" ON "materiais" USING btree ("tenant_id","tipo_id");--> statement-breakpoint
CREATE INDEX "materiais_tenant_id_ativo_descricao_index" ON "materiais" USING btree ("tenant_id","ativo","descricao");--> statement-breakpoint
CREATE INDEX "materiais_tenant_id_codigo_fabricante_index" ON "materiais" USING btree ("tenant_id","codigo_fabricante");--> statement-breakpoint
CREATE INDEX "materiais_precos_consulta" ON "materiais_precos" USING btree ("material_id","tabela_preco_id","data_inicio" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "materiais_precos_tabela_preco_id_index" ON "materiais_precos" USING btree ("tabela_preco_id");--> statement-breakpoint
CREATE INDEX "materiais_precos_encerrado_pelo_preco_id_index" ON "materiais_precos" USING btree ("encerrado_pelo_preco_id");--> statement-breakpoint
CREATE INDEX "precos_eventos_preco_id_criado_em_index" ON "precos_eventos" USING btree ("preco_id","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "tabelas_preco_codigo_unico" ON "tabelas_preco" USING btree ("tenant_id","codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "tabelas_preco_nome_unico" ON "tabelas_preco" USING btree ("tenant_id",lower("nome"));--> statement-breakpoint
CREATE UNIQUE INDEX "tipos_deposito_nome_unico" ON "tipos_deposito" USING btree ("tenant_id",lower("nome"));--> statement-breakpoint
CREATE UNIQUE INDEX "tipos_material_nome_unico" ON "tipos_material" USING btree ("tenant_id",lower("nome"));--> statement-breakpoint
CREATE POLICY "categorias_isolamento_tenant" ON "categorias" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "depositos_isolamento_tenant" ON "depositos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "marcas_isolamento_tenant" ON "marcas" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "materiais_isolamento_tenant" ON "materiais" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "materiais_precos_isolamento_tenant" ON "materiais_precos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "precos_eventos_isolamento_tenant" ON "precos_eventos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tabelas_preco_isolamento_tenant" ON "tabelas_preco" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tipos_deposito_isolamento_tenant" ON "tipos_deposito" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tipos_material_isolamento_tenant" ON "tipos_material" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- ===== Regras que o Drizzle não modela =====
-- btree_gist: permite "=" em uuid dentro da constraint EXCLUDE; pg_trgm: busca por trecho da descrição.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
-- Regra crítica: para o mesmo material + tabela, duas vigências não canceladas não podem se sobrepor.
-- Fim inclusivo ('[]'); fim NULL = aberta (daterange sem limite superior). Vale mesmo com gravações simultâneas.
ALTER TABLE "materiais_precos" ADD CONSTRAINT "materiais_precos_sem_sobreposicao"
  EXCLUDE USING gist ("tenant_id" WITH =, "material_id" WITH =, "tabela_preco_id" WITH =, daterange("data_inicio", "data_fim", '[]') WITH &&)
  WHERE (NOT "cancelado");--> statement-breakpoint
CREATE INDEX "materiais_descricao_trgm" ON "materiais" USING gin ("descricao" gin_trgm_ops);--> statement-breakpoint
-- Categoria não pode ficar abaixo de si mesma nem de uma descendente. A trava por oficina serializa
-- mudanças de hierarquia, para que duas alterações simultâneas (A sob B e B sob A) não formem um ciclo.
CREATE FUNCTION "categorias_sem_ciclo"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.categoria_pai_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('categorias:' || NEW.tenant_id::text));
  IF EXISTS (
    WITH RECURSIVE acima(id, pai) AS (
      SELECT c.id, c.categoria_pai_id FROM categorias c WHERE c.id = NEW.categoria_pai_id
      UNION
      SELECT c.id, c.categoria_pai_id FROM categorias c JOIN acima a ON c.id = a.pai
    )
    SELECT 1 FROM acima WHERE acima.id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Categoria não pode ficar abaixo dela mesma' USING ERRCODE = 'check_violation', CONSTRAINT = 'categorias_sem_ciclo';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "categorias_sem_ciclo" BEFORE INSERT OR UPDATE OF "categoria_pai_id" ON "categorias"
  FOR EACH ROW EXECUTE FUNCTION "categorias_sem_ciclo"();--> statement-breakpoint
-- Tipos padrão para as oficinas existentes (as novas recebem os mesmos em criarOficinaComAdmin).
INSERT INTO "tipos_material" ("tenant_id", "nome") SELECT t."id", x."nome" FROM "tenants" t
  CROSS JOIN (VALUES ('Peça'), ('Acessório'), ('Pneu'), ('Lubrificante'), ('Fluido'), ('Insumo'), ('Outro')) AS x("nome");--> statement-breakpoint
INSERT INTO "tipos_deposito" ("tenant_id", "nome") SELECT t."id", x."nome" FROM "tenants" t
  CROSS JOIN (VALUES ('Loja'), ('Oficina'), ('Central'), ('Garantia'), ('Trânsito'), ('Outro')) AS x("nome");--> statement-breakpoint
-- Funções padrão ganham os módulos novos (igual a FUNCOES_PADRAO), sem mexer no que o admin já definiu.
INSERT INTO "funcao_permissoes" ("tenant_id", "funcao_id", "modulo", "nivel")
  SELECT f."tenant_id", f."id", p."modulo"::"modulo", p."nivel"::"nivel_acesso"
  FROM "funcoes" f
  JOIN (VALUES
    ('Atendente', 'materiais', 'consultar'), ('Atendente', 'precos', 'consultar'),
    ('Mecânico', 'materiais', 'consultar'),
    ('Almoxarife', 'materiais', 'editar'), ('Almoxarife', 'precos', 'consultar'),
    ('Financeiro', 'materiais', 'consultar'), ('Financeiro', 'precos', 'editar')
  ) AS p("funcao", "modulo", "nivel") ON p."funcao" = f."nome" AND NOT f."admin"
  ON CONFLICT DO NOTHING;
