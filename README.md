# TIDEFRONT

Strategie-Browserspiel auf der Weltkarte mit Marine, Bodentruppen und Luftwaffe. Hobbyprojekt für den Freundeskreis, Handy zuerst, Betrieb per Docker Compose.

Stand: Meilenstein 1 in Arbeit. Bisher vorhanden sind die Regel-Spezifikation, die Balance-Daten und der Regelkern.

- `docs/REGELN.md` – verbindliche Spielregeln für Meilenstein 1
- `packages/balance/v1/balance.json` – alle Zahlen des Spiels
- `packages/game-core` – Spielregeln und Börsenkern als reine Funktionen, ohne Fremdpakete

Tests (Node 22.18 oder neuer, keine Installation nötig):

    npm test
