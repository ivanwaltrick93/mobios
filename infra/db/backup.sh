#!/bin/sh
# Backup do banco de uso (mobios) no formato custom do pg_dump (compactado, restaurável tabela a tabela), tirado
# do container `db` do docker compose. Guarda em backups/ (fora do git) e apaga os mais antigos que a retenção.
#
# Uso, na raiz do repositório:  sh infra/db/backup.sh
# Agendado (cron do servidor, todo dia às 3h):
#   0 3 * * *  cd /caminho/do/MobiOS && sh infra/db/backup.sh >> backups/backup.log 2>&1
#
# O arquivo tem dados pessoais (CPF, telefone): copie para um armazenamento externo criptografado
# (docs/performance/DATABASE.md §Backup) e teste a restauração com infra/db/restaurar.sh.
set -eu
cd "$(dirname "$0")/../.."

RETENCAO_DIAS="${BACKUP_RETENCAO_DIAS:-14}"
mkdir -p backups
arquivo="backups/mobios-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker compose exec -T db pg_dump -U mobios -d mobios --format=custom --no-owner > "$arquivo.parcial"
# Só vira backup depois de o pg_dump terminar sem erro: um arquivo pela metade nunca fica com o nome final.
mv "$arquivo.parcial" "$arquivo"
echo "Backup gravado: $arquivo ($(du -h "$arquivo" | cut -f1))"

find backups -name 'mobios-*.dump' -mtime +"$RETENCAO_DIAS" -print -delete
