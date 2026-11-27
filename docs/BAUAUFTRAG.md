# Bauauftrag Meilenstein 1 mit Börse Stufe 1

Hobbyprojekt für den Freundeskreis. Gebaut wird mit KI-Agenten. Regeln: `docs/REGELN.md`, Zahlen: `packages/balance/v1/balance.json`.

## Stand

| Paket | Inhalt | Stand |
| --- | --- | --- |
| 0 Fundament | Gerüst, Regel-Spezifikation, Balance-Daten | fertig |
| 1 Spielregeln | `packages/game-core`: Ressourcen, Bau, Einheiten, Missionen, Kampf, Freibeuter-Kartell, Schutz | fertig, offene Punkte aus Stand 1 behoben (Stand 2) |
| 4 Börsenkern | `packages/game-core/src/market`: Sofortkauf und -verkauf, Schutzregeln, Journal | fertig |
| 2 Server | Datenbank, Ereignis-Queue, Befehle, Konten, WebSocket | fertig (Stand 2), Integrationstests gegen PostgreSQL |
| 3 Oberfläche | PWA mit Basis, Karte, Truppen, Mission planen, Kampfbericht, Börse | fertig (Stand 2) |
| 5 Betrieb | Dockerfile, Compose, Sicherung, Startanleitung | fertig (Stand 2), läuft auf `speech.local:8080` |
| 6 Prüfung | Unabhängiger Testlauf und Durchspielen im Handy-Format | Browser-Testreihe (Playwright, iPhone 13) steht: `npm run e2e`, siehe Paket 6 |

## Offene Punkte am Regelkern (Stand 2: erledigt)

Auslegungen stehen in `packages/game-core/ENTSCHEIDUNGEN.md` und `packages/game-core/src/market/ENTSCHEIDUNGEN.md`.

- [x] **Restschaden** wird je Einheitentyp über Runden und Phasen mitgeführt (REGELN.md, `combat.ts`, Tests).
- [x] Kampfbericht auf Stützpunkte anwenden: `applyDefenseResult`, `returnMission`, `attackerReturning` (`resolution.ts`).
- [x] Ablauf von Aufklärung und Transport am Ziel: `scoutBase`, `deliverCargo`; Regeln in REGELN.md.
- [x] Schwachziel-Regel, Wrack-Verfall und Bergung, Radar-Vorwarnzeit, Abbruch von Bau und Ausbildung: geregelt und umgesetzt.
- [x] `anlage` der Bodentruppen wirkt gegen die Bunkerlinie, `kuestenbatterie.attack.land` feuert im Bodenkampf mit (A1, A3).
- [x] Simulations-Runner: `npm run sim` (Kampf-Matrix und Bau-Bot). Ergebnisse und Balance-Hinweise in ENTSCHEIDUNGEN.md, Abschnitt C;
  `balance.json` ist seit v1.1 angepasst (Kartell-Stärke mit Bodentruppen und Schwankung, Nest-Fahrplan über 28 Tage); siehe ENTSCHEIDUNGEN.md, Abschnitt C.
- [x] Typprüfung: `npm run typecheck` (TypeScript mit `@types/node`) über alle Pakete und Tests.

## Festlegungen des Servers (Stand 2)

- Stützpunkt-Zustand liegt als `BaseState` (JSON) in `base.state`; jede Änderung sperrt die Zeile (`FOR UPDATE`).
  Sperrreihenfolge: Ereignis, Mission, Stützpunkte aufsteigend, Spieler, Marktzeile.
- Ereignisse: `build_complete`, `training_complete`, `mission_arrive`, `mission_return`, `raid_launch`, `raid_arrive`,
  `delivery_arrive`. Handler rechnen mit dem Fälligkeitszeitpunkt, nicht mit der Uhr des Workers. Fehlgeschlagene
  Ereignisse werden mit wachsendem Abstand bis zu fünfmal wiederholt, danach `failed`.
- Befehle und Lesezugriffe verarbeiten zuerst die fälligen Ereignisse des eigenen Stützpunkts (je eine eigene Transaktion),
  dann läuft der Befehl in einer Transaktion. Abgelehnte Befehle werden mit ihrem Code im Befehlsprotokoll gespeichert.
