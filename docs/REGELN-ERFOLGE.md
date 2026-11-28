# TIDEFRONT – Erfolge (Abzeichen) und Wochenziele

Teil der Regeln (siehe `docs/REGELN.md`). Werte in `balance.json`, Block `achievements`.

## Erfolge

- Ein **Erfolg** ist ein dauerhaftes Abzeichen mit drei Stufen **Bronze, Silber, Gold** (`achievements.list`: Titel,
  Beschreibung, Zähler `counter`, Schwellen `thresholds`). Erfolge und ihre Zähler gelten **über alle Saisons**; das
  Saisonende setzt sie nicht zurück.
- Je Spieler gibt es dauerhafte **Zähler** (Tabelle `achievement_counter`). Eine Stufe ist erreicht, sobald der Zähler
  ihre Schwelle erreicht; ein großer Sprung schaltet mehrere Stufen zugleich frei. Freischaltung ist idempotent
  (je Spieler, Erfolg und Stufe höchstens eine Zeile in `achievement_tier`).
- Bei der Freischaltung erhält der Spieler eine **Nachricht** (Systemnachricht) und – über den Worker, höchstens etwa
  eine Minute später – einen **Push** der Art „Berichte“.
- Jede Stufe hat eine kleine einmalige **Belohnung** (`achievements.rewards` je Stufe, Taler und Ressourcen; ein Erfolg
  kann eigene `rewards` haben). Sie wird bei der Freischaltung festgeschrieben und per **Abholen** genau einmal
  gutgeschrieben: Ressourcen in den Hafen (auch über die Lagerkapazität), Taler über das Journal (Konto `rewards`).
- Die **drei höchsten Abzeichen** (höchste Stufe zuerst, dann Reihenfolge der Balance) stehen in der Rangliste und in
  der Spielerübersicht neben dem Namen.

| Erfolg | Zähler | Bronze / Silber / Gold | Was zählt |
|---|---|---|---|
| Nestjäger | `nester` | 5 / 25 / 100 | gewonnene Überfälle auf Piratennester |
| Freibeuter | `ueberfaelle` | 3 / 15 / 50 | gewonnene Überfälle auf Häfen von Mitspielern |
| Bollwerk | `abwehr_ohne_verluste` | 1 / 5 / 20 | abgewehrte Angriffe (Spieler, Kartell, Weltereignis) ohne eigene Verluste an Einheiten und Anlagen |
| Prisenmeister | `beute` | 25.000 / 250.000 / 2.000.000 | Summe der Beute aus Überfällen |
| Kaufmann | `handel_gebuehr` | 400 / 2.000 / 8.000 | an der Börse gezahlte Gebühr in Talern (Geschäfte ab 500 Talern; früher die Zahl der Geschäfte, M-07) |
| Baumeister | `prachtbau` | 1 / 3 / 6 | Gebäude auf Stufe `fromLevel` (v1.35: 12, vorher 18 = Prachtbau) oder höher, Bestwert (M-12: vorher unerreichbar) |
| Gelehrter | `forschung_voll` | 1 / 5 / 12 | Techniken auf Höchststufe, Bestwert |
| Meisterspion | `spionage` | 5 / 25 / 100 | gelungene Aufträge des Nachrichtendienstes |
| Flottenbrecher | `weltereignisse` | 1 / 3 / 10 | Weltereignisse, bei denen der eigene Angriff das Ereignis besiegt |
| Pflichttreu | `serie` | 3 / 7 / 21 | längste Serie der Tagesbefehle (Bestwert) |
| Ruhmreich | `saison` | Platz 1–10 / Platz 1–3 / Saisonsieg | beste Platzierung am Saisonende (mit mehr als 0 Punkten) |
| Wochenwerk | `wochenziele` | 3 / 15 / 50 | abgeholte Wochenziele |

Belohnungen (gemeinsam): Bronze 100 Taler, 800 Stahl, 500 Treibstoff, 300 Elektronik, 400 Proviant; Silber das
Dreifache, Gold das Achtfache (1.000 Taler).

