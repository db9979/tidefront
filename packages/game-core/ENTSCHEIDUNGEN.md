# game-core – Entscheidungen und offene Punkte (ohne Börse)

Verbindlich bleibt `docs/REGELN.md`. Hier steht nur, wo die Spezifikation eine Lücke lässt und wie der Code sie füllt.
Die Börse hat ihre eigene Liste in `src/market/ENTSCHEIDUNGEN.md`.

## Übersicht (aufgeteilt, je Datei unter 500 Zeilen)

- A. Auslegungen, die das Spielgefühl berühren (bitte gegenlesen) → `ENTSCHEIDUNGEN.md`
- B. Technische Festlegungen → `ENTSCHEIDUNGEN.md`
- C. Auffälligkeiten und Balance (Stand v1.2) → `ENTSCHEIDUNGEN.md`
- D. Modifikatoren und Forschung (v1.3) → `ENTSCHEIDUNGEN.md`
- E. Kriegsglück und Veteranen (v1.4) → `ENTSCHEIDUNGEN.md`
- F. Wetter und Strom (v1.6) → `ENTSCHEIDUNGEN-2.md`
- G. Spionage, Kriegsglück und Kartell gegen Forschung (v1.7) → `ENTSCHEIDUNGEN-2.md`
- H. Admirale (Welle 2, Block `admirals`, ab v1.8) → `ENTSCHEIDUNGEN-2.md`
- I. Minen, Seeblockade und Konvois (Welle 2, Balance-Blöcke `mines`, `blockade`, `convoys`) → `ENTSCHEIDUNGEN-2.md`
- J. Rohstofffelder (Welle 3 „Expansion“, Teil 1, Balance-Block `fields`) → `ENTSCHEIDUNGEN-2.md`
- K. Mehrere Häfen: Gründung und Verlegung (Welle 3 „Expansion“, Teil 2, Block `expansion`, v1.11) → `ENTSCHEIDUNGEN-2.md`
- L. Offene Balance-Fragen per Simulation entschieden (Balance v1.13) → `ENTSCHEIDUNGEN-3.md`
- M. KI-Spieler (Bots, Balance-Block `bots`) → `ENTSCHEIDUNGEN-3.md`
- N. Nest Stufe 6 als Spätspiel-Ziel (Balance v1.15) → `ENTSCHEIDUNGEN-3.md`
- O. Ökostrom, Elektrolyse, Seekabel (Balance v1.21) → `ENTSCHEIDUNGEN-3.md`

## A. Auslegungen, die das Spielgefühl berühren (bitte gegenlesen)

1. **Bodenkampf: `land` gegen Truppen, `anlage` gegen die Bunkerlinie** (seit Stand 2, in REGELN.md übernommen).
   Damit haben die `anlage`-Werte der Bodentruppen eine Funktion, `pioniere.bonus.bunkerlinie` wirkt auf `anlage`.
   `pioniere.bonus.minensperre` bleibt ungenutzt: Minensperren sind im Bodenkampf kein Ziel; Pioniere halbieren ihren
   Schaden ohnehin.
2. **Seegefecht: Küstenbatterien sind Teilnehmer, also auch Ziel.** Schiffe treffen Schiffe mit `see` und
   Küstenbatterien mit `anlage`. REGELN sagt nur „feuern mit“; ohne diese Auslegung wären die `anlage`-Werte der
   Schiffe ohne Funktion und Batterien nur durch Bomber zerstörbar. Teilnehmer sind alle Anlagen mit `attack.see > 0`.
3. **Bodenkampf-Teilnehmer des Verteidigers: Bodentruppen und Bunkerlinie als Ziele; Küstenbatterien feuern mit
   `land` mit** (seit Stand 2, in REGELN.md übernommen), sind aber kein Ziel und zählen nicht für den Sieg.
4. **Luftschlag gilt für beide Seiten.** Auch Bomber des Verteidigers greifen an (die Schiffe des Angreifers), vorher
   schießen dessen Schiffe mit `luft` auf sie. Ablauf je Runde: erst Flugabwehr, Verluste abziehen, dann schlagen die
   überlebenden Bomber beider Seiten gleichzeitig zu. Jäger schießen im Luftschlag nicht auf Bomber; sie wirken nur
   über Bonus und Malus der Luftüberlegenheit.
5. **Flugzeugrollen kommen aus den Werten, nicht aus IDs:** Luft-Einheit mit `see`, `land` oder `anlage` > 0 ist
   Bomber; sonst mit `luft` > 0 Jäger; sonst (Drohne) nimmt sie am Kampf nicht teil und kann nicht verloren gehen.
   `jagdbomber.attack.land` und sein Bonus gegen Kampfpanzer bleiben ungenutzt (Bomber greifen nur Schiffe und Anlagen an).
6. **Minensperren** wirken einmal je Kampf zu Beginn der Landung, ohne Zufallsfaktor, verteilt nach Lebenspunkten auf
   die gelandeten Truppen. Sie werden dabei nicht verbraucht; zerstörbar sind sie nur durch Bomber. Halbierung, sobald
   mindestens ein Pionier im Landungsverband lebt.
7. **Truppen ohne Transportraum gehen immer verloren**, auch wenn gar kein Landungsschiff überlebt (dann alle).
   Bei Überhang wird jeder Truppentyp im selben Verhältnis gekürzt (abgerundet).
8. **Sieg und Beute:** Ohne Landung kein Sieg, ohne Sieg keine Beute. Wer nach `maxRoundsPerPhase` Runden Bodenkampf
   noch Verteidiger vor sich hat, hat verloren. Steht nach der Landung nichts mehr (keine Truppen, keine Bunkerlinie),
   genügt ein überlebender Soldat.
