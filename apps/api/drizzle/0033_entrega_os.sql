-- Evento novo da O.S.: recria o enum (renomear, criar, trocar a coluna, apagar), nunca ADD VALUE (ver 0008).
ALTER TYPE "public"."evento_os" RENAME TO "evento_os_antigo";--> statement-breakpoint
CREATE TYPE "public"."evento_os" AS ENUM('criada', 'convertida', 'dados_alterados', 'itens_alterados', 'descontos_alterados', 'diagnostico_iniciado', 'aprovacao_solicitada', 'aprovada', 'recusada', 'execucao_iniciada', 'aguardando_peca', 'execucao_retomada', 'cancelada', 'mecanico_vinculado', 'mecanico_desvinculado', 'aprovacao_comercial_solicitada', 'aprovado_comercialmente', 'reprovado_comercialmente', 'checklist_registrado', 'diagnostico_registrado', 'foto_adicionada', 'foto_removida', 'servico_executado', 'execucao_desfeita', 'mecanicos_do_servico', 'peca_solicitada', 'solicitacao_atendida', 'solicitacao_recusada', 'concluida', 'entregue');--> statement-breakpoint
ALTER TABLE "os_eventos" ALTER COLUMN "evento" TYPE "public"."evento_os" USING "evento"::text::"public"."evento_os";--> statement-breakpoint
DROP TYPE "public"."evento_os_antigo";--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD COLUMN "km_saida" integer;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD COLUMN "entregue_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD COLUMN "entregue_por" uuid;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD COLUMN "recebido_por" text;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD COLUMN "observacoes_entrega" text;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tenant_id_entregue_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","entregue_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ordens_servico_previsao_em_aberto" ON "ordens_servico" USING btree ("tenant_id","previsao_entrega") WHERE "ordens_servico"."previsao_entrega" is not null and "ordens_servico"."status" in ('aberta', 'em_diagnostico', 'aguardando_aprovacao', 'aprovada', 'em_execucao', 'aguardando_peca');--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_km_saida" CHECK ("ordens_servico"."km_saida" is null or "ordens_servico"."km_saida" >= "ordens_servico"."km_entrada");--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_entrega" CHECK ("ordens_servico"."status" <> 'entregue' or ("ordens_servico"."km_saida" is not null and "ordens_servico"."entregue_em" is not null));