**Auswertung:** Kampf-, Missions- und Spionageberichte, die ein Ereignis erzeugt, werden nach dem Ereignis genau einmal
ausgewertet (Markierung im Bericht). Ein **erfolgreicher Einsatz** (Zähler `missionen`) ist ein gewonnener Überfall oder
Weltereignis-Angriff, eine Aufklärung, ein angekommener Transport oder ein gelungener Spionageauftrag. Bestwerte
(Prachtbau, Forschung, Serie, Platzierung) werden nach Bau und Forschung sowie beim Abruf der Erfolge und Wochenziele
fortgeschrieben.

## Wochenziele

- Die **Spielwoche** beginnt am **Montag um 0:00 Uhr** in der Spielzeitzone (Vorgabe Europe/Berlin, Sommer- und
  Winterzeit beachtet) und endet am Sonntag um 24:00 Uhr.
- Je Spieler und Woche gibt es **drei verschiedene Ziele** aus einem Pool, ausgewählt beim ersten Abruf
  **deterministisch** aus Spieler und Woche und **passend zum Ausbaustand** (wie die Tagesbefehle):

| Art | Ziel | nur wenn |
|---|---|---|
| Nester | 3 Nester ab Stufe 1 + KZ/3 (höchstens 5) | Werft und Kaserne |
| Beute | 15.000 × (1 + KZ/3), auf 1.000 gerundet | Werft und Kaserne |
| Gebäudestufen | 5 + KZ/3 | immer |
| Missionen | 10 erfolgreiche Einsätze | Werft oder Flugfeld |
| Spionage | 3 gelungene Aufträge | Nachrichtendienst kann erkunden |
| Allianz-Beitrag | 3 Transporte an Allianzmitglieder | Allianz mit mind. 2 Mitgliedern, Werft |
| Forschung | 3 abgeschlossene Forschungen | Forschungsamt |
| Börse | 5 Geschäfte | Börse offen |
| Abwehr | 2 abgewehrte Angriffe | Anfängerschutz vorbei |
| Wrackgut | 3.000 × (1 + KZ/5), auf 500 gerundet | Werft oder Flugfeld |
| Anlagen | 5 + KZ/2 Verteidigungsanlagen | immer |
| Tagesbefehle | 12 abgeholte Tagesbefehle der Woche | immer |
| Felderträge | Erträge von Rohstofffeldern im Wert von 5.000 × (1 + KZ/5), auf 1.000 gerundet (Richtpreis, Stahl = 1; eingelaufene Konvois) | Werft und mindestens ein erlaubtes Feld (Hafenkommandantur) |
| Gründung | 1 neuer Hafen in der Woche (aus den Häfen gelesen) | weiterer Hafen erlaubt (Kommandozentrale) und Hafenkommandantur für das Kolonieschiff |

  (KZ = Stufe der Kommandozentrale bei der Vergabe.)
- Fortschritt zählt in der Woche, in der das Geschehen stattfand. Erfüllte Ziele der Vorwochen bleiben abholbar.
- **Belohnung je Ziel:** Ressourcenpaket im Wert `weekly.goalValue` × (1 + KZ × `stageGrowth`) und
  `goalCredits` × (1 + KZ/10) Taler (auf 10 gerundet). **Wochenbonus**, einmal je Woche, wenn alle drei Ziele der
  Woche abgeholt sind: `bonusValue` bzw. `bonusCredits` mit demselben Wachstum. Jedes abgeholte Ziel zählt für den
  Erfolg „Wochenwerk“.

## Erweiterung

Neue Ereignisse zählen über `recordAchievement(tx, playerId, counter, amount, { atMs, level, mode })`
(`packages/engine/src/achievements.ts`): schreibt den Zähler fort, schaltet Stufen frei und zählt auf Wochenziele
gleicher Art. Ein neuer Erfolg braucht nur einen Eintrag in `achievements.list` mit dem Zähler.
