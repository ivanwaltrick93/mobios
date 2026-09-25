-- Alvo da FK composta orcamentos → veiculos.
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_tenantId_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
CREATE TYPE "public"."evento_orcamento" AS ENUM('criado', 'alterado', 'precos_recalculados', 'tabela_trocada', 'emitido', 'enviado', 'aprovado', 'recusado', 'cancelado', 'nova_versao');--> statement-breakpoint
CREATE TYPE "public"."status_orcamento" AS ENUM('rascunho', 'emitido', 'enviado', 'aprovado', 'recusado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."tipo_item_orcamento" AS ENUM('material', 'servico');--> statement-breakpoint
-- Módulos "Orçamentos" e "Aprovar orçamentos": o tipo é recriado com a lista completa (ADD VALUE não pode ser usado
-- na mesma transação).
ALTER TYPE "public"."modulo" RENAME TO "modulo_antigo";--> statement-breakpoint
CREATE TYPE "public"."modulo" AS ENUM('clientes', 'orcamentos', 'aprovar_orcamentos', 'os', 'pecas_os', 'materiais', 'servicos', 'precos', 'estoque', 'recebimentos', 'financeiro', 'relatorios');--> statement-breakpoint
ALTER TABLE "funcao_permissoes" ALTER COLUMN "modulo" TYPE "public"."modulo" USING "modulo"::text::"public"."modulo";--> statement-breakpoint
DROP TYPE "public"."modulo_antigo";--> statement-breakpoint
CREATE TABLE "orcamento_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"orcamento_id" uuid NOT NULL,
	"ordem" integer NOT NULL,
	"tipo" "tipo_item_orcamento" NOT NULL,
	"material_id" uuid,
	"servico_id" uuid,
	"codigo" text NOT NULL,
	"descricao" text NOT NULL,
	"unidade" text NOT NULL,
	"forma_preco" "forma_preco_servico",
	"multiplo" integer NOT NULL,
	"fracionada" boolean DEFAULT false NOT NULL,
	"quantidade" numeric(14, 3),
	"tempo_minutos" integer,
	"preco_tabela_centavos" bigint NOT NULL,
	"preco_unitario_centavos" bigint NOT NULL,
	"desconto_percentual" integer,
	"bruto_centavos" bigint NOT NULL,
	"desconto_centavos" bigint NOT NULL,
	"total_centavos" bigint NOT NULL,
	CONSTRAINT "orcamento_itens_um_item" CHECK (("orcamento_itens"."tipo" = 'material' and "orcamento_itens"."material_id" is not null and "orcamento_itens"."servico_id" is null)
        or ("orcamento_itens"."tipo" = 'servico' and "orcamento_itens"."servico_id" is not null and "orcamento_itens"."material_id" is null)),
	CONSTRAINT "orcamento_itens_quantidade" CHECK (case when "orcamento_itens"."forma_preco" = 'hora' then "orcamento_itens"."tempo_minutos" > 0 and "orcamento_itens"."quantidade" is null
        else "orcamento_itens"."quantidade" > 0 and "orcamento_itens"."tempo_minutos" is null end),
	CONSTRAINT "orcamento_itens_multiplo_positivo" CHECK ("orcamento_itens"."multiplo" > 0),
	CONSTRAINT "orcamento_itens_preco_negociado" CHECK ("orcamento_itens"."preco_unitario_centavos" >= 0 and "orcamento_itens"."preco_unitario_centavos" <= "orcamento_itens"."preco_tabela_centavos"),
	CONSTRAINT "orcamento_itens_servico_sem_negociacao" CHECK ("orcamento_itens"."tipo" = 'material' or "orcamento_itens"."preco_unitario_centavos" = "orcamento_itens"."preco_tabela_centavos"),
	CONSTRAINT "orcamento_itens_percentual" CHECK ("orcamento_itens"."desconto_percentual" is null or "orcamento_itens"."desconto_percentual" between 0 and 10000),
	CONSTRAINT "orcamento_itens_totais" CHECK ("orcamento_itens"."bruto_centavos" >= 0 and "orcamento_itens"."desconto_centavos" >= 0
        and "orcamento_itens"."total_centavos" = "orcamento_itens"."bruto_centavos" - "orcamento_itens"."desconto_centavos")
);
--> statement-breakpoint
ALTER TABLE "orcamento_itens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orcamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"numero" integer DEFAULT proximo_codigo('orcamentos') NOT NULL,
	"versao_orcamento" integer DEFAULT 1 NOT NULL,
	"orcamento_origem_id" uuid,
	"status" "status_orcamento" DEFAULT 'rascunho' NOT NULL,
	"cliente_id" uuid NOT NULL,
	"veiculo_id" uuid,
	"vendedor_id" uuid NOT NULL,
	"tabela_preco_id" uuid NOT NULL,
	"validade_ate" date,
	"precos_em" date NOT NULL,
	"observacoes" text,
	"subtotal_centavos" bigint DEFAULT 0 NOT NULL,
	"desconto_centavos" bigint DEFAULT 0 NOT NULL,
	"total_centavos" bigint DEFAULT 0 NOT NULL,
	"emitido_em" timestamp with time zone,
	"emitido_por" uuid,
	"enviado_em" timestamp with time zone,
	"enviado_por" uuid,
	"aprovado_em" timestamp with time zone,
	"aprovado_por" uuid,
	"recusado_em" timestamp with time zone,
	"recusado_por" uuid,
	"motivo_recusa" text,
	"cancelado_em" timestamp with time zone,
	"cancelado_por" uuid,
	"motivo_cancelamento" text,
	"criado_por" uuid,
	"atualizado_por" uuid,
	"versao" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orcamentos_tenantId_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "orcamentos_versao_positiva" CHECK ("orcamentos"."versao_orcamento" >= 1),
	CONSTRAINT "orcamentos_origem_da_versao" CHECK (("orcamentos"."versao_orcamento" = 1) = ("orcamentos"."orcamento_origem_id" is null)),
	CONSTRAINT "orcamentos_emitido_com_validade" CHECK ("orcamentos"."status" = 'rascunho' or "orcamentos"."status" = 'cancelado' or "orcamentos"."validade_ate" is not null),
	CONSTRAINT "orcamentos_totais" CHECK ("orcamentos"."subtotal_centavos" >= 0 and "orcamentos"."desconto_centavos" >= 0 and "orcamentos"."total_centavos" >= 0
        and "orcamentos"."total_centavos" = "orcamentos"."subtotal_centavos" - "orcamentos"."desconto_centavos")
);
--> statement-breakpoint
ALTER TABLE "orcamentos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orcamentos_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"orcamento_id" uuid NOT NULL,
	"evento" "evento_orcamento" NOT NULL,
	"detalhe" text,
	"usuario_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orcamentos_eventos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tabelas_preco" ADD COLUMN "padrao" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_tenant_id_orcamento_id_orcamentos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","orcamento_id") REFERENCES "public"."orcamentos"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_tenant_id_material_id_materiais_tenant_id_id_fk" FOREIGN KEY ("tenant_id","material_id") REFERENCES "public"."materiais"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_tenant_id_servico_id_servicos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","servico_id") REFERENCES "public"."servicos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_tenant_id_orcamento_origem_id_orcamentos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","orcamento_origem_id") REFERENCES "public"."orcamentos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_tenant_id_cliente_id_clientes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cliente_id") REFERENCES "public"."clientes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_tenant_id_veiculo_id_veiculos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","veiculo_id") REFERENCES "public"."veiculos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_tenant_id_vendedor_id_vendedores_tenant_id_id_fk" FOREIGN KEY ("tenant_id","vendedor_id") REFERENCES "public"."vendedores"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_tenant_id_tabela_preco_id_tabelas_preco_tenant_id_id_fk" FOREIGN KEY ("tenant_id","tabela_preco_id") REFERENCES "public"."tabelas_preco"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_tenant_id_emitido_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","emitido_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_tenant_id_enviado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","enviado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_tenant_id_aprovado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","aprovado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_tenant_id_recusado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","recusado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_tenant_id_cancelado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cancelado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_tenant_id_criado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","criado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_tenant_id_atualizado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","atualizado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos_eventos" ADD CONSTRAINT "orcamentos_eventos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos_eventos" ADD CONSTRAINT "orcamentos_eventos_tenant_id_orcamento_id_orcamentos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","orcamento_id") REFERENCES "public"."orcamentos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamentos_eventos" ADD CONSTRAINT "orcamentos_eventos_tenant_id_usuario_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","usuario_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orcamento_itens_ordem_unica" ON "orcamento_itens" USING btree ("orcamento_id","ordem");--> statement-breakpoint
