#!/bin/sh
# Executado uma única vez, na criação do volume do Postgres (docker-entrypoint-initdb.d).
# A aplicação conecta como mobios_app: sem SUPERUSER e sem BYPASSRLS,
# então as políticas de Row-Level Security sempre se aplicam a ela.
set -e

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v app_pwd="${APP_DB_PASSWORD:-mobios_app}" -v dono="$POSTGRES_USER" <<'SQL'
CREATE ROLE mobios_app LOGIN PASSWORD :'app_pwd' NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO mobios_app;

-- Tabelas criadas pelas migrações (usuário dono) já nascem acessíveis ao app.
ALTER DEFAULT PRIVILEGES FOR ROLE :"dono" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mobios_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"dono" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO mobios_app;

-- Banco separado para os testes automatizados (pnpm test), para não sujar os dados de uso.
CREATE DATABASE mobios_test OWNER :"dono";
\connect mobios_test
GRANT USAGE ON SCHEMA public TO mobios_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"dono" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mobios_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"dono" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO mobios_app;
SQL
