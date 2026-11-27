# game-core – Entscheidungen, Teil 5

Fortsetzung von `ENTSCHEIDUNGEN-4.md`. Verbindlich bleibt `docs/REGELN.md`. Neue Abschnitte bitte hier anhängen.

## AB. Aufholhilfe (Baugutschrift für kleine Häfen und Spät-Einsteiger)

Umsetzung der Vorlage `docs/VORLAGE-AUFHOLHILFE.md` (im Haupt-Checkout) mit den Nutzerentscheiden (Messung an Ausbaupunkten, Deckel +50 %
statt +100 %, Baugutschrift, Startpaket 15 % ab Tag 8, gilt für KI, keine schnellere Bauzeit). Regeln:
`docs/REGELN.md` „Aufholhilfe“; Balance-Block `catchUp`; Kern `game-core/src/catch-up.ts`, Server
`engine/src/catch-up.ts`, Rechnung `game-core/sim/aufholhilfe.ts`.

1. **Kurve:** b = 0,5 × clamp((0,70 − r) / 0,40; 0; 1) – Beginn unter 70 %, linear bis zum Deckel +50 % bei ≤ 30 %
   (60 % → +12,5 %, 50 % → +25 %, 40 % → +37,5 %). Hysterese wie Vorlage (Wegfall ab 70 %, Wiederbeginn unter 60 %).
2. **Konto:** Betrag zum Börsen-Richtwert (Stahl = 1) in `BaseState.catchUp` (eigenes Feld, nicht in `resources`):
   Lager, Plünderung (`defenderFromBase`/`applyDefenseResult`), Handel, Transport und Kolonie-Fracht sehen es gar nicht.
   `cloneBase` kopiert es (sonst ginge es bei jedem `settle` verloren). Je Hafen, r je Spieler über alle Häfen.
3. **Verbrauch: zuerst, nicht anteilig.** `startUpgrade` verbraucht die Gutschrift vor dem Lager und deckt denselben
   Anteil jeder Ressource (abgerundet, `splitBuildCost`). Begründung: Die Gutschrift hat keinen anderen Zweck, ihr
   Zufluss ruht am Höchstbestand (24 h) – „anteilig“ hielte sie unnötig voll und bremste genau die Hilfe; sie ist nicht
   plünderbar, also gibt es keinen Grund, das Lager zuerst zu leeren. Ein fester Anteil je Ressource verhindert, dass
   die Gutschrift gezielt nur die knappe Elektronik bezahlt. Der Auftrag merkt sich `credit`; `cancelUpgrade` erstattet
   diesen Teil (anteilig wie üblich) in die Gutschrift statt ins Lager – sonst würde ein Abbruch Gutschrift in
   plünder- und handelbare Rohstoffe verwandeln.
4. **Leichtgewichtig für den Pi:** Worker-Schritt alle 10 Minuten, rechnet nur alle `refreshMinutes` (60): eine Abfrage
   `state->'buildings'` aller Häfen, `buildingValue` aus `scoring.ts` (nur gelesen), Median in `server_setting catch_up`.
   Geschrieben werden nur Häfen mit Konto oder mit Hilfe, je Hafen kurze Transaktion mit `for update` + `jsonb_set`
   (kein verlorener Verbrauch durch gleichzeitige Bauaufträge). Zufluss mit dem Bonus des vorigen Laufs, höchstens 2 h
   je Lauf (Worker-Stillstand zahlt nicht nach). Gebäudeproduktion ohne Forschungszuschläge (spart Modifikator-Abfragen).
5. **Startpaket** in `chooseBase` (Menschen und KI): ab Saisontag 8 (Tag 1 = Beginn), Median aus dem Zwischenspeicher
   (höchstens zwei Läufe alt), sonst frisch gerechnet. Einmalig, da nur der erste Hafen über `chooseBase` entsteht
   (Heimathafen lässt sich nicht aufgeben; Kolonien bekommen nichts).
6. **Missbrauch:** kein Neustart möglich (neues Konto nur per Einladung), Median nur aus Häfen ≥ 3 Tage, Gutschrift nur
   für Gebäude (Rüsten bringt nichts, Bauen beendet die Hilfe von selbst). Die Verwaltung zeigt je Spieler aktiv,
   Bonus, Bestand und Summe (Statistik → Wirtschaft).
7. **Bots** nutzen die Gutschrift automatisch (gleicher `startUpgrade`); ihre Rücklage beim Sparen rechnet nur den
   Lageranteil (`bots-plan.ts`). Sim-Bot: Gutschrift-Teile zählen nicht als eigene Bauausgaben (Rüstungsanteil).
8. **Oberfläche:** Zeile unter der Ressourcenleiste und im Bauhof (Betrag, Herkunft „Aufholhilfe“, Erklärblatt),
   Kosten im Gebäudeblatt verrechnet („Baugutschrift“ / „aus dem Lager“), Raute „ausbaubar“ nach Abzug der
   Gutschrift; Handbuch-Kapitel „Aufholhilfe“.

**Rechnung** (`node packages/game-core/sim/aufholhilfe.ts`; Median = Referenz-Bot 45 % Rüstung, „Spitze“ =
Wirtschaftsspieler 25 % Rüstung; Ausbauwert / Median nach 14 Tagen bzw. am Saisonende Tag 42):

