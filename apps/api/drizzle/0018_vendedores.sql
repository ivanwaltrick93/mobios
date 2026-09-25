-- Códigos sequenciais por oficina (usuários, funções, vendedores), parâmetros de função e cadastro de vendedores.
CREATE TYPE "public"."evento_vendedor" AS ENUM('criado', 'alterado', 'inativado', 'reativado');
--> statement-breakpoint
CREATE TYPE "public"."origem_evento_vendedor" AS ENUM('cadastro', 'importacao', 'automatica');
--> statement-breakpoint
CREATE TABLE "contadores" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"chave" text NOT NULL,
	"valor" integer NOT NULL,
	CONSTRAINT "contadores_tenant_id_chave_pk" PRIMARY KEY("tenant_id","chave"),
	CONSTRAINT "contadores_valor_positivo" CHECK ("contadores"."valor" > 0)
);
--> statement-breakpoint
ALTER TABLE "contadores" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Próximo código da sequência `p_chave` na oficina corrente (app.tenant_id). O UPSERT trava a linha do contador
-- até o fim da transação: códigos nunca se repetem, e um INSERT desfeito devolve o número (sem buraco).
CREATE FUNCTION proximo_codigo(p_chave text) RETURNS integer
LANGUAGE sql VOLATILE AS $$
  INSERT INTO contadores (chave, valor) VALUES (p_chave, 1)
  ON CONFLICT (tenant_id, chave) DO UPDATE SET valor = contadores.valor + 1
  RETURNING valor
$$;
--> statement-breakpoint
-- O código é a identificação estável do registro: nunca muda depois de gerado.
CREATE FUNCTION impedir_troca_de_codigo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
    RAISE EXCEPTION 'O código não pode ser alterado'
      USING ERRCODE = '23514', CONSTRAINT = TG_TABLE_NAME || '_codigo_imutavel';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "codigo" integer;
