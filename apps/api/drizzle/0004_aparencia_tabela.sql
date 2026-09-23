CREATE TABLE "tenant_aparencia" (
	"tenant_id" uuid PRIMARY KEY DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"cor_primaria" text,
	"cor_menu" text,
	"cor_botao_primario" text,
	"cor_botao_primario_texto" text,
	"cor_botao_secundario" text,
	"cor_botao_secundario_texto" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_aparencia" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_aparencia" ADD CONSTRAINT "tenant_aparencia_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Preserva as cores já configuradas antes de remover as colunas antigas de tenants.
INSERT INTO "tenant_aparencia" ("tenant_id", "cor_primaria", "cor_menu")
  SELECT "id", "cor_primaria", "cor_menu" FROM "tenants" WHERE "cor_primaria" IS NOT NULL OR "cor_menu" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "cor_primaria";--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "cor_menu";--> statement-breakpoint
CREATE POLICY "tenant_aparencia_isolamento_tenant" ON "tenant_aparencia" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);