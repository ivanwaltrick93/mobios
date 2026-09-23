CREATE TYPE "public"."combustivel" AS ENUM('flex', 'gasolina', 'etanol', 'diesel', 'gnv', 'eletrico', 'hibrido');--> statement-breakpoint
CREATE TYPE "public"."sexo" AS ENUM('masculino', 'feminino', 'outro', 'nao_informado');--> statement-breakpoint
CREATE TYPE "public"."status_veiculo" AS ENUM('ativo', 'vendido', 'inativo');--> statement-breakpoint
CREATE TYPE "public"."tipo_endereco" AS ENUM('residencial', 'comercial', 'outro');--> statement-breakpoint
CREATE TABLE "cliente_enderecos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"tipo" "tipo_endereco" NOT NULL,
	"cep" text NOT NULL,
	"logradouro" text NOT NULL,
	"numero" text NOT NULL,
	"complemento" text,
	"bairro" text NOT NULL,
	"cidade" text NOT NULL,
	"uf" text NOT NULL,
	"pais" text DEFAULT 'Brasil' NOT NULL,
	"principal" boolean DEFAULT false NOT NULL,
	"faturamento" boolean DEFAULT false NOT NULL,
	"entrega" boolean DEFAULT false NOT NULL,
	"cobranca" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cliente_enderecos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "origens_cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"nome" text NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "origens_cliente_tenantId_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "origens_cliente" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "relacionamentos_cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"nome" text NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relacionamentos_cliente_tenantId_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "relacionamentos_cliente" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "rg_ie" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "data_nascimento" date;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "sexo" "sexo";--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "whatsapp" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "cliente_desde" date DEFAULT current_date NOT NULL;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "origem_id" uuid;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "relacionamento_id" uuid;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "ativo" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "veiculos" ADD COLUMN "renavam" text;--> statement-breakpoint
ALTER TABLE "veiculos" ADD COLUMN "versao" text;--> statement-breakpoint
ALTER TABLE "veiculos" ADD COLUMN "ano_fabricacao" integer;--> statement-breakpoint
ALTER TABLE "veiculos" ADD COLUMN "ano_modelo" integer;--> statement-breakpoint
ALTER TABLE "veiculos" ADD COLUMN "combustivel" "combustivel";--> statement-breakpoint
ALTER TABLE "veiculos" ADD COLUMN "ultima_visita" date;--> statement-breakpoint
ALTER TABLE "veiculos" ADD COLUMN "principal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "veiculos" ADD COLUMN "status" "status_veiculo" DEFAULT 'ativo' NOT NULL;--> statement-breakpoint
ALTER TABLE "cliente_enderecos" ADD CONSTRAINT "cliente_enderecos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cliente_enderecos" ADD CONSTRAINT "cliente_enderecos_tenant_id_cliente_id_clientes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cliente_id") REFERENCES "public"."clientes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origens_cliente" ADD CONSTRAINT "origens_cliente_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relacionamentos_cliente" ADD CONSTRAINT "relacionamentos_cliente_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cliente_enderecos_cliente_id_index" ON "cliente_enderecos" USING btree ("cliente_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cliente_enderecos_principal_unico" ON "cliente_enderecos" USING btree ("cliente_id") WHERE "cliente_enderecos"."principal";--> statement-breakpoint
CREATE UNIQUE INDEX "origens_cliente_nome_unico" ON "origens_cliente" USING btree ("tenant_id",lower("nome"));--> statement-breakpoint
CREATE UNIQUE INDEX "relacionamentos_cliente_nome_unico" ON "relacionamentos_cliente" USING btree ("tenant_id",lower("nome"));--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_tenant_id_origem_id_origens_cliente_tenant_id_id_fk" FOREIGN KEY ("tenant_id","origem_id") REFERENCES "public"."origens_cliente"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_tenant_id_relacionamento_id_relacionamentos_cliente_tenant_id_id_fk" FOREIGN KEY ("tenant_id","relacionamento_id") REFERENCES "public"."relacionamentos_cliente"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clientes_origem_id_index" ON "clientes" USING btree ("origem_id");--> statement-breakpoint
CREATE INDEX "clientes_relacionamento_id_index" ON "clientes" USING btree ("relacionamento_id");--> statement-breakpoint
CREATE UNIQUE INDEX "veiculos_tenant_id_chassi_index" ON "veiculos" USING btree ("tenant_id","chassi") WHERE "veiculos"."chassi" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "veiculos_principal_unico" ON "veiculos" USING btree ("cliente_id") WHERE "veiculos"."principal";--> statement-breakpoint
CREATE INDEX "veiculos_tenant_id_marca_modelo_index" ON "veiculos" USING btree ("tenant_id","marca","modelo");--> statement-breakpoint
CREATE POLICY "cliente_enderecos_isolamento_tenant" ON "cliente_enderecos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "origens_cliente_isolamento_tenant" ON "origens_cliente" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "relacionamentos_cliente_isolamento_tenant" ON "relacionamentos_cliente" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Dados existentes: "cliente desde" = data do cadastro (Brasília); telefones só com dígitos.
UPDATE "clientes" SET "cliente_desde" = ("criado_em" at time zone 'America/Sao_Paulo')::date;--> statement-breakpoint
UPDATE "clientes" SET "telefone" = nullif(regexp_replace("telefone", '\D', '', 'g'), '') WHERE "telefone" IS NOT NULL;--> statement-breakpoint
-- O antigo "ano" vira ano de fabricação; o ano modelo fica pendente (cadastro incompleto).
UPDATE "veiculos" SET "ano_fabricacao" = "ano";--> statement-breakpoint
-- O veículo mais antigo de cada cliente vira o principal.
UPDATE "veiculos" SET "principal" = true WHERE "id" IN (SELECT DISTINCT ON ("cliente_id") "id" FROM "veiculos" ORDER BY "cliente_id", "criado_em", "id");--> statement-breakpoint
-- Listas padrão para as oficinas existentes (as novas recebem as mesmas em criarOficinaComAdmin).
INSERT INTO "origens_cliente" ("tenant_id", "nome") SELECT t."id", o."nome" FROM "tenants" t CROSS JOIN (VALUES ('Indicação'), ('Site'), ('Campanha'), ('Loja'), ('Concessionária')) AS o("nome");--> statement-breakpoint
INSERT INTO "relacionamentos_cliente" ("tenant_id", "nome") SELECT t."id", r."nome" FROM "tenants" t CROSS JOIN (VALUES ('Consumidor final'), ('Empresa'), ('Frota'), ('Seguradora')) AS r("nome");