| Einstieg (Saisontag) | ohne Hilfe +14 / Ende | **Paket 15 % + Bonus +50 %** +14 / Ende | Σ Gutschrift | höchstens / Spitze | Vergleich +100 % +14 / Ende |
|---|---|---|---|---|---|
| 8 | 58 / 96 % | **80 / 105 %** | 18 k | 69 % | 80 / 105 % |
| 15 | 35 / 70 % | **66 / 84 %** | 45 k | 55 % | 70 / 87 % |
| 22 | 25 / 42 % | **60 / 77 %** | 84 k | 51 % | 70 / 96 % |
| 29 | – / 24 % | **– / 76 %** (nach 13 Tagen) | 112 k | 50 % | – / 83 % |

- Die Baugutschrift wirkt stärker als die Vorlage (dort Rohstoffe, Bonus +100 %: Tag 22 + 14 → 54 %): sie fließt
  vollständig in Gebäude. Deshalb reicht der halbe Deckel; +100 % brächte vor allem späten Einsteigern mehr
  (Tag 22: Ende 96 % statt 77 %) und kaum Vorteil sonst.
- **Niemand überholt die Spitze:** höchstens 69 % des Ausbaus der Spitze. Der Einsteiger an Tag 8 endet bei 105 % des
  Medians – die Hilfe endet bei ihm schon nach etwa einer Woche (71 %), den Rest holt er selbst auf, weil der
  Median-Ausbau gegen Saisonende abflacht (ohne Hilfe 96 %).
- Wer von Anfang an mitspielt, bekommt nichts (Σ 0).

## AE. Saisonfinale „Leviathan“

Umsetzung von docs/VORLAGE-SAISONFINALE.md mit den Nutzerentscheidungen (1a Abzug ohne Strafe, Restbeute verfällt,
Ruhmeshalle „entkommen“; 2b Kampfpunkte × 0,5; 3 zentraler Ort, Vorhuten bei weit verteilten Häfen; 4b KI tragen bei,
Titel/Ruhmeshalle nur Menschen; 5a Tag 36 Ankündigung, Tag 38 12:00 + 72 h; 6a Beute ohne Laderaumgrenze).

1. **Ereignisart `finale`** in der Tabelle `world_event` (Weltereignis wie die anderen, aber nicht in `WORLD_EVENT_KINDS`:
   nie zufällig geplant). Eigene game_event-Typen `finale_announce`, `finale_appear`, `finale_end`; der Planer hängt an
   `ensureWorldEventPlanner` (eine Ankündigung je Saison). Gewöhnliche Weltereignisse enden ab der Ankündigung
   (`ordinaryEventsUntil`).
2. **Zeiten** als Tage nach Saisonbeginn (35,5 / 37,5) plus 72 h, bezogen auf 42 Tage; andere Saisonlängen
   proportional (auch die Dauer), Ende immer vor dem Saisonende.
3. **Flaggschiff** als NPC-Einheit `flaggschiff` (eine Sektion, 1 000 LP) in `balance.npcUnits`; Teilschaden bleibt so
   über mehrere Angriffe erhalten. Wert in der Wertung 2 375 je Sektion (gleicher Wert je LP wie Schnellboot + 8 Miliz).
4. **Abschnitt** = 0,5 × K / hp(Schnellboot) Boote – genau wie in der Rechnung der Vorlage (K in LP der Kriegsschiffe
   und Flugzeuge, die Boote kommen mit ihrer Miliz, Schaden ≈ 1,5 × K). Mindestens 4 Boote.
5. **Vorhuten** (Frage 3b als Automatik): Spannweite der Teilnehmerhäfen > 1 500 km → je ferner Hafen (> 400 km vom
   Sammelpunkt) eine Vorhut höchstens 400 km vor ihm, nahe Häfen teilen sich eine. Vorhuten sind nur weitere
   Kampforte derselben Geschwader (gemeinsamer Bestand), keine eigenen Verbände; eine Mission fährt zum nächsten
   Kampfort. Nach dem Versenken der Geschwader bleibt nur der Sammelpunkt (Ankunft an einer Vorhut: Bericht ohne Kampf).
6. **Aktiv** heißt: `player.last_seen_at` (oder Anmeldung) in den letzten 72 h; KI-Spieler zählen immer.
7. **Allianz-Schaden** nur von menschlichen Mitgliedern zum Kampfzeitpunkt, mitgeschrieben in `world_event.data.finale`
   (Entscheidung 4b gilt auch für den Titel „Leviathan-Flotte“). Der Gesamtschaden (Anteile, Erfolg) enthält die KI.
8. **Ruhmeshalle:** neue Tabelle `season_finale_result` (eine Zeile je Saison; bleibt über das Saisonende, anders als
   `world_event`). Sie erscheint in der Ruhmeshalle der beendeten Saison; bis dahin stehen Ergebnis und Titel in der
   Systemnachricht an alle und im Kartenblatt. **Migration erzeugt der Integrator** (`drizzle-kit generate`).
9. **Erfolg „Armada-Jäger“** (Zähler `armada`, Modus max, keine Wochenziele): Anteil am Gesamtschaden in ganzen Prozent.
10. **Vor dem Erscheinen** werden Missionen abgelehnt, die vorher ankämen (`finale_not_yet`); ein Sammelangriff, der zu
    früh ankommt, findet keinen Gegner (Bericht ohne Kampf).
11. **Verwaltung:** „Saisonfinale vorziehen“ (`admin.startFinale`, Engine `startFinaleNow`) kündigt sofort an; ein
    beendetes Finale der Saison wird ersetzt (Ergebnis gelöscht), ein laufendes nicht.
12. **Wertung:** eine abgegrenzte Stelle in `scoring.ts` (`armada` in `reportScore`) mit `scoring.armadaFactor`; sie ersetzt nur den NPC-Faktor. Armada-Kämpfe sind keine Spielerkämpfe, die PvP-Faktoren bleiben dort 1.
