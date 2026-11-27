# game-core – Entscheidungen, Teil 3 (Abschnitte L–O)

Fortsetzung von `ENTSCHEIDUNGEN.md` (dort Übersicht und Teil 1). Verbindlich bleibt `docs/REGELN.md`.

## L. Offene Balance-Fragen per Simulation entschieden (Balance v1.13)

Auf dem Server spielt bisher nur ein Mensch; die „nach Spielerfahrung“ offenen Fragen aus C5, D2 und E2 sind deshalb mit
Simulationen entschieden (`npm run sim`, neue Abschnitte aus `sim/raids.ts`, `sim/veterans.ts`, `sim/uboot-npc.ts`,
erweiterte Würfel-Varianten in `sim/luck.ts`). Kartell: 400 Seeds je Fall, Ressourcen 8000/4000/2000/3000, Bunkerschutz
300; übrige Fälle 200–400 Seeds. Werte zum Richtwert in Stahl-Äquivalent.

1. **Bunkerlinie (C5).** Die Überfallstärke wächst mit den Lebenspunkten, die Miliz traf die Bunkerlinie aber nur mit
   `anlage` 1. In drei Runden Bodenkampf fiel sie deshalb nie, und „Bunkerlinie steht“ heißt „Verteidiger hält“: Eine
   Bunkerlinie für 460 Stahl-Äquivalent machte jeden Hafen immun gegen Kartell-Siege. Sieg % Kartell (in Klammern:
   Bunkerlinie fällt, %) je Miliz-`anlage`, Schiffe schon nach L2 gewichtet:

| Verteidigung | ohne Bunker | anlage 1 | 3 | **5** | 6 | 8 |
|---|---|---|---|---|---|---|
| 1 Bunkerlinie allein (11 Schützen, gleich teuer: 100 %) | 100 % | 0 (0) | 0 (0) | **14 (14)** | 40 (40) | 79 (79) |
| 20 Schützen + 1 Bunkerlinie (31 Schützen: 1 %) | 52 % | 0 (0) | 0 (0) | **0 (18)** | 1 (40) | 26 (75) |
| 40 Schützen + 1 Bunkerlinie | 1 % | 0 (0) | 0 (0) | **0 (21)** | 2 (42) | 17 (74) |
| 50 Schützen, 3 Batterien + 1 Bunkerlinie | 9 % | 0 (0) | 0 (1) | **1 (25)** | 8 (38) | 17 (56) |
| 40 Schützen, 4 Batterien, 2 Flak + 1 Bunkerlinie | 43 % | 0 (0) | 5 (18) | **19 (51)** | 33 (60) | 49 (68) |
| stark (3 Zerst., 2 Batt., 80 Sch.) + 2 Bunkerlinien | 3 % | 0 (0) | 0 (30) | **1 (63)** | 3 (71) | 8 (81) |
| Bot-Hafen Tag 14 / 28 + 1 Bunkerlinie | 0 % | 0 (0) | 0 (0) | **0 (3 / 2)** | 0 (8 / 7) | 0 (20) |

   Kosten gegen Schutz (Ersparnis an Beute und bleibenden Verlusten je Überfall; 0,83 Überfälle je Tag nach Nachtschild;
   abzüglich 460 Kosten und 40 % Reparatur bei Zerstörung; Summe über 7 / 14 / 28 Tage):
   - anlage 1: Wache 20 Schützen 3420 je Überfall → +19 489 / +39 439 / +79 337; 50 Schützen + 3 Batterien 519 →
     +2 567 / +5 594 / +11 648; 40 Schützen + 4 Batterien + 2 Flak 2753 → +15 597 / +31 655 / +63 770.
   - anlage 5: 3386 → +19 293 / +39 047 / +78 554; 426 → +2 025 / +4 511 / +9 482; 1485 → +8 202 / +16 865 / +34 190.

   Befund: Am unteren Ende ist die Bunkerlinie nicht billiger als Truppen (11 Schützen mehr wirken gleich: 20 → 31 Schützen
   52 → 1 %); zu billig war ihre **Unzerstörbarkeit**: In Häfen mit viel Anlagen-Lebenspunkten (Batterien, Flak) drehte sie
   43 % in 0 %, und sie veraltete nie. **Entscheidung:** `npcUnits.piratenmiliz.attack.anlage` 1 → **5** (= `land`: Die
   Miliz trifft Bunker und Truppen gleich hart). Das ist der höchste geprüfte Wert, bei dem eine Bunkerlinie in keinem Fall
   schadet (mit 6 hebt sie 40 Schützen von 1 auf 2 %, mit 8 ist sie bei 40 Schützen + Batterien schlechter als keine).
   Eine Bunkerlinie bleibt das wirksamste Einzelstück und hat sich in allen Fällen nach ein bis zwei Tagen bezahlt, ist
   aber kein Freibrief mehr (allein 14 % Kartell-Sieg, Batterie-Hafen 43 → 19 %). Eine stärkere Gewichtung der
   Bunkerlinie in der Überfallstärke (geprüft ×1,5 / ×2 / ×3) wurde verworfen: Sie lockt größere Überfälle an und macht den
   Bau schädlich (anlage 3, Gewicht 2, vor L2: 40 Schützen + Bunker 1 → 4 %, Bot Tag 7 11 → 14 %) – derselbe Fehler wie bei
   der Flotte (L2). Nester ändern sich nicht (dort verteidigt die Miliz). Auch die Großflotte (Weltereignis) landet Miliz
   und trifft Bunkerlinien nun mit 5.

2. **Flotte daheim (C5).** Schiffe zählten voll zur Überfallstärke, das Kartell setzte die zusätzliche Miliz aber allein
   gegen die Bodentruppen ein. Sieg % Kartell / Ø bleibender Schiffsverlust je Überfall (Tr. = Landungsschiff,
   Kolonieschiff, Minenleger; Miliz anlage 5):