CREATE INDEX "orcamento_itens_material_id_index" ON "orcamento_itens" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "orcamento_itens_servico_id_index" ON "orcamento_itens" USING btree ("servico_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orcamentos_numero_versao_unico" ON "orcamentos" USING btree ("tenant_id","numero","versao_orcamento");--> statement-breakpoint
CREATE UNIQUE INDEX "orcamentos_uma_versao_viva" ON "orcamentos" USING btree ("tenant_id","numero") WHERE "orcamentos"."status" <> 'cancelado';--> statement-breakpoint
CREATE INDEX "orcamentos_tenant_id_criado_em_index" ON "orcamentos" USING btree ("tenant_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orcamentos_tenant_id_status_validade_ate_index" ON "orcamentos" USING btree ("tenant_id","status","validade_ate");--> statement-breakpoint
CREATE INDEX "orcamentos_cliente_id_index" ON "orcamentos" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "orcamentos_veiculo_id_index" ON "orcamentos" USING btree ("veiculo_id");--> statement-breakpoint
CREATE INDEX "orcamentos_vendedor_id_index" ON "orcamentos" USING btree ("vendedor_id");--> statement-breakpoint
CREATE INDEX "orcamentos_tabela_preco_id_index" ON "orcamentos" USING btree ("tabela_preco_id");--> statement-breakpoint
CREATE INDEX "orcamentos_orcamento_origem_id_index" ON "orcamentos" USING btree ("orcamento_origem_id");--> statement-breakpoint
CREATE INDEX "orcamentos_eventos_orcamento_id_criado_em_index" ON "orcamentos_eventos" USING btree ("orcamento_id","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "tabelas_preco_padrao_unico" ON "tabelas_preco" USING btree ("tenant_id") WHERE "tabelas_preco"."padrao";--> statement-breakpoint
ALTER TABLE "tabelas_preco" ADD CONSTRAINT "tabelas_preco_padrao_ativa" CHECK (not "tabelas_preco"."padrao" or "tabelas_preco"."ativa");--> statement-breakpoint
CREATE POLICY "orcamento_itens_isolamento_tenant" ON "orcamento_itens" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "orcamentos_isolamento_tenant" ON "orcamentos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "orcamentos_eventos_isolamento_tenant" ON "orcamentos_eventos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- Número e versão do orçamento não mudam depois de gravados.
CREATE FUNCTION impedir_troca_de_numero_orcamento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero IS DISTINCT FROM OLD.numero OR NEW.versao_orcamento IS DISTINCT FROM OLD.versao_orcamento THEN
    RAISE EXCEPTION 'O número e a versão do orçamento não podem ser alterados'
      USING ERRCODE = '23514', CONSTRAINT = 'orcamentos_numero_imutavel';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER orcamentos_numero_imutavel BEFORE UPDATE OF numero, versao_orcamento ON orcamentos
  FOR EACH ROW EXECUTE FUNCTION impedir_troca_de_numero_orcamento();--> statement-breakpoint
-- Depois de emitido, o conteúdo do orçamento não muda: itens só são incluídos, alterados ou removidos no rascunho
-- (a API já recusa; o banco garante mesmo por fora dela).
CREATE FUNCTION itens_so_no_rascunho() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  situacao status_orcamento;
BEGIN
  SELECT status INTO situacao FROM orcamentos WHERE id = COALESCE(NEW.orcamento_id, OLD.orcamento_id);
  IF situacao IS DISTINCT FROM 'rascunho' THEN
    RAISE EXCEPTION 'Só o rascunho pode ter os itens alterados'
      USING ERRCODE = '23514', CONSTRAINT = 'orcamento_itens_so_no_rascunho';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;--> statement-breakpoint
CREATE TRIGGER orcamento_itens_so_no_rascunho BEFORE INSERT OR UPDATE OR DELETE ON orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION itens_so_no_rascunho();--> statement-breakpoint
-- Tabela padrão: a ativa mais antiga de cada oficina (o admin troca depois em Tabelas de Preço).
UPDATE tabelas_preco SET padrao = true
WHERE id IN (
  SELECT DISTINCT ON (tenant_id) id FROM tabelas_preco WHERE ativa ORDER BY tenant_id, criado_em, id
);--> statement-breakpoint
-- Níveis dos módulos novos nas funções padrão (iguais a FUNCOES_PADRAO), sem mexer no que o admin já definiu.
INSERT INTO "funcao_permissoes" ("tenant_id", "funcao_id", "modulo", "nivel")
  SELECT f."tenant_id", f."id", p."modulo"::"modulo", p."nivel"::"nivel_acesso"
  FROM "funcoes" f
  JOIN (VALUES
    ('Atendente', 'orcamentos', 'editar'), ('Atendente', 'aprovar_orcamentos', 'editar'),
    ('Financeiro', 'orcamentos', 'editar'), ('Financeiro', 'aprovar_orcamentos', 'editar'),
    ('Mecânico', 'orcamentos', 'consultar'), ('Almoxarife', 'orcamentos', 'consultar')
  ) AS p("funcao", "modulo", "nivel") ON p."funcao" = f."nome" AND NOT f."admin"
  ON CONFLICT DO NOTHING;
