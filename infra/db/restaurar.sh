#!/bin/sh
# Ensaio de restauração: restaura um backup (infra/db/backup.sh) num banco SEPARADO e compara a quantidade de linhas
# de cada tabela com a do banco de uso. Nunca escreve no banco mobios. Um backup só vale se restaurar.
#
# Uso, na raiz do repositório:  sh infra/db/restaurar.sh backups/mobios-AAAAMMDDTHHMMSSZ.dump
# O banco de ensaio (mobios_restauracao) é apagado no fim; para mantê-lo e inspecionar, defina MANTER=1.
#
# Restauração de verdade (desastre) é outro procedimento, manual e com a API parada: docs/performance/DATABASE.md.
set -eu
cd "$(dirname "$0")/../.."

arquivo="${1:?informe o arquivo de backup}"
destino=mobios_restauracao
psql_dono() { docker compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -U mobios "$@"; }

psql_dono -d postgres -c "drop database if exists $destino" -c "create database $destino owner mobios"
docker compose exec -T db pg_restore -U mobios -d "$destino" --no-owner --exit-on-error < "$arquivo"

contar() {
  psql_dono -d "$1" -At -c "select string_agg(format('%s=%s', relname, n), ' ' order by relname) from (
    select c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I', c.relname),
      false, true, '')))[1]::text::bigint as n
    from pg_class c where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace) t"
}
origem="$(contar mobios)"
restaurado="$(contar "$destino")"

if [ "${MANTER:-0}" != 1 ]; then psql_dono -d postgres -c "drop database $destino"; fi

if [ "$origem" = "$restaurado" ]; then
  echo "Restauração conferida: as mesmas tabelas e quantidades de linhas do banco de uso."
else
  echo "DIFERENÇA entre o backup restaurado e o banco de uso (normal se houve gravações depois do backup):"
  echo "  uso:         $origem"
  echo "  restaurado:  $restaurado"
  exit 1
fi