| Verteidigung | alle 1 (v1.12) | See 0,75, Tr. 0 | See 0,5 | **See 0,5, Tr. 0** | See 0,25, Tr. 0 |
|---|---|---|---|---|---|
| 20 Schützen (Bezug) | 52 % | 52 % | 52 % | **52 %** | 52 % |
| 20 Sch. + 1 Zerstörer | 58 % / 78 | 33 % / 0 | 11 % / 0 | **11 % / 0** | 4 % / 0 |
| 20 Sch. + 2 Landungsschiffe | 100 % / 963 | 52 % / 103 | 76 % / 438 | **52 % / 103** | 52 % / 103 |
| 40 Schützen (Bezug) | 1 % | 1 % | 1 % | **1 %** | 1 % |
| 40 Sch. + 8 Korvetten | 6 % / 1891 | 0 % / 1354 | 0 % / 871 | **0 % / 871** | 0 % / 405 |
| 40 Sch. + 4 Zerstörer | 60 % / 2584 | 28 % / 1843 | 1 % / 1102 | **1 % / 1102** | 0 % / 141 |
| 40 Sch. + 4 Landungsschiffe | 100 % / 2245 | 1 % / 655 | 76 % / 1440 | **1 % / 655** | 1 % / 655 |
| 40 Sch. + 4 U-Boote | 14 % / 0 | 2 % / 0 | 0 % / 0 | **0 % / 0** | 0 % / 0 |
| 40 Sch. + 2 Minenleger | 76 % / 2712 | 1 % / 1233 | 38 % / 2059 | **1 % / 1233** | 1 % / 1233 |
| Bot-Hafen Tag 7 / 14 / 28 | 11 / 14 / 13 % | 0 / 0 / 0 % | 0 / 0 / 0 % | **0 / 0 / 0 %** | 0 / 0 / 0 % |
| Schiffsverlust Bot Tag 7 / 14 / 28 | 7190 / 13 617 / 21 007 | 5523 / 10 536 / 16 387 | 5615 / 9932 / 15 503 | **5029 / 9038 / 14 155** | 4436 / 7538 / 12 000 |

   Der Bot-Hafen ohne Schiffe verliert in allen Varianten 0 %: Seine 11–14 % kamen allein von der Flotte. **Entscheidung:**
   neu `pirates.raidHpWeights` = `{ see: 0,5, minenraeumer: 0,1, minenleger: 0, landungsschiff: 0, kolonieschiff: 0 }`
   (Schlüssel: Einheiten-ID vor Gattung, sonst 1; Anlagen je ID). 0,5 ist das höchste Gewicht, bei dem kein Kriegsschiff
   die Siegchance des Kartells über den Bezug ohne Schiffe hebt (0,6: 40 Schützen + 4 Zerstörer 1 → 6 %, 0,75: → 28 %).
   Schiffe ohne Seekampfwert (Angriff `see` ≤ 10) heben sie auch mit 0,5 (2 Landungsschiffe 52 → 76 %) und zählen nicht;
   Minenräumer (`see` 15) mit 0,1 (40 Schützen + 2 Minenräumer: 0,5 → 22 %, 0,2 → 6 %, 0,1 → 3 %, 0 → 1 %).
   Bleibende Verluste des Bot-Hafens je Überfall sinken insgesamt von 14 720 / 26 727 / 39 823 auf 9 288 / 16 694 / 24 964
   (Tag 7 / 14 / 28). Code: `raidHpWeight`, `raidDefenseHp` (gewichtet, auch der Forschungsanteil); `defenseHp` bleibt
   ungewichtet (Weltereignisse). Ohne `raidHpWeights` rechnet alles wie v1.12.

   Wirkung auf die Kartell-Tabelle aus C3 (v1.12 → v1.13): Wache 20 Schützen 50 → 50 %, 30 Schützen 2 → 2 %,
   2 Korvetten + 30 Sch. 11 → 0 %, 2 U-Boote + 30 Sch. 18 → 0 %, 4 U-Boote + 40 Sch. 14 → 0 %, 5 Korvetten + 3 Batterien
   + 50 Sch. 7 → 0 %, „gut“ (60 Sch., Bunker, 2 Batt.) 0 → 1 %, „stark“ 0 → 1 %, „sehr stark“ 0 → 2 %; Bot-Hafen
   Tag 7 / 28 12 / 13 → 0 / 0 % (auch mit U-Boot-Doktrinen 11–16 → 0 %). Nest-Fahrplan unverändert (Stufe 1–5: Tag 1, 3,
   7, 14, 21). Die Tabelle „Kartell gegen Forschung“ (G3) zeigt gegen den Bot-Hafen nun überall 0 %.

3. **Kriegsglück (E2).** Varianten des Würfels (400 Seeds, vier Gefechte, Bezug „ohne Würfel 50 %“), Sieg % bei 5 / 10 /
   20 % Überlegenheit (Feuerkraft ×1,05 / ×1,10 / ×1,20), dazu ×1,5:

| Würfel innen (Rand) | ×1,05 | ×1,10 | ×1,20 | ×1,50 |
|---|---|---|---|---|
| ±10 % (±15 %) | 67–73 % | 80–89 % | 95–99 % | 100 % |
| **±15 % (±20 %) aktuell** | **62–71 %** | **75–78 %** | **89–94 %** | **100 %** |
| ±20 % (±25 %) | 58–67 % | 68–74 % | 84–86 % | 99–100 % |
| ±25 % (±30 %) | 54–64 % | 60–69 % | 77–81 % | 96–100 % |

   „Knapp überlegen“ (5–10 %) liegt mit ±15 % bei 62–78 %, also im Ziel 60–75 % (oben am Rand); ±20 % träfe 10 % etwas
   besser, fiele bei 5 % aber unter 60 % und ließe bei ×1,3 jeden 15. bis 20. Kampf kippen (5–7 % statt 1–4 %).
   **Entscheidung:** nicht zu zahm, `combat.luck` bleibt unverändert.

4. **Veteranen (E2).** Saison-Simulation (`sim/veterans.ts`, 200 Seeds): Verband des Bots am jeweiligen Tag, Nest der
   höchsten Stufe mit ≥ 70 % (Rückkehr nach 20 h), Kartell alle 18 h ab Tag 8 ohne Nachtschild (21 Überfälle), nur wenn
   der Verband daheim ist; Erfahrung wie im Spiel, Ränge wirken im Kampf, Verluste und Zuwachs verwässern. Ø Erfahrung an
   Tag 7 / 14 / 21 / 28:

| Spielweise | Schützen | Korvette | Zerstörer | Jagdbomber | Kampfpanzer |
|---|---|---|---|---|---|
| nur Kartell-Abwehr | 0 / 28 / 31 / 32 | 0 / 10 / 10 / 9 | 0 / 12 / 11 / 11 | 0 / 10 / 10 / 11 | 0 / 32 / 37 / 33 |
| Nest alle 2 Tage | 7 / 19 / 25 / 27 | 9 / 16 / 13 / 13 | 0 / 26 / 16 / 19 | 4 / 5 / 8 / 8 | 5 / 31 / 43 / 36 |
| Nest täglich | 12 / 16 / 17 / 19 | 15 / 22 / 28 / 25 | 0 / 32 / 52 / 88 | 6 / 4 / 4 / 5 | 13 / 33 / 46 / 38 |

   Ränge (15 / 40 / 80): Schützen und Panzer werden in Woche 2 „Erprobt“, aktive Spieler haben Zerstörer und Panzer in
   Woche 3 als „Veteran“; „Elite“ erreicht nur ein kleiner, selten nachgebauter Bestand (4 Zerstörer bei täglichen
   Nestangriffen, Tag 28). Korvetten und Jagdbomber bleiben Rekruten bis Erprobt, weil sie oft verloren gehen und
   nachgebaut werden – gewollt: Erfahrung belohnt Überleben. Gegenproben: `xpWin` 15 macht reine Kartell-Abwehr schon an
   Tag 14 zu Veteranen (Schützen 43, Panzer 50); Schwellen 10/30/60 heben ebenfalls vor allem die passive Abwehr
   (Schützen und Panzer „Veteran“ ab Tag 14–21). **Entscheidung:** Werte bleiben (Schwellen 15/40/80, `xpWin` 10,
   `xpLoss` 4, `lossPenalty` 0,5): Ränge sind erreichbar, Elite bleibt selten, der Bonus (+5/+10/+15 %) entscheidet keine
   Saison. Vereinfachung der Simulation: Verluste werden sofort ersetzt; ohne Ersatz läge die Erfahrung etwas höher.

5. **U-Jagd für Kartell und Nester (C5).** Bot-Doktrinen gegen Nester (Sieg / Netto je Angriff = Beute − bleibende
   Verluste − Treibstoff) und im Kartell-Überfall (`sim/uboot-npc.ts`, 200 Seeds), jeweils Tag 21 · Tag 28:

