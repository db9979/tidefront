#!/bin/sh
# Sicherung der Datenbank (läuft im backup-Container, postgres-Image).
#   loop             tägliche Sicherung um BACKUP_HOUR Uhr, beim Start sofort, falls die letzte älter als 24 h ist
#   once             eine Sicherung jetzt
#   health           0, wenn die letzte erfolgreiche Sicherung höchstens 26 Stunden alt ist
#   restore DATEI    stellt DATEI in die laufende Datenbank wieder her (api und worker vorher stoppen!)
#   restore-test DATEI  stellt DATEI in die Probe-Datenbank tidefront_restore_test her und zählt Zeilen
set -eu
DIR=/backups
KEEP=${BACKUP_KEEP_DAYS:-14}
HOUR=${BACKUP_HOUR:-4}

backup_once() {
  ts=$(date +%Y%m%d-%H%M%S)
  tmp="$DIR/.tidefront-$ts.dump.part"
  pg_dump -Fc -f "$tmp"
  mv "$tmp" "$DIR/tidefront-$ts.dump"
  date +%s > "$DIR/.last-ok"
  # Für den Systemzustand im Spiel (Worker-Alarm): erfolgreiche Sicherung vermerken.
  size=$(wc -c < "$DIR/tidefront-$ts.dump" | tr -d ' ')
  psql -qAtc "insert into backup_run (file, bytes) values ('tidefront-$ts.dump', $size)" >/dev/null 2>&1 \
    || echo "backup_run nicht vermerkt"
  find "$DIR" -maxdepth 1 -name 'tidefront-*.dump' -mtime +"$KEEP" -delete
  echo "backup ok: tidefront-$ts.dump"
}

last_age() {
  if [ -f "$DIR/.last-ok" ]; then echo $(( $(date +%s) - $(cat "$DIR/.last-ok") )); else echo 999999999; fi
}

case "${1:-loop}" in
  once) backup_once ;;
  health) [ "$(last_age)" -le $((26 * 3600)) ] ;;
  restore)
    f=${2:?Datei angeben}
    pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" "$f"
    echo "restore ok: $f" ;;
  restore-test)
    f=${2:?Datei angeben}
    psql -d postgres -qc 'drop database if exists tidefront_restore_test'
    psql -d postgres -qc 'create database tidefront_restore_test'
    pg_restore --no-owner -d tidefront_restore_test "$f"
    psql -d tidefront_restore_test -Atc "select 'player=' || count(*) from player union all select 'base=' || count(*) from base union all select 'game_event=' || count(*) from game_event union all select 'trade_ledger=' || count(*) from trade_ledger"
    psql -d postgres -qc 'drop database tidefront_restore_test'
    echo "restore-test ok: $f" ;;
  loop)
    mkdir -p "$DIR"
    if [ "$(last_age)" -gt $((24 * 3600)) ]; then backup_once || echo "backup failed"; fi
    while true; do
      now=$(date +%s)
      target=$(date -d "$(date +%Y-%m-%d) $HOUR:00:00" +%s 2>/dev/null || echo $((now + 86400)))
      [ "$target" -le "$now" ] && target=$((target + 86400))
      sleep $((target - now))
      backup_once || echo "backup failed"
    done ;;
  *) echo "unbekannt: $1" >&2; exit 2 ;;
esac
