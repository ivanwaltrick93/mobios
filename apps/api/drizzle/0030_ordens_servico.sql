CREATE TYPE "public"."aprovacao_item_os" AS ENUM('pendente', 'aprovado', 'recusado');--> statement-breakpoint
CREATE TYPE "public"."evento_os" AS ENUM('criada', 'convertida', 'dados_alterados', 'itens_alterados', 'descontos_alterados', 'diagnostico_iniciado', 'aprovacao_solicitada', 'aprovada', 'recusada', 'execucao_iniciada', 'aguardando_peca', 'execucao_retomada', 'cancelada', 'mecanico_vinculado', 'mecanico_desvinculado', 'aprovacao_comercial_solicitada', 'aprovado_comercialmente', 'reprovado_comercialmente');--> statement-breakpoint
CREATE TYPE "public"."status_os" AS ENUM('aberta', 'em_diagnostico', 'aguardando_aprovacao', 'aprovada', 'em_execucao', 'aguardando_peca', 'concluida', 'entregue', 'recusada', 'cancelada');--> statement-breakpoint
CREATE TABLE "ordens_servico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"numero" integer DEFAULT proximo_codigo('ordens_servico') NOT NULL,
	"status" "status_os" DEFAULT 'aberta' NOT NULL,
	"cliente_id" uuid NOT NULL,
	"veiculo_id" uuid NOT NULL,
	"vendedor_id" uuid,
	"orcamento_id" uuid,
	"tabela_preco_id" uuid NOT NULL,
	"km_entrada" integer NOT NULL,
	"relato_cliente" text,
	"observacoes" text,
	"previsao_entrega" timestamp with time zone,
	"aprovada_em" timestamp with time zone,
	"aprovada_por" uuid,
	"recusada_em" timestamp with time zone,
	"recusada_por" uuid,
	"motivo_recusa" text,
	"cancelada_em" timestamp with time zone,
	"cancelada_por" uuid,
	"motivo_cancelamento" text,
	"subtotal_servicos_centavos" bigint DEFAULT 0 NOT NULL,
	"subtotal_materiais_centavos" bigint DEFAULT 0 NOT NULL,
	"desconto_centavos" bigint DEFAULT 0 NOT NULL,
	"total_centavos" bigint DEFAULT 0 NOT NULL,
	"criado_por" uuid,
	"atualizado_por" uuid,
	"versao" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ordens_servico_tenantId_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "ordens_servico_km_entrada" CHECK ("ordens_servico"."km_entrada" >= 0),
	CONSTRAINT "ordens_servico_totais" CHECK ("ordens_servico"."subtotal_servicos_centavos" >= 0 and "ordens_servico"."subtotal_materiais_centavos" >= 0 and "ordens_servico"."desconto_centavos" >= 0
        and "ordens_servico"."total_centavos" = "ordens_servico"."subtotal_servicos_centavos" + "ordens_servico"."subtotal_materiais_centavos" - "ordens_servico"."desconto_centavos"),
	CONSTRAINT "ordens_servico_cancelamento" CHECK ("ordens_servico"."status" <> 'cancelada' or "ordens_servico"."motivo_cancelamento" is not null)
);
--> statement-breakpoint
ALTER TABLE "ordens_servico" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "os_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"ordem_servico_id" uuid NOT NULL,
	"evento" "evento_os" NOT NULL,
	"situacao_anterior" "status_os",
	"situacao_nova" "status_os",
	"detalhe" text,
	"usuario_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "os_eventos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "os_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"ordem_servico_id" uuid NOT NULL,
	"ordem" integer NOT NULL,
	"tipo" "tipo_item_orcamento" NOT NULL,
	"material_id" uuid,
	"servico_id" uuid,
	"avulso" boolean DEFAULT false NOT NULL,
	"orcamento_item_id" uuid,
	"codigo" text,
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
	"pmc_centavos" bigint,
	"bruto_centavos" bigint NOT NULL,
	"desconto_centavos" bigint NOT NULL,
	"total_centavos" bigint NOT NULL,
	"aprovacao" "aprovacao_item_os" DEFAULT 'pendente' NOT NULL,
	CONSTRAINT "os_itens_um_item" CHECK (case when "os_itens"."avulso" then "os_itens"."material_id" is null and "os_itens"."servico_id" is null and "os_itens"."codigo" is null
        when "os_itens"."tipo" = 'material' then "os_itens"."material_id" is not null and "os_itens"."servico_id" is null and "os_itens"."codigo" is not null
        else "os_itens"."servico_id" is not null and "os_itens"."material_id" is null and "os_itens"."codigo" is not null end),
	CONSTRAINT "os_itens_quantidade" CHECK (case when "os_itens"."forma_preco" = 'hora' then "os_itens"."tempo_minutos" > 0 and "os_itens"."quantidade" is null
        else "os_itens"."quantidade" > 0 and "os_itens"."tempo_minutos" is null end),
	CONSTRAINT "os_itens_multiplo_positivo" CHECK ("os_itens"."multiplo" > 0),
	CONSTRAINT "os_itens_preco_negociado" CHECK ("os_itens"."preco_unitario_centavos" >= 0 and "os_itens"."preco_unitario_centavos" <= "os_itens"."preco_tabela_centavos"),
	CONSTRAINT "os_itens_sem_negociacao" CHECK (("os_itens"."tipo" = 'material' and not "os_itens"."avulso")
        or ("os_itens"."preco_unitario_centavos" = "os_itens"."preco_tabela_centavos" and "os_itens"."desconto_percentual" is null)),
	CONSTRAINT "os_itens_pmc" CHECK ("os_itens"."pmc_centavos" is null or ("os_itens"."tipo" = 'material' and not "os_itens"."avulso" and "os_itens"."pmc_centavos" >= 0)),
	CONSTRAINT "os_itens_percentual" CHECK ("os_itens"."desconto_percentual" is null or "os_itens"."desconto_percentual" between 0 and 10000),
	CONSTRAINT "os_itens_totais" CHECK ("os_itens"."bruto_centavos" >= 0 and "os_itens"."desconto_centavos" >= 0
        and "os_itens"."total_centavos" = "os_itens"."bruto_centavos" - "os_itens"."desconto_centavos")
);
--> statement-breakpoint
ALTER TABLE "os_itens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "os_mecanicos" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"ordem_servico_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "os_mecanicos_ordem_servico_id_usuario_id_pk" PRIMARY KEY("ordem_servico_id","usuario_id")
);
--> statement-breakpoint
ALTER TABLE "os_mecanicos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "aprovacoes_comerciais" DROP CONSTRAINT "aprovacoes_comerciais_documento";--> statement-breakpoint
-- O.S. como documento da aprovação comercial. O enum é recriado (não ADD VALUE): o valor novo é usado nesta mesma
-- migração, na CHECK abaixo, e ADD VALUE não pode ser usado na transação em que foi criado.
ALTER TYPE "public"."tipo_documento_comercial" RENAME TO "tipo_documento_comercial_antigo";--> statement-breakpoint
CREATE TYPE "public"."tipo_documento_comercial" AS ENUM('orcamento', 'ordem_servico');--> statement-breakpoint
ALTER TABLE "aprovacoes_comerciais" ALTER COLUMN "tipo_documento" TYPE "public"."tipo_documento_comercial" USING "tipo_documento"::text::"public"."tipo_documento_comercial";--> statement-breakpoint
DROP TYPE "public"."tipo_documento_comercial_antigo";--> statement-breakpoint
ALTER TABLE "aprovacoes_comerciais" ADD COLUMN "ordem_servico_id" uuid;--> statement-breakpoint
-- Alvo da FK composta os_itens → orcamento_itens (antes dela).
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_tenantId_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tenant_id_cliente_id_clientes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cliente_id") REFERENCES "public"."clientes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tenant_id_veiculo_id_veiculos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","veiculo_id") REFERENCES "public"."veiculos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tenant_id_vendedor_id_vendedores_tenant_id_id_fk" FOREIGN KEY ("tenant_id","vendedor_id") REFERENCES "public"."vendedores"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tenant_id_orcamento_id_orcamentos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","orcamento_id") REFERENCES "public"."orcamentos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tenant_id_tabela_preco_id_tabelas_preco_tenant_id_id_fk" FOREIGN KEY ("tenant_id","tabela_preco_id") REFERENCES "public"."tabelas_preco"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tenant_id_aprovada_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","aprovada_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tenant_id_recusada_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","recusada_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tenant_id_cancelada_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cancelada_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tenant_id_criado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","criado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tenant_id_atualizado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","atualizado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_eventos" ADD CONSTRAINT "os_eventos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_eventos" ADD CONSTRAINT "os_eventos_tenant_id_ordem_servico_id_ordens_servico_tenant_id_id_fk" FOREIGN KEY ("tenant_id","ordem_servico_id") REFERENCES "public"."ordens_servico"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_eventos" ADD CONSTRAINT "os_eventos_tenant_id_usuario_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","usuario_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_itens" ADD CONSTRAINT "os_itens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_itens" ADD CONSTRAINT "os_itens_tenant_id_ordem_servico_id_ordens_servico_tenant_id_id_fk" FOREIGN KEY ("tenant_id","ordem_servico_id") REFERENCES "public"."ordens_servico"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_itens" ADD CONSTRAINT "os_itens_tenant_id_material_id_materiais_tenant_id_id_fk" FOREIGN KEY ("tenant_id","material_id") REFERENCES "public"."materiais"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_itens" ADD CONSTRAINT "os_itens_tenant_id_servico_id_servicos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","servico_id") REFERENCES "public"."servicos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_itens" ADD CONSTRAINT "os_itens_tenant_id_orcamento_item_id_orcamento_itens_tenant_id_id_fk" FOREIGN KEY ("tenant_id","orcamento_item_id") REFERENCES "public"."orcamento_itens"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_mecanicos" ADD CONSTRAINT "os_mecanicos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_mecanicos" ADD CONSTRAINT "os_mecanicos_tenant_id_ordem_servico_id_ordens_servico_tenant_id_id_fk" FOREIGN KEY ("tenant_id","ordem_servico_id") REFERENCES "public"."ordens_servico"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_mecanicos" ADD CONSTRAINT "os_mecanicos_tenant_id_usuario_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","usuario_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ordens_servico_numero_unico" ON "ordens_servico" USING btree ("tenant_id","numero");--> statement-breakpoint
CREATE UNIQUE INDEX "ordens_servico_um_orcamento" ON "ordens_servico" USING btree ("tenant_id","orcamento_id") WHERE "ordens_servico"."orcamento_id" is not null;--> statement-breakpoint
CREATE INDEX "ordens_servico_lista" ON "ordens_servico" USING btree ("tenant_id","criado_em" DESC NULLS FIRST,"numero" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ordens_servico_tenant_id_status_index" ON "ordens_servico" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "ordens_servico_cliente_id_index" ON "ordens_servico" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "ordens_servico_veiculo_id_index" ON "ordens_servico" USING btree ("veiculo_id");--> statement-breakpoint
CREATE INDEX "ordens_servico_vendedor_id_index" ON "ordens_servico" USING btree ("vendedor_id");--> statement-breakpoint
CREATE INDEX "ordens_servico_tabela_preco_id_index" ON "ordens_servico" USING btree ("tabela_preco_id");--> statement-breakpoint
CREATE INDEX "os_eventos_ordem_servico_id_criado_em_index" ON "os_eventos" USING btree ("ordem_servico_id","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "os_itens_ordem_unica" ON "os_itens" USING btree ("ordem_servico_id","ordem");--> statement-breakpoint
CREATE INDEX "os_itens_ordem_servico_id_index" ON "os_itens" USING btree ("ordem_servico_id");--> statement-breakpoint
CREATE INDEX "os_itens_material_id_index" ON "os_itens" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "os_itens_servico_id_index" ON "os_itens" USING btree ("servico_id");--> statement-breakpoint
CREATE INDEX "os_itens_orcamento_item_id_index" ON "os_itens" USING btree ("orcamento_item_id");--> statement-breakpoint
CREATE INDEX "os_mecanicos_usuario_id_index" ON "os_mecanicos" USING btree ("usuario_id");--> statement-breakpoint
ALTER TABLE "aprovacoes_comerciais" ADD CONSTRAINT "aprovacoes_comerciais_tenant_id_ordem_servico_id_ordens_servico_tenant_id_id_fk" FOREIGN KEY ("tenant_id","ordem_servico_id") REFERENCES "public"."ordens_servico"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aprovacoes_comerciais_uma_pendente_os" ON "aprovacoes_comerciais" USING btree ("tenant_id","ordem_servico_id") WHERE "aprovacoes_comerciais"."status" = 'pendente' and "aprovacoes_comerciais"."ordem_servico_id" is not null;--> statement-breakpoint
CREATE INDEX "aprovacoes_comerciais_ordem_servico_id_index" ON "aprovacoes_comerciais" USING btree ("ordem_servico_id");--> statement-breakpoint
ALTER TABLE "aprovacoes_comerciais" ADD CONSTRAINT "aprovacoes_comerciais_documento" CHECK (("aprovacoes_comerciais"."tipo_documento" = 'orcamento') = ("aprovacoes_comerciais"."orcamento_id" is not null)
        and ("aprovacoes_comerciais"."tipo_documento" = 'ordem_servico') = ("aprovacoes_comerciais"."ordem_servico_id" is not null));--> statement-breakpoint
CREATE POLICY "ordens_servico_isolamento_tenant" ON "ordens_servico" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "os_eventos_isolamento_tenant" ON "os_eventos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "os_itens_isolamento_tenant" ON "os_itens" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "os_mecanicos_isolamento_tenant" ON "os_mecanicos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Histórico da O.S. só de inclusão (a função é a da migração 0025).
CREATE TRIGGER os_eventos_imutavel BEFORE UPDATE OR DELETE ON os_eventos
  FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_de_historico();--> statement-breakpoint
-- Parâmetro MECÂNICO (docs/modulos/ORDENS_SERVICO.md §6): quem pode ser vinculado a uma O.S. A função padrão
-- Mecânico das oficinas que já existem passa a tê-lo (as novas já nascem com ele, FUNCOES_PADRAO).
INSERT INTO parametros_funcao (codigo, nome, descricao) VALUES (
  'MECANICO',
  'Mecânico',
  'Usuários com uma função ativa com este parâmetro podem ser vinculados às O.S. como mecânicos; sem ser Administrador nem vendedor, veem só as O.S. vinculadas a eles.'
);--> statement-breakpoint
INSERT INTO funcao_parametros (tenant_id, funcao_id, parametro_id)
SELECT f.tenant_id, f.id, p.id
FROM funcoes f CROSS JOIN parametros_funcao p
WHERE p.codigo = 'MECANICO' AND lower(f.nome) = 'mecânico' AND NOT f.admin;--> statement-breakpoint
-- Busca da lista de O.S. (número exato, nome do cliente por trecho, placa exata), como busca_orcamentos (0028):
-- ILIKE direto na rota não usa índice sob o RLS.
CREATE FUNCTION busca_ordens_servico(p_numero integer, p_cliente text, p_placa text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM ordens_servico
  WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND numero = p_numero
  UNION
  SELECT o.id FROM ordens_servico o JOIN clientes c ON c.tenant_id = o.tenant_id AND c.id = o.cliente_id
  WHERE c.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND c.nome ILIKE p_cliente
  UNION
  SELECT o.id FROM ordens_servico o JOIN veiculos v ON v.tenant_id = o.tenant_id AND v.id = o.veiculo_id
  WHERE v.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND v.placa = p_placa
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION busca_ordens_servico(integer, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION busca_ordens_servico(integer, text, text) TO mobios_app;