| Doktrin | Nest 4 | Nest 5 | Kartell: Sieg / bleibende Verluste |
|---|---|---|---|
| Zerstörer (Vorgabe) | 100 % / 12 012 · 11 972 | 99 % / 13 551 · 100 % / 17 180 | 0 % / 21 463 · 24 747 |
| U-Boote statt Zerstörer | 100 % / 11 999 · 12 069 | 97 % / 7891 · 100 % / 10 684 | 0 % / 21 092 · 24 378 |
| schwere U-Boot-Rüstung | 100 % / 15 664 · 15 822 | 92 % / 10 557 · 95 % / 10 762 | 0 % / 19 496 · 22 135 |

   Die ersten Prüftage mit ≥ 70 % sind für alle Doktrinen gleich (Stufe 1–5: Tag 1, 3, 7, 14, 21). U-Boote sind gegen
   Nester nicht überlegen (sie treffen keine Anlagen; gegen Stufe 5 22–42 % weniger Netto); nur die schwere Rüstung bringt
   gegen Stufe 3/4 bis +32 % Netto. Im Kartell-Überfall gehen U-Boote nie verloren, der Hafen verliert insgesamt aber nur
   1–13 % weniger. Gegenprobe Schnellboot mit U-Jagd 10: Das Kartell versenkt dann in fast jedem Überfall alle U-Boote
   (4 von 4, 9,2 von 11) – viel zu stark, weil die Zahl der Schnellboote mit dem Hafen wächst. **Entscheidung:** keine
   U-Jagd für Kartell und Nester. Sollte sie später nötig werden, dann über eine eigene Nest-Einheit der Stufen 3–5, nicht
   über das Schnellboot.

6. **Kartell gegen Forschung (D2).** Schon umgesetzt, nur dokumentiert: v1.7 `pirates.raidResearchWeight` 0,5 (G3), der
   Server übergibt die Modifikatoren seit dem Merge 4a22249 (`packages/engine/src/handlers.ts`, `raidLaunch`:
   `composeRaid(…, randomSeed(), mods)` mit `mods = modsOf(tx, b, due)`). Seit v1.13 gewichtet `raidDefenseHp` auch den
   Forschungsanteil nach L2.

7. **Kartell siegt selten (gelöst über die Verwaltung):** Gegen ausgewogene Häfen gewinnt das Kartell jetzt kaum noch
   (Bot-Hafen 0 %, starke Häfen 1–2 %); seine Bedrohung sind die Verluste je Überfall (Bot Tag 7 Ø 9 288 bleibend). Statt
   die Balance festzulegen, stellt der Admin die Stärke ein: Regler „Kartell-Stärke“ (25–300 %, `server_setting`
   `cartel_strength`) skaliert `raidStrengthShareOfDefense` beim Auslaufen (`packages/engine/src/cartel-strength.ts`). **Großflotte (erledigt, v1.16):** siehe 9.

8. **Saison 42 statt 28 Tage** (`SEASON_DAYS`, Vorgabe in `packages/engine/src/season.ts`). Simulation `sim/season42.ts`
   und Veteranen über 42 Tage (Balance v1.13, 200 Seeds je Kampffall). Bot mit 45 % Rüstung / Wirtschafts-Bot:

| Tag | KZ | HK | Gebäudestufen | Produktion/h | Lager (höchste Ressource) | Ausgaben der Woche Ausbau / Rüstung | Felder | Häfen |
|---|---|---|---|---|---|---|---|---|
| 28 | 7 / 8 | 7 / 8 | 101 / 112 | 1127 / 1343 | 31 / 55 % | 99 651 / 8333 · 121 997 | 2 / 3 | 2 / 2 |
| 35 | 8 / 8 | 8 / 9 | 111 / 120 | 1172 / 1436 | 28 / 50 % | 111 963 / 8144 · 122 333 | 3 / 3 | 2 / 2 |
| 42 | 8 / 9 | 9 / 10 | 120 / 128 | 1328 / 1645 | 25 / 64 % | 132 367 / 0 · 157 938 | 3 / 3 | 2 / 3 |

   - **Kein wirtschaftlicher Stillstand:** Die Ausbauausgaben je Woche steigen bis Tag 42 weiter (Bot 99 k → 132 k), das
     Lager läuft nicht über (höchstens 64 %). **Stillstand gibt es militärisch:** Die Kommandopunkte (KZ 8: 300) sind ab
     etwa Tag 35 voll, die Rüstungsausgaben fallen von 26,8 k (Woche 1) auf 8 k (Woche 4–5) und 0 (Woche 6); der Verband
     an Tag 35 und 42 ist gleich. Nest 5 fällt ab Tag 21 zu 99–100 %; seine Beute (33 200) sinkt von 37 h auf 25 h
     Produktion (Netto 13,6 k → 20 k je Angriff). Das Kartell siegt nie (0 %), kostet aber 20–24 h Produktion je Überfall.
   - **3. Hafen und Felder:** Kommandozentrale 5 an Tag 16 (Wirtschafts-Bot Tag 10), Kommandozentrale 9 nur der
     Wirtschafts-Bot an Tag 37 (Rüstungs-Bot erreicht bis Tag 42 nur 8). Felder: 2 ab Hafenkommandantur 4, 3 ab
     Hafenkommandantur 8 (Tag 30 bzw. 23), 4 Felder (Stufe 12) erreicht keiner. Der 3. Hafen bleibt wie in v1.12 gewollt
     ein Ziel für gezielten Ausbau (nach 3 Tagen bezahlt, K3) – **nicht geändert**; Umgesetzt (v1.14, K1): Freischaltung
     `expansion.unlockCommandLevels` [5, 8].
   - **Saisonfortschritt skaliert sinnvoll:** `seasonGrowth`, `lootSeasonGrowth` und die Großflotten-/Belagerungsbeute
     rechnen mit dem Anteil der Saison (0 … 1), nicht mit Tagen; sie steigen über 42 Tage langsamer, enden aber gleich
     (×2,0, Schatzschiff 42 750). Gemessen an der Produktion des Bots bleibt die Schatzschiff-Beute über die ganze Saison
     bei 30–35 h (28-Tage-Saison: 38–41 h), Stärken folgen ohnehin der Verteidigung der Ziele. Die Zahl der Ereignisse
     wächst mit der Länge (alle 48–96 h). Börse `seasonEnd` (letzte 7 Tage, absolut) passt auch für 6 Wochen.
     **Nicht geändert.**
   - **Veteranen und Admirale:** Mit 42 Tagen erreichen aktive Spieler (Nest täglich) Elite bei Zerstörern (ab Tag 28)
     und Panzern (Tag 42: 90), passive bleiben „Erprobt“ (Schützen 37, Panzer 39 an Tag 42). Ein Admiral mit täglichem
     Nestangriff ab Tag 10 wird an Tag 16 Admiral (700) – schon in 28 Tagen so; die zusätzlichen Wochen ändern das nicht.
     **Nicht geändert.**
   - **Nest 6:** Nötig wäre ein Ziel für die Wochen 5–6, denn ab Tag 28 gibt es kein schwereres Nest. Gerechnet (nicht
     umgesetzt): Nest 5 × 1,3 (Besatzung, Anlagen, Beute) schlägt der Bot-Verband an Tag 28 / 35 / 42 zu 25 / 82 / 82 %,
     × 1,4 zu 4 / 62 / 62 %, × 1,2 zu 82 / 100 / 100 %. Ein Nest 6 ≈ Nest 5 × 1,3–1,4 passte ins Fenster Tag 35–42. Es
     ist aber mehr als ein Balance-Wert: Die Nestplätze und ihre Stufen erzeugt `@tidefront/world` (`nestSites`), der
     Server legt sie nur beim Seed an. Umsetzung als eigenes Paket (Nest 6); bis dahin sind
     Weltereignisse, Felder, 3. Hafen und Spieler das Spätspiel. Balance bleibt **v1.13**.

