CREATE TYPE "public"."papel" AS ENUM('dono', 'atendente', 'mecanico', 'financeiro');--> statement-breakpoint
CREATE TYPE "public"."tipo_pessoa" AS ENUM('PF', 'PJ');--> statement-breakpoint
CREATE TABLE "clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"tipo" "tipo_pessoa" DEFAULT 'PF' NOT NULL,
	"nome" text NOT NULL,
	"cpf_cnpj" text,
	"telefone" text,
	"email" text,
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clientes_tenantId_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "clientes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"cnpj" text,
	"plano" text DEFAULT 'gratuito' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text NOT NULL,
	"papel" "papel" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "veiculos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"placa" text NOT NULL,
	"marca" text NOT NULL,
	"modelo" text NOT NULL,
	"ano" integer,
	"cor" text,
	"chassi" text,
	"km_atual" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "veiculos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_tenant_id_cliente_id_clientes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cliente_id") REFERENCES "public"."clientes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clientes_tenant_id_cpf_cnpj_index" ON "clientes" USING btree ("tenant_id","cpf_cnpj") WHERE "clientes"."cpf_cnpj" is not null;--> statement-breakpoint
CREATE INDEX "clientes_tenant_id_nome_index" ON "clientes" USING btree ("tenant_id","nome");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_index" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_tenant_id_index" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "veiculos_tenant_id_placa_index" ON "veiculos" USING btree ("tenant_id","placa");--> statement-breakpoint
CREATE INDEX "veiculos_cliente_id_index" ON "veiculos" USING btree ("cliente_id");--> statement-breakpoint
CREATE POLICY "clientes_isolamento_tenant" ON "clientes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "veiculos_isolamento_tenant" ON "veiculos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);