9. **Beuteformel:** `min(Bestand - Bunkerschutz, …)` enthält in REGELN eine Auslassung. Umgesetzt als
   `max(0, Bestand - Bunkerschutz) * maxShareOfUnprotected * Wiederholungsfaktor`, je Ressource abgerundet.
   Wiederholungsfaktor: `repeatFactors[min(n, letzter Index)]`, n = frühere Angriffe im Zeitfenster (der Aufrufer zählt).
   Feste Nestbeute unterliegt dem Wiederholungsfaktor nicht.
10. **Kartell-Überfall:** „eigene Landungskapazität“ heißt hier: Jedes überlebende Schnellboot trägt `raidMiliPerBoot`
    Milizionäre (`troopSpaceBonus`). Die Beute des Kartells folgt der normalen Anteilsformel ohne Ladegrenze
    (`unlimitedCargo`). Zur Verteidigung zählen seit v1.1 Schiffe, Bodentruppen und alle Anlagen daheim, keine
    Flugzeuge und nichts auf Mission. Die Stärke schwankt je Überfall (`raidStrengthSpread`); der Faktor kommt aus
    einem eigenen Seed, den der Aufrufer an `composeRaid` übergibt. Ohne Seed ist der Faktor 1 (Mittelwert).
11. **Flugreichweite:** `planMission` lehnt einen Verband ab (`out_of_range`), wenn ein Flugzeugtyp das Ziel nicht
    erreicht, statt die Flugzeuge still zu Hause zu lassen.
12. **Verteidigungsanlagen bauen** ist in REGELN nicht geregelt (kein `builtIn`). Umgesetzt über `startTraining`:
    keine Gebäudevoraussetzung, keine Beschleunigung, eigener Bauplatz `anlagen`, kein Stopp bei Versorgungsmangel.

13. **U-Boote (seit v1.2): eigene Phase „U-Boot-Angriff“ vor dem Seegefecht.** Die U-Boote beider Seiten feuern
    `torpedoSalvos` Salven (1) mit `see` auf die Überwasserschiffe des Gegners, ohne Gegenwehr. Begründung: Das
    U-Boot lebt vom Überraschungsmoment; eine eigene Phase macht im Kampfbericht sichtbar, woher die ersten Verluste
    kommen. Im Seegefecht schießen U-Boote weiter, sind aber nur Ziel der U-Jagd. Die U-Jagd ist eine zusätzliche
    Salve (Wasserbomben) neben der Salve über Wasser, nicht ein Teil davon: Eine Korvette verliert gegen Schnellboote
    nichts, wenn zugleich ein U-Boot da ist. Sie nutzt denselben Zufallsfaktor wie die Salve über Wasser; ohne U-Boote
    bleibt der Zufallsstrom und damit jeder bisherige Kampf unverändert (`npm run sim` gibt für v1.1-Fälle dieselben Zahlen).
14. **Wer U-Boote treffen kann:** nur Einheiten und Anlagen mit `attack.uboot > 0` (in v1.2 Korvette 40, Zerstörer 60).
    Bomber (auch Jagdbomber), Flak, Küstenbatterien und das Kartell bekommen keine U-Jagd: Die Korvette ist der billige
    Spezialist, der Zerstörer der Allrounder; Flugzeuge und Anlagen bleiben einfach, und das Gegenmittel steht in der
    Werft, die auch das U-Boot baut. Torpedos treffen keine Anlagen (`anlage` 0) und Schnellboote kaum
    (`bonus.schnellboot` 0,5: flach gehende Boote), dafür Landungsschiffe hart (`bonus.landungsschiff` 1,5).
15. **Getaucht ist eine Eigenschaft, keine ID:** `UnitDef.submerged` macht eine See-Einheit zum U-Boot (Kampfrolle
    `sub`). Die Mindeststufe des Baugebäudes ist generisch (`UnitDef.requiresLevel`, Code `building_level`).
16. **Seegefecht ohne mögliche Treffer endet** vor der nächsten Runde (z. B. U-Boote gegen Küstenbatterien), statt
    leere Runden zu zählen; ohne eine einzige Runde gilt es als übersprungen (`no_targets`). Für Kämpfe ohne U-Boote
    ändert das nichts, weil dort jedes Schiff ein Ziel treffen kann.
17. **Kartell und Nester:** keine U-Boote, keine U-Jagd. U-Boote daheim zählen zur Verteidigungsstärke (sie kämpfen
    gegen die Schnellboote mit) und locken wie jedes Schiff größere Überfälle an. Nester der Stufen 3–5 bekommen
    vorerst **keine** U-Jagd: Die Simulation (C4) zeigt, dass U-Boote gegen Nester nicht besser sind als Korvetten und
    Zerstörer (Torpedos treffen keine Küstenbatterien, kaum Schnellboote); keine Neststufe fällt früher.

## B. Technische Festlegungen

- **Bestände sind Gleitkommazahlen**; `settle` rundet nicht. Kosten, Treibstoff, Beute und Wracks sind ganzzahlig.
- **Lagerkapazität und Bunkerschutz** werden nicht gerundet (z. B. 5000 * 1,5^4 = 25312,5).
- **Bestand über der Kapazität** (Beute, Lieferung) bleibt bei nicht negativer Rate unverändert; bei negativer
  Proviant-Rate sinkt er normal.
- **Versorgungsmangel** wird bei jedem `settle` neu bestimmt: Proviant 0 und Netto-Rate negativ.
  Der Faktor 0,8 gilt für Einheiten, nicht für Anlagen.
- **Unterhalt und Stellplätze** zählen auch Einheiten auf Mission (`unitsAway`); Stellplätze zusätzlich Flugzeuge in
  Ausbildung. Jedes Flugzeug, auch die Drohne, belegt einen Platz.