9. **Großflotte gewichtet wie das Kartell (L7, Balance v1.16).** Die Großflotte kämpft wie ein Kartell-Überfall:
   Seekampf gegen die Schiffe daheim, dann landet ihre Miliz (`miliPerBoot` je Schnellboot, eigene Landungskapazität).
   Ihr Bezug war ungewichtet (`defenseHp`, Median der Zielhäfen) – dasselbe Muster wie L2: Schiffe locken mehr Boote und
   Miliz an, kämpfen an Land aber nicht mit. Simulation `sim/armada.ts` (`npm run sim`, Abschnitt „Großflotte“,
   400 Seeds, erster Angriff mit voller Stärke, alle drei Ziele gleich; Saisonmitte bzw. Bot-Tag/42).
   Sieg % Großflotte / Ø bleibender Schiffsverlust / Ø Verlust gesamt / Schnellboote:

| Verteidigung | ungewichtet (bis v1.15) | **gewichtet (v1.16)** |
|---|---|---|
| 40 Schützen | 100 % / 0 / 1008 / 23 | **100 % / 0 / 1008 / 23** |
| 40 Sch. + 8 Korvetten | 100 % / 5491 / 6499 / 36 | **92 % / 3325 / 4324 / 24** |
| 40 Sch. + 4 Zerstörer | 100 % / 7278 / 8286 / 39 | **100 % / 4417 / 5425 / 26** |
| 40 Sch. + 4 Landungsschiffe | 100 % / 4440 / 5448 / 30 | **100 % / 3965 / 4973 / 23** |
| 80 Sch., 2 Batterien (+ 8 Korvetten) | 100 % / 0 / 2016 / 36 (100 % / 5258 / 7274 / 60) | **100 % / 0 / 2016 / 36 (100 % / 4314 / 6330 / 48)** |
| Bot-Hafen Tag 7 (ohne Schiffe) | 100 % / 9170 / 21 688 / 88 (76 % / 0 / 10 904 / 58) | **75 % / 9138 / 20 672 / 68** (76 % ohne Schiffe) |
| Bot-Hafen Tag 14 / 28 | 100 % / 19 780 · 29 060 / 181 · 337 Boote | **100 % / 19 701 · 29 060 / 138 · 258 Boote** |

   Befund: Ungewichtet hob die eigene Flotte die Siegchance der Großflotte (Bot Tag 7: 76 % ohne Schiffe → 100 % mit)
   und vergrößerte sie um ein Drittel bis zur Hälfte; gewichtet bleibt sie beim Bezug ohne Schiffe (75 % gegen 76 %),
   und kleine Flotten verlieren ein Drittel weniger (8 Korvetten 5491 → 3325, 4 Zerstörer 7278 → 4417). Liegt der
   Hafen nicht im Median der Region (zwei Nachbarn ohne Schiffe), ändert sich nichts. **Entscheidung:**
   `worldEvents.grossflotte.raidWeights` = true: Bezug je Zielhafen `armadaTargetHp` = `raidDefenseHp` ohne Forschung
   (die Großflotte rechnete nie mit Forschung; das bleibt). Schatzschiff und Belagerung kämpfen nur auf See, dort
   zählen Schiffe voll – unverändert. Nebenbefund (nicht geändert): Gegen Häfen ab Tag 14 siegt die Großflotte
   auch gewichtet immer; gedacht ist, sie vorher auf See zu schwächen (Beute für Schaden). Stellschraube wäre
   `grossflotte.shareOfDefense` (0,8).

## M. KI-Spieler (Bots, Balance-Block `bots`)

Regeln: `docs/REGELN-KI.md`. Code: `packages/engine/src/bots-*.ts`. Testlauf: `packages/engine/test/bots-sim.test.ts`.

1. **Nur Befehle.** Bots rufen dieselben Befehlsfunktionen wie der Client auf (Idempotenz-Schlüssel, Transaktion,
   Prüfungen). Vorher prüfen sie mit den reinen Kernfunktionen (`startUpgrade`, `startTraining`, `startResearch`) bzw.
   `missionPreview`, damit das Befehlsprotokoll nicht mit Ablehnungen volläuft. Keine direkten Schreibzugriffe auf
   Spielzustand; einzige eigene Spalten sind `player.bot_profile`, `bot_settings`, `bot_state`. Gelesen wird nur, was
   auch ein Mensch sieht (eigener Zustand, Karte, Nest-Tabelle aus dem Handbuch, Schutzstatus, eigene Berichte).
2. **Stärke über Entscheidungsqualität und Takt**, nicht über Vorteile: leicht = selten (60–120 Min.), 35 %
   Zufallsentscheidungen, nur ein Bauauftrag in der Schlange, keine Knappheitsplanung; mittel = 30–60 Min., Probekampf
   mit 3 Durchläufen; stark = 12–25 Min., drei Bauaufträge, Aufklärung vor jedem Spielerangriff und Probekampf mit
   12 Durchläufen (≥ 75 % Siege, Beute ≥ 0,5–0,8 × erwartete Verluste). Ziele, die im Probekampf durchfallen,
   meidet der Bot für 12 h (sonst schickt er im Dauertakt Aufklärer).
3. **Rüstungsanteil wächst mit der Kommandozentrale** (voll ab Stufe 3). Erste Fassung rüstete ab Minute 1 auf 45–55 %
   und lag an Tag 1 bei der Hälfte der Punkte der anderen; Wirtschaft zuerst wie bei Menschen. Liegt die Rüstung unter
   dem Ziel und fehlt Geld für die dringendste Einheit, wird gespart (sonst verhungert die Rüstung am Ausbau – erste
   Fassung: Militär 9 Punkte nach 6 Tagen).
4. **Forschung gedeckelt** (10/20/8 % des Gebäudewerts). Ohne Deckel steckte die Festung ab Tag 3 alles in Forschung
   (Kosten ×2) und stand mit Kommandozentrale 1 still.
5. **Truppen und Landungsschiffe.** Landungsschiffe in Losen von höchstens 2 nach Truppenbedarf; ist die Werft belegt,
   wird die Truppe trotzdem ausgebildet. Erste Fassung baute nur Korvetten (Truppe immer durch belegte Werft
   blockiert) und gewann kein einziges Nest.
6. **Menschen.** Angriffserlaubnis je Bot, Vorgabe aus. Mit Erlaubnis: Schutzregeln der Befehle plus Sperrfrist 12 h je
   Bot und Mensch (Bericht oder Überfall unterwegs). Keine Aufklärung und keine Minen gegen Menschen ohne Erlaubnis.
7. **Takt und Last (Raspberry Pi).** Höchstens 2 Züge je Minute, Budget 8 s, ältester Termin zuerst; mehr Bots
   strecken sich so über die Zeit statt die Minute zu sprengen. Ein Zug kostet lokal ~10–17 ms (Median).
8. **Aktivitätszeiten.** Fenster je Spielweise in Europe/Berlin, täglich um ±45 Min. verschoben, dazu ein Nachtschild
   in der Schlafzeit – Bots wirken nicht wie 24/7-Maschinen und sind nachts so geschützt wie Menschen.
