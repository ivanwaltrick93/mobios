-- Serviços (mão de obra) com preço nas mesmas tabelas dos materiais: cada vigência, preço padrão e evento de preço
-- passa a ser de um material OU de um serviço. Lista "Classificação de serviço" e módulo de acesso "Serviços".
CREATE TYPE "public"."forma_preco_servico" AS ENUM('fechado', 'hora');--> statement-breakpoint
-- Módulo "Serviços": o tipo é recriado com a lista completa (ADD VALUE não pode ser usado na mesma transação).
ALTER TYPE "public"."modulo" RENAME TO "modulo_antigo";--> statement-breakpoint
CREATE TYPE "public"."modulo" AS ENUM('clientes', 'os', 'pecas_os', 'materiais', 'servicos', 'precos', 'estoque', 'recebimentos', 'financeiro', 'relatorios');--> statement-breakpoint
ALTER TABLE "funcao_permissoes" ALTER COLUMN "modulo" TYPE "public"."modulo" USING "modulo"::text::"public"."modulo";--> statement-breakpoint
DROP TYPE "public"."modulo_antigo";--> statement-breakpoint
CREATE TABLE "classificacoes_servico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"codigo" integer DEFAULT proximo_codigo('classificacoes_servico') NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classificacoes_servico_tenantId_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "classificacoes_servico" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "servicos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"codigo" integer DEFAULT proximo_codigo('servicos') NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"forma_preco" "forma_preco_servico" DEFAULT 'fechado' NOT NULL,
	"tempo_minutos" integer,
	"observacao" text,
	"classificacao_id" uuid,
	"garantia_dias" integer,
	"garantia_km" integer,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_por" uuid,
	"atualizado_por" uuid,
	"versao" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "servicos_tenantId_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "servicos_tempo_positivo" CHECK ("servicos"."tempo_minutos" is null or "servicos"."tempo_minutos" > 0),
	CONSTRAINT "servicos_valor_hora_com_tempo" CHECK ("servicos"."forma_preco" <> 'hora' or "servicos"."tempo_minutos" is not null),
	CONSTRAINT "servicos_garantia_positiva" CHECK (coalesce("servicos"."garantia_dias", 0) >= 0 and coalesce("servicos"."garantia_km", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "servicos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "materiais_precos" ALTER COLUMN "material_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "precos_padrao" ALTER COLUMN "material_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "precos_padrao_eventos" ALTER COLUMN "material_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "materiais_precos" ADD COLUMN "servico_id" uuid;--> statement-breakpoint
ALTER TABLE "precos_padrao" ADD COLUMN "servico_id" uuid;--> statement-breakpoint
ALTER TABLE "precos_padrao_eventos" ADD COLUMN "servico_id" uuid;--> statement-breakpoint
ALTER TABLE "classificacoes_servico" ADD CONSTRAINT "classificacoes_servico_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servicos" ADD CONSTRAINT "servicos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servicos" ADD CONSTRAINT "servicos_tenant_id_classificacao_id_classificacoes_servico_tenant_id_id_fk" FOREIGN KEY ("tenant_id","classificacao_id") REFERENCES "public"."classificacoes_servico"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servicos" ADD CONSTRAINT "servicos_tenant_id_criado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","criado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servicos" ADD CONSTRAINT "servicos_tenant_id_atualizado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","atualizado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "classificacoes_servico_codigo_unico" ON "classificacoes_servico" USING btree ("tenant_id","codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "classificacoes_servico_nome_unico" ON "classificacoes_servico" USING btree ("tenant_id",lower("nome"));--> statement-breakpoint
CREATE UNIQUE INDEX "servicos_codigo_unico" ON "servicos" USING btree ("tenant_id","codigo");--> statement-breakpoint
CREATE INDEX "servicos_tenant_id_ativo_codigo_index" ON "servicos" USING btree ("tenant_id","ativo","codigo");--> statement-breakpoint
CREATE INDEX "servicos_classificacao_id_index" ON "servicos" USING btree ("classificacao_id");--> statement-breakpoint
ALTER TABLE "materiais_precos" ADD CONSTRAINT "materiais_precos_tenant_id_servico_id_servicos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","servico_id") REFERENCES "public"."servicos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos_padrao" ADD CONSTRAINT "precos_padrao_tenant_id_servico_id_servicos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","servico_id") REFERENCES "public"."servicos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos_padrao_eventos" ADD CONSTRAINT "precos_padrao_eventos_tenant_id_servico_id_servicos_tenant_id_id_fk" FOREIGN KEY ("tenant_id","servico_id") REFERENCES "public"."servicos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "materiais_precos_consulta_servico" ON "materiais_precos" USING btree ("servico_id","tabela_preco_id","data_inicio" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "precos_padrao_servico_unico" ON "precos_padrao" USING btree ("tenant_id","servico_id","tabela_preco_id") WHERE "precos_padrao"."servico_id" is not null;--> statement-breakpoint
CREATE INDEX "precos_padrao_eventos_servico_id_tabela_preco_id_criado_em_index" ON "precos_padrao_eventos" USING btree ("servico_id","tabela_preco_id","criado_em");--> statement-breakpoint
ALTER TABLE "materiais_precos" ADD CONSTRAINT "materiais_precos_um_item" CHECK (num_nonnulls("materiais_precos"."material_id", "materiais_precos"."servico_id") = 1);--> statement-breakpoint
ALTER TABLE "precos_padrao" ADD CONSTRAINT "precos_padrao_um_item" CHECK (num_nonnulls("precos_padrao"."material_id", "precos_padrao"."servico_id") = 1);--> statement-breakpoint
ALTER TABLE "precos_padrao_eventos" ADD CONSTRAINT "precos_padrao_eventos_um_item" CHECK (num_nonnulls("precos_padrao_eventos"."material_id", "precos_padrao_eventos"."servico_id") = 1);--> statement-breakpoint
CREATE POLICY "classificacoes_servico_isolamento_tenant" ON "classificacoes_servico" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "servicos_isolamento_tenant" ON "servicos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Mesma regra crítica dos materiais: vigências não canceladas do mesmo serviço + tabela não se sobrepõem.
ALTER TABLE "materiais_precos" ADD CONSTRAINT "materiais_precos_servico_sem_sobreposicao"
  EXCLUDE USING gist ("tenant_id" WITH =, "servico_id" WITH =, "tabela_preco_id" WITH =, daterange("data_inicio", "data_fim", '[]') WITH &&)
  WHERE (NOT "cancelado" AND "servico_id" IS NOT NULL);--> statement-breakpoint
CREATE TRIGGER servicos_codigo_imutavel BEFORE UPDATE OF codigo ON servicos
  FOR EACH ROW EXECUTE FUNCTION impedir_troca_de_codigo();--> statement-breakpoint
CREATE TRIGGER classificacoes_servico_codigo_imutavel BEFORE UPDATE OF codigo ON classificacoes_servico
  FOR EACH ROW EXECUTE FUNCTION impedir_troca_de_codigo();--> statement-breakpoint
-- Busca de serviços por trecho do nome.
CREATE INDEX "servicos_nome_trgm" ON "servicos" USING gin ("nome" gin_trgm_ops);--> statement-breakpoint
-- Oficinas existentes: classificações padrão (iguais a OPCOES_PADRAO) com código explícito, porque aqui não há
-- oficina na sessão para proximo_codigo; o contador fica no último código.
INSERT INTO classificacoes_servico (tenant_id, codigo, nome)
SELECT t.id, c.ordem, c.nome
FROM tenants t
CROSS JOIN (VALUES
  (1, 'Mecânica'), (2, 'Elétrica'), (3, 'Funilaria e pintura'), (4, 'Alinhamento e balanceamento'),
  (5, 'Revisão'), (6, 'Diagnóstico'), (7, 'Outro')
) AS c(ordem, nome);--> statement-breakpoint
INSERT INTO contadores (tenant_id, chave, valor) SELECT id, 'classificacoes_servico', 7 FROM tenants;--> statement-breakpoint
-- Níveis do módulo novo nas funções padrão (iguais a FUNCOES_PADRAO), sem mexer no que o admin já definiu.
INSERT INTO "funcao_permissoes" ("tenant_id", "funcao_id", "modulo", "nivel")
  SELECT f."tenant_id", f."id", 'servicos'::"modulo", p."nivel"::"nivel_acesso"
  FROM "funcoes" f
  JOIN (VALUES ('Atendente', 'consultar'), ('Mecânico', 'consultar'), ('Almoxarife', 'consultar'), ('Financeiro', 'editar'))
    AS p("funcao", "nivel") ON p."funcao" = f."nome" AND NOT f."admin"
  ON CONFLICT DO NOTHING;