- **Neuer Stützpunkt** (`createBase`): Startbestände, alle Gebäude Stufe 0. Ohne Kraftwerk gibt es nur die Grundrate.
- **Bauschlange:** Liste mit höchstens `building.queueSlots` Einträgen, der erste läuft. `startUpgrade` reiht ein
  (Zielstufe über `plannedLevel`, Start = max(jetzt, Ende des letzten Auftrags)). `maxAllowedLevel` rechnet mit der
  geplanten Stufe der Kommandozentrale. `completeUpgrade` schließt alle fälligen Aufträge der Reihe nach ab und rechnet
  jeweils bis zur Fertigstellung mit den alten und danach mit den neuen Stufen. `cancelUpgrade(base, now, balance, index)`:
  begonnener Auftrag nach Restzeit, wartender voll erstattet; danach wird die Restschlange in Reihenfolge neu geprüft
  (Stufenfolge je Gebäude und Deckel über die simulierte Kommandozentrale). Ungültige Aufträge fallen voll erstattet
  weg – auch über den Wortlaut „dasselbe Gebäude“ hinaus, wenn ein abgebrochener Ausbau der Kommandozentrale den Deckel
  für ein anderes Gebäude senkt. Nachrücker behalten ihre Dauer und beginnen frühestens beim Abbruch.
- **Rückruf:** `recallMission(plan, now)` in `mission.ts` (Codes `already_recalled`, `already_arrived`); setzt
  `recalledAtMs` und `returnAtMs = now + (now − departAtMs)`. Die Rückbuchung macht wie sonst `returnMission`
  mit allen entsandten Einheiten und dem Transportgut als Ladung.
- **Ausbildung:** höchstens ein Auftrag je Baugebäude (Werft, Kaserne, Flugfeld parallel möglich), Dauer =
  Zeit je Einheit mal Anzahl, alle Einheiten erscheinen am Ende gemeinsam. `completeTraining` schließt alle fälligen
  Aufträge ab. Abbruch: `cancelUpgrade` und `cancelTraining` in `resolution.ts`, Erstattung nach Restzeit.
- **Reihenfolge der Ereignisse** (Bau fertig, Ausbildung fertig, Mission, Kampf) muss der Aufrufer zeitlich
  einhalten; `settle` kennt nur den aktuellen Zustand.
- **Mission:** Reisezeit nach dem langsamsten Schiff, auch wenn Flugzeuge mitfliegen. Verband ohne Schiff und ohne
  Flugzeug: `troop_capacity` oder `no_carrier`. `planMission` verschiebt Einheiten nach `unitsAway`; die Rückbuchung
  macht `returnMission`, das Kampfergebnis beim Verteidiger `applyDefenseResult` (beide in `resolution.ts`).
  Verlorene Einheiten zählen bis zur Heimkehr des Verbands noch für Unterhalt und Stellplätze. Transport-Ladung ist durch `cargo` begrenzt.
  Ein optional übergebenes geschütztes Ziel wird für Überfälle abgelehnt (`target_protected`).
- **Nachtschild:** Startstunde in Ortszeit mit festem `tzOffsetMinutes` (keine Sommerzeit-Automatik). „Diese Nacht“ =
  das laufende, sonst das nächste Schildfenster. Jeder geplante `ueberfall` hebt es auf, auch gegen Nester.
  Anfängerschutz endet durch eigene Angriffe nicht.
- **Kampf:** Ein Zufallsfaktor je Seite und Runde (im Luftschlag je Seite für Flugabwehr und für Bomber), Reihenfolge
  der Ziehungen fest. `entscheidend` ist der Typ mit dem höchsten rechnerisch ausgeteilten Schaden beider Seiten
  (`entscheidendSide` nennt die Seite), bei Gleichstand Angreifer vor Verteidiger, dann Reihenfolge der `balance.json`.
  Eine Phase gilt als übersprungen (`skipped`, `skipReason`), wenn kein Schuss fiel bzw. keine Landung stattfand.
  Luftüberlegenheit gibt es auch kampflos, wenn nur eine Seite Jäger hat. Gleichstand: keine.
- **Rückkehrer** je Typ abgerundet. Lazarett des Angreifers zählt alle Bodenverluste (auch ertrunkene), nur bei Sieg.
  Wracks: beide Seiten, Summe abgerundet; NPC-Schiffe haben keine Kosten und hinterlassen nichts.
- **Konstanten aus REGELN statt aus balance.json** (dort fehlen sie): Angriff mal 0,8 bei Versorgungsmangel
  (`SUPPLY_SHORTAGE_ATTACK_FACTOR`), Minen-Halbierung (`PIONEER_MINE_FACTOR`), Hin- und Rückweg mal 2
  (`ROUND_TRIP_FACTOR`), Erdradius 6371 km. Vorschlag: die ersten beiden in `balance.json` aufnehmen.
- `harborMarketUnlocked` und `harborCreditLimit` liegen in `buildings.ts` (Abschnitt Gebäude) und heißen bewusst
  anders als mögliche Funktionen des Börsenkerns.

## C. Auffälligkeiten und Balance (Stand v1.2)

- **`maxBuildSeconds` (432000 s) wird nie erreicht.** Die längste Bauzeit ist Kommandozentrale 19 auf 20 mit
  120 * 1,4^19, rund 71700 s (knapp 20 Stunden). Der Test prüft die Kappung deshalb mit verkleinerter Obergrenze.
- **Früher ohne Regel, seit Stand 2 geregelt und umgesetzt** (`resolution.ts`): Schwachziel (Stärke = Summe der
  Gebäudestufen), Wrack-Verfall (linear, Bergung durch eigene Missionen), Radar-Vorwarnzeit, Abbruch von Bau und
  Ausbildung. Wer den Spielerstützpunkt eines anderen Spielers angreift, wird nach seinem Startstützpunkt gemessen.
- **Restschaden wird seit Stand 2 mitgeführt** (vorher verfiel er je Runde, kleine Verbände waren wirkungslos).
- **Nest-Besatzung** steht in `nestLevels` als flache Schlüssel neben `loot`; der Code ordnet sie über die IDs den
  Einheiten oder Anlagen zu.