--> statement-breakpoint
ALTER TABLE "funcoes" ADD COLUMN "codigo" integer;
--> statement-breakpoint
ALTER TABLE "funcoes" ADD COLUMN "descricao" text;
--> statement-breakpoint
-- Registros existentes: código pela ordem de cadastro (o Administrador é a função 1) e contador no último.
UPDATE users u SET codigo = n.codigo
FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY criado_em, id) AS codigo FROM users) n
WHERE u.id = n.id;
--> statement-breakpoint
UPDATE funcoes f SET codigo = n.codigo
FROM (
  SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY admin DESC, criado_em, nome) AS codigo FROM funcoes
) n
WHERE f.id = n.id;
--> statement-breakpoint
INSERT INTO contadores (tenant_id, chave, valor)
SELECT tenant_id, 'usuarios', max(codigo) FROM users GROUP BY tenant_id
UNION ALL
SELECT tenant_id, 'funcoes', max(codigo) FROM funcoes GROUP BY tenant_id;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "codigo" SET DEFAULT proximo_codigo('usuarios');
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "codigo" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "funcoes" ALTER COLUMN "codigo" SET DEFAULT proximo_codigo('funcoes');
--> statement-breakpoint
ALTER TABLE "funcoes" ALTER COLUMN "codigo" SET NOT NULL;
--> statement-breakpoint
CREATE TABLE "funcao_parametros" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"funcao_id" uuid NOT NULL,
	"parametro_id" uuid NOT NULL,
	CONSTRAINT "funcao_parametros_funcao_id_parametro_id_pk" PRIMARY KEY("funcao_id","parametro_id")
);
--> statement-breakpoint
ALTER TABLE "funcao_parametros" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "parametros_funcao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nome" text NOT NULL,
	"descricao" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendedores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"codigo" integer DEFAULT proximo_codigo('vendedores') NOT NULL,
	"usuario_id" uuid NOT NULL,
	"matricula" text,
	"whatsapp" text NOT NULL,
	"funcionario_desde" date,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_por" uuid,
	"atualizado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendedores_tenantId_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "vendedores" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "vendedores_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"vendedor_id" uuid NOT NULL,
	"evento" "evento_vendedor" NOT NULL,
	"origem" "origem_evento_vendedor" NOT NULL,
	"motivo" text,
	"alteracoes" jsonb NOT NULL,
	"usuario_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendedores_eventos" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contadores" ADD CONSTRAINT "contadores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "funcao_parametros" ADD CONSTRAINT "funcao_parametros_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "funcao_parametros" ADD CONSTRAINT "funcao_parametros_parametro_id_parametros_funcao_id_fk" FOREIGN KEY ("parametro_id") REFERENCES "public"."parametros_funcao"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "funcao_parametros" ADD CONSTRAINT "funcao_parametros_tenant_id_funcao_id_funcoes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","funcao_id") REFERENCES "public"."funcoes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendedores" ADD CONSTRAINT "vendedores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendedores" ADD CONSTRAINT "vendedores_tenant_id_usuario_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","usuario_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendedores" ADD CONSTRAINT "vendedores_tenant_id_criado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","criado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendedores" ADD CONSTRAINT "vendedores_tenant_id_atualizado_por_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","atualizado_por") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendedores_eventos" ADD CONSTRAINT "vendedores_eventos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendedores_eventos" ADD CONSTRAINT "vendedores_eventos_tenant_id_vendedor_id_vendedores_tenant_id_id_fk" FOREIGN KEY ("tenant_id","vendedor_id") REFERENCES "public"."vendedores"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendedores_eventos" ADD CONSTRAINT "vendedores_eventos_tenant_id_usuario_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","usuario_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "funcao_parametros_parametro_id_index" ON "funcao_parametros" USING btree ("parametro_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "parametros_funcao_codigo_unico" ON "parametros_funcao" USING btree ("codigo");
--> statement-breakpoint
CREATE UNIQUE INDEX "vendedores_codigo_unico" ON "vendedores" USING btree ("tenant_id","codigo");
--> statement-breakpoint
CREATE UNIQUE INDEX "vendedores_usuario_unico" ON "vendedores" USING btree ("tenant_id","usuario_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "vendedores_matricula_unico" ON "vendedores" USING btree ("tenant_id",upper("matricula")) WHERE "vendedores"."matricula" is not null;
--> statement-breakpoint
CREATE INDEX "vendedores_eventos_vendedor_id_criado_em_index" ON "vendedores_eventos" USING btree ("vendedor_id","criado_em" DESC NULLS LAST);
--> statement-breakpoint
CREATE UNIQUE INDEX "funcoes_codigo_unico" ON "funcoes" USING btree ("tenant_id","codigo");
--> statement-breakpoint
CREATE UNIQUE INDEX "users_codigo_unico" ON "users" USING btree ("tenant_id","codigo");
--> statement-breakpoint
CREATE POLICY "contadores_isolamento_tenant" ON "contadores" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "funcao_parametros_isolamento_tenant" ON "funcao_parametros" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "vendedores_isolamento_tenant" ON "vendedores" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "vendedores_eventos_isolamento_tenant" ON "vendedores_eventos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE TRIGGER users_codigo_imutavel BEFORE UPDATE OF codigo ON users
  FOR EACH ROW EXECUTE FUNCTION impedir_troca_de_codigo();
--> statement-breakpoint
CREATE TRIGGER funcoes_codigo_imutavel BEFORE UPDATE OF codigo ON funcoes
  FOR EACH ROW EXECUTE FUNCTION impedir_troca_de_codigo();
--> statement-breakpoint
CREATE TRIGGER vendedores_codigo_imutavel BEFORE UPDATE OF codigo ON vendedores
  FOR EACH ROW EXECUTE FUNCTION impedir_troca_de_codigo();
--> statement-breakpoint
-- Catálogo global: só as migrações gravam nele.
REVOKE INSERT, UPDATE, DELETE ON parametros_funcao FROM mobios_app;
--> statement-breakpoint
INSERT INTO parametros_funcao (codigo, nome, descricao) VALUES (
  'VENDEDOR',
  'Vendedor',
  'Usuários com uma função ativa com este parâmetro podem ser cadastrados como vendedores.'
);
--> statement-breakpoint
-- Valores atuais: o Atendente (função padrão, ainda não renomeada) é a função de vendedor.
INSERT INTO funcao_parametros (tenant_id, funcao_id, parametro_id)
SELECT f.tenant_id, f.id, p.id
FROM funcoes f CROSS JOIN parametros_funcao p
WHERE p.codigo = 'VENDEDOR' AND lower(f.nome) = 'atendente' AND NOT f.admin;