9. **Entfernen** nutzt die vorhandene Mechanik (Angebot zurückziehen, Feld/Verband zurückrufen, Kolonie aufgeben,
   Hinderungsgründe von `abandonBlockers`); erst danach werden Heimathafen und Spieler gelöscht (Kaskade). Berichte,
   Journal und Nachrichten bleiben.
10. **Testlauf** (`BOT_SIM_DAYS=10`, verstellte Uhr, echte Engine mit Kartell-Überfällen): Punkte an Tag 10
    Freibeuter 2524 / 2338, Festung 1959 / 1855, Händler 1541 / 1035 (zwei Läufe); Freibeuter 10–13 Überfälle (fast
    alle gewonnen, Beute 510–534 Punkte), Festung 3–4 Nester, Händler keine; Gebäudestufen 59–70 (Start 0).
    Gründungen erst nach Tag 10 (Kolonieschiff braucht Hafenkommandantur 6).
    **Felder (erledigt):** Ursache war der Probekampf: er zählte `winner === "attacker"`, im Feldkampf ohne Truppen gibt
    es diesen Sieg nie (der Feldkampf wertet „Wache vernichtet“, `strandTroops`) – jeder Probekampf ergab 0 %. Jetzt
    (`bots-fields.ts`): Sieg = Wache vernichtet und die Überlebenden bilden eine Besatzung; dazu muss der Verband als
    ganze Besatzung (stayAll) einen Kartellangriff der Stufe halten (sonst verlor der Bot das Feld mit der
    Mindestbesatzung nach 1–2 Tagen: im Testlauf 3–4 Einnahmen, 0–1 gehalten). Heimwache nur um den Feldverband
    gesenkt (halbe Heimwache bleibt), ein Missionsplatz bleibt für Nester frei (sonst fielen die Nestangriffe der
    Festung von 9 auf 0), gemerktes Ziel 36 h (Überfälle lassen den Feldverband daheim, Doktrin +15 % Korvetten,
    +5 % Zerstörer), Verstärkung, wenn die Besatzung den nächsten Kartellangriff nicht mehr hält. Bedarf (Probekampf,
    200 Seeds): Wache Stufe 1/2/3 (4/8/14 Schnellboote) fällt sicher ab 3/5/10 Korvetten bzw. 2/4/8 Zerstörern;
    Kartellangriff 9/12/18 hält eine Besatzung ab 3/4/5 Korvetten. Testlauf (`BOT_SIM_DAYS=14`, drei Läufe), Felder
    an Tag 10 / Tag 14: Freibeuter 0–2 / 2, Festung 1 / 1, Händler 1–2 / 1–2 (Höchstzahl je nach Hafenkommandantur
    1–2); Feldverluste an das Kartell 0–2 je Lauf (alle Bots), Nestangriffe der Festung 5–11, Freibeuter 8–18.

## N. Nest Stufe 6 als Spätspiel-Ziel (Balance v1.15)

Anlass: Saison 42 statt 28 Tage. Nest 5 fällt ab Tag 21 zu 99–100 %, danach fehlt ein schwereres Ziel (Balance-Prüfung
der 42-Tage-Saison, Abschnitt L8 auf dem Balance-Zweig: Nest 5 × 1,2 / 1,3 / 1,4 an Tag 28/35/42 zu 82/100/100,
25/82/82 bzw. 4/62/62 %). Ziel: Nest 6 im Fenster Tag 35–42, d. h. ein bezahlbarer Verband siegt um Tag 35–38 mit
≥ 70 %, an Tag 28 deutlich darunter.

Simulation `sim/nest6.ts` (in `npm run sim`, einzeln `node packages/game-core/sim/nest6.ts`), 400 Seeds je Fall. Verband
= Bot mit 45 % Rüstung, alles daheim (Tag 28 Kommandopunkte 269,5/270, ab Tag 35 299/300 – der Verband an Tag 35 und
42 ist gleich). „+2 L frei“: zwei Landungsschiffe zusätzlich über die Kommandopunkte hinaus (Forschung/Admiral),
„gleiche KP“: zwei Landungsschiffe statt 67 Schützen. Sieg in %:

| Nest | Tag 21 | Tag 28 | Tag 35–42 | +2 L frei Tag 28 / 35 | gleiche KP Tag 28 / 35 |
|---|---|---|---|---|---|
| Nest 5 | 99 | 100 | 100 | 100 / 100 | 100 / 100 |
| Nest 5 × 1,3 | 8 | 28 | 83 | 85 / 97 | 53 / 80 |
| **Nest 5 × 1,35 = Nest 6** | 3 | **15** | **74** | 76 / 94 | 44 / 70 |
| Nest 5 × 1,4 | 1 | 6 | 63 | 67 / 89 | 33 / 63 |
| Nest 5 × 1,45 | 0 | 3 | 54 | 58 / 83 | 22 / 52 |
| Nest 5 × 1,5 | 0 | 0 | 40 | 44 / 67 | 9 / 43 |

1. **Faktor 1,35** (Besatzung und Anlagen, gerundet): 35 Schnellboote, 338 Piratenmiliz, 4 Flakstellungen,
   3 Küstenbatterien, 3 Bunkerlinien. Der Verband mit vollen Kommandopunkten siegt an Tag 28 zu 15 %, ab Tag 35 zu
   74 % – genau das Fenster Tag 35–42. ×1,3 wäre schon an Tag 28 mit zwei zusätzlichen Landungsschiffen (85 %) zu
   haben, ×1,4 erreicht 70 % mit vollen Kommandopunkten nie.
2. **Beute** 8000 Stahl, 8000 Treibstoff, 11 000 Elektronik, 2000 Proviant = 56 600 zum Richtwert (Nest 5: 33 200), also
   48 h Produktion des Bots an Tag 35 und 43 h an Tag 38–42 (Nest 5 dort 25 h). Bewusst elektroniklastig: Die Menge
   (29 000) passt fast ganz in die 7 Landungsschiffe des Verbands (28 000); mehr Menge würde der Laderaum kappen.
   Netto je Angriff (Beute − bleibende Verluste − Treibstoff, mit 26 % Niederlagen): Tag 35 +10 200 (8,7 h), mit
   2 Landungsschiffen statt Schützen +18 100 (15,4 h); an Tag 28 −23 100 (Angriff lohnt dort nicht). Nest 6 ist ein
   *zusätzliches* Ziel neben Nest 5 (Netto +20 100), kein Ersatz.
3. **Wiederkehr 24 h** statt 12 h (`respawnHours` in der Stufe, neu und optional; ohne Angabe gilt
   `nestRespawnHours`). Wenige Plätze für den ganzen Server, also eine Trophäe je Tag und Platz, nicht zweimal täglich
   abzuernten. `respawnHours` ist kein Besatzungsschlüssel (`nestGarrison` überspringt ihn).
4. **Plätze:** 5 feste Inseln (`LATE_NEST_POINTS` in `@tidefront/world`), an `nestSites()` angehängt, sodass die ersten
   70 Plätze (Stufen 1–5) unverändert bleiben: Bermuda (Westatlantik), Azoren/São Miguel (Atlantik-Mitte), Jan Mayen
   (Nordmeer), Balearen/Mallorca (westliches Mittelmeer), Rhodos (östliches Mittelmeer). Alle auf Inselfeldern ohne
   Festlandküste, mindestens 175 km vom nächsten anderen Nest; Mittelmeer und Nordamerika haben je eins in Reichweite.