- Schutz des Ziels wird beim Planen eines Überfalls geprüft, nicht erneut bei Ankunft.
- Kartell: läuft alle `raidIntervalHours` je Stützpunkt aus und kommt 60 Minuten später an; Schutz wird bei Auslaufen und
  Ankunft geprüft. Der Verband wird beim Auslaufen nach der dann vorhandenen Verteidigung zusammengestellt.
- Aufklärung wird in Meilenstein 1 nicht abgefangen. Transport geht nur an fremde Spielerstützpunkte (ein Stützpunkt je Spieler).
- Börse: Startkredite 0; Bestände werden für die Börse abgerundet, der Stützpunkt behält Nachkommastellen. Lieferungen
  buchen bei Ankunft `delivery:<id>` an `player:<id>`. Der Worker prüft alle 10 Minuten das Journal gegen Kredite und offene
  Lieferungen (`audit_run`).
- Einladungscodes kommen aus `INVITE_CODES` und werden bei jedem `migrate` ergänzt; dazu persönliche Einladungen der
  Spieler (Abschnitt „Freunde einladen“).
- Bauschlange: Jeder eingereihte Auftrag plant beim Einreihen sein eigenes `build_complete`. Der Handler schließt alle
  fälligen Aufträge ab und tut nichts, wenn der erste noch nicht fällig ist. Abbruch (`base.cancelUpgrade` mit
  `buildingId` und `targetLevel`, ohne Angabe der laufende Auftrag) plant für nachgerückte Aufträge neue Ereignisse;
  die alten laufen ins Leere. Die Basis-Ansicht liefert `buildQueue`, `buildQueueSlots` und je Gebäude `planned`
  (Kosten und Bauzeit gelten für den nächsten Ausbau über der geplanten Stufe).
- Rückruf (`mission.recall`): sperrt nur die Mission (`FOR UPDATE`, Sperrreihenfolge bleibt Ereignis → Mission →
  Stützpunkte), setzt sie auf `returning` mit allen Einheiten und dem Transportgut als `cargoHome` und plant
  `mission_return`. Das geplante `mission_arrive` bleibt stehen und wirkt nicht mehr (Handler prüft `outbound`).
  Rückruf nach der geplanten Ankunft wird abgelehnt (`already_arrived`), auch wenn der Worker sie noch nicht verarbeitet hat.
  Kartell-Verbände und fremde Missionen: `no_mission`; Rückfahrt: `not_outbound`.

## Festlegungen: Andere Spieler und Saison (Punkte 5 und 6)

- Tabellen `message`, `season`, `season_result` (Abschnitt am Ende von `schema.ts`). Saisonlänge aus `SEASON_DAYS`
  (Vorgabe 28). `migrate` legt Saison 1 an, wenn keine läuft (Start = jetzt), und plant `season_end` im `game_event`.
- Rangliste (`packages/engine/src/scoring.ts`): Punkte = Kostenwert / 100, je Kategorie abgerundet; Gesamt = Summe.
  Kostenwert = Summe aller vier Ressourcen der Baukosten.
  - Ausbau: Kosten aller gebauten Gebäudestufen (`upgradeCost` von Stufe 0 bis L-1).
  - Militär: Einheiten daheim und Anlagen plus laufende Missionen (ausfahrend: Plan, heimkehrend: `returning`).
    Ausbildungsaufträge zählen erst nach Fertigstellung.
  - Kampf: aus `battle_report` seit Saisonbeginn, nur Berichte mit `battle`: als Angreifer `battle.defender.losses`,
    als Verteidiger `battle.attacker.losses` (Verluste laut Bericht, Rückkehrer werden nicht abgezogen).
    NPC-Einheiten haben feste Werte: Schnellboot 250, Piratenmiliz 40; Anlagen der Nester zählen mit ihren Baukosten.
  - Beute: Summe `battle.loot` der Berichte, in denen der Spieler Angreifer ist (Kartell-Beute zählt für niemanden).
  - Rang nach Gesamtpunkten, gleiche Punkte gleicher Rang (1, 1, 3). Die Rangliste wird im API-Prozess 30 s zwischengespeichert.
- Nachrichten: höchstens 2000 Zeichen, Betreff optional (80), 10 Nachrichten je 10 Minuten und Spieler (`ctx.rateLimit`).
  Systemnachrichten haben `from_player_id = null`. Änderungen melden `messages` über WebSocket.