### C1. Befund v1 (Stand 2)

Kartell-Überfälle gewannen nur gegen völlig unverteidigte Stützpunkte: 20 Schützen hielten die Mindeststärke
(4 Boote, 24 Miliz) immer auf, weil nur Schiffe und Anlagen die Stärke bestimmten und die Miliz bei 6 je Boot den
Bodenkampf verlor. Nester Stufe 4 und 5 hielt jeder getestete Verband; die Sprünge zwischen den Stufen waren groß.

### C2. Änderungen in v1.1

| Wert | v1 | v1.1 |
| --- | --- | --- |
| `pirates.raidStrengthShareOfDefense` | 0,6 (nur Schiffe und Anlagen) | 0,55 (Schiffe, Bodentruppen, Anlagen) |
| `pirates.raidMiliPerBoot` | 6 | 8 |
| `pirates.raidStrengthSpread` | – | 0,3 (neu) |
| `pirates.raidMinSchnellboote` | 4 | 4 |
| Nest 1: Boote / Miliz / Flak / Batterie / Bunker | 6 / 40 / 0 / 0 / 0 | 4 / 18 / 0 / 0 / 0 |
| Nest 2 | 14 / 90 / 1 / 0 / 0 | 9 / 60 / 1 / 0 / 0 |
| Nest 3 | 26 / 160 / 2 / 1 / 1 | 14 / 110 / 1 / 1 / 1 |
| Nest 4 | 44 / 260 / 3 / 2 / 2 | 22 / 215 / 2 / 1 / 1 |
| Nest 5 | 70 / 400 / 5 / 4 / 3 | 26 / 250 / 3 / 2 / 2 |
| Nestbeute St/Tr/El/Pr Stufe 1 | 3000 / 1200 / 400 / 800 | 2000 / 800 / 300 / 700 |
| Stufe 2 | 6500 / 2600 / 900 / 1600 | 3500 / 1400 / 500 / 1000 |
| Stufe 3 | 12000 / 5000 / 1800 / 3000 | 6500 / 2600 / 1000 / 1900 |
| Stufe 4 | 20000 / 8500 / 3200 / 5000 | 9500 / 3800 / 1500 / 2700 |
| Stufe 5 | 32000 / 14000 / 5500 / 8000 | 14000 / 5600 / 2200 / 4200 |

Regel: Grundstärke in Booten = max(`raidMinSchnellboote`, `raidStrengthShareOfDefense` * Lebenspunkte von Schiffen,
Bodentruppen und Anlagen / 80); Miliz = Grundstärke * Faktor * 8 (gerundet), Boote = Miliz / 8 (aufgerundet); Faktor
gleichverteilt in [0,7; 1,3]. Die Beute bleibt durch den Tiefbunker begrenzt (Anteilsformel unverändert).

Die Nestbeute ist kleiner als in v1, entspricht aber ungefähr der Ladung der Landungsschiffe eines passenden Verbands
(4000 je Schiff); in v1 wurde ein Großteil der Beute durch die Ladegrenze ohnehin gekappt.

### C3. Simulation v1.1 (`npm run sim`, 200 Seeds je Fall)

Kartell (Ressourcen 8000/4000/2000/3000, Bunkerschutz 300; Radar ist im Kampf ohne Wirkung):

| Verteidigung | Ø Boote / Miliz | Sieg Kartell v1 | Sieg Kartell v1.1 |
| --- | --- | --- | --- |
| nichts | 4,4 / 32 | 100 % | 100 % |
| Wache: 20 Schützen | 4,4 / 32 | 0 % | 51 % |
| 30 Schützen | 4,5 / 33 | – | 0 % |
| 2 Korvetten, 30 Schützen | 7,3 / 55 | 0 % | 17 % |
| 40 Schützen, 1 Bunkerlinie | 10,0 / 77 | 0 % | 0 % |
| gut: 60 Schützen, 1 Bunkerlinie, 2 Küstenbatterien, Radar | 18,2 / 142 | – | 0 % |
| 5 Korvetten, 3 Küstenbatterien, 50 Schützen | 22,3 / 175 | 0 % | 4 % |
| stark: 3 Zerstörer, 2 Batterien, 2 Bunkerlinien, 80 Schützen | 34,3 / 271 | 0 % | 0 % |
| sehr stark: dazu 4 Zerstörer, 3 Batterien, 120 Schützen, 4 Panzer | 53,7 / 426 | – | 0 % |
| Bot nach 7 Tagen (ganzer Verband daheim, keine Anlagen) | 51,7 / 410 | – | 7 % |
| Bot nach 28 Tagen | 138,4 / 1104 | – | 13 % |

Wirtschafts-Bot (`sim/bot.ts`): gieriger Ausbau wie bisher, zuerst Kaserne und Werft, 45 % der Ausgaben (zum
Richtwert) in einen Verband nach Doktrin (Wertanteile: Korvetten 22 %, Zerstörer 12 % ab Werft 3, Schützen 30 %,
Pioniere 10 % ab Kaserne 2, Kampfpanzer 8 % ab Kaserne 4, Jagdbomber 18 %), Landungsschiffe nach Truppenbedarf,
nie über die Kommandopunkte und nie mit negativer Proviantbilanz. Der Verband geht geschlossen auf ein Nest in
400 km (Missionsplatz, Transportraum, Reichweite und Kommandopunkte werden mit `validateFleet` geprüft).