5. **Laufende Welten:** `ensureNests` legt beim migrate/Seed fehlende Plätze an (`on conflict do nothing` auf dem
   Feld), vorhandene Nester bleiben unverändert. Steht auf einem neuen Platz schon ein Hafen, wird er übersprungen
   und beim Saisonwechsel (nach dem Löschen der Häfen) angelegt.
6. **Kein Freischalten nach Saisontag:** Ein „ab Tag 28 sichtbar“ bräuchte den Saisonstand in Karte, Missionsstart,
   Ankunft und Allianz-Ops (fünf Stellen) und eine eigene Anzeige. Die Stärke ist die Schwelle (Tag 21: 3 %, Tag 28:
   15 %), Aufklärung und Probekampf zeigen das vorher. Tagesbefehle und Wochenziele verlangen weiter höchstens Stufe 5
   (`nestCap`), weil es nur fünf Plätze gibt; Erfolge zählen Nest 6 wie jedes Nest.

## O. Ökostrom, Elektrolyse, Seekabel (Balance v1.21)

Anlass: Überschuss über Bedarf und Speicher verfiel bisher; einziger Anreiz für Wind und Sonne waren Tagesbefehle.
Regeln: [docs/REGELN-STROM.md](../../docs/REGELN-STROM.md). Simulation `sim/power-green.ts` (in `npm run sim`, einzeln
`node packages/game-core/sim/power-green.ts`): mittlerer Hafen (Stahlwerk 8, Raffinerie 8, Chipfabrik 6,
Versorgungshof 6 = Bedarf 302 Strom), 28 Tage stündlich mit echtem Wetter, Grün-Bonus angewandt.

1. **Ökostrom zuerst an den Bedarf.** Nur so ist die Elektrolyse ohne Schleife möglich: Würde Kraftwerksstrom den
   Bedarf decken und Ökostrom frei machen, wäre 3 Treibstoff → 60 Strom → 6 Treibstoff ein Gewinn. Mit dieser
   Reihenfolge kann mehr Kraftwerk den Ökostrom-Überschuss nur senken; die Treibstoff-Rate fällt monoton mit der
   Kraftwerk-Auslastung, die Bisektion bei Treibstoff 0 bleibt eindeutig (Test „keine Endlosschleife“).
2. **Elektrolyse 40 Strom/h je Stufe, 10 : 1.** Treibstoff aus Elektrolyse je Tag gegen die Raffinerie Stufe 8
   (3830–3945/Tag):

   | Lage, Start | Ausbau | Bonus-Std. | Anteil | versorgt | Elektrolyse/Tag | Anteil an Raffinerie |
   |---|---|---|---|---|---|---|
   | Nordsee März | Kraftwerk 6 | 0 % | 0 % | 100 % | – | – |
   | Nordsee März | KW 3 + Wind 4 + Sonne 2 + Speicher 2 (+ Elektr. 3) | 78 % | 98 % | 100 % | 6 | 0,2 % |
   | Nordsee März | KW 1 + Wind 7 + Sonne 4 + Speicher 4 + Elektr. 5 | 100 % | 100 % | 100 % | 242 | 6,1 % |
   | Nordsee Nov. | dasselbe | 100 % | 100 % | 100 % | 133 | 3,4 % |
   | Biskaya März / Nov. | KW 3 + Wind 4 + Sonne 2 + Speicher 2 | 51 / 26 % | 61 / 40 % | 100 % | 0–2 | 0 % |
   | Biskaya März / Nov. | KW 1 + Wind 7 + Sonne 4 + Speicher 4 + Elektr. 5 | 100 % | 92 / 73 % | 100 / 98 % | 122 / 60 | 3,1 / 1,6 % |
   | Mittelmeer März / Nov. | KW 3 + Wind 4 + Sonne 2 + Speicher 2 | 1 / 3 % | 51 / 46 % | 100 / 99 % | 0 | 0 % |
   | Mittelmeer März / Nov. | KW 1 + Wind 7 + Sonne 4 + Speicher 4 + Elektr. 5 | 100 % | 87 / 81 % | 97 / 94 % | 63 / 19 | 1,6 / 0,5 % |

   Die Elektrolyse liefert höchstens rund 6 % der Raffinerie-Menge desselben Hafens – sie flutet die Börse nicht.
   Lohnend ist sie nur bei viel Wind und Sonne (Nordsee, großer Ausbau: 242 Treibstoff/Tag = 435 zum Richtwert,
   Elektrolyse 5 kostet ~5700, amortisiert in ~13 Tagen); bei kleinem Ausbau deckt der Ökostrom fast nur den Bedarf.
3. **Bonus 3 % ab 60 %.** Ökostrom ist kein Muss: Ein Kraftwerkshafen bleibt zu 100 % versorgt und verliert nur die
   3 % (hier 637 von 21 217 Produktionswert/Tag). Im wind- und sonnenarmen Mittelmeer-Winter reicht selbst der große
   Ökostrom-Ausbau mit Kraftwerk 1 nicht (94 % versorgt) – das Kraftwerk bleibt dort nötig. Wind und Sonne lohnten
   an der Nordsee schon vor v1.21 (Kraftwerk 6 kostet 432 Treibstoff/Tag); der Bonus verstärkt das um ~500/Tag. 60 %
   ist im Norden mit gemischtem Ausbau meist erreicht (78 % der Stunden), in der Biskaya teilweise, im Mittelmeer nur
   mit großem Ausbau – Absicht: Grün ist eine Entscheidung, keine Pflicht. Höhere Boni (5 %) machten den Ausbau ohne
   Kraftwerk zur Pflicht im Norden; 2 % wäre kaum spürbar.
4. **Seekabel ohne Verdopplung.** Nordsee-Windhafen (Wind 8, Sonne 2) → Hafen ohne Kraftwerk in 300 km, Station 3,
   14 Tage, Abrechnung alle 10 min: gesendet 30 240, angekommen 21 168 (genau 70 %), genutzt 21 158, Empfänger zu
   100 % versorgt. Mit Elektrolyse beim Abgebenden geht sie vor (4032 Treibstoff), das Kabel bekommt den Rest. Geprüft:
   genutzt ≤ angekommen ≤ gesendet × (1 − Verlust). Kabelstrom wird nicht gespeichert, nicht elektrolysiert, nicht
   weitergeleitet, und jeder Hafen hat nur ein Kabel – keine Ketten, keine Kreise.
5. **Abrechnung in Paketen statt gekoppelter Fortschreibung.** Eine echte Live-Kopplung müsste zwei Häfen gemeinsam
   fortschreiben; `settle` wird aber an Dutzenden Stellen für einen Hafen allein aufgerufen. Darum schreibt jeder Hafen
   für sich fort (Abgebender zählt `cable.sent`, Empfänger zieht aus `cable.buffer`), und `cable_tick` bucht alle
   10 Minuten mit Verlust und Preis um. Deterministisch, unabhängig davon, wann ein Hafen sonst fortgeschrieben wird;
   die Verzögerung von höchstens 10 Minuten fängt der Puffer (2 Stunden) auf.
6. **Preis je angekommener Strom-Stunde, vorab bezahlt.** Geliefert wird nur, was der Empfänger bezahlen kann; keine
   Schulden, keine Mahnung. Höchstpreis 2 Kredite (1 Strom-Stunde ist als Elektrolyse-Treibstoff ~0,18 wert, als
   ersetzter Kraftwerksstrom ~0,09) – Raum für Allianzhandel, aber kein Wucher.
