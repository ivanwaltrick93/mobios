-- A função de login devolvia o papel: recriada sem ele antes de remover a coluna e o tipo.
DROP FUNCTION auth_usuario_por_email(text);--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "papel";--> statement-breakpoint
DROP TYPE "public"."papel";--> statement-breakpoint
CREATE FUNCTION auth_usuario_por_email(p_email text)
RETURNS TABLE (id uuid, tenant_id uuid, senha_hash text, ativo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.senha_hash, u.ativo FROM users u WHERE u.email = lower(p_email)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_usuario_por_email(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_usuario_por_email(text) TO mobios_app;
