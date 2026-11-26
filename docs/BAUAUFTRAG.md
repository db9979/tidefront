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
  `balance.json` ist unverändert.
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
- Einladungscodes kommen aus `INVITE_CODES` und werden bei jedem `migrate` ergänzt.

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
