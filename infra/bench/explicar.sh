#!/bin/sh
# EXPLAIN (ANALYZE, BUFFERS) de uma consulta no banco mobios_bench, como a aplicação a executa: usuário mobios_app
# (sujeito ao RLS) e app.tenant_id da oficina grande (ou de outra, pelo e-mail do admin no 1º argumento).
# A consulta vem pela entrada padrão e roda numa transação desfeita no fim (ROLLBACK).
#
#   sh infra/bench/explicar.sh [email] < consulta.sql
set -eu
cd "$(dirname "$0")/../.."
email="${1:-admin@bench.local}"
consulta="$(cat)"

docker compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -U mobios -d mobios_bench -v email="$email" <<SQL
select tenant_id as tenant from users where email = :'email' \gset
begin;
set local role mobios_app;
select set_config('app.tenant_id', :'tenant', true) \g /dev/null
explain (analyze, buffers, costs off, timing on)
$consulta;
rollback;
SQL
