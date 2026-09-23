CREATE TYPE "public"."modulo" AS ENUM('clientes', 'os', 'estoque', 'financeiro', 'relatorios');--> statement-breakpoint
CREATE TYPE "public"."nivel_acesso" AS ENUM('consultar', 'editar');--> statement-breakpoint
CREATE TABLE "funcao_permissoes" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"funcao_id" uuid NOT NULL,
	"modulo" "modulo" NOT NULL,
	"nivel" "nivel_acesso" NOT NULL,
	CONSTRAINT "funcao_permissoes_funcao_id_modulo_pk" PRIMARY KEY("funcao_id","modulo")
);
--> statement-breakpoint
ALTER TABLE "funcao_permissoes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "funcoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"nome" text NOT NULL,
	"admin" boolean DEFAULT false NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funcoes_tenantId_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "funcoes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "usuario_funcoes" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"funcao_id" uuid NOT NULL,
	CONSTRAINT "usuario_funcoes_usuario_id_funcao_id_pk" PRIMARY KEY("usuario_id","funcao_id")
);
--> statement-breakpoint
ALTER TABLE "usuario_funcoes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Precisa existir antes da FK composta usuario_funcoes -> users(tenant_id, id).
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "funcao_permissoes" ADD CONSTRAINT "funcao_permissoes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funcao_permissoes" ADD CONSTRAINT "funcao_permissoes_tenant_id_funcao_id_funcoes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","funcao_id") REFERENCES "public"."funcoes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funcoes" ADD CONSTRAINT "funcoes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_funcoes" ADD CONSTRAINT "usuario_funcoes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_funcoes" ADD CONSTRAINT "usuario_funcoes_tenant_id_usuario_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","usuario_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_funcoes" ADD CONSTRAINT "usuario_funcoes_tenant_id_funcao_id_funcoes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","funcao_id") REFERENCES "public"."funcoes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "funcoes_nome_unico" ON "funcoes" USING btree ("tenant_id",lower("nome"));--> statement-breakpoint
CREATE UNIQUE INDEX "funcoes_admin_unico" ON "funcoes" USING btree ("tenant_id") WHERE "funcoes"."admin";--> statement-breakpoint
CREATE INDEX "usuario_funcoes_funcao_id_index" ON "usuario_funcoes" USING btree ("funcao_id");--> statement-breakpoint
CREATE POLICY "funcao_permissoes_isolamento_tenant" ON "funcao_permissoes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "funcoes_isolamento_tenant" ON "funcoes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "usuario_funcoes_isolamento_tenant" ON "usuario_funcoes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- ---------- Dados: funções padrão para as oficinas existentes (igual a FUNCOES_PADRAO em packages/shared/src/acessos.ts) ----------
INSERT INTO "funcoes" ("tenant_id", "nome", "admin") SELECT "id", 'Administrador', true FROM "tenants";--> statement-breakpoint
INSERT INTO "funcoes" ("tenant_id", "nome")
  SELECT t."id", f."nome" FROM "tenants" t CROSS JOIN (VALUES ('Atendente'), ('Mecânico'), ('Financeiro')) AS f("nome");--> statement-breakpoint
INSERT INTO "funcao_permissoes" ("tenant_id", "funcao_id", "modulo", "nivel")
  SELECT f."tenant_id", f."id", p."modulo"::"modulo", p."nivel"::"nivel_acesso"
  FROM "funcoes" f
  JOIN (VALUES
    ('Atendente', 'clientes', 'editar'), ('Atendente', 'os', 'editar'), ('Atendente', 'estoque', 'editar'),
    ('Mecânico', 'clientes', 'consultar'), ('Mecânico', 'os', 'editar'), ('Mecânico', 'estoque', 'consultar'),
    ('Financeiro', 'clientes', 'consultar'), ('Financeiro', 'os', 'consultar'), ('Financeiro', 'financeiro', 'editar'), ('Financeiro', 'relatorios', 'consultar')
  ) AS p("funcao", "modulo", "nivel") ON p."funcao" = f."nome";--> statement-breakpoint
-- Cada usuário recebe a função equivalente ao papel que tinha.
INSERT INTO "usuario_funcoes" ("tenant_id", "usuario_id", "funcao_id")
  SELECT u."tenant_id", u."id", f."id"
  FROM "users" u
  JOIN "funcoes" f ON f."tenant_id" = u."tenant_id" AND f."nome" = CASE u."papel"
    WHEN 'admin' THEN 'Administrador' WHEN 'atendente' THEN 'Atendente' WHEN 'mecanico' THEN 'Mecânico' WHEN 'financeiro' THEN 'Financeiro' END;
