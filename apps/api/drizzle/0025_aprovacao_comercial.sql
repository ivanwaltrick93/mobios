CREATE TYPE "public"."evento_aprovacao_comercial" AS ENUM('necessaria', 'solicitada', 'aprovada', 'reprovada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."status_aprovacao_comercial" AS ENUM('pendente', 'aprovada', 'reprovada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."tipo_documento_comercial" AS ENUM('orcamento');--> statement-breakpoint
-- Novas situações e eventos do orçamento e o módulo "Aprovação comercial". Valor criado com ADD VALUE não pode
-- ser usado na mesma transação (o migrador roda tudo em uma), então os tipos são recriados (ver 0008).
ALTER TYPE "public"."modulo" RENAME TO "modulo_antigo";--> statement-breakpoint
CREATE TYPE "public"."modulo" AS ENUM('clientes', 'orcamentos', 'aprovar_orcamentos', 'aprovacao_comercial', 'os', 'pecas_os', 'materiais', 'servicos', 'precos', 'estoque', 'recebimentos', 'financeiro', 'relatorios');--> statement-breakpoint
ALTER TABLE "funcao_permissoes" ALTER COLUMN "modulo" TYPE "public"."modulo" USING "modulo"::text::"public"."modulo";--> statement-breakpoint
DROP TYPE "public"."modulo_antigo";--> statement-breakpoint
ALTER TYPE "public"."evento_orcamento" RENAME TO "evento_orcamento_antigo";--> statement-breakpoint
CREATE TYPE "public"."evento_orcamento" AS ENUM('criado', 'alterado', 'precos_recalculados', 'tabela_trocada', 'emitido', 'enviado', 'aprovado', 'recusado', 'cancelado', 'nova_versao', 'descontos_alterados', 'aprovacao_comercial_solicitada', 'aprovado_comercialmente', 'reprovado_comercialmente', 'aprovacao_comercial_retirada');--> statement-breakpoint
ALTER TABLE "orcamentos_eventos" ALTER COLUMN "evento" TYPE "public"."evento_orcamento" USING "evento"::text::"public"."evento_orcamento";--> statement-breakpoint
DROP TYPE "public"."evento_orcamento_antigo";--> statement-breakpoint
-- A situação aparece no índice parcial e no CHECK da validade: saem antes e voltam com o tipo novo.
DROP INDEX "orcamentos_uma_versao_viva";--> statement-breakpoint
ALTER TABLE "orcamentos" DROP CONSTRAINT "orcamentos_emitido_com_validade";--> statement-breakpoint
ALTER TABLE "orcamentos" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."status_orcamento" RENAME TO "status_orcamento_antigo";--> statement-breakpoint
CREATE TYPE "public"."status_orcamento" AS ENUM('rascunho', 'aguardando_aprovacao_comercial', 'reprovado_comercialmente', 'emitido', 'enviado', 'aprovado', 'recusado', 'cancelado');--> statement-breakpoint
ALTER TABLE "orcamentos" ALTER COLUMN "status" TYPE "public"."status_orcamento" USING "status"::text::"public"."status_orcamento";--> statement-breakpoint
ALTER TABLE "orcamentos" ALTER COLUMN "status" SET DEFAULT 'rascunho';--> statement-breakpoint
DROP TYPE "public"."status_orcamento_antigo";--> statement-breakpoint
CREATE UNIQUE INDEX "orcamentos_uma_versao_viva" ON "orcamentos" USING btree ("tenant_id","numero") WHERE "orcamentos"."status" <> 'cancelado';--> statement-breakpoint
CREATE TABLE "alcadas_desconto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"funcao_id" uuid NOT NULL,
	"percentual" integer NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_por" uuid,
	"atualizado_por" uuid,
	"versao" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alcadas_desconto_tenantId_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "alcadas_desconto_percentual" CHECK ("alcadas_desconto"."percentual" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "alcadas_desconto" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "alcadas_desconto_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"funcao_id" uuid NOT NULL,
	"percentual_antes" integer,
	"percentual_depois" integer NOT NULL,
	"ativa_antes" boolean,
	"ativa_depois" boolean NOT NULL,
	"usuario_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alcadas_desconto_eventos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aprovacoes_comerciais" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"tipo_documento" "tipo_documento_comercial" NOT NULL,
	"orcamento_id" uuid,
	"documento_numero" text NOT NULL,
	"documento_versao" integer NOT NULL,
	"cliente_nome" text NOT NULL,
	"subtotal_centavos" bigint NOT NULL,
	"desconto_centavos" bigint NOT NULL,
	"total_centavos" bigint NOT NULL,
	"percentual" integer NOT NULL,
	"solicitante_id" uuid NOT NULL,
	"solicitante_funcao" text,
	"alcada_solicitante" integer NOT NULL,
	"status" "status_aprovacao_comercial" DEFAULT 'pendente' NOT NULL,
	"decidido_por" uuid,
	"decisor_funcao" text,
	"alcada_decisor" integer,
	"decidido_em" timestamp with time zone,
	"justificativa" text,
	"snapshot" jsonb NOT NULL,
	"versao" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aprovacoes_comerciais_tenantId_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "aprovacoes_comerciais_documento" CHECK (("aprovacoes_comerciais"."tipo_documento" = 'orcamento') = ("aprovacoes_comerciais"."orcamento_id" is not null)),
	CONSTRAINT "aprovacoes_comerciais_alcadas" CHECK ("aprovacoes_comerciais"."percentual" between 1 and 10000 and "aprovacoes_comerciais"."alcada_solicitante" between 0 and 10000
        and "aprovacoes_comerciais"."alcada_solicitante" < "aprovacoes_comerciais"."percentual"
        and ("aprovacoes_comerciais"."alcada_decisor" is null or "aprovacoes_comerciais"."alcada_decisor" >= "aprovacoes_comerciais"."percentual")),
	CONSTRAINT "aprovacoes_comerciais_decisao" CHECK (case "aprovacoes_comerciais"."status"
        when 'pendente' then "aprovacoes_comerciais"."decidido_por" is null and "aprovacoes_comerciais"."decidido_em" is null
        when 'cancelada' then "aprovacoes_comerciais"."decidido_em" is not null
        else "aprovacoes_comerciais"."decidido_por" is not null and "aprovacoes_comerciais"."decidido_em" is not null and "aprovacoes_comerciais"."alcada_decisor" is not null
          and "aprovacoes_comerciais"."decidido_por" <> "aprovacoes_comerciais"."solicitante_id" end),
	CONSTRAINT "aprovacoes_comerciais_justificativa" CHECK ("aprovacoes_comerciais"."status" <> 'reprovada' or length(trim("aprovacoes_comerciais"."justificativa")) > 0),
	CONSTRAINT "aprovacoes_comerciais_totais" CHECK ("aprovacoes_comerciais"."total_centavos" = "aprovacoes_comerciais"."subtotal_centavos" - "aprovacoes_comerciais"."desconto_centavos" and "aprovacoes_comerciais"."desconto_centavos" > 0)
);
--> statement-breakpoint
ALTER TABLE "aprovacoes_comerciais" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aprovacoes_comerciais_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"aprovacao_id" uuid NOT NULL,
	"evento" "evento_aprovacao_comercial" NOT NULL,
	"usuario_id" uuid,
	"funcao" text,
	"alcada" integer,
	"detalhe" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aprovacoes_comerciais_eventos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alcadas_desconto" ADD CONSTRAINT "alcadas_desconto_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alcadas_desconto" ADD CONSTRAINT "alcadas_desconto_tenant_id_funcao_id_funcoes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","funcao_id") REFERENCES "public"."funcoes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alcadas_desconto" ADD CONSTRAINT "alcadas_desconto_tenant_id_criado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","criado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alcadas_desconto" ADD CONSTRAINT "alcadas_desconto_tenant_id_atualizado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","atualizado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alcadas_desconto_eventos" ADD CONSTRAINT "alcadas_desconto_eventos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alcadas_desconto_eventos" ADD CONSTRAINT "alcadas_desconto_eventos_tenant_id_funcao_id_funcoes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","funcao_id") REFERENCES "public"."funcoes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alcadas_desconto_eventos" ADD CONSTRAINT "alcadas_desconto_eventos_tenant_id_usuario_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","usuario_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aprovacoes_comerciais" ADD CONSTRAINT "aprovacoes_comerciais_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aprovacoes_comerciais" ADD CONSTRAINT "aprovacoes_comerciais_tenant_id_orcamento_id_orcamentos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","orcamento_id") REFERENCES "public"."orcamentos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aprovacoes_comerciais" ADD CONSTRAINT "aprovacoes_comerciais_tenant_id_solicitante_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","solicitante_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aprovacoes_comerciais" ADD CONSTRAINT "aprovacoes_comerciais_tenant_id_decidido_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","decidido_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aprovacoes_comerciais_eventos" ADD CONSTRAINT "aprovacoes_comerciais_eventos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aprovacoes_comerciais_eventos" ADD CONSTRAINT "aprovacoes_comerciais_eventos_tenant_id_aprovacao_id_aprovacoes_comerciais_tenant_id_id_fk" FOREIGN KEY ("tenant_id","aprovacao_id") REFERENCES "public"."aprovacoes_comerciais"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aprovacoes_comerciais_eventos" ADD CONSTRAINT "aprovacoes_comerciais_eventos_tenant_id_usuario_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","usuario_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alcadas_desconto_funcao_unica" ON "alcadas_desconto" USING btree ("tenant_id","funcao_id");--> statement-breakpoint
CREATE INDEX "alcadas_desconto_eventos_funcao_id_criado_em_index" ON "alcadas_desconto_eventos" USING btree ("funcao_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "alcadas_desconto_eventos_tenant_id_criado_em_index" ON "alcadas_desconto_eventos" USING btree ("tenant_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "aprovacoes_comerciais_uma_pendente" ON "aprovacoes_comerciais" USING btree ("tenant_id","tipo_documento","orcamento_id") WHERE "aprovacoes_comerciais"."status" = 'pendente';--> statement-breakpoint
CREATE INDEX "aprovacoes_comerciais_tenant_id_status_criado_em_index" ON "aprovacoes_comerciais" USING btree ("tenant_id","status","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "aprovacoes_comerciais_orcamento_id_index" ON "aprovacoes_comerciais" USING btree ("orcamento_id");--> statement-breakpoint
CREATE INDEX "aprovacoes_comerciais_solicitante_id_index" ON "aprovacoes_comerciais" USING btree ("solicitante_id");--> statement-breakpoint
CREATE INDEX "aprovacoes_comerciais_decidido_por_index" ON "aprovacoes_comerciais" USING btree ("decidido_por");--> statement-breakpoint
CREATE INDEX "aprovacoes_comerciais_eventos_aprovacao_id_criado_em_index" ON "aprovacoes_comerciais_eventos" USING btree ("aprovacao_id","criado_em");--> statement-breakpoint
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_emitido_com_validade" CHECK ("orcamentos"."status" in ('rascunho', 'cancelado', 'aguardando_aprovacao_comercial', 'reprovado_comercialmente')
        or "orcamentos"."validade_ate" is not null);--> statement-breakpoint
CREATE POLICY "alcadas_desconto_isolamento_tenant" ON "alcadas_desconto" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "alcadas_desconto_eventos_isolamento_tenant" ON "alcadas_desconto_eventos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "aprovacoes_comerciais_isolamento_tenant" ON "aprovacoes_comerciais" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "aprovacoes_comerciais_eventos_isolamento_tenant" ON "aprovacoes_comerciais_eventos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Histórico só de inclusão: eventos da aprovação e das alçadas não podem ser alterados nem apagados.
CREATE FUNCTION impedir_alteracao_de_historico() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'O histórico não pode ser alterado nem apagado'
    USING ERRCODE = '23514', CONSTRAINT = TG_TABLE_NAME || '_imutavel';
END
$$;--> statement-breakpoint
CREATE TRIGGER aprovacoes_comerciais_eventos_imutavel BEFORE UPDATE OR DELETE ON aprovacoes_comerciais_eventos
  FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_de_historico();--> statement-breakpoint
CREATE TRIGGER alcadas_desconto_eventos_imutavel BEFORE UPDATE OR DELETE ON alcadas_desconto_eventos
  FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_de_historico();--> statement-breakpoint
-- Solicitação: não é apagada; decidida (aprovada, reprovada, cancelada), não muda mais. Enquanto pendente, só a
-- decisão muda: documento, valores, percentuais, solicitante e retrato ficam como na solicitação.
CREATE FUNCTION proteger_aprovacao_comercial() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'pendente'
    OR (NEW.tipo_documento, NEW.orcamento_id, NEW.documento_numero, NEW.documento_versao, NEW.cliente_nome,
        NEW.subtotal_centavos, NEW.desconto_centavos, NEW.total_centavos, NEW.percentual, NEW.solicitante_id,
        NEW.solicitante_funcao, NEW.alcada_solicitante, NEW.snapshot, NEW.criado_em)
      IS DISTINCT FROM
       (OLD.tipo_documento, OLD.orcamento_id, OLD.documento_numero, OLD.documento_versao, OLD.cliente_nome,
        OLD.subtotal_centavos, OLD.desconto_centavos, OLD.total_centavos, OLD.percentual, OLD.solicitante_id,
        OLD.solicitante_funcao, OLD.alcada_solicitante, OLD.snapshot, OLD.criado_em)
  THEN
    RAISE EXCEPTION 'A aprovação comercial decidida não pode ser alterada nem apagada'
      USING ERRCODE = '23514', CONSTRAINT = 'aprovacoes_comerciais_imutavel';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER aprovacoes_comerciais_imutavel BEFORE UPDATE OR DELETE ON aprovacoes_comerciais
  FOR EACH ROW EXECUTE FUNCTION proteger_aprovacao_comercial();--> statement-breakpoint
-- Alçada inicial (decisão de 25/09/2026): Administrador 100%; as demais funções ficam sem linha = 0%.
INSERT INTO "alcadas_desconto" ("tenant_id", "funcao_id", "percentual")
  SELECT "tenant_id", "id", 10000 FROM "funcoes" WHERE "admin";