7. **Sabotage nur durch Kriegsgegner.** Die übrigen Sabotageziele gelten gegen alle außer Verbündete und Paktpartner;
   ein Kabel betrifft aber meist zwei Spieler einer Allianz, deshalb nur im Krieg (Code `cable_sabotage_war`). Minen
   auf der Kabelstrecke gibt es nicht (Kabel haben keine Strecke auf der Karte).
8. **Wochenziel und Erfolg.** Genutzter Ökostrom je Woche: 35–55 × Höchstwert aus Wind und Sonne (Nordsee 53, Mittelmeer
   35). Ziel = Höchstwert × 30 → 119–181 % erreichbar bei gemischtem Ausbau. Erfolg: Saison (42 Tage) 150 000–400 000
   bei mittlerem Ausbau ab Tag ~10; Bronze 10 000 (ein bis zwei Tage), Silber 75 000, Gold 300 000 (nur grüne Häfen
   im Norden über die ganze Saison).
### O.1 Kraftwerk regelt nach (Lastfolge, 0.21.3)

Bisher lief das Kraftwerk immer voll, solange Treibstoff da war; Überschuss verfiel oder lud den Speicher grau. Auf
Wunsch des Nutzers regelt es jetzt nach: Auslastung = (Bedarf − Wind − Sonne − Kabelbezug − Speicherentladung) ÷
Volllast, begrenzt auf 0–1; der Treibstoffverbrauch sinkt anteilig. Das Kraftwerk lädt den Speicher nicht mehr (Laden
nur aus Ökostrom), deshalb entsteht kein grauer Speicher. Ohne Treibstoff gilt weiter die Bisektion („verbrennt, was
nachkommt“), jetzt mit Obergrenze Lastfolge; `fuelLimited` unterscheidet in der Anzeige Treibstoffmangel von geringer
Last. Kein Balance-Schalter: Kraftwerksstrom hatte außer Bedarf und grauem Speicher keinen Abnehmer, Lastfolge spart
also nur Treibstoff, ohne Strom wegzunehmen. Wirkung: Treibstoff wird spürbar knapper verbraucht (typisch statt
3/h je Stufe nur Bedarf ÷ 20); Elektrolyse bleibt der Weg, Treibstoff *dazu* zu gewinnen.

## P. Lagebild Stufe 2: Aufklärung, Radarposten, Sonar, Bordsicht (Balance v1.20)

Regeln: `docs/REGELN-LAGEBILD.md` 5.3–5.5, 5.7, 5.8 (Bordsicht, Entscheidung vom 27.11.2026). Zahlen aus
`npm run sim` (Abschnitt „Lagebild Stufe 2“), Richtwert der Börse in Stahl-Gegenwert, Produktion des Wirtschafts-Bots
Tag 7 ≈ 620/h, Tag 14 ≈ 780/h, Tag 28 ≈ 1 130/h.

1. **Patrouille** (Block `intel.patrol`): Werte wie freigegeben (4/8/12 h, Schiffe 100 km, Drohnen 200 km, Drohnen
   ≤ 6 h und ≤ 800 km, Abfangen 15 % je Jäger bis 75 %). Kosten sind bewusst klein: 2 Korvetten 300 km vor dem Hafen
   kosten 68/87/106 Treibstoff (4/8/12 h) ≈ 120–190 Stahl-Gw. (0,16–0,24 h Produktion an Tag 14) und überstreichen
   79–175 Tsd. km². Aufklärung soll alltäglich sein; der Preis ist der gebundene Missionsplatz und das Risiko.
   Drohnen sehen am meisten (2 Drohnen 4 h: 606 Tsd. km² für 65 Stahl-Gw.), sterben aber in fremder Radarreichweite:
   bei 3 Jägern gehen ⌀ 0,9 von 2 Drohnen verloren (beide in 20 %), ab 5 Jägern ⌀ 1,5 (beide in 57 %) – 476 Stahl-Gw.
   je Drohne. Das ist das Gegenmittel gegen Dauerüberwachung; Schiffe bleiben in Stufe 2 unbehelligt (Regelwerk).
   Abgefangen wird einmal je Hafen und Patrouille (sonst würde der Prüftakt die Chance vervielfachen).
2. **Kampagne** (`intel.campaign`): bis 4 Ziele, Erkennung 150 km um die Position. 4 Nester mit 1 Korvette: 70 statt
   160 Treibstoff (56 % gespart) und 1 statt 4 Missionsplätzen. Gegen die Beute eines Nests 3 (≈ 15 300 Stahl-Gw.) ist
   eine Kampagne (≈ 130) vernachlässigbar – gewollt, damit Lagebild kein Engpass vor jedem Überfall ist.
3. **Radarposten** (`intel.post`): Bau 4 500 Stahl-Gw. (7,3 h Produktion an Tag 7, 4 h an Tag 28), Betrieb 130/Tag,
   Abbau gibt 2 250 zurück. Eine Woche Betrieb mit Abbau kostet ≈ 3 160 Stahl-Gw. ≈ 0,2 Nest-3-Beuten; dafür 196 Tsd.
   km² Dauersicht (Radarstation 3: 229 Tsd. km² um den eigenen Hafen) an einer selbst gewählten Küste. Werte wie
   freigegeben. Ohne Treibstoff fällt der Posten erst aus, wenn der Hafen leer ist (die Grundrate liefert sonst schon
   genug) – Strafe für völlige Leere, nicht für knappe Bestände.
4. **Sonar** (`intel.sonar`): 60 km + 40 km je Stufe der vorhandenen Forschung „sonar“ (Stufe 2: 140 km) für
   Korvetten und Zerstörer im Hafen, auf Patrouille und unterwegs; U-Boote auf Patrouille 60 km.
5. **Bordsicht** (`intel.fleetSight`, Auftrag des Nutzers): jeder Verband auf See sieht um seine Position, beste
   Einheit zählt: Kriegsschiff 80 km, Transporter 40 km, Drohne 200 km (Erkennung), Flugzeuge 120 km nur Sichtung von
   Verbänden. Ein Überfall auf ein Ziel 500 km entfernt deckt nebenbei einen Streifen von 160 Tsd. km² auf (Kriegsschiff,
   hin und zurück) – mehr als eine 4-h-Patrouille (79 Tsd. km²), aber nicht dort, wo man hinschauen will. Patrouillen
   behalten die größeren Werte (100/200 km) und sind das Werkzeug für gezielte Aufklärung. Gespeichert wird beim
   Kartenabruf (höchstens alle 60 s je Partei), nicht im Takt der Verbände.
6. **KI-Spieler:** Ohne Aufklärung griff die Festung im Nebel nie an (8-Tage-Lauf, 4 Läufe: 0 Überfälle, 0 Nester
   aufgeklärt; ohne Nebel ebenfalls 0, ihr Probekampf verlangt 100 % Siegquote). Neu: Festung Kampagnen gegen Nester
   (alle 6 h, Felder alle 12 h), Händler einmal am Tag gegen Felder, Freibeuter laufend Kampagnen und alle 12 h eine
   Patrouille (2 Korvetten) über unbekannte Nester. Ergebnis (je 4–6 Läufe): Festung 3–12 Nester aufgeklärt, 0–2
   Überfälle (gewonnen), 0–1 Feld; Händler 2–8 Felder aufgeklärt, 0–2 Felder; Freibeuter 2–9 Überfälle (alle gewonnen),
   4–12 Aufklärungen, 6 Patrouillen je Lauf. Der Bot-Testlauf prüft jetzt das Verhalten (Freibeuter gewinnt Überfälle,
   Festung und Freibeuter klären auf, Bots befassen sich mit Feldern) statt „hält ein Feld“ (Kampfglück).

## Q. Lagebild Stufe 3: Satelliten, Tarnnetze, Störsender (Balance v1.23)

Regeln: `docs/REGELN-LAGEBILD.md` 5.6, 6 und 11 (Punkt 3: Satellit fair bemessen, vor Stufe 3 gegen den Wert des
Wissens prüfen). Zahlen aus `npm run sim` (Abschnitt „Lagebild Stufe 3“, `sim/satellite.ts`), Richtwert der Börse in
Stahl-Gegenwert, Produktion des Militär-Bots (45 % Rüstung) Tag 28 ≈ 1 130/h, Tag 35 ≈ 1 170/h.

1. **Preis gegen Produktion** (Ziel 2–3 h Produktion je Tag Laufzeit): optischer Satellit 5 000 / 2 000 / 3 500
   = 19 100 Stahl-Gw. = 16,3 h Produktion an Tag 35 = **2,33 h je Tag** (Tag 28: 2,42 h); Radarsatellit 6 000 / 2 500 /
   4 500 = 24 000 = 20,5 h = **2,92 h je Tag** (Tag 28: 3,04 h). Beide liegen im Zielband; die Werte aus Abschnitt 11
   bleiben. Startrampe Stufe 1: 3 000 / 1 000 / 1 000 (≈ 7 800); jede weitere Stufe −4 % auf den Start (höchstens −20 %),
   damit der Ausbau der Rampe überhaupt etwas bringt.
2. **Wert des Wissens bei Nest-Überfällen** (Bot-Verband des Tages, eine Woche, Nester ≤ 1 000 km um Brest, Kiel,
   Halifax, Neapel und Reykjavík, echtes Wetter, Nebel an, 30 Läufe je Hafen; andere Spieler leeren Nester zufällig,
   0,5 je Nest und Tag). Wissen: (a) nur Radar 6 und eigene Kampfberichte, (b) dazu täglich eine Kampagne (4 Ziele),
   (c) dazu ein optischer Satellit.
   | Tag | Wissen | Angriffe | Siege | Niederlagen | Leerfahrten | Netto/Woche |
   |---|---|---|---|---|---|---|
   | 35 | nur Radar | 10,7 | 9,1 | 0 | 1,6 | 81 971 |
   | 35 | + Kampagne | 9,1 | 7,9 | 0 | 1,2 | 85 241 |
   | 35 | + optischer Satellit | 9,6 | 8,2 | 0 | 1,4 | 83 213 |
   | 28 | nur Radar | 12,7 | 11,2 | 0 | 1,5 | 72 441 |
   | 28 | + Kampagne | 9,1 | 7,9 | 0 | 1,2 | 80 089 |
   | 28 | + optischer Satellit | 10,5 | 9,1 | 0 | 1,4 | 73 145 |
   Der Satellit bringt bei Nestern nur **+0,7–1,2 Tsd. Netto je Woche** (≈ 1 h Produktion, 4–7 % seines Preises):
   Nest-Stufen sind feste Weltdaten, der eigene Kampfbericht deckt sie ohnehin auf, und der Verband ab Tag 28 gewinnt
   Stufe 1–5 sicher (Niederlagen 0). Sein Nutzen ist das Leer-Risiko (−0,2 Leerfahrten je Woche) und vor allem das,
   was die Simulation nicht misst: Schutzstatus und Verbände fremder Spieler kartenweit (Kampf um Häfen und Felder),
   der Radarsatellit nur für Verbände. Eine tägliche Kampagne liefert das Nest-Wissen günstiger (≈ 1,6 Tsd. Treibstoff-
   Gw. je Woche). **Entscheidung:** Preise nicht senken – billiger würde der Satellit für Nester trotzdem nicht lohnen
   (dafür müsste er ~90 % billiger sein), aber Spielerkriege im Spätspiel entwerten (Rundumsicht für ein paar Stunden
   Produktion). Er bleibt ein Spätspiel-Werkzeug für den Kampf um Spielerziele; im Handbuch steht, dass Kampagnen für
   Nester reichen.
3. **Bahn** (600 km Streifen, alle 6 h, 1 400 km nach Westen; Kartenbreite 9 190 km): Nach einem Tag sind ~26 % der
   Karte einmal erfasst, nach 3 Tagen ~79 %, nach 5 Tagen ~97 % – nicht „nach etwa einem Tag“ wie in 5.6 geschätzt.
   Die Zahlen aus 5.6 bleiben (Auftrag); die Wanderung um 1 400 km verteilt die Streifen gleichmäßig. 27 Überflüge
   in 7 Tagen (der 28. fiele auf das Ende der Lebensdauer).
4. **Wolken:** Bewölkung über 0,6 trifft im Mittel **49 %** der Felder (Stichprobe: 40 Zeitpunkte im Herbst, jedes
   vierte Feld; See und Küste 48 %) – ein optischer Überflug sieht also etwa die Hälfte seines Streifens. Der Radarsatellit sieht durch, liefert aber
   nur Sichtungen (Verbände, Wracks, Posten); Häfen, Nester und Felder schreibt er nicht ins Wissen, damit eine Sichtung
   kein älteres Erkennen überschreibt.
5. **Gegenmittel** (Block `intel.counter`): Tarnnetze 2 Stufen im Zweig Heer (900 / 200 / 500 / 300, Forschungsamt 4,
   nach Pioniertechnik), Störsender 600 / 200 / 900 je Stufe (Faktor 1,5), 10 Strom je Stufe (Rang 1 wie das Radar; bei
   Strommangel aus), voll ab Stufe 2. Tarnanstrich −20 % je Stufe auf die Sichtweite fremder Sensoren für reine
   Flugverbände; Admiral mit Aufklärung halbiert fremdes Radar (Häfen, Posten, Radarsatellit) auf seinen Verband.
6. **KI-Spieler:** Freibeuter und Festung bauen die Startrampe (Stufe 1), sobald die Voraussetzungen stehen, forschen
   Raumfahrt am Ende ihrer Reihenfolge (Festung auch Tarnnetze) und starten einen Satelliten, wenn mindestens 4 Nester
   in 1 500 km ohne Lagebild sind und danach noch einmal die Startkosten im Lager liegen (höchstens alle 6 h). Die
   Festung baut den Störsender bis Stufe 2. Im 8-Tage-Lauf erreicht kein Bot die Startrampe (Tag 28–35); mit
   `BOT_SIM_SPACE=1` (Startrampe, Raumfahrt und 20 000 je Ressource ab Tag 0) starten Freibeuter und Festung in jedem
   Lauf je einen Satelliten (4 Läufe). Dabei fiel ein Fehler im Nest-Überfall auf: Mit viel Wissen standen oben
   viele zu starke Nester, die Liste endete nach 12 Einträgen – jetzt Probekampf je Stufe einmal, bis zu 6 Startversuche.

Fortsetzung (Prüfbericht 0.22: Einstieg, Stabilität, Wertung v1.24, Bots, Oberfläche, Seewege) in `ENTSCHEIDUNGEN-4.md`.
