#!/bin/sh
set -eu

CONFIG_FILE="${BOY_BACKUP_CONFIG:-$HOME/.config/boy-operation/backup.env}"
if [ -f "$CONFIG_FILE" ]; then
  # The config file is outside the repository and must be readable only by its owner.
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
fi

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL in $CONFIG_FILE}"
: "${BACKUP_PASSPHRASE_FILE:?Set BACKUP_PASSPHRASE_FILE in $CONFIG_FILE}"

BACKUP_DIR="${BOY_BACKUP_DIR:-$HOME/BOY-Backups}"
RETENTION_DAYS="${BOY_BACKUP_RETENTION_DAYS:-31}"
STAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
PLAIN="$BACKUP_DIR/boy-central-$STAMP.dump"
ENCRYPTED="$PLAIN.enc"

command -v pg_dump >/dev/null 2>&1 || { echo "pg_dump is required" >&2; exit 1; }
command -v pg_restore >/dev/null 2>&1 || { echo "pg_restore is required" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 1; }
[ -r "$BACKUP_PASSPHRASE_FILE" ] || { echo "Backup passphrase file is not readable" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
trap 'rm -f "$PLAIN"' EXIT HUP INT TERM

pg_dump --dbname="$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges --file="$PLAIN"
pg_restore --list "$PLAIN" >/dev/null
openssl enc -aes-256-cbc -pbkdf2 -salt -in "$PLAIN" -out "$ENCRYPTED" -pass "file:$BACKUP_PASSPHRASE_FILE"
chmod 600 "$ENCRYPTED"
rm -f "$PLAIN"
trap - EXIT HUP INT TERM

find "$BACKUP_DIR" -type f -name 'boy-central-*.dump.enc' -mtime "+$RETENTION_DAYS" -delete
echo "$ENCRYPTED"
