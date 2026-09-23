-- Novos módulos: "Peças na O.S." e "Recebimentos".
-- Um valor criado com ALTER TYPE ... ADD VALUE não pode ser usado na mesma transação (o migrador roda
-- tudo em uma), então o tipo é recriado com a lista completa, na ordem de MODULOS (packages/shared).
ALTER TYPE "public"."modulo" RENAME TO "modulo_antigo";--> statement-breakpoint
CREATE TYPE "public"."modulo" AS ENUM('clientes', 'os', 'pecas_os', 'estoque', 'recebimentos', 'financeiro', 'relatorios');--> statement-breakpoint
ALTER TABLE "funcao_permissoes" ALTER COLUMN "modulo" TYPE "public"."modulo" USING "modulo"::text::"public"."modulo";--> statement-breakpoint
DROP TYPE "public"."modulo_antigo";--> statement-breakpoint
-- Almoxarife nas oficinas existentes (só onde ainda não há função com esse nome; igual a FUNCOES_PADRAO).
WITH novas AS (
  INSERT INTO "funcoes" ("tenant_id", "nome") SELECT "id", 'Almoxarife' FROM "tenants"
  ON CONFLICT ("tenant_id", lower("nome")) DO NOTHING
  RETURNING "id", "tenant_id"
)
INSERT INTO "funcao_permissoes" ("tenant_id", "funcao_id", "modulo", "nivel")
  SELECT n."tenant_id", n."id", p."modulo"::"modulo", p."nivel"::"nivel_acesso"
  FROM novas n
  CROSS JOIN (VALUES ('clientes', 'consultar'), ('os', 'consultar'), ('pecas_os', 'editar'), ('estoque', 'consultar')) AS p("modulo", "nivel");--> statement-breakpoint
-- Atendente e Financeiro ganham os módulos novos (sem mexer em níveis já definidos pelo admin).
INSERT INTO "funcao_permissoes" ("tenant_id", "funcao_id", "modulo", "nivel")
  SELECT f."tenant_id", f."id", p."modulo"::"modulo", p."nivel"::"nivel_acesso"
  FROM "funcoes" f
  JOIN (VALUES ('Atendente', 'pecas_os', 'editar'), ('Atendente', 'recebimentos', 'editar'), ('Financeiro', 'recebimentos', 'editar'))
    AS p("funcao", "modulo", "nivel") ON p."funcao" = f."nome" AND NOT f."admin"
  ON CONFLICT DO NOTHING;
