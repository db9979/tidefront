# TIDEFRONT

Strategie-Browserspiel auf der Weltkarte mit Marine, Bodentruppen und Luftwaffe. Hobbyprojekt für den Freundeskreis,
Handy zuerst, Betrieb per Docker Compose. Schauplatz: Nordatlantik mit Mittelmeer als Hexraster.

- `docs/REGELN.md` – verbindliche Spielregeln für Meilenstein 1
- `docs/BAUAUFTRAG.md` – Bauauftrag und Stand der Pakete
- `packages/balance/v1/balance.json` – alle Zahlen des Spiels
- `packages/game-core` – Spielregeln und Börsenkern als reine Funktionen, ohne Fremdpakete
- `packages/world` – Hexraster, Küsten, Nestplätze, Handelshäfen (rein, von Server und Oberfläche genutzt)
- `packages/db` – Datenbankschema (Drizzle) und Migrationen
- `packages/engine` – Server-Logik: Ereignis-Queue, Befehle, Börse, Prüflauf
- `apps/api` – Fastify, tRPC, WebSocket, Auslieferung der Oberfläche
- `apps/worker` – verarbeitet fällige Ereignisse, Prüflauf, Aufräumen
- `apps/web` – Oberfläche (React, Vite, Tailwind, TanStack Query, PixiJS) als PWA

## Starten (Raspberry Pi oder jeder Rechner mit Docker)

Voraussetzung: Docker mit Compose-Plugin, 64-Bit-System (arm64 oder amd64).

    git clone https://github.com/db9979/tidefront.git
    cd tidefront
    cp .env.example .env
    # in .env: POSTGRES_PASSWORD auf ein langes Zufallspasswort setzen, INVITE_CODES festlegen
    docker compose up -d

Der erste Start baut das Image (auf dem Pi einige Minuten). Danach läuft das Spiel auf `http://<host>:8080`.
Der vorhandene Proxy leitet HTTPS auf diesen Port weiter; WebSocket läuft unter `/ws` über denselben Port,
der Proxy muss also `Upgrade`-Header durchreichen. Postgres und Valkey sind nur im Container-Netz erreichbar.

Dienste: `api` (Port 8080), `worker`, `migrate` (läuft vor jedem Start einmal, legt Schema, Nester, Markt und
Einladungscodes an), `postgres`, `valkey`, `backup`. Zustand: `docker compose ps`, Protokolle: `docker compose logs -f api worker`.

Mitspieler einladen: Code in `INVITE_CODES` eintragen (z. B. `FREUNDE2026:10` für zehn Anmeldungen), dann
`docker compose up -d` – `migrate` ergänzt neue Codes, ohne bestehende zu verringern.

Aktualisieren:

    git pull
    docker compose up -d --build

## Sicherung und Wiederherstellung

Der Dienst `backup` sichert täglich um `BACKUP_HOUR` Uhr nach `./backups` (Vorgabe, änderbar über `BACKUP_DIR`)
und hält `BACKUP_KEEP_DAYS` Tage vor. Beim ersten Start wird sofort gesichert.

    docker compose exec backup sh /scripts/backup.sh once                       # jetzt sichern
    docker compose exec backup sh /scripts/backup.sh restore-test /backups/<datei>.dump   # Probe in eigener DB

Ernstfall (Spielstand aus einer Sicherung zurückholen):

    docker compose stop api worker
    docker compose exec backup sh /scripts/backup.sh restore /backups/<datei>.dump
    docker compose start api worker

## Entwickeln

Node 22.18 oder neuer.

    npm install
    npm test                 # Regelkern und Börse (ohne Datenbank)
    npm run typecheck
    npm run sim              # Balance-Simulation
    TEST_DATABASE_URL=postgres://... npm run test:server   # Server gegen ein leeres PostgreSQL (wird geleert!)

Lokal mit Postgres und Valkey: `npm run dev:api`, `npm run dev:worker`, `npm run dev:web` (Vite leitet `/trpc` und
`/ws` an den API-Port weiter). Schemaänderungen: `packages/db/src/schema.ts` ändern, dann `npm run db:generate`.