| Tag | KZ | KP | Verband |
| --- | --- | --- | --- |
| 1 | 0 | 16/60 | 2 Korvetten, 1 Landungsschiff, 30 Schützen |
| 3 | 1 | 42/90 | 4 Korvetten, 1 Landungsschiff, 80 Schützen, 10 Pioniere, 2 Jagdbomber |
| 7 | 2 | 101/120 | 8 Korvetten, 3 L-Schiffe, 180 Schützen, 25 Pioniere, 3 Jagdbomber, 3 Panzer |
| 14 | 4 | 180/180 | 13 Korvetten, 3 Zerstörer, 4 L-Schiffe, 310 Schützen, 50 Pioniere, 5 Jagdbomber, 4 Panzer |
| 21 | 6 | 240/240 | 17 Korvetten, 4 Zerstörer, 6 L-Schiffe, 420 Schützen, 55 Pioniere, 7 Jagdbomber, 5 Panzer |
| 28 | 7 | 270/270 | 20 Korvetten, 4 Zerstörer, 6 L-Schiffe, 470 Schützen, 70 Pioniere, 8 Jagdbomber, 6 Panzer |

Sieg des Bot-Verbands und Netto-Ertrag (Beute − bleibende Verluste − Treibstoff, Stahl-Äquivalent), * = Zielfenster:

| Tag | Stufe 1 | Stufe 2 | Stufe 3 | Stufe 4 | Stufe 5 |
| --- | --- | --- | --- | --- | --- |
| 1 | 100 % / +4224 * | 0 % | 0 % | 0 % | 0 % |
| 2 | 100 % / +4284 * | 0 % | 0 % | 0 % | 0 % |
| 3 | 100 % / +3981 | 100 % / +1813 * | 0 % | 0 % | 0 % |
| 5 | 100 % | 100 % / +5102 * | 0 % | 0 % | 0 % |
| 7 | 100 % | 100 % | 100 % / +9431 * | 0 % | 0 % |
| 10 | 100 % | 100 % | 100 % / +9523 * | 0 % | 0 % |
| 14 | 100 % | 100 % | 100 % | 100 % / +9833 * | 0 % |
| 18 | 100 % | 100 % | 100 % | 100 % / +12114 * | 36 % |
| 21 | 100 % | 100 % | 100 % | 100 % | 100 % / +17492 * |
| 28 | 100 % | 100 % | 100 % | 100 % | 100 % / +17819 * |

Mit den Nestern aus v1 schlug derselbe Bot Stufe 1 ab Tag 2, Stufe 2 ab Tag 5, Stufe 3 ab Tag 10, Stufe 4 erst ab
Tag 21; Stufe 5 hielt bis Tag 28.
Empfindlichkeit: Bei 30 % Rüstungsanteil verschiebt sich jede Stufe um einen Prüftag nach hinten (1 → Tag 2,
2 → 5, 3 → 10, 4 → 18, 5 → 21), bei 60 % fällt Stufe 2 schon an Tag 2; alle anderen Stufen bleiben im Fenster.
Die Übergänge sind scharf (0 % oder 100 %), weil der Zufall im Kampf nur ±5 % beträgt.

### C4. U-Boote in v1.2 (`npm run sim`, 200 Seeds je Fall)

Werte: Kosten 700 Stahl / 250 Treibstoff / 250 Elektronik (Richtwert 1900, wie ein Zerstörer), 900 s, ab Werft 3,
Unterhalt 3, 6 Kommandopunkte, 250 HP, `see` 80, keine Luftabwehr, 45 km/h, 6 Treibstoff je 100 km,
Bonus Landungsschiff 1,5, Schnellboot 0,5. U-Jagd: Korvette 40, Zerstörer 60. Alle v1.1-Zahlen ohne U-Boote unverändert.

Seegefecht Spieler gegen Spieler (nur Schiffe), Ø Verlust zum Richtwert:

| Angreifer | Verteidiger | Verlust Angreifer | Verlust Verteidiger |
| --- | --- | --- | --- |
| 4 U-Boote (7600) | 6 Landungsschiffe (6660) | 0 | 6660 (alle) |
| 4 U-Boote | 4 Korvetten, 3 Landungsschiffe (6250) | 1900 (1 U-Boot) | 4647 |
| 4 U-Boote | 4 Zerstörer (7800) | 3800 (2 U-Boote) | 3900 |
| 4 U-Boote | 10 Korvetten (7300) | 5700 (3 U-Boote) | 3643 |
| Bot-Flotte Tag 14 (13 Korv., 3 Zerst., 4 L) | 4 U-Boote im Hafen | 1121 | 7600 (alle) |
| 3 Zerstörer, 4 Landungsschiffe | 4 U-Boote im Hafen | 4170 | 1900 |
| Vergleich: 10 Korvetten | 4 Zerstörer | 3300 | 3900 |

Stark gegen ungeschützte Flotten (Landungsschiffe), gleichwertig gegen Zerstörer, klar unterlegen gegen Korvetten
gleichen Werts. Gegen Nester schwächer als Zerstörer: 4 U-Boote, 3 L-Schiffe, 5 Pz, 200 Sch. schlagen Stufe 3 zu 0 %
(mit 4 Zerstörern 51 %); 8 U-Boote, 5 L-Schiffe, 10 Pz, 300 Sch., 50 Pio. schlagen Stufe 4 zu 0 %, weil die
Küstenbatterien weiter auf die Landungsschiffe feuern.

Kartell: 2 U-Boote, 30 Schützen 25 % (2 Korvetten, 30 Schützen 17 %); 4 U-Boote, 40 Schützen 19 %.
Bot-Gegenprobe (Doktrin wie oben, 45 % Rüstung): U-Boote statt Zerstörer → Stufe 1–5 an Tag 1/3/7/14/21 (wie ohne
U-Boote), Kartell gegen den Bot 7 % (Tag 7) / 7 % (Tag 28). Schwere U-Boot-Rüstung (30 % U-Boote statt Zerstörern und
Jagdbombern) → ebenfalls Tag 1/3/7/14/21, Kartell 20 % / 21 %. Alle Neststufen bleiben im Zielfenster.

