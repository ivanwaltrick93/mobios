CREATE TYPE "public"."categoria_foto_os" AS ENUM('entrada', 'avaria', 'execucao');--> statement-breakpoint
CREATE TYPE "public"."estado_checklist" AS ENUM('presente', 'ausente', 'avariado', 'nao_aplicavel');--> statement-breakpoint
CREATE TYPE "public"."nivel_combustivel" AS ENUM('reserva', 'um_quarto', 'meio', 'tres_quartos', 'cheio');--> statement-breakpoint
-- Eventos novos da O.S.: recria o enum (renomear, criar, trocar a coluna, apagar), nunca ADD VALUE (ver 0008).
ALTER TYPE "public"."evento_os" RENAME TO "evento_os_antigo";--> statement-breakpoint
CREATE TYPE "public"."evento_os" AS ENUM('criada', 'convertida', 'dados_alterados', 'itens_alterados', 'descontos_alterados', 'diagnostico_iniciado', 'aprovacao_solicitada', 'aprovada', 'recusada', 'execucao_iniciada', 'aguardando_peca', 'execucao_retomada', 'cancelada', 'mecanico_vinculado', 'mecanico_desvinculado', 'aprovacao_comercial_solicitada', 'aprovado_comercialmente', 'reprovado_comercialmente', 'checklist_registrado', 'diagnostico_registrado', 'foto_adicionada', 'foto_removida');--> statement-breakpoint
ALTER TABLE "os_eventos" ALTER COLUMN "evento" TYPE "public"."evento_os" USING "evento"::text::"public"."evento_os";--> statement-breakpoint
DROP TYPE "public"."evento_os_antigo";--> statement-breakpoint
CREATE TABLE "os_checklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"ordem_servico_id" uuid NOT NULL,
	"ordem" integer NOT NULL,
	"item" text NOT NULL,
	"estado" "estado_checklist" NOT NULL,
	"observacao" text
);
--> statement-breakpoint
ALTER TABLE "os_checklist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "os_fotos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"ordem_servico_id" uuid NOT NULL,
	"categoria" "categoria_foto_os" NOT NULL,
	"conteudo" "bytea" NOT NULL,
	"tipo" text NOT NULL,
	"tamanho" integer NOT NULL,
	"criado_por" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "os_fotos_tamanho" CHECK ("os_fotos"."tamanho" > 0 and "os_fotos"."tamanho" <= 1048576)
);
--> statement-breakpoint
ALTER TABLE "os_fotos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD COLUMN "combustivel" "nivel_combustivel";--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD COLUMN "avarias_entrada" text;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD COLUMN "checklist_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD COLUMN "diagnostico" text;--> statement-breakpoint
ALTER TABLE "os_checklist" ADD CONSTRAINT "os_checklist_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_checklist" ADD CONSTRAINT "os_checklist_tenant_id_ordem_servico_id_ordens_servico_tenant_id_id_fk" FOREIGN KEY ("tenant_id","ordem_servico_id") REFERENCES "public"."ordens_servico"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_fotos" ADD CONSTRAINT "os_fotos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_fotos" ADD CONSTRAINT "os_fotos_tenant_id_ordem_servico_id_ordens_servico_tenant_id_id_fk" FOREIGN KEY ("tenant_id","ordem_servico_id") REFERENCES "public"."ordens_servico"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_fotos" ADD CONSTRAINT "os_fotos_tenant_id_criado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","criado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "os_checklist_item_unico" ON "os_checklist" USING btree ("ordem_servico_id",lower("item"));--> statement-breakpoint
CREATE INDEX "os_fotos_ordem_servico_id_criado_em_index" ON "os_fotos" USING btree ("ordem_servico_id","criado_em");--> statement-breakpoint
CREATE INDEX "os_fotos_criado_por_index" ON "os_fotos" USING btree ("criado_por");--> statement-breakpoint
CREATE POLICY "os_checklist_isolamento_tenant" ON "os_checklist" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "os_fotos_isolamento_tenant" ON "os_fotos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);