- Saisonende (`season_end`, Handler in `season.ts`), eine Transaktion, idempotent über `season.status`:
  Endstand in `season_result` (gewertet werden Spieler mit Hafen oder Punkten), Auszeichnungen Gold/Silber/Bronze
  für Rang 1–3 (nur mit Punkten) und je Kategorie ein Bester; Systemnachricht an alle Spieler.
  Danach Reset: offene Journalsalden von `player:*` und `delivery:*` werden gegen `season:<n>` ausgebucht
  (Kredite und Lieferungen auf 0, der Prüflauf bleibt ok); gelöscht werden Lieferungen, Missionen, Wracks, Kampfberichte,
  Befehlsprotokoll, ausstehende Ereignisse außer `season_end` und alle Stützpunkte. Nester ohne `defeated_at`, Markt auf
  Richtwert, Händlerzustand der Spieler neu (Kredite 0). Spieler, Sitzungen, Nachrichten, `season_result`, Journal und
  Einladungscodes bleiben. Danach wird die nächste Saison angelegt und ihr Ende geplant; Meldung `season` an alle.
- Oberfläche: Der Reiter „Meldungen“ der unteren Leiste hat oben die Reiter Berichte | Nachrichten | Rangliste
  (mit Spielerübersicht und Ruhmeshalle) | Allianz. Ohne Stützpunkt landet der Spieler in der Hafenwahl, die den Saisonwechsel anzeigt.

## Festlegungen: Allianzen, Diplomatie, Handel zwischen Spielern

- Tabellen (Abschnitt am Ende von `schema.ts`): `alliance`, `alliance_member` (PK `player_id`: höchstens eine Allianz),
  `alliance_request` (Einladung/Anfrage, eindeutig je Allianz und Spieler), `alliance_chat`, `diplomacy`
  (Paar `party_a < party_b` als `a:<allianz>` bzw. `p:<spieler>`, eindeutig je Paar und Art), `player_offer`.
- Engine: `alliance-core.ts` (Parteien, Systemnachrichten, Abfragen `diplomacyBlock` und `atWar`), `alliance.ts`
  (Mitgliedschaft, Chat), `alliance-view.ts` (Lesemodelle, Allianzwertung aus der zwischengespeicherten Rangliste),
  `diplomacy.ts`, `player-trade.ts`. API: `routers/alliance.ts` (`alliance.*`), `routers/trade.ts` (`playerTrade.*`).
- Allianz-Befehle laufen ohne Idempotenz-Schlüssel in einer Transaktion und sperren zuerst die Allianzzeile
  (Größe und Rollen). Diplomatie sperrt das Paar per `pg_advisory_xact_lock`. Abgelaufene Pakte werden beim nächsten
  Zugriff gelöscht (kein Ereignis). Änderungen melden `alliance` über WebSocket (neue `ChangeKind`), Systemnachrichten `messages`.
- Eingriffe in bestehende Dateien, jeweils markiert: `launchMission` lehnt `ueberfall` auf Verbündete (`ally`) und
  Paktpartner (`pact`) ab, geprüft vor dem Schutz. `mission_arrive` setzt `AttackerInput.weakTarget` auf `false`, wenn zum
  Kampfzeitpunkt Krieg herrscht. `runCommand` und `Ctx` in `commands.ts` sind exportiert. `season_end` ruft vor dem
  Journalabschluss `expireOffers` auf.
- Handel: Befehle mit Idempotenz-Schlüssel (`runCommand`). Sperrreihenfolge: Angebot (`FOR UPDATE`), Stützpunkte
  aufsteigend, Spieler aufsteigend. Journal (`trade_ledger`): Einstellen `po-<id>:escrow` (`player:<id>` → `escrow:po-<id>`),
  Annahme `po-<id>:accept` (Treuhand → `delivery:po-<id>-k` bzw. `player:<käufer>`; Zahlung `player:<käufer>` →
  `delivery:po-<id>-v` bzw. `player:<anbieter>`; Gebühr → `fees`), Rückzug `po-<id>:cancel`, Saisonende `po-<id>:expire`
  (Treuhand → `season:<n>`). Ressourcen reisen über die bestehende Tabelle `delivery` und das Ereignis `delivery_arrive`.
- Prüflauf (`audit.ts`) zusätzlich: Treuhand je Angebot = angebotene Menge, solange offen, sonst 0 (`escrowMismatches`).
- Oberfläche: Reiter „Allianz“ unter Meldungen (Übersicht, Chat, Mitglieder, Diplomatie; Reiterleiste scrollbar),
  Allianzwertung und Kürzel in der Rangliste, Beziehung und Einladen in der Spielerübersicht, „Handel mit Spielern“
  als Abschnitt der Börse (`components/PlayerTrade.tsx`). Die Karte markiert Verbündete noch nicht.

## Festlegungen: Freunde einladen

- Tabellen `player_invite` (Einladung: Einladender, Kanal `email`/`link`, Adresse, Name, Nachricht, Sperr-Token,
  Gültigkeit, Versand, zurückgezogen, angenommen von) und `invite_block` (SHA-256 gesperrter Adressen), Abschnitt am
  Ende von `schema.ts`. Der Code selbst ist ein normaler Eintrag in `invite_code` mit `max_uses = 1`; Zurückziehen und
  Sperren setzen dort zusätzlich `disabled_at`. Persönliche Codes erscheinen nicht in der Code-Liste der Verwaltung.
- Logik in `packages/engine/src/invite.ts`, Mail in `invite-mail.ts` (über `renderMail`; `MailContent` hat dafür das
  optionale Feld `unsubscribeLabel` bekommen). Router `apps/api/src/routers/invite.ts`, Sperrlink in `mail-links.ts`.
- Registrierung (`auth.register`): nach dem Verbrauchen des Codes prüft `claimPersonalInvite` (Zeile gesperrt), ob eine
  persönliche Einladung noch gilt (sonst `invite_invalid`), nach dem Anlegen markiert `markInviteAccepted` sie –
  alles in derselben Transaktion. Danach benachrichtigt `notifyInviter` den Einladenden (Systemnachricht über
  `message`, Push und E-Mail über `engine.push` mit der Art `report`).
- Grenzen: `invite_settings` in `server_setting` (`enabled`, `maxOpen` 5, `maxWeek` 10); offen = nicht angenommen,
  nicht zurückgezogen, nicht abgelaufen; Woche = in 7 Tagen angelegt (auch zurückgezogene). Geprüft unter Sperre der
  Spielerzeile. Dieselbe Adresse (klein geschrieben) höchstens einmal je 7 Tage, über alle Einladenden. Mailfehler
  beim Anlegen löschen die Einladung wieder. Admins dürfen auch bei abgeschaltetem Einladen.
- Keine Belohnung: Ein Ressourcenpaket würde in die Wirtschaft der Saison eingreifen und den Stützpunkt-Code berühren;
  im kleinen Freundeskreis reicht die Meldung an den Einladenden.

## Festlegungen: Tagesbefehle

- Regeln in `REGELN.md`, Abschnitt Tagesbefehle. Tabellen `daily_challenge` (Unique-Index Spieler/Tag/Slot) und
  `daily_streak` am Ende von `schema.ts`; `season_result.befehle` hält die Punkte fest.
- Pool und Spieltag rein in `engine/src/challenge-pool.ts`; Datenbankseite in `challenges.ts`: Vergabe
  `ensureAssigned` (lazy, Doppelvergabe durch Unique-Index und deterministische Auswahl ausgeschlossen),
  Fortschritts-Schnittstelle `trackProgress(tx, playerId, kind, amount, { atMs, param?, level?, mode? })` in einem
  eigenen Savepoint (wirft nie). Aufrufe: `events.ts` (Vorher/Nachher um jeden Handler, `challengeSnapshot` und
  `challengesAfter`), `commands.ts` (`upgrade`: Bauschlange, `trade`: Kredite). Abholen und Würfeln in `daily.ts` über
  `runCommand`; Router `apps/api/src/routers/daily.ts`. Saisonende leert beide Tabellen.

## Festlegungen: Sicherungen und Statistik in der Verwaltung

- Tabellen `backup_request` und `backup_download_token` (Abschnitt am Ende von `schema.ts`). Logik in
  `packages/engine/src/backups.ts` und `adminstats.ts`, tRPC-Teilrouter `apps/api/src/routers/adminstats.ts`
  (`adminStats.*`, alle Prozeduren über `adminProc`), Download-Route in `apps/api/src/routers/backup-download.ts`.