Verworfen: Bonus des U-Boots gegen Zerstörer (1,2) und Zerstörer-U-Jagd 30 – dann verloren 4 Zerstörer gegen
4 U-Boote 5850 bei 1900 eigenem Verlust. Ohne Malus gegen Schnellboote waren U-Boote daheim ein unverwundbarer
Kartell-Konter (2 U-Boote, 30 Schützen: 0 %).

### C5. Offene Punkte

- **Seed für die Überfallstärke (erledigt):** Der Server zieht beim Auslaufen einen eigenen Seed, unabhängig vom
  Kampf-Seed, und gibt ihn mit (`packages/engine/src/handlers.ts`, `raidLaunch`:
  `composeRaid(state.units, state.defenses, balance, randomSeed(), mods)`). Die Stärke-Schwankung wirkt damit wie in
  der Simulation; ohne Seed wäre der Faktor 1 gewesen und das Kartell hätte gegen die Wache (20 Schützen, immer
  32 Miliz) zu rund 80 % statt 51 % gesiegt.
- ~~**Bunkerlinie:** Die Miliz (`anlage` 1) kann eine Bunkerlinie praktisch nicht zerstören.~~ **Erledigt (v1.13,
  L1):** Miliz `anlage` 1 → 5; eine Bunkerlinie bleibt starker Schutz, hält aber nicht mehr jeden Überfall auf.
- ~~**Flotte daheim lockt größere Überfälle an.**~~ **Erledigt (v1.13, L2):** Schiffe zählen in der Überfallstärke
  halb, Transporter gar nicht (`pirates.raidHpWeights`); Kartell gegen den Bot-Hafen 11–14 % → 0 %.
- Der Bot schickt den ganzen Verband und rechnet keine Verluste aus früheren Überfällen oder Kartell-Angriffen ein.
  Weitere Landungsschiffe für mehr Ladung baut er nicht; ab Stufe 2 lohnt ein zweites Schiff für die volle Beute.
- **U-Boote (v1.2):** ~~Ob Nester der Stufen 3–5 oder das Kartell später U-Jagd bekommen.~~ **Entschieden (v1.13,
  L5):** keine U-Jagd für Kartell und Nester (Mechanik bleibt vorhanden: jede NPC-Einheit oder Anlage mit
  `attack.uboot`). Aufklärung zeigt U-Boote wie jede andere Einheit; ein „getarntes“ Lagebild gibt es nicht.

## D. Modifikatoren und Forschung (v1.3)

1. **Modifikatoren sind Faktoren mit neutraler Vorgabe 1** (`src/modifiers.ts`). Jede betroffene Kernfunktion nimmt
   optional `mods` als letzten Parameter (`resolveBattle` über `attacker.modifiers` und `defender.modifiers`). Ohne
   Modifikatoren rechnet alles bit-gleich wie v1.2: überall wird mit `x * 1` multipliziert, an den bisherigen Stellen der
   Rechnung; im Kampf wird ohne Modifikatoren dieselbe Werte-Tabelle benutzt. Bestehende Tests und alle v1.2-Zahlen von
   `npm run sim` sind unverändert.
2. **Kombination multiplikativ** je Schlüssel (`combineModifiers`), auch zwischen zwei Techniken auf denselben Wert.
   Innerhalb einer Technik additiv (1 + Wirkung × Stufe). Begründung: Quellen sind unabhängig (Forschung, Wetter,
   Admiral); ein Produkt ist reihenfolgeunabhängig und lässt neutrale Quellen (1) folgenlos.
3. **Kampf je Seite:** Für jede Seite eine eigene Werte-Tabelle (`withModifiers`): Lebenspunkte × `hp[Gattung]`, jeder
   Angriffswert × `attack[Gattung]` × `attackVs[Wert]` × `attackUnit[Typ]`, Ladung × `cargo`. Gattung der Anlagen ist
   `anlage`. Minenschaden × `mineDamage` des Angreifers, Beute-Anteil × `loot` des Angreifers (feste Nestbeute nicht).
   Der Bunkerschutz des Verteidigers steckt in `protectedPerResource` (`defenderFromBase(base, balance, mods)`).
   Die Stärke des Kartells richtet sich weiter nach den unmodifizierten Lebenspunkten der Verteidigung.
4. **Tarnung** (`stealth`) ist eine Eigenschaft des Angreifers: `planMission` speichert sie als `Mission.warningFactor`,
   der Server multipliziert damit die Vorwarnzeit des Ziels (Ansicht, Börsensperre, Vorwarn-Ereignis).
5. **Forschung liegt im `BaseState`** (`research: { levels, order, lastRoll, halfNext }`) statt in eigenen Tabellen:
   Kosten werden aus den Beständen desselben gesperrten Stützpunkts bezahlt, der Abschluss läuft wie Bau und Ausbildung
   über ein Ereignis mit `baseId`, das Saisonende löscht ihn mit dem Stützpunkt, und es braucht keine Migration. Ein
   Spieler hat genau einen Stützpunkt; `modifiersFor(playerId)` liest dort.
6. **Abschluss:** `completeResearch` schreibt nur bis zur Fertigstellung fort (`resUpdatedAt` = Fertigstellung), weil sich
   danach die Modifikatoren ändern; der Aufrufer rechnet sie neu. Ebenso schreibt `chooseBreakthrough` vor der Wahl mit
   den alten Modifikatoren fort.
7. **Durchbruch:** Seed beim Start (Server: Zufalls-Seed, Kern: `seed`-Parameter, Vorgabe Startzeit), Chance beim Start
   festgehalten und angezeigt (`order.chance`), Wurf `randomInt(mulberry32(seed), 1, 100)` beim Abschluss. Durchbruch auf
   Höchststufe wählt automatisch die halbe Dauer. Bis zur Wahl ist keine neue Forschung möglich (`breakthrough_pending`),
   damit die Belohnung „halbe Dauer“ eindeutig der nächsten Forschung gilt. Ein Abbruch gibt die eingelöste halbe Dauer
   zurück. Chance literal nach Regel: 10 % + 2 Punkte je Stufe (Stufe 1: 12 %, ab Stufe 8: 25 %).
