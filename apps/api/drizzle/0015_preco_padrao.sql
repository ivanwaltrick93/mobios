CREATE TABLE "precos_padrao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"tabela_preco_id" uuid NOT NULL,
	"preco_centavos" bigint NOT NULL,
	"criado_por" uuid,
	"atualizado_por" uuid,
	"versao" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "precos_padrao_valor_positivo" CHECK ("precos_padrao"."preco_centavos" >= 0)
);
--> statement-breakpoint
ALTER TABLE "precos_padrao" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "precos_padrao_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"tabela_preco_id" uuid NOT NULL,
	"evento" text NOT NULL,
	"preco_antes" bigint,
	"preco_depois" bigint,
	"usuario_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "precos_padrao_eventos_evento" CHECK ("precos_padrao_eventos"."evento" in ('definido', 'alterado', 'removido'))
);
--> statement-breakpoint
ALTER TABLE "precos_padrao_eventos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "precos_padrao" ADD CONSTRAINT "precos_padrao_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos_padrao" ADD CONSTRAINT "precos_padrao_tenant_id_material_id_materiais_tenant_id_id_fk" FOREIGN KEY ("tenant_id","material_id") REFERENCES "public"."materiais"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos_padrao" ADD CONSTRAINT "precos_padrao_tenant_id_tabela_preco_id_tabelas_preco_tenant_id_id_fk" FOREIGN KEY ("tenant_id","tabela_preco_id") REFERENCES "public"."tabelas_preco"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos_padrao" ADD CONSTRAINT "precos_padrao_tenant_id_criado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","criado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos_padrao" ADD CONSTRAINT "precos_padrao_tenant_id_atualizado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","atualizado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos_padrao_eventos" ADD CONSTRAINT "precos_padrao_eventos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos_padrao_eventos" ADD CONSTRAINT "precos_padrao_eventos_tenant_id_material_id_materiais_tenant_id_id_fk" FOREIGN KEY ("tenant_id","material_id") REFERENCES "public"."materiais"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos_padrao_eventos" ADD CONSTRAINT "precos_padrao_eventos_tenant_id_tabela_preco_id_tabelas_preco_tenant_id_id_fk" FOREIGN KEY ("tenant_id","tabela_preco_id") REFERENCES "public"."tabelas_preco"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos_padrao_eventos" ADD CONSTRAINT "precos_padrao_eventos_tenant_id_usuario_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","usuario_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "precos_padrao_unico" ON "precos_padrao" USING btree ("tenant_id","material_id","tabela_preco_id");--> statement-breakpoint
CREATE INDEX "precos_padrao_tabela_preco_id_index" ON "precos_padrao" USING btree ("tabela_preco_id");--> statement-breakpoint
CREATE INDEX "precos_padrao_eventos_material_id_tabela_preco_id_criado_em_index" ON "precos_padrao_eventos" USING btree ("material_id","tabela_preco_id","criado_em");--> statement-breakpoint
CREATE INDEX "precos_padrao_eventos_tabela_preco_id_index" ON "precos_padrao_eventos" USING btree ("tabela_preco_id");--> statement-breakpoint
CREATE POLICY "precos_padrao_isolamento_tenant" ON "precos_padrao" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "precos_padrao_eventos_isolamento_tenant" ON "precos_padrao_eventos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);