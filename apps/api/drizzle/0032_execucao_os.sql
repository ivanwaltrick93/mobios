CREATE TYPE "public"."status_solicitacao_peca" AS ENUM('pendente', 'atendida', 'recusada');--> statement-breakpoint
-- Eventos novos da O.S.: recria o enum (renomear, criar, trocar a coluna, apagar), nunca ADD VALUE (ver 0008).
ALTER TYPE "public"."evento_os" RENAME TO "evento_os_antigo";--> statement-breakpoint
CREATE TYPE "public"."evento_os" AS ENUM('criada', 'convertida', 'dados_alterados', 'itens_alterados', 'descontos_alterados', 'diagnostico_iniciado', 'aprovacao_solicitada', 'aprovada', 'recusada', 'execucao_iniciada', 'aguardando_peca', 'execucao_retomada', 'cancelada', 'mecanico_vinculado', 'mecanico_desvinculado', 'aprovacao_comercial_solicitada', 'aprovado_comercialmente', 'reprovado_comercialmente', 'checklist_registrado', 'diagnostico_registrado', 'foto_adicionada', 'foto_removida', 'servico_executado', 'execucao_desfeita', 'mecanicos_do_servico', 'peca_solicitada', 'solicitacao_atendida', 'solicitacao_recusada', 'concluida');--> statement-breakpoint
ALTER TABLE "os_eventos" ALTER COLUMN "evento" TYPE "public"."evento_os" USING "evento"::text::"public"."evento_os";--> statement-breakpoint
DROP TYPE "public"."evento_os_antigo";--> statement-breakpoint
CREATE TABLE "os_item_mecanicos" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"os_item_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	CONSTRAINT "os_item_mecanicos_os_item_id_usuario_id_pk" PRIMARY KEY("os_item_id","usuario_id")
);
--> statement-breakpoint
ALTER TABLE "os_item_mecanicos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "os_solicitacoes_peca" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"ordem_servico_id" uuid NOT NULL,
	"descricao" text NOT NULL,
	"quantidade" numeric(14, 3) NOT NULL,
	"observacao" text,
	"status" "status_solicitacao_peca" DEFAULT 'pendente' NOT NULL,
	"solicitada_por" uuid NOT NULL,
	"solicitada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"resolvida_por" uuid,
	"resolvida_em" timestamp with time zone,
	"resposta" text,
	CONSTRAINT "os_solicitacoes_peca_quantidade" CHECK ("os_solicitacoes_peca"."quantidade" > 0),
	CONSTRAINT "os_solicitacoes_peca_resolucao" CHECK (("os_solicitacoes_peca"."status" = 'pendente') = ("os_solicitacoes_peca"."resolvida_em" is null)
        and ("os_solicitacoes_peca"."resolvida_em" is null) = ("os_solicitacoes_peca"."resolvida_por" is null)
        and ("os_solicitacoes_peca"."status" <> 'recusada' or "os_solicitacoes_peca"."resposta" is not null))
);
--> statement-breakpoint
ALTER TABLE "os_solicitacoes_peca" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD COLUMN "concluida_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD COLUMN "concluida_por" uuid;--> statement-breakpoint
ALTER TABLE "os_itens" ADD COLUMN "executado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "os_itens" ADD COLUMN "executado_por" uuid;--> statement-breakpoint
ALTER TABLE "os_item_mecanicos" ADD CONSTRAINT "os_item_mecanicos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_itens" ADD CONSTRAINT "os_itens_tenantId_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "os_item_mecanicos" ADD CONSTRAINT "os_item_mecanicos_tenant_id_os_item_id_os_itens_tenant_id_id_fk" FOREIGN KEY ("tenant_id","os_item_id") REFERENCES "public"."os_itens"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_item_mecanicos" ADD CONSTRAINT "os_item_mecanicos_tenant_id_usuario_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","usuario_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_solicitacoes_peca" ADD CONSTRAINT "os_solicitacoes_peca_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_solicitacoes_peca" ADD CONSTRAINT "os_solicitacoes_peca_tenant_id_ordem_servico_id_ordens_servico_tenant_id_id_fk" FOREIGN KEY ("tenant_id","ordem_servico_id") REFERENCES "public"."ordens_servico"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_solicitacoes_peca" ADD CONSTRAINT "os_solicitacoes_peca_tenant_id_solicitada_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","solicitada_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_solicitacoes_peca" ADD CONSTRAINT "os_solicitacoes_peca_tenant_id_resolvida_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","resolvida_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "os_item_mecanicos_usuario_id_index" ON "os_item_mecanicos" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "os_solicitacoes_peca_ordem_servico_id_solicitada_em_index" ON "os_solicitacoes_peca" USING btree ("ordem_servico_id","solicitada_em");--> statement-breakpoint
CREATE INDEX "os_solicitacoes_peca_pendentes" ON "os_solicitacoes_peca" USING btree ("tenant_id","ordem_servico_id") WHERE "os_solicitacoes_peca"."status" = 'pendente';--> statement-breakpoint
CREATE INDEX "os_solicitacoes_peca_solicitada_por_index" ON "os_solicitacoes_peca" USING btree ("solicitada_por");--> statement-breakpoint
CREATE INDEX "os_solicitacoes_peca_resolvida_por_index" ON "os_solicitacoes_peca" USING btree ("resolvida_por");--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tenant_id_concluida_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","concluida_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_itens" ADD CONSTRAINT "os_itens_tenant_id_executado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","executado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "os_itens_executado_por_index" ON "os_itens" USING btree ("executado_por");--> statement-breakpoint
ALTER TABLE "os_itens" ADD CONSTRAINT "os_itens_execucao" CHECK (("os_itens"."executado_em" is null) = ("os_itens"."executado_por" is null) and ("os_itens"."executado_em" is null or "os_itens"."tipo" = 'servico'));--> statement-breakpoint
CREATE POLICY "os_item_mecanicos_isolamento_tenant" ON "os_item_mecanicos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "os_solicitacoes_peca_isolamento_tenant" ON "os_solicitacoes_peca" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);