8. **Forschungsamt** ist ein eigenes Gebäude (statt der Chipfabrik), damit Forschung eine bewusste Investition ist und die
   Produktion nicht verdrängt. Es verbraucht keinen Strom und zählt wie jedes Gebäude zur Wertung (Ausbau). Die Bots der
   Simulation bauen es nicht (fester Bauplan), daher bleiben die v1.2-Zahlen gleich.

### D1. Simulation v1.3 (`npm run sim`, 200 Seeds je Fall)

Voll erforscht (alle 20 Techniken auf Höchststufe): kein Bereich über ±24 % (Tempo See/Luft, LP Anlagen, Torpedos,
Jagdbomber, Stahl, Treibstoff, Ladung, Bauzeit, Bunker, Radar, Minen), LP Schiffe +18 %, Bodentruppen Angriff +10 %
und LP +15 %. Kampfkraft (Angriff × LP) damit meist bis etwa +27 %; Ausnahme U-Boote: Torpedos +24 % und LP +18 %
ergibt rund ×1,46 gegen Überwasserschiffe (Gegenmittel Sonar +20 % U-Jagd). Bei Spielerfahrung beobachten.

- Knappe Kämpfe kippen schon bei kleinen Vorteilen, weil der Zufall nur ±5 % streut (z. B. 4 Zerstörer gegen Nest 3:
  51 % → 100 %). Aussagekräftiger ist die nötige Verbandsgröße für ≥ 70 % Sieg: voll erforscht spart der Angreifer
  0–18 % des Verbands (Nest 5, Tag 28: ×0,85 → ×0,70; Bot-Hafen Tag 28: ×1,70 → ×1,50), ein voll erforschter
  Verteidiger verlangt 12–14 % mehr (×1,70 → ×1,90). Erforschen beide Seiten, bleibt es beim Ausgangswert.
  Forschung ist damit so viel wert wie ein etwa 10–20 % größerer Verband – spürbar, aber nicht spielentscheidend.
- Kartell gegen den Bot-Hafen: 7 % / 13 % Sieg (Tag 7 / 28) ohne, 0 % mit voller Forschung des Verteidigers. Das Kartell
  bemisst seine Stärke an den unmodifizierten Lebenspunkten; das ist gewollt (Forschung schützt), aber zu beobachten.
- Wirtschaft Tag 28: Stahl 442 → 543/h, Reise zum Nest 600 → 484 min, Treibstoff 2016 → 1533.
- Alles erforschen kostet etwa 65.300 Stahl, 19.000 Treibstoff, 37.300 Elektronik, 4.200 Proviant und 9,5 Tage reine
  Forschungszeit bei Forschungsamt Stufe 5 (ohne Durchbrüche). In einer Saison von 28 Tagen ist das erreichbar, aber
  nur mit spürbarem Verzicht auf Ausbau und Truppen.

### D2. Offene Punkte

- Wetter, Admirale und Weltereignisse melden sich mit `registerModifierSource` im Server an (`packages/engine/src/modifiers.ts`).
- ~~Ob die Kartell-Stärke Forschung des Verteidigers berücksichtigen soll (D1).~~ **Erledigt (v1.7, G3; Server seit
  dem Merge 4a22249, L6):** Anteil `raidResearchWeight` 0,5, `raidLaunch` übergibt die Modifikatoren.
- Erledigt: Die Admin-Statistik rechnet die Produktion mit allen Modifikatoren wie im Hafen (`modsOf`: Forschung,
  Sabotage, Strom, Wetter, Ereignisse).

## E. Kriegsglück und Veteranen (v1.4)

1. **Kriegsglück** (`src/luck.ts`, `combat.luck = { die: 20, min: 0.8, max: 1.2, innerMin: 0.85, innerMax: 1.15 }`): ein W20
   je Phase und Seite als Faktor auf allen Schaden der Seite in der Phase (auch Minen). 1 → 0,8, 20 → 1,2, 2…19 linear
   0,85…1,15. **Mittelwert exakt 1**: Die Augen k und 21 − k ergeben zusammen 2 (min + max = 2, innerMin + innerMax = 2),
   die Summe aller 20 Faktoren ist 20 (Test `luck.test.ts`, Ausgabe in `npm run sim`).
2. **Eigener Würfelstrom** `mulberry32(seed XOR 0x4C55434B)`: Der Rundenzufall (`randomSpread`) zieht weiter aus
   `mulberry32(seed)` in derselben Reihenfolge wie v1.3. Gewürfelt wird für alle fünf Phasen, auch entfallene – so hängt
   der Wurf einer Phase nur vom Seed ab, nicht vom Verlauf. Ohne `combat.luck` (alte Balance) rechnet der Kern bit-gleich
   wie v1.3 und schreibt keine Würfe; Tests, die Schaden exakt nachrechnen, nutzen `loadBalanceNoLuck()`.
3. **Bericht:** `PhaseReport.luck = { attacker, defender }` (optional). Alte Berichte ohne Würfe bleiben lesbar
   (Oberfläche zeigt dann keine Würfel, die Kampfbilanz zählt sie nicht zum Würfelglück).
