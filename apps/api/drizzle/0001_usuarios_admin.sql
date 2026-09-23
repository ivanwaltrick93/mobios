-- Papel "dono" passa a se chamar "admin" (renomeia no lugar: linhas existentes são preservadas).
ALTER TYPE "public"."papel" RENAME VALUE 'dono' TO 'admin';--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "users_tenant_id_index";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid;--> statement-breakpoint
CREATE INDEX "users_tenant_id_nome_index" ON "users" USING btree ("tenant_id","nome");--> statement-breakpoint
CREATE POLICY "users_isolamento_tenant" ON "users" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Única porta de leitura de users sem tenant definido: o login, que busca pelo e-mail.
-- SECURITY DEFINER roda como o dono da tabela (fora do RLS) e devolve só o necessário para autenticar.
CREATE FUNCTION auth_usuario_por_email(p_email text)
RETURNS TABLE (id uuid, tenant_id uuid, senha_hash text, papel "public"."papel", ativo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.senha_hash, u.papel, u.ativo FROM users u WHERE u.email = lower(p_email)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_usuario_por_email(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_usuario_por_email(text) TO mobios_app;
