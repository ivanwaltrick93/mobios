CREATE TABLE "estoque_ajustes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"deposito_id" uuid NOT NULL,
	"disponivel_antes" numeric(14, 3) NOT NULL,
	"disponivel_depois" numeric(14, 3) NOT NULL,
	"reservado_antes" numeric(14, 3) NOT NULL,
	"reservado_depois" numeric(14, 3) NOT NULL,
	"motivo" text NOT NULL,
	"usuario_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "estoque_ajustes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "estoques" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"deposito_id" uuid NOT NULL,
	"disponivel" numeric(14, 3) DEFAULT 0 NOT NULL,
	"reservado" numeric(14, 3) DEFAULT 0 NOT NULL,
	"atualizado_por" uuid,
	"versao" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estoques_material_id_deposito_id_pk" PRIMARY KEY("material_id","deposito_id"),
	CONSTRAINT "estoques_disponivel_positivo" CHECK ("estoques"."disponivel" >= 0),
	CONSTRAINT "estoques_reservado_positivo" CHECK ("estoques"."reservado" >= 0)
);
--> statement-breakpoint
ALTER TABLE "estoques" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "estoque_ajustes" ADD CONSTRAINT "estoque_ajustes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estoque_ajustes" ADD CONSTRAINT "estoque_ajustes_tenant_id_material_id_materiais_tenant_id_id_fk" FOREIGN KEY ("tenant_id","material_id") REFERENCES "public"."materiais"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estoque_ajustes" ADD CONSTRAINT "estoque_ajustes_tenant_id_deposito_id_depositos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","deposito_id") REFERENCES "public"."depositos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estoque_ajustes" ADD CONSTRAINT "estoque_ajustes_tenant_id_usuario_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","usuario_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estoques" ADD CONSTRAINT "estoques_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estoques" ADD CONSTRAINT "estoques_tenant_id_material_id_materiais_tenant_id_id_fk" FOREIGN KEY ("tenant_id","material_id") REFERENCES "public"."materiais"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estoques" ADD CONSTRAINT "estoques_tenant_id_deposito_id_depositos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","deposito_id") REFERENCES "public"."depositos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estoques" ADD CONSTRAINT "estoques_tenant_id_atualizado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","atualizado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "estoque_ajustes_material_id_deposito_id_criado_em_index" ON "estoque_ajustes" USING btree ("material_id","deposito_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "estoque_ajustes_deposito_id_index" ON "estoque_ajustes" USING btree ("deposito_id");--> statement-breakpoint
CREATE INDEX "estoques_deposito_id_index" ON "estoques" USING btree ("deposito_id");--> statement-breakpoint
CREATE POLICY "estoque_ajustes_isolamento_tenant" ON "estoque_ajustes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "estoques_isolamento_tenant" ON "estoques" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);