- Liste: der `api`-Dienst liest das Sicherungsverzeichnis schreibgeschützt (`/backups:ro`, `BACKUP_PATH` überschreibt
  den Pfad). Gezeigt werden nur reguläre Dateien (keine Links, keine Ordner) nach `tidefront-[A-Za-z0-9_-]+.dump`;
  zusätzlich muss der aufgelöste Pfad direkt im Verzeichnis liegen. Quelle „manuell“ am Zusatz `-manuell`.
- Download `GET /api/admin/backups/:name?t=…`: Reihenfolge Name → Sitzung (401) → `is_admin` (403) → Token (403) → Datei
  (404). Token: 24 Zufallsbytes, gespeichert als SHA-256, 60 s gültig, an Admin und Datei gebunden, wird beim ersten
  Einlösen verbraucht (auch wenn Admin oder Datei nicht passen). Antwort gestreamt mit `Content-Disposition: attachment`
  und `Cache-Control: no-store`.
- „Jetzt sichern“: Auftrag in `backup_request` (`pending` → `running` → `done`/`failed`); höchstens einer offen, nach
  15 Minuten gilt ein offener als verwaist. `scripts/backup.sh loop` prüft jede Minute (`BACKUP_POLL_SECONDS`) mit
  `FOR UPDATE SKIP LOCKED`, sichert mit Zusatz `-manuell` und trägt `backup_run` ein; beim Start werden hängende
  `running`-Aufträge als fehlgeschlagen abgeschlossen und Aufträge älter als 90 Tage gelöscht. Fehlt die Tabelle, tut
  die Prüfung nichts. Aufräumen nach `BACKUP_KEEP_DAYS` gilt für tägliche und manuelle Dateien gleich.
  Wiederherstellen bleibt Konsolensache.
- Statistik (`adminStats(db, 7 | 28)`): eine SQL-Abfrage je Bereich (Gruppierung nach Kalendertag in `TZ`), nur die
  Stützpunkt-Zustände werden in JS mit `settle`/`productionRates` fortgeschrieben. Kämpfe zählen nur Berichte mit
  `battle` (`ueberfall`, `kartell`); Börsenumsatz = Konto `market` in Krediten (ohne Gebühr), Gebühren = Konto `fees`.
  Auffällig: Ressourcen > 3 × Median (ab drei Häfen, mindestens 1000), ≥ 5 Überfälle an einem Tag auf dasselbe Ziel,
  fehlgeschlagene Ereignisse. Ergebnis 60 s je Zeitraum im API-Prozess zwischengespeichert.
- Integrationstests: `packages/engine/test/adminstats.test.ts`. Die Migration für die beiden Tabellen ist nicht
  eingecheckt und wird bei der Zusammenführung mit `npm run db:generate` erzeugt.

## Festlegungen: Komfort (Simulator, Vorlagen, Zeitleiste, Morgenbericht)

- Tabellen `formation_template`, `morning_summary`, `summary_entry` (Abschnitt „Komfort“ am Ende von `schema.ts`).
  API: Teil-Router `comfort` (`apps/api/src/routers/comfort.ts`), Logik in `packages/engine/src/comfort.ts` und `summary.ts`.
- **Kampfsimulator** rechnet im Browser mit `resolveBattle` aus `game-core` über 50 feste Seeds (`simSeed(i)`), Balance aus
  `trpc.meta`. Er liegt im nachgeladenen Chunk `BattleSim` (nur Regelkern, keine Server-Teile, keine Balance-Datei).
  Einheiten, Anlagen und Nest-Stufen kommen generisch aus der Balance; neue Einheiten erscheinen ohne Codeänderung.
  Gegner: Nester mit `nestDefender`, Spielerhäfen nur mit dem Lagebild der letzten eigenen Aufklärung
  (`comfort.scout`), sonst „Erst aufklären“. Nicht eingerechnet: Wiederholungsabschlag, Schwachziel-Regel, Wracks.
  Verluste = Verluste minus Rückkehrer. Freier Simulator unter Truppen, auch „Kartell gegen eigenen Hafen“ (`composeRaid` ohne Seed).
- **Verbandsvorlagen** serverseitig je Spieler, höchstens 20, Name 1–32 Zeichen, eindeutig ohne Groß-/Kleinschreibung
  (gleicher Name überschreibt). Nur Spielereinheiten mit positiver Anzahl, Missionsart optional. Beim Einsetzen wird je Typ
  auf die Einheiten daheim gekürzt und die Kürzung angezeigt; Kommandopunkte und Truppenraum prüft weiterhin die Vorschau.
