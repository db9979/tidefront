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

## Betrieb

### Proxy (nginx o. ä.)

Der Proxy terminiert TLS und leitet alles an den Port des `api`-Dienstes weiter. Nötig sind:

- WebSocket unter `/ws`: `Upgrade`- und `Connection`-Header durchreichen, langes Lese-Timeout (z. B. 1 h).
- `X-Forwarded-Proto` (und `X-Forwarded-For`) setzen. Daran erkennt der Server HTTPS und setzt das Sitzungs-Cookie
  mit `Secure` (`COOKIE_SECURE=auto`; `true`/`false` erzwingt bzw. verbietet es).

      location / {
          proxy_pass http://127.0.0.1:8080;
          proxy_http_version 1.1;
          proxy_set_header Host $host;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection $connection_upgrade;   # map $http_upgrade $connection_upgrade { default upgrade; '' close; }
          proxy_read_timeout 3600s;
      }

### Verwaltung (ohne Konsole)

Admins stehen in `ADMIN_NAMES` (Spielernamen, Komma-getrennt; `migrate` gleicht bei jedem Start ab). Ist die Liste leer,
wird der zuerst registrierte Spieler Admin. Admins erreichen über „?“ → „Einstellungen“ → „Verwaltung“:
Einladungscodes anlegen und deaktivieren, Spielerliste mit letzter Aktivität, Passwort-Rücksetzcodes (einmalig,
24 Stunden), E-Mail-Versand und Systemzustand. Spieler ändern ihr Passwort in den Einstellungen; „Passwort vergessen?“
auf dem Anmeldebildschirm nimmt den Rücksetzcode oder schickt mit bestätigter Adresse einen Link per E-Mail.

### Einladungen (Freunde einladen)

Neben den allgemeinen Codes aus `INVITE_CODES` und der Verwaltung kann jeder Spieler unter Einstellungen →
„Freunde einladen“ (auch aus Meldungen → Rangliste) Freunde einladen:

- **Per E-Mail** (braucht eingerichteten SMTP-Versand): Name und persönliche Nachricht (bis 500 Zeichen) optional.
  Die Mail im Stil Seekarte enthält Einladenden, kurze Spielbeschreibung, Knopf „Einladung annehmen“
  (`PUBLIC_URL/?invite=CODE`), den Code als Text und die Gültigkeit. Ihr Fußlink „Keine Einladungen mehr an diese
  Adresse“ (`/api/mail/invite-block`, Bestätigung per Knopf, auch Ein-Klick aus dem Mailprogramm) sperrt die Adresse
  dauerhaft; gespeichert wird nur ein SHA-256 der Adresse.
- **Als Link** („Link teilen“, immer möglich, auch ohne SMTP): erzeugt ebenso einen persönlichen Code; geteilt über
  das Teilen-Menü des Geräts oder kopiert.

Jeder persönliche Code gilt einmal und 14 Tage. Der Anmeldebildschirm öffnet mit `?invite=` direkt „Registrieren“ mit
eingetragenem Code und „Eingeladen von …“ (öffentliche, ratenbegrenzte Abfrage, liefert nur den Namen). Nach der
Registrierung bekommt der Einladende eine Systemnachricht sowie Push/E-Mail (Art „Kampfberichte“). Unter
„Meine Einladungen“: Status (versandt, Link offen, angenommen von …, abgelaufen, zurückgezogen), Zurückziehen,
erneut senden frühestens 24 Stunden nach dem letzten Versand (höchstens dreimal, verlängert die Gültigkeit).

Grenzen gegen Missbrauch: je Spieler höchstens 5 offene und 10 neue Einladungen in 7 Tagen (Verwaltung →
„Freunde einladen“, gespeichert in `server_setting` unter `invite_settings`); dieselbe Adresse höchstens einmal je
7 Tage; Adressen mit bestätigter `player_email` und gesperrte Adressen werden abgelehnt; zusätzlich 10 Versuche je
Stunde und Spieler. Dort lässt sich das Einladen für Nicht-Admins ganz abschalten, und die Verwaltung sieht alle
persönlichen Einladungen mit Einladendem. Eine Belohnung für Einladungen gibt es bewusst nicht.

### Benachrichtigungen

- **Push** (Web Push mit VAPID): `migrate` erzeugt die Schlüssel beim ersten Start und legt sie in `server_setting` ab;
  alternativ `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` setzen. Spieler aktivieren Push in den Einstellungen.
  iPhone/iPad: nur als installierte Home-Bildschirm-App ab iOS 16.4.
- **E-Mail** (SMTP, nur Versand): in der Verwaltung einrichten (Vorlagen für iCloud und Google, sonst eigener Server).
  Das SMTP-Passwort wird mit `APP_SECRET` verschlüsselt gespeichert; ohne `APP_SECRET` bleibt E-Mail abgeschaltet.
  Erzeugen: `openssl rand -hex 32`, in `.env` eintragen, `docker compose up -d`. Wird `APP_SECRET` geändert, das
  SMTP-Passwort in der Verwaltung neu eingeben. Angriffe und Kampfberichte gehen sofort raus, fertige Aufträge
  gebündelt (höchstens eine Mail je 30 Minuten und Spieler). Jede Mail enthält einen Abmeldelink.
- Arten: Angriff erkannt (zur Radar-Vorwarnzeit), Kampfbericht, Ausbau fertig, Ausbildung fertig, Verband zurück,
  Lieferung angekommen; für Admins zusätzlich Betriebsalarm.

### Überwachung

Der Worker prüft jede Minute: Rückstau (Ereignisse über 2 Minuten überfällig), fehlgeschlagene Ereignisse, letzter
Prüflauf der Börse, Alter der letzten Sicherung (der `backup`-Dienst trägt jede Sicherung in `backup_run` ein).
Neue Probleme gehen per Push/E-Mail an alle Admins (je Vorfall höchstens einmal pro Stunde). Der Gesundheitsendpunkt
des Workers meldet 503, wenn der Rückstau älter als 10 Minuten ist. Anzeige unter Verwaltung → Systemzustand.

### Umgebungsvariablen (`.env`)

| Variable | Bedeutung |
| --- | --- |
| `POSTGRES_PASSWORD` | Datenbankpasswort (Pflicht) |
| `TIDEFRONT_PORT` | veröffentlichter HTTP-Port, Vorgabe 8080 |
| `INVITE_CODES` | Einladungscodes `CODE:Anzahl`, Komma-getrennt; werden bei jedem Start ergänzt |
| `ADMIN_NAMES` | Admins (Spielernamen); leer: erster Spieler |
| `PUBLIC_URL` | öffentliche Adresse für Links in E-Mails und VAPID, Vorgabe `https://tidefront.metaluna9.i234.me` |
| `APP_SECRET` | Schlüssel für gespeicherte Geheimnisse (SMTP-Passwort); ohne ihn kein E-Mail-Versand |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | optional eigene Push-Schlüssel; Subject Vorgabe `PUBLIC_URL` |
| `COOKIE_SECURE` | `auto` (Vorgabe), `true`, `false` |
| `BACKUP_HOUR`, `BACKUP_KEEP_DAYS`, `BACKUP_DIR` | Sicherung |
| `TZ`, `LOG_LEVEL` | Zeitzone (auch für Uhrzeiten in Benachrichtigungen), Protokollstufe |

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