4. **Veteranen** liegen wie die Forschung im `BaseState` (`veterancy: { [unitId]: xp }`, keine Migration, Saisonende
   löscht sie mit dem Stützpunkt). Erfahrung ist ein Durchschnitt je Typ; Gewinn, Verlust und Verwässerung sind
   gewichtete Mittelwerte über den ganzen Bestand des Typs (daheim + unterwegs). Kernfunktionen rein in `src/veterans.ts`:
   `veteranRank`, `veteranModifiers`, `diluteXp` (in `completeTraining`), `nextXp`, `battleVeterancy`,
   `applyDefenseResult` (Verteidiger sofort) und `applyAttackExperience` (Angreifer bei der Rückkehr; der Server liest dazu
   den Kampfbericht der Mission – so bleibt die Sperrreihenfolge der Stützpunkte beim Kampf unverändert).
5. **Wirkung** über das Modifikator-System: `attackUnit[Typ] = 1 + Rangbonus` als eigene Quelle „Veteranen“ in
   `packages/engine/src/modifiers.ts` (eingebaut neben „Forschung“; weitere Quellen mit `registerModifierSource(fn, id,
   label)`). `modifierBreakdown` liefert die Quellen getrennt für die Info-Blätter (`base.get.modifierSources`).
   Weltereignis-Kämpfe (Angriff auf Ereignisse, Großflotte gegen Häfen) rechnen seit v1.4 ebenfalls mit den
   Modifikatoren des Spielers.
6. Werte v1.4: Ränge 15/40/80 Erfahrung für +5/+10/+15 % Angriff, `xpWin` 10, `xpLoss` 4, Stärkefaktor 0,5–2,
   `lossPenalty` 0,5, höchstens 100. Ein voll eingesetzter Verband wird nach 2 ebenbürtigen Siegen „Erprobt“, nach
   etwa 4 „Veteran“ (gegen doppelt Starke doppelt so schnell); wer viel nachbaut, verwässert.

### E1. Simulation v1.4 (`npm run sim`)

Kriegsglück gegen Überlegenheit (400 Seeds; Feuerkraft = Faktor auf alle Angriffswerte, bezogen auf den Punkt, an dem
der Angreifer 50 % gewinnt; links ohne Würfel wie v1.3, rechts mit):

| Gefecht | ×1,08 | ×1,15 | ×1,30 | ×1,50 |
|---|---|---|---|---|
| Seegefecht 10 Korvetten gegen 4 Zerstörer | 90 → 64 % | 100 → 73 % | 100 → 91 % | 100 → 99 % |
| Landung 3 L, 5 Pz, 200 Sch. gegen 150 Sch., Bunker | 100 → 69 % | 100 → 85 % | 100 → 100 % | 100 → 100 % |
| Nest 3 mit 4 Zerst., 3 L, 5 Pz, 200 Sch. | 89 → 71 % | 100 → 85 % | 100 → 97 % | 100 → 100 % |
| Nest 5 mit 8 Zerst., 4 Jagdb., 5 L, 10 Pz, 300 Sch., 50 Pio. | 100 → 71 % | 100 → 87 % | 100 → 99 % | 100 → 100 % |

- Klar überlegen (×1,5) gewinnt weiter 99–100 % (Ziel ≥ 95 %). Knapp überlegen: Ziel 60–75 % wird bei ×1,08 erreicht
  (64–71 %); bei ×1,15 sind es 73–87 %. Mehr Streuung ginge nur mit Würfen über ±20 % hinaus (Probe mit 2…19 =
  ±18 %: nur 2–5 Punkte weniger). Bewusst so belassen: Vorher entschied schon ein Vorteil von 8 % fast sicher.
- Vorher/nachher übrige Fälle (200 Seeds): Nest-Fahrplan unverändert (erster Prüftag ≥ 70 %: Stufe 1 Tag 1, 2 Tag 3,
  3 Tag 7, 4 Tag 14, 5 Tag 21 – alle im Zielfenster); knappe Prüftage streuen jetzt (Stufe 2 Tag 3: 100 → 79 %,
  Stufe 3 Tag 7: 100 → 85 %, Stufe 4 Tag 14: 100 → 97 %, Stufe 5 Tag 18: 36 → 55 %, Tag 21: 100 → 99 %).
  Rüstungsanteil 30 %: Stufe 3 erst Tag 14 statt 10 (Bot knapp unter 70 %).
- Kartell (Richtwerte C3): Wache 20 Schützen 51 → 50 %, 30 Schützen 0 → 2 %, 2 Korvetten + 30 Sch. 17 → 11 %, 5 Korvetten +
  3 Batterien 4 → 7 %, starke Verteidigungen weiter 0 %. Gegen den Bot-Hafen Tag 7 / 28: 7 → 12 % / 13 → 13 %.
- Feste Nest-Verbände: 4 Zerstörer gegen Nest 3 51 → 37 %, großer Verband gegen Nest 4/5 100 → 97 % / 6 → 41 %.
- Nötige Verbandsgröße für ≥ 70 % gegen den Bot-Hafen steigt leicht (Tag 28: ×1,70 → ×1,85), weil Glück auch dem
  Verteidiger hilft; Forschung bleibt etwa 10–20 % Verband wert.

### E2. Offene Punkte

- ~~Ob ±15 % (innen) für „knapp überlegen = 60–75 %“ zu zahm ist.~~ **Entschieden (G2, v1.13 L3):** ±15 % bleibt
  (5 / 10 / 20 % Überlegenheit: 62–71 / 75–78 / 89–94 %).
- ~~Veteranen-Werte (Schwellen, Gewinn) sind geschätzt.~~ **Geprüft (v1.13, L4):** Schwellen 15/40/80 und Gewinn 10/4
  bleiben. Die Admin-Statistik zeigt die Ränge ebenfalls (Einheiten je Rang über alle Häfen, daheim und unterwegs, und
  je Typ mit Ø Erfahrung; `veteranStats` in `engine/adminstats.ts`).
- Probekampf und freier Simulator rechnen mit den eigenen Modifikatoren (Forschung, Veteranen), das Ziel ohne
  (Forschung und Erfahrung des Gegners zeigt die Aufklärung nicht).