- **Wiederholen** sucht die eigene Mission über `mission.report_id` (Bericht) bzw. heimgekehrte Missionen (`status = done`,
  die letzten 5) und öffnet die Planung mit Ziel, Missionsart und Zusammensetzung (gekürzt wie bei Vorlagen).
- **Zeitleiste** („Als Nächstes“ auf der Basis) rechnet nur im Client aus `base.get` und `season.current`.
- **Morgenbericht**: Einstellung je Spieler (an/aus, Uhrzeit, Vorgabe 7:00, Zeitzone, Vorgabe `Europe/Berlin`, optional Push).
  Der Worker prüft jede Minute (`runMorningSummaries`). Fällig ab der Uhrzeit, höchstens 3 Stunden nachgeholt. Idempotent je
  Spieler und Tag: `last_sent_day` (Datum in der Zeitzone des Spielers) wird vor dem Versand per bedingtem UPDATE beansprucht;
  schlägt der Versand fehl (E-Mail-Fehler und kein Push zugestellt), wird der Tag wieder freigegeben. Zeitraum: seit dem letzten
  Bericht, höchstens 36 Stunden, ohne Vorgänger 24 Stunden. Inhalt: Kämpfe mit Ergebnis, Beute und eigenen Verlusten (aus
  `battle_report`), fertige Aufträge und Lieferungen (aus `summary_entry`, mitgeschrieben in `deliverNotice` nur bei aktiviertem
  Bericht, 3 Tage aufbewahrt), Aufklärungsberichte, neue und ungelesene Nachrichten, Rang der laufenden Saison. Weitere
  Abschnitte (z. B. Tagesbefehle) melden andere Module über `registerSummarySection` an. Versand nur an bestätigte Adressen;
  Push als Art `report`. Der Abmeldelink der E-Mails schaltet auch den Morgenbericht ab.

## Festlegungen für den Betrieb

- Ziel ist ein Raspberry Pi mit 64-Bit-System unter `speech@speech.local`; alle Images müssen für arm64 verfügbar sein.
- Kein eigener Proxy-Container. TLS übernimmt der vorhandene Proxy. Das Spiel veröffentlicht genau einen HTTP-Port,
  Vorgabe 8080, in `.env` änderbar. WebSocket läuft über denselben Port.
- Datenbank und Valkey sind nur im Container-Netz erreichbar. Tägliche Sicherung in einen Ordner auf dem Pi.
- Anmeldung nur mit Einladungscode. Keine Monetarisierung.

## Stack

TypeScript durchgängig. Backend: Node, Fastify, tRPC, Zod. Datenbank: PostgreSQL mit Drizzle. Valkey für Pub/Sub und Limits.
Oberfläche: React, Vite, Tailwind, TanStack Query, PixiJS für die Karte, als PWA. `game-core` bleibt ohne Fremdpakete.

## Paket 2: Server (`apps/api`, `apps/worker`, `packages/db`)

- Der Server entscheidet alles; der Client sendet nur Absichten.
- Ereignis-Tabelle `game_event(due_at, type, payload, status)` in PostgreSQL, im selben Commit wie die auslösende Aktion.
- Worker holt fällige Ereignisse mit `FOR UPDATE SKIP LOCKED`, eine Transaktion je Ereignis, Stützpunkte in aufsteigender ID sperren.
- Ressourcen werden bei Bedarf fortgeschrieben (`settle` aus `game-core`), nie per Tick.
- Jeder Befehl trägt einen Idempotenz-Schlüssel (Unique-Index) und verarbeitet zuerst fällige Ereignisse des eigenen Stützpunkts.
- Kampf mit gespeichertem Seed und Balance-Version; Bericht wird gespeichert.
- Börse: Marktzeile je Ressource pro Handel sperren; `trade_ledger` nur fortschreiben; Prüflauf Journal gegen Bestände.
- Abnahme: Zwei gleichzeitige Befehle erzeugen nie negative Bestände; nach Neustart der Container ist der Spielstand unverändert.

## Paket 3: Oberfläche (`apps/web`)

