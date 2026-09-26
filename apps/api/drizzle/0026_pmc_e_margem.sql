-- Módulo "Custos e margem". Valor criado com ADD VALUE não pode ser usado na mesma transação (o migrador roda tudo
-- em uma), então o tipo é recriado com a lista completa, na ordem de MODULOS (ver 0008).
ALTER TYPE "public"."modulo" RENAME TO "modulo_antigo";--> statement-breakpoint
CREATE TYPE "public"."modulo" AS ENUM('clientes', 'orcamentos', 'aprovar_orcamentos', 'aprovacao_comercial', 'os', 'pecas_os', 'materiais', 'servicos', 'precos', 'custos', 'estoque', 'recebimentos', 'financeiro', 'relatorios');--> statement-breakpoint
ALTER TABLE "funcao_permissoes" ALTER COLUMN "modulo" TYPE "public"."modulo" USING "modulo"::text::"public"."modulo";--> statement-breakpoint
DROP TYPE "public"."modulo_antigo";--> statement-breakpoint
CREATE TABLE "materiais_pmc_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"antes_centavos" bigint,
	"depois_centavos" bigint,
	"usuario_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "materiais_pmc_eventos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "materiais" ADD COLUMN "pmc_centavos" bigint;--> statement-breakpoint
ALTER TABLE "orcamento_itens" ADD COLUMN "pmc_centavos" bigint;--> statement-breakpoint
ALTER TABLE "materiais_pmc_eventos" ADD CONSTRAINT "materiais_pmc_eventos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materiais_pmc_eventos" ADD CONSTRAINT "materiais_pmc_eventos_tenant_id_material_id_materiais_tenant_id_id_fk" FOREIGN KEY ("tenant_id","material_id") REFERENCES "public"."materiais"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materiais_pmc_eventos" ADD CONSTRAINT "materiais_pmc_eventos_tenant_id_usuario_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","usuario_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "materiais_pmc_eventos_material_id_criado_em_index" ON "materiais_pmc_eventos" USING btree ("material_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "materiais" ADD CONSTRAINT "materiais_pmc_positivo" CHECK ("materiais"."pmc_centavos" is null or "materiais"."pmc_centavos" >= 0);--> statement-breakpoint
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_pmc" CHECK ("orcamento_itens"."pmc_centavos" is null or ("orcamento_itens"."tipo" = 'material' and "orcamento_itens"."pmc_centavos" >= 0));--> statement-breakpoint
CREATE POLICY "materiais_pmc_eventos_isolamento_tenant" ON "materiais_pmc_eventos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Histórico do PMC só de inclusão (mesma função do histórico das aprovações, migração 0025).
CREATE TRIGGER materiais_pmc_eventos_imutavel BEFORE UPDATE OR DELETE ON materiais_pmc_eventos
  FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_de_historico();
