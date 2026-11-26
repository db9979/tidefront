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
| 6 Prüfung | Unabhängiger Testlauf und Durchspielen im Handy-Format | offen |

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
- Oberfläche: Der Reiter „Meldungen“ der unteren Leiste hat oben drei Reiter Berichte | Nachrichten | Rangliste
  (mit Spielerübersicht und Ruhmeshalle). Ohne Stützpunkt landet der Spieler in der Hafenwahl, die den Saisonwechsel anzeigt.

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

## Abnahme

- [ ] Ein neuer Spieler registriert sich mit Einladungscode und wählt ein Küstenfeld.
- [ ] Gebäude ausbauen und Einheiten bauen laufen über Timer, auch wenn die App geschlossen ist.
- [ ] Ein Überfall auf ein Piratennest läuft komplett durch: Abfahrt, Kampf, Beute, Rückkehr, Kampfbericht.
- [ ] Das Kartell greift von sich aus an; Nachtschild und Tiefbunker wirken.
- [ ] An der Börse lässt sich kaufen und verkaufen; die Schutzregeln greifen nachweislich.
- [ ] Nach einem Neustart der Container ist der Spielstand unverändert.
- [ ] Eine Sicherung lässt sich testweise wiederherstellen.
