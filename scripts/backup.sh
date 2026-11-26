#!/bin/sh
# Sicherung der Datenbank (läuft im backup-Container, postgres-Image).
#   loop             tägliche Sicherung um BACKUP_HOUR Uhr, beim Start sofort, falls die letzte älter als 24 h ist;
#                    dazu jede Minute: offene Aufträge „Jetzt sichern“ aus der Verwaltung (Tabelle backup_request)
#   once             eine Sicherung jetzt (Datei mit Zusatz -manuell)
#   requests         offene Aufträge einmal abarbeiten (sonst macht das der loop jede Minute)
#   health           0, wenn die letzte erfolgreiche Sicherung höchstens 26 Stunden alt ist
#   restore DATEI    stellt DATEI in die laufende Datenbank wieder her (api und worker vorher stoppen!)
#   restore-test DATEI  stellt DATEI in die Probe-Datenbank tidefront_restore_test her und zählt Zeilen
set -eu
DIR=${BACKUP_LOCAL_DIR:-/backups}
KEEP=${BACKUP_KEEP_DAYS:-14}
HOUR=${BACKUP_HOUR:-4}
POLL=${BACKUP_POLL_SECONDS:-60}
LAST_FILE=""

# backup_once [ZUSATZ]: pg_dump nach tidefront-JJJJMMTT-HHMMSS[ZUSATZ].dump, backup_run eintragen, aufräumen.
backup_once() {
  suffix=${1:-}
  ts=$(date +%Y%m%d-%H%M%S)
  name="tidefront-$ts$suffix.dump"
  tmp="$DIR/.$name.part"
  if ! pg_dump -Fc -f "$tmp"; then rm -f "$tmp"; return 1; fi
  mv "$tmp" "$DIR/$name"
  date +%s > "$DIR/.last-ok"
  LAST_FILE=$name
  # Für den Systemzustand im Spiel (Worker-Alarm) und die Liste in der Verwaltung: erfolgreiche Sicherung vermerken.
  size=$(wc -c < "$DIR/$name" | tr -d ' ')
  psql -qAtc "insert into backup_run (file, bytes) values ('$name', $size)" >/dev/null 2>&1 \
    || echo "backup_run nicht vermerkt"
  # Aufräumen: tägliche und manuelle Sicherungen gleich (Muster tidefront-*.dump), dazu liegengebliebene Teildateien.
  find "$DIR" -maxdepth 1 -name 'tidefront-*.dump' -mtime +"$KEEP" -delete
  find "$DIR" -maxdepth 1 -name '.tidefront-*.dump.part' -mtime +1 -delete
  echo "backup ok: $name"
}

# Offene Aufträge aus der Verwaltung abarbeiten, je Aufruf höchstens einen (der nächste folgt in der nächsten Minute).
# Fehlt die Tabelle (Migration noch nicht eingespielt) oder ist die Datenbank nicht erreichbar, passiert nichts.
run_requests() {
  id=$(psql -qAtc "update backup_request set status = 'running', started_at = now()
      where id = (select id from backup_request where status = 'pending' order by id limit 1 for update skip locked)
      returning id" 2>/dev/null | head -n 1) || return 0
  case "$id" in ''|*[!0-9]*) return 0 ;; esac
  echo "Auftrag $id: Sicherung läuft"
  if backup_once -manuell; then
    psql -qAtc "update backup_request set status = 'done', file = '$LAST_FILE', finished_at = now() where id = $id" >/dev/null \
      || echo "Auftrag $id nicht als erledigt vermerkt"
  else
    psql -qAtc "update backup_request set status = 'failed', error = 'pg_dump fehlgeschlagen', finished_at = now() where id = $id" >/dev/null \
      || echo "Auftrag $id nicht als fehlgeschlagen vermerkt"
  fi
}

last_age() {
  if [ -f "$DIR/.last-ok" ]; then echo $(( $(date +%s) - $(cat "$DIR/.last-ok") )); else echo 999999999; fi
}

# Nächster Tageszeitpunkt BACKUP_HOUR:00 nach jetzt (Sekunden seit 1970).
next_daily() {
  now=$(date +%s)
  target=$(date -d "$(date +%Y-%m-%d) $HOUR:00:00" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$target" -le "$now" ] && target=$((target + 86400))
  echo "$target"
}

case "${1:-loop}" in
  once) mkdir -p "$DIR"; backup_once -manuell ;;
  requests) mkdir -p "$DIR"; run_requests ;;
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
    # Nach einem Neustart mitten in einer Sicherung: hängende Aufträge abschließen, alte Aufträge entfernen.
    psql -qAtc "update backup_request set status = 'failed', error = 'Sicherungsdienst neu gestartet', finished_at = now()
        where status = 'running'; delete from backup_request where created_at < now() - interval '90 days'" >/dev/null 2>&1 || true
    if [ "$(last_age)" -gt $((24 * 3600)) ]; then backup_once || echo "backup failed"; fi
    target=$(next_daily)
    while true; do
      run_requests || echo "Auftrag fehlgeschlagen"
      now=$(date +%s)
      if [ "$now" -ge "$target" ]; then
        backup_once || echo "backup failed"
        target=$(next_daily)
        continue
      fi
      wait_s=$((target - now))
      [ "$wait_s" -gt "$POLL" ] && wait_s=$POLL
      sleep "$wait_s"
    done ;;
  *) echo "unbekannt: $1" >&2; exit 2 ;;
esac
