# Bauauftrag Meilenstein 1 mit Börse Stufe 1

Hobbyprojekt für den Freundeskreis. Gebaut wird mit KI-Agenten. Regeln: `docs/REGELN.md`, Zahlen: `packages/balance/v1/balance.json`.

## Stand

| Paket | Inhalt | Stand |
| --- | --- | --- |
| 0 Fundament | Gerüst, Regel-Spezifikation, Balance-Daten | fertig |
| 1 Spielregeln | `packages/game-core`: Ressourcen, Bau, Einheiten, Missionen, Kampf, Freibeuter-Kartell, Schutz | fertig, 104 Tests; offene Punkte unten |
| 4 Börsenkern | `packages/game-core/src/market`: Sofortkauf und -verkauf, Schutzregeln, Journal | fertig, 28 Tests |
| 2 Server | Datenbank, Ereignis-Queue, Befehle, Konten, WebSocket | offen |
| 3 Oberfläche | PWA nach den Mockups | offen |
| 5 Betrieb | Dockerfile, Compose, Sicherung, Startanleitung | offen |
| 6 Prüfung | Unabhängiger Testlauf und Durchspielen im Handy-Format | offen |

## Offene Punkte am Regelkern

Auslegungen stehen in `packages/game-core/ENTSCHEIDUNGEN.md` und `packages/game-core/src/market/ENTSCHEIDUNGEN.md`.

- **Restschaden verfällt (Regelfehler):** Weil Schaden unterhalb der Lebenspunkte einer Einheit je Runde verfällt, sind kleine Verbände
  und die Überfälle des Kartells fast wirkungslos. Korrektur: Restschaden je Einheitentyp über Runden und Phasen mitführen;
  REGELN.md und `combat.ts` anpassen, Test ergänzen.
- Kampfbericht auf den Stützpunkt anwenden (Bestände, Beute, Rückkehr der Einheiten) fehlt; gehört zu Paket 2 oder als Funktion in den Kern.
- Ablauf von Aufklärung und Transport am Ziel fehlt.
- Ohne Regel und nicht umgesetzt: Schwachziel-Regel (`loot.weakTarget*`), Wrack-Verfall, Radar-Vorwarnzeit, Abbruch von Bau und Ausbildung.
- Der Angriffswert `anlage` der Bodentruppen und `kuestenbatterie.attack.land` werden nicht genutzt; Auslegung A1 bis A4 prüfen.
- Balance ist nicht simuliert. Ein Simulations-Runner mit Bots steht aus.
- Typprüfung der Tests fehlt (`@types/node`); nach `npm install` nachholen.

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
