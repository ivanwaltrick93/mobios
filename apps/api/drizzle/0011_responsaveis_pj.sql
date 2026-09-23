CREATE TABLE "cargos_responsavel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"nome" text NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cargos_responsavel_tenantId_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cargos_responsavel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cliente_responsaveis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"telefone" text NOT NULL,
	"telefone_whatsapp" boolean DEFAULT false NOT NULL,
	"email" text,
	"cargo_id" uuid NOT NULL,
	"principal" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cliente_responsaveis" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cargos_responsavel" ADD CONSTRAINT "cargos_responsavel_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cliente_responsaveis" ADD CONSTRAINT "cliente_responsaveis_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cliente_responsaveis" ADD CONSTRAINT "cliente_responsaveis_tenant_id_cliente_id_clientes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cliente_id") REFERENCES "public"."clientes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cliente_responsaveis" ADD CONSTRAINT "cliente_responsaveis_tenant_id_cargo_id_cargos_responsavel_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cargo_id") REFERENCES "public"."cargos_responsavel"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cargos_responsavel_nome_unico" ON "cargos_responsavel" USING btree ("tenant_id",lower("nome"));--> statement-breakpoint
CREATE INDEX "cliente_responsaveis_cliente_id_index" ON "cliente_responsaveis" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "cliente_responsaveis_cargo_id_index" ON "cliente_responsaveis" USING btree ("cargo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cliente_responsaveis_principal_unico" ON "cliente_responsaveis" USING btree ("cliente_id") WHERE "cliente_responsaveis"."principal";--> statement-breakpoint
CREATE POLICY "cargos_responsavel_isolamento_tenant" ON "cargos_responsavel" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "cliente_responsaveis_isolamento_tenant" ON "cliente_responsaveis" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Funções padrão do responsável para as oficinas existentes (as novas recebem as mesmas em criarOficinaComAdmin).
INSERT INTO "cargos_responsavel" ("tenant_id", "nome") SELECT t."id", c."nome" FROM "tenants" t CROSS JOIN (VALUES ('Sócio / Proprietário'), ('Gestor de frota'), ('Financeiro'), ('Compras'), ('Motorista')) AS c("nome");
