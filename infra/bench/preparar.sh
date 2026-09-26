#!/bin/sh
# Recria o banco de benchmark (mobios_bench) no Postgres do docker compose, aplica as migrações e carrega os
# dados sintéticos (semear.sql). Não toca nos bancos mobios (uso) e mobios_test (testes).
#
# Uso, na raiz do repositório:  sh infra/bench/preparar.sh
# O admin da oficina grande e a senha dele ficam em infra/bench/.credenciais (fora do git), para o teste de carga.
set -eu

cd "$(dirname "$0")/../.."
# Só a senha do dono do banco, lida do .env (sem executar o arquivo).
POSTGRES_PASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env)"
DB_PORT="$(sed -n 's/^DB_PORT=//p' .env)"

psql_dono() { docker compose exec -T db psql -v ON_ERROR_STOP=1 -U mobios "$@"; }

psql_dono -d postgres -c 'drop database if exists mobios_bench' -c 'create database mobios_bench owner mobios'
psql_dono -d mobios_bench <<'SQL'
GRANT USAGE ON SCHEMA public TO mobios_app;
ALTER DEFAULT PRIVILEGES FOR ROLE mobios IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mobios_app;
ALTER DEFAULT PRIVILEGES FOR ROLE mobios IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO mobios_app;
SQL

senha="$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")"
printf 'ADMIN_EMAIL=admin@bench.local\nADMIN_SENHA=%s\n' "$senha" > infra/bench/.credenciais

# As variáveis do ambiente valem mais que as do .env (tsx --env-file não as sobrescreve).
(cd apps/api && DATABASE_MIGRATION_URL="postgres://mobios:${POSTGRES_PASSWORD}@localhost:${DB_PORT:-5432}/mobios_bench" \
  OFICINA_NOME='Oficina grande' ADMIN_NOME='Admin Bench' ADMIN_EMAIL='admin@bench.local' ADMIN_SENHA="$senha" \
  pnpm db:migrate)

psql_dono -d mobios_bench < infra/bench/semear.sql

# Logins do benchmark (mesma senha do admin): um vendedor da oficina grande e o admin de uma oficina pequena.
psql_dono -d mobios_bench <<'SQL'
UPDATE users SET email = 'vendedor@bench.local', senha_hash = a.senha_hash
FROM users a
WHERE a.email = 'admin@bench.local' AND users.tenant_id = a.tenant_id AND users.codigo = 101;
UPDATE users SET email = 'pequena@bench.local', senha_hash = a.senha_hash
FROM users a
WHERE a.email = 'admin@bench.local'
  AND users.id = (SELECT u.id FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE t.nome = 'Oficina pequena 1'
                  ORDER BY u.codigo LIMIT 1);
-- As oficinas sintéticas não têm funções: o admin da pequena ganha a de Administrador para poder entrar.
WITH f AS (
  INSERT INTO funcoes (tenant_id, nome, admin, codigo)
  SELECT tenant_id, 'Administrador', true, 1 FROM users WHERE email = 'pequena@bench.local'
  RETURNING id, tenant_id
)
INSERT INTO usuario_funcoes (tenant_id, usuario_id, funcao_id)
SELECT f.tenant_id, u.id, f.id FROM f JOIN users u ON u.tenant_id = f.tenant_id AND u.email = 'pequena@bench.local';
SQL
