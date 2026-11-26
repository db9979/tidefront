#!/bin/sh
# Automatisches Update auf dem Server (per cron, z. B. alle 5 Minuten):
# Liegt auf origin/main eine neue Versionsnummer (package.json), wird gesichert, aktualisiert, gebaut und neu gestartet.
# Protokoll: ./auto-deploy.log im Projektordner. Läuft nie doppelt (Sperrdatei).
set -eu
cd "$(dirname "$0")/.."
LOG=auto-deploy.log
LOCK=/tmp/tidefront-auto-deploy.lock

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# Sperre gegen parallele Läufe (mkdir ist atomar); verwaiste Sperren nach 60 Minuten entfernen
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null || true; fi
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

git fetch -q origin main || { log "fetch fehlgeschlagen"; exit 1; }
local_v=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)
remote_v=$(git show origin/main:package.json | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -1)
[ -n "$remote_v" ] || { log "keine Version auf origin/main"; exit 1; }
[ "$local_v" = "$remote_v" ] && exit 0

log "Update $local_v -> $remote_v"
docker compose exec -T backup sh /scripts/backup.sh once </dev/null >> "$LOG" 2>&1 || log "Sicherung vor Update fehlgeschlagen (Update läuft trotzdem)"
git pull -q --ff-only origin main >> "$LOG" 2>&1 || { log "pull fehlgeschlagen – lokale Änderungen?"; exit 1; }
if docker compose up -d --build </dev/null >> "$LOG" 2>&1; then
  sleep 30
  log "läuft: $(docker compose ps --format '{{.Service}}={{.Health}}' </dev/null | tr '\n' ' ')"
  log "Version online: $(curl -s -m 5 http://127.0.0.1:${TIDEFRONT_PORT:-8080}/version)"
else
  log "Build oder Start fehlgeschlagen"
  exit 1
fi