- Screens nach den Mockups: Basis, Karte, Truppen, Mission planen, Kampfbericht, Börse. Untere Navigation mit fünf Zielen.
- Tippflächen mindestens 44 px, alles bei 390 px Breite bedienbar, keine Funktion hängt an Hover.
- Countdowns laufen im Client aus dem Fertigstellungszeitpunkt und dem Server-Zeitversatz.
- Schauplatz: Nordatlantik mit Mittelmeer als Hexraster.

## Paket 5: Betrieb

- Ein Image für `api`, `worker` und `migrate`; die Oberfläche wird vom `api`-Container ausgeliefert.
- Compose-Dienste: `api`, `worker`, `migrate`, `postgres`, `valkey`, `backup`. Healthchecks überall.
- `docker compose up -d` muss auf arm64 ohne Handarbeit starten. Startanleitung im README.

## Paket 6: Prüfung (`apps/web/e2e`)

- Playwright-Testreihe im Handy-Format (Gerät „iPhone 13“, 390 × 664 CSS-Pixel, Touch, Chromium). Start: `npm run e2e`
  (einmalig `npx playwright install chromium`). Voraussetzung: Docker. Typprüfung der Tests: `npm run typecheck:e2e`.
- `apps/web/e2e/stack.ts` baut für jeden Lauf eine frische Test-Datenbank (Postgres und Valkey als eigene Container
  `tf-e2e-pg`/`tf-e2e-valkey`, Daten nur im Arbeitsspeicher, Ports 55452/56392), migriert mit Einladungscode `E2ETEST`
  und startet api (18380), worker (18381, Abfrage alle 250 ms) und vite (5380). Nach dem Lauf werden die Container
  entfernt. `npm run e2e:stack` startet denselben Stack von Hand; mit `E2E_REUSE=1 npm run e2e` nutzen die Tests ihn.
- Spieler und Häfen legt die Testreihe direkt über die Engine an (ohne Ratenbegrenzung); Wartezeiten (Bau, Ausbildung,
  Missionen, Konvois) werden in der Test-DB vorgezogen (`apps/web/e2e/game.ts`), der Worker arbeitet die Ereignisse
  regulär ab. Ausbaustände, Einheiten und Bestände kommen per Seed in den Hafenzustand.
- Abläufe: Registrieren und Anmelden mit Einladungscode, Hafenwahl, Bauschlange (ausbauen, einreihen, abbrechen,
  fertigstellen), Ausbildung, Überfall auf ein Nest mit Kampfbericht, Börse (verkaufen, kaufen, Lieferung), Meldungen,
  Handbuch mit Einstellungen und Verwaltung, Hafen umbenennen, Kolonieschiff und Außenposten mit Hafenwahl,
  Rohstofffeld besetzen, Rundgang durch alle Bildschirme und Blätter.
- Je Bildschirm geprüft: keine Konsolenfehler und keine unbehandelten Ausnahmen, kein waagerechtes Überlaufen bei
  390 px (Dokument, Hauptbereich, offene Blätter; Elemente, die rechts herausragen, außer in Schiebeleisten).
- Gefundene Fehler stehen als `test.fixme` in `apps/web/e2e/10-befunde.spec.ts` (Stand: der Heimathafen lässt sich auf
  das Feld eines Handelshafens legen, Börsenlieferungen kommen dann sofort an).
- Ergebnisse und Spuren fehlgeschlagener Tests: `node_modules/.cache/tidefront-e2e/`
  (`npx playwright show-report node_modules/.cache/tidefront-e2e/report`).

## Abnahme

- [x] Ein neuer Spieler registriert sich mit Einladungscode und wählt ein Küstenfeld. (E2E `01-anmeldung`)
- [x] Gebäude ausbauen und Einheiten bauen laufen über Timer, auch wenn die App geschlossen ist. (E2E `02-bauen`, `03-ausbilden`: der Worker schließt ab)
- [x] Ein Überfall auf ein Piratennest läuft komplett durch: Abfahrt, Kampf, Beute, Rückkehr, Kampfbericht. (E2E `04-mission`)
- [ ] Das Kartell greift von sich aus an; Nachtschild und Tiefbunker wirken.
- [ ] An der Börse lässt sich kaufen und verkaufen; die Schutzregeln greifen nachweislich. (Kaufen und Verkaufen: E2E `05-boerse`; Schutzregeln dort nicht einzeln geprüft)
- [ ] Nach einem Neustart der Container ist der Spielstand unverändert.
- [ ] Eine Sicherung lässt sich testweise wiederherstellen.
