# game-core – Entscheidungen und offene Punkte (ohne Börse)

Verbindlich bleibt `docs/REGELN.md`. Hier steht nur, wo die Spezifikation eine Lücke lässt und wie der Code sie füllt.
Die Börse hat ihre eigene Liste in `src/market/ENTSCHEIDUNGEN.md`.

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

- **Seed für die Überfallstärke:** Der Server (`packages/engine`, `raidLaunch`) ruft `composeRaid` noch ohne Seed
  auf. Dann ist der Faktor 1, und die Wache (20 Schützen) trifft immer auf 32 Miliz: Das Kartell siegt dort zu
  rund 80 % statt 51 %. Der Server sollte beim Auslaufen einen eigenen Seed ziehen und mitgeben.
- **Bunkerlinie:** Die Miliz (`anlage` 1) kann eine Bunkerlinie praktisch nicht zerstören. Eine einzelne Bunkerlinie
  hält deshalb jeden Kartell-Überfall auf, solange sie steht. Gewollt als harter Konter; falls zu billig, Miliz
  `anlage` anheben oder Bunkerlinien in der Stärke stärker gewichten.
- **Flotte daheim lockt größere Überfälle an:** Schiffe zählen zur Stärke, kämpfen aber nicht am Boden. Ein
  Stützpunkt mit vielen Schiffen und wenig Bodentruppen verliert häufiger (Bot nach 28 Tagen 13 %).
- Der Bot schickt den ganzen Verband und rechnet keine Verluste aus früheren Überfällen oder Kartell-Angriffen ein.
  Weitere Landungsschiffe für mehr Ladung baut er nicht; ab Stufe 2 lohnt ein zweites Schiff für die volle Beute.
- **U-Boote (v1.2):** Ob Nester der Stufen 3–5 oder das Kartell später U-Jagd bekommen, nach Spielerfahrung
  entscheiden (Mechanik vorhanden: jede NPC-Einheit oder Anlage mit `attack.uboot`). Aufklärung zeigt U-Boote wie jede
  andere Einheit; ein „getarntes“ Lagebild gibt es nicht.

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
- Ob die Kartell-Stärke Forschung des Verteidigers berücksichtigen soll (D1), nach Spielerfahrung entscheiden.
- Die Admin-Statistik rechnet Produktion ohne Modifikatoren.

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

- Ob ±15 % (innen) für „knapp überlegen = 60–75 %“ zu zahm ist, nach Spielerfahrung entscheiden (Stellschraube
  `innerMin`/`innerMax`, Mittel bleibt 1, solange beide um 1 symmetrisch sind).
- Veteranen-Werte (Schwellen, Gewinn) sind geschätzt; die Kampfbilanz zeigt die Ränge, Admin-Statistik noch nicht.
- Probekampf und freier Simulator rechnen mit den eigenen Modifikatoren (Forschung, Veteranen), das Ziel ohne
  (Forschung und Erfahrung des Gegners zeigt die Aufklärung nicht).

## F. Wetter und Strom (v1.6)

1. **Wetter ohne gespeicherten Zustand:** `weatherAt(Ort, Zeit, weather)` ist eine reine Funktion (`src/weather.ts`).
   Die Systeme entstehen je Zeitfenster (`systemEveryHours`) mit Seed `hash(weather.seed, Fenster)`; der „Saison-Seed“ ist
   damit implizit: Jede Saison liegt in anderen Zeitfenstern und hat eigenes Wetter, ohne dass Server und Karte einen
   Seed austauschen müssen. Die Karte rechnet dasselbe Feld im Browser (`apps/web/src/map/weather.ts`).
2. **Zwischenspeicher:** je Ort (0,01°) und Minute (höchstens 50 000 Einträge, dann geleert) und je System. Eine Abfrage
   kostet ohne Treffer etwa 1,6 µs; eine Fortschreibung über drei Tage braucht 144 Abfragen.
3. **Lage im Stützpunkt:** `BaseState.site` (Breite, Länge des Felds). Ältere Stände erhalten sie beim Lesen
   (`engine/store.ts`, `withSite`) und beim nächsten Speichern dauerhaft; keine Schemaänderung. Ohne Lage (Tests, Simulation)
   gilt `DEFAULT_SITE` (50° N, 0°). Der Speicher-Ladezustand liegt in `BaseState.powerStored`.
4. **Integration statt Mittelwert:** `settle` integriert stückweise mit konstanten Raten (Schritt 30 min, an der Uhr
   ausgerichtet, Teilung an Ereignissen). Dadurch ist Fortschreiben in Teilen exakt gleich dem in einem Stück (Test), und
   Lager- und Bestandsgrenzen wirken wie bisher je Stück.
5. **Kraftwerk ohne Treibstoff:** Statt eines An-Aus-Flackerns (Treibstoff kommt nach, Kraftwerk springt an, Bestand sofort
   wieder 0) läuft das Kraftwerk bei Bestand 0 mit der Auslastung, bei der die Treibstoff-Rate 0 ist (Bisektion, 24 Schritte).
   Ohne Zufluss liefert es nichts. So bleibt die Rechnung zustandslos und zerlegungsgleich.
6. **Rang 3 und 4 nur bei laufendem Auftrag:** Werft, Kaserne und Flugfeld verbrauchen nur, solange dort eine Ausbildung
   läuft, das Forschungsamt nur während einer Forschung. Anlagenbau (`anlagen`) braucht keinen Strom.
7. **Fertigstellung beim Start (nicht beim Abschluss nachgerechnet):** Das Wetter ist deterministisch, die Prognose also
   bis auf spätere Änderungen am Hafen exakt. Beim Start wird mit dem Auftrag als unbegrenzt laufendem Verbraucher
   vorausgerechnet (`poweredFinishMs`, Horizont 336 h, Mindesttempo 0,25). Vorteile: Der Spieler sieht eine feste Zeit,
   die Ereignisse `training_complete`/`research_complete` werden nie verschoben, Abbruch-Erstattung (Restzeit/Gesamtdauer)
   bleibt unverändert. Nachteil: Wer nach dem Start Strom zubaut, beschleunigt den laufenden Auftrag nicht (wie beim
   Ausbau, dessen Dauer beim Einreihen feststeht). Halbe Dauer nach Durchbruch wirkt vor der Stromprognose.
8. **Radar:** Der Stromanteil wird zum Stand des Stützpunkts (`resUpdatedAt`) bestimmt; die Basis-Ansicht und die
   Sperre `under_attack` rechnen mit dem aktuellen Stand, die Push-Warnung `attack_warning` mit dem Stand bei der Planung
   des Angriffs (Prognose). Nebel ist eine Modifikator-Quelle „Wetter“ (nur mit Radarstation, auf ganze Prozent gerundet),
   damit die Info-Blätter ihn aufschlüsseln.
9. **Reise:** Wetter nur bei Abfahrt, gemittelt über 9 Stützstellen der Route (`MissionInput.weather`, vom Server gesetzt;
   fehlt es, kein Wettereinfluss, so bleiben alte Tests und die Simulation unverändert). Der Faktor steht im Plan
   (`Mission.weather`); Rückweg = Hinweg wie bisher. Flugzeuge werden nicht gebremst; das Startverbot gilt nur ohne Schiffe.
10. **Kampf:** `resolveBattle(…, weather)` als benannter Parameter statt Modifikator, weil Wolken nur den Luftschlag der
    Bomber treffen sollen (über Modifikatoren nicht von Jägern zu trennen). Weltereignis-Kämpfe (Großflotte, Ring,
    Schatzschiff, Hafenangriffe der Großflotte) rechnen ebenfalls mit dem Wetter am Kampfort.
11. **Nebel und Aufklärung:** Rundung statt Spannen, damit gespeicherte Lagebilder (Kampfvorschau) dieselbe Form behalten;
    das Feld `uncertain` kennzeichnet sie.

### F1. Simulation v1.6 (`npm run sim`, Abschnitt „Wetter und Strom“)

- Bot (Kraftwerk bei Strommangel) gegenüber v1.4: Tag 7 und 28 Ausgaben, Gebäudestufen und Kraftwerksstufen gleich
  (±0 %), Treibstoff-Rate −10 bis −14 % durch den Verbrauch der Kraftwerke (9–10 Stufen: 27–30 Treibstoff/h). Nestfahrplan
  unverändert im Zielfenster (Stufe 1–5: Tag 1, 3, 7, 14, 21).
- Stromquelle je Lage (Bot mit 45 % Rüstung, Ausgaben gegenüber Kraftwerk): Windpark + Speicher an der Nordsee −0,3 % /
  −3,1 % (Tag 7/28), Mix Kraftwerk/Wind/Sonne in der Biskaya −2 %, Kraftwerk + Solarfeld im Mittelmeer +2,5 % / +1,4 %.
  Nur Sonne (auch mit Speicher) reicht nachts nicht (−44 % bis −85 %), nur Wind im Mittelmeer ebenso nicht (−40 % bis −58 %):
  Sonne und Wind ergänzen das Kraftwerk, Wind kann es im Norden ersetzen.
- Jahresmittel je Stufe: Windpark Nordsee 44 Strom, Mittelmeer 17; Solarfeld Mittelmeer 35, Nordsee 14 (Kraftwerk 60
  für 3 Treibstoff/h).
- Sturmzuschlag der Schiffe: Nordsee → Norwegen Ø +9 % (39 % der Abfahrten über +10 %), Mittelmeer Ø 0 %; Startverbot
  reiner Luftmissionen Irland 11 %, Nordsee 7 %, Mittelmeer 0 %.

### F2. Offene Punkte

- Kartell-Überfälle mit Wetter am Hafen (Kartell hat keine Flugzeuge, wirkt nur auf die des Verteidigers).
- Fronten (Kalt-/Warmfront) sind auf der Wetterkarte nicht gezeichnet; der Wolkenschirm ist nur nach Osten versetzt.
- Erkannte Angriffe werden mit der aktuellen Vorwarnzeit geprüft: Fällt der Strom des Radars nach der Erkennung aus,
  verschwindet die Anzeige wieder, bis der Angriff in die verkürzte Vorwarnzeit kommt.
- Tagesbefehle zu Wetter und Strom sind nicht ergänzt.

### F3. Wettermodell v1.9 (Gutachten Entwickler und Meteorologe)

- **Modell:** Tiefs ziehen nach Nordost (vLat 0,02–0,08°/h, Entstehung 44–62° N / 62–30° W), Wind im Ring um einen Radius
  und an der Südflanke am stärksten, im Winter × 1, im Sommer × 0,5; Hochs 5–15 km/h, Lebensdauer `highLifeHours` (170 h,
  ± 10 %, neuer optionaler Wert; fehlt er, wie Tiefs). Ein System alle 18 h statt 12 h (gleichzeitig ≈ 4 Tiefs, 3 Hochs;
  T/H-Schilder erst ab Stärke 0,35). Klimawind entschärft, regionale Winde (Mistral, Meltemi, Gibraltar, Bora), Nebel
  jahreszeitlich und nie bei Sturm, Wolkenschirm nach Osten versetzt, Süden nicht mehr fast wolkenlos. Werte in
  `docs/REGELN-WETTER.md` (Klimatabelle). Die Koeffizienten stehen im Code (`climateAt`), nicht in der Balance: Sie sind
  Modellform, keine Stellschrauben; die Regelwirkungen (Sturm, Bremsung, Strafen) bleiben in `weather`.
- **Beaufort** einheitlich `round(Wind · 11,25)` in `game-core` (`beaufort`, `BEAUFORT_WORDS`): Sturm 0,8 = 9 Bft.
- **Anzeige nach Regeln:** Alle Schwellen der Oberfläche aus `balance.weather` (Nebel ab `fogScoutFrom`/`fogScoutHeavy`,
  Sturm ab `stormFrom`); Feldinfo zeigt Flugzeuge −X % (`airStormPenalty · Sturmanteil`), Luftschlag −X %
  (`cloudStrikePenalty · Wolken`, linear), Startverbot und Radar −X % nur am eigenen Hafen. Planung zeigt das Wetter am
  Ziel zur Ankunft (`RouteWeather.atTarget`, nur in der Vorschau, nicht im gespeicherten Plan).
- **Stromkurve** beginnt zur nächsten vollen Stunde; die Sturmwarnung steht auf 5 Minuten genau (`stormWarning`) statt
  auf dem Beginn des Stundenbalkens. Eine Mangelwarnung „Jetzt“ kommt aus dem Augenblickswert.
- **Balance v1.9:** Mit dem neuen Klima sanken die Jahreserträge (Windpark Nordsee 44 → 39, Solarfeld Mittelmeer 35 → 29);
  `windPowerPerLevel` 80 → 90 und `solarPowerPerLevel` 150 → 180 stellen sie wieder her (Nordsee 44, Mittelmeer 35).
  Simulation (Bot 45 % Rüstung, Start 1. März): Windpark + Speicher Nordsee −0,3 % / −5,3 % (Tag 7/28; vorher −0,3/−3,1),
  Kraftwerk + Solarfeld Mittelmeer +2,5 % / +1,4 % (unverändert), Mix Biskaya −2,0 % / −2,1 %; Wind im Mittelmeer nun
  −24 % / −42 % (vorher −40/−58), weiter kein Ersatz für das Kraftwerk. Sturmzuschlag Nordsee → Norwegen Ø +4,4 % (vorher
  +9,3 %), Startverbot Nordsee 6 %, Irland 6,5 % (vorher 11 %), Mittelmeer 0 %.
- **Karte:** Isobaren per Marching Squares über das Druckfeld `p = Σ −Vorzeichen · Stärke · e^(−q)` (6 Stufen), Windrichtung
  in km gerechnet und in die Projektion umgesetzt; Übersicht mit Haarlinien einmal je 15 min, Feldzeichen nur bei
  Zoomsprung × 1,5 neu gestrichen, T/H aus einem Vorrat.
- **Serverzeit:** Der Versatz wird nur bei erfolgreichem Abruf und nur mit neueren Daten übernommen (`trpc.ts`).

## G. Spionage, Kriegsglück und Kartell gegen Forschung (v1.7)

1. **Spionage abgestimmt** (`sim/espionage.ts`; Chance exakt Zielzahl / 20). Typischer Stand: Tag 3 Stufe 2, Tag 7
   Stufe 3, Tag 14 Stufe 5 + Forschung 1, Tag 28 Stufe 8 + Forschung 2; Erfahrung nach 0/3/8/20 gelungenen Aufträgen.
   Geändert: Erkunden +2 → +4, Sabotage −3 → −2 und 2 → 1 Spion, `maxXpPoints` 3 → 2, Kartell-Abwehr 5 → 4,
   Desinformation `forceFactor` 1,8 → 1,5. Grundwert 9 und je Stufe ±1 bleiben.

| Gleich starker Gegner, Tag | Erkunden | Desinformation | Sabotage | Kartell-Aufklärung |
|---|---|---|---|---|
| 3 | 55 → 65 % | 45 → 45 % | – (ab Stufe 3) | 30 → 35 % |
| 7 | 55 → 65 % | 45 → 45 % | 30 → 35 % | 35 → 40 % |
| 14 | 60 → 70 % | 50 → 50 % | 35 → 40 % | 55 → 60 % |
| 28 | 70 → 75 % | 60 → 55 % | 45 → 45 % | 85 → 85 % |

- Abwehr wirkt voll (Stufe gegen Stufe): Angreifer Stufe 5 + F1 gegen Abwehr Stufe 8 + F2 Erkunden 50 %, Sabotage 20 %;
  gegen Stufe 10 + F2 (Höchststufe bei KZ 7) 40 % / 10 %; gegen Endausbau 5 %. Die Untergrenze Zielzahl 1 hält jeden
  Auftrag bei mindestens 5 % (geprüft über alle Paarungen). Ein Ziel ohne Nachrichtendienst ist offen (Erkunden 80–95 %).
- **Sabotage:** Spionverlust je gelungener Sabotage = Spione × (1 − p) / p × 1760 Stahl-Äquivalent. Mit 2 Spionen
  8213 / 6537 / 4302 (Tag 7/14/28) gegen 1859 / 2458 / 3631 Schaden einer Kraftwerk-Sabotage (6 h halbe
  Gebäudeproduktion des Bots) – deutlich unwirtschaftlich. Mit 1 Spion 3269 / 2640 / 2151: früh ein taktisches Mittel
  (Radar vor einem Angriff, Werft-Verzug), ab Mitte der Saison wirtschaftlich etwa gleichauf bis lohnend. Die Sperrfrist
  24 h je Ziel verhindert Dauerbeschuss.
- **Desinformation:** einmalig, nur das nächste Lagebild, Chance wie bisher 45–55 %. Mit ×1,8 sah ein 2,5:1 überlegener
  Angreifer nur 1,39:1 und hätte abgebrochen – ein Wurf neutralisierte fast jede Überlegenheit. Mit ×1,5 bleibt 2,5:1 als
  1,67:1 sichtbar überlegen; 1,5–2:1 wird verschleiert. Gegenmittel bleibt ein zweites Lagebild.

2. **Kriegsglück** (Frage aus E2, `sim/luck.ts`, Varianten bezogen auf den Punkt „ohne Würfel 50 %“, 400 Seeds,
   Spannen über die vier Gefechte; zweite Zahl = Anteil der Kämpfe, die der Würfel gegenüber ohne Würfel umdreht):

| Würfel (innen / Rand) | ×1,08 | ×1,15 | ×1,30 | ×1,50 |
|---|---|---|---|---|
| ±10 % / ±15 % | 76–82 % (18–29) | 89–95 % (5–12) | 100 % (0–1) | 100 % (0) |
| **±15 % / ±20 % (aktuell)** | 70–74 % (27–34) | 84–87 % (13–16) | 96–100 % (1–4) | 100 % (0) |
| ±20 % / ±25 % | 64–72 % (30–36) | 78–79 % (21–22) | 93–95 % (5–7) | 99–100 % (0–2) |
| ±25 % / ±30 % | 57–67 % (35–43) | 68–75 % (26–32) | 88–90 % (10–12) | 96–100 % (1–4) |

   Alle Varianten halten ×1,5 ≥ 95 %. Der aktuelle Würfel kippt nur knappe Kämpfe (bei ×1,3 höchstens 4 %) und liegt bei
   ×1,08 im Ziel 60–75 %; erst ×1,15 liegt darüber (84–87 %). ±20 % träfe ×1,15 besser, ließe aber schon bei ×1,3 jeden
   20. Kampf kippen. **Nicht geändert** – die Daten sprechen nicht eindeutig dafür. Empfehlung: ±15 % behalten; wenn
   Spieler Kämpfe als zu vorhersehbar empfinden, `innerMin`/`innerMax` 0,8/1,2 und `min`/`max` 0,75/1,25.

3. **Kartell gegen Forschung:** Bis v1.6 bemaß das Kartell seine Stärke an unmodifizierten Lebenspunkten; Forschung
   (LP +15–24 %) senkte seine Siegchance gegen den Bot-Hafen von 12–14 % auf 2 % (halbe Forschung 3–6 %). Mit der Saison
   mitwachsen hülfe nicht gezielt: Ein fester Zuschlag (×1,1 auf `raidStrengthShareOfDefense`) hebt Unerforschte auf
   24–31 %, Erforschte nur auf 9–15 %. Gewollt bleibt: Forschung schützt etwas, macht aber nicht immun. Neu
   `pirates.raidResearchWeight` (0,5): Das Kartell zählt die Hälfte des LP-Zuwachses aus den Modifikatoren des
   Verteidigers mit (`raidDefenseHp`, `composeRaid(…, mods)`). Kartell-Sieg ohne / halbe / volle Forschung:
   Tag 7 12 / 9 / 8 %, Tag 14 13 / 12 / 11 %, Tag 28 13 / 12 / 11 % (Gewicht 1 überzieht: 17–22 %).
   **Offen:** Der Server übergibt die Modifikatoren noch nicht (`packages/engine/src/handlers.ts`, `raidLaunch`:
   `composeRaid(state.units, state.defenses, balance, randomSeed(), mods)`); bis dahin rechnet das Spiel wie v1.6.

## H. Admirale (Welle 2, Block `admirals`, ab v1.8)

1. **Wirkung über das Modifikatoren-System, je Rolle getrennt.** Jede Spezialisierung hat Boni für drei Rollen:
   `mission` (nur der Verband, den er führt: Kampf, Tempo, Treibstoff, Tarnung, Laderaum/Beute), `defense` (nur im
   Verteidigungskampf des eigenen Hafens, auch gegen das Kartell) und `harbor` (passiv, solange er stationiert und bereit
   ist: Radar-Vorwarnzeit, Bunkerschutz; als Quelle „Hafenkommandant“ in `modifierSourcesFor`). Kampfwerte stehen bewusst
   **nicht** in `harbor`, sonst wirkte der Hafenkommandant auch auf eigene Überfälle. Der Bonus wächst mit dem Rang:
   Faktor 0,5 / 0,7 / 0,85 / 1 (Kapitän zur See … Admiral). Die zweite Spezialisierung wirkt ab Rang 3 (Vizeadmiral).
2. **Auslegung „+Angriff See“:** `attack.see` = Angriff der eigenen Schiffe (Gattung des Schützen), nicht aller Schützen
   gegen Schiffe. Folge: In Landungskämpfen bringt „Angriff“ fast nichts; dort hilft „Verteidigung“ (LP aller Gattungen).
   „Aufklärung“: auf Mission Tarnung (Vorwarnzeit des Ziels −25 %), daheim Radar-Vorwarnzeit +25 % – die gewünschte
   „bessere Vorschau“ ist damit als längere Vorwarnung umgesetzt, nicht als genaueres Lagebild (offen).
3. **Kampfwert (`sim/admirals.ts`, 200 Seeds):** Feuerkraft-Faktor für 50 % Sieg ohne und mit Admiral; Bonus = nötige
   Mehr-Feuerkraft ohne Admiral.

| Admiral | Seegefecht | Landung | Nest 3 | Nest 5 |
|---|---|---|---|---|
| Kapitän z. S., Angriff | +4,0 % | 0 % | +0,2 % | 0 % |
| Admiral, Angriff | +8,0 % | 0 % | +0,9 % | 0 % |
| Admiral, Verteidigung | +9,2 % | +0,8 % | +7,2 % | +0,9 % |
| Admiral, Angriff + Verteidigung | **+17,9 %** | +0,8 % | +8,1 % | +0,9 % |
| Hafen: Admiral Angriff + Verteidigung | **+18,9 %** | +6,0 % | +10,2 % | +8,1 % |

   Mit den ersten Werten (Angriff +10 %, Verteidigung +8 %) lag der Hafenkommandant im Seegefecht bei +27 %, der
   Missionsadmiral bei +21 %. Gesenkt auf Angriff See +8 % (daheim +7 %, auch Anlagen) und LP +6 %: voll ausgebildet
   +10–19 %, nie über 20 %. Landungen bleiben fast unberührt (Ausgang hängt an Truppen und Bunkern).
4. **Erfahrung** nur bei Sieg: zerstörte gegnerische LP / 60, mindestens 5, höchstens 120 je Kampf (Nest 5 ≈ Deckel).
   Ränge ab 0 / 100 / 300 / 700: Admiral nach etwa 6–10 großen Siegen. Ohne Landung gewinnt der Angreifer nie
   (Kampfregel) – reine Seeangriffe bringen dem Angreifer-Admiral also keine Erfahrung, dem Verteidiger schon.
5. **Risiko:** Wurf nur nach Niederlage mit > 70 % verlorener LP (endgültig, nach Lazarett/Reparatur). W20 aus
   `mulberry32(seed ^ Seitenkonstante)` – unabhängig von den Würfen des Kampfs, je Seite eigener Strom, im Bericht.
   1 gefallen (Zeile gelöscht), 2–5 gefangen (48 h oder Lösegeld 1 500 Kredite), 6–12 verwundet (12 h), 13–20 unversehrt.
   Der Sieger erhält den Gefangenen nicht.
6. **Kosten** 2 000 Kredite + 400 Elektronik; Kredite mit Journal (`player:<id>` → `admiralitaet`), damit der Prüflauf
   ausgeglichen bleibt. Plätze 1 + 1 je 5 Stufen Hafenkommandantur, höchstens 3. Kredite gibt es erst über die Börse
   (Hafenkommandantur 3) – Admirale sind bewusst ein Mittelspiel-Ziel.
7. **Status ohne Buchführung bei der Rückkehr:** „unterwegs“ = die Mission in `admiral.mission_id` ist outbound oder
   returning. Weltereignis-Missionen nehmen (noch) keinen Admiral mit (offen).

## I. Minen, Seeblockade und Konvois (Welle 2, Balance-Blöcke `mines`, `blockade`, `convoys`)

Regeln in `docs/REGELN-SEE.md`, Simulation `sim/naval.ts` (`npm run sim`, Abschnitt „See“, 400 feste Seeds).

1. **Minen.** Ø Verlust (Wert) je Durchfahrt nach Feldstärke 25 / 50 / 100 / 150:
   Überfall-Verband 20 Korvetten + 4 Landungsschiffe + 300 Schützen 2,2 / 4,4 / 9,0 / 13,5 %; mit 4 Minenräumern
   1,5 / 2,9 / 5,8 / 8,8 %; 12 U-Boote 1,5 / 2,9 / 6,1 / 9,1 %; 10 Zerstörer 3,7 / 7,7 / 15,0 / 22,5 %.
   Ein volles Feld (150, sechs Minenleger) kostet 2550 Stahl-Äquivalent an Minen und versenkt bei einem solchen Verband
   Ø 4263. Erster Entwurf (0,002 je Stärke, höchstens 30 %, 2 Stärke je Treffer) ließ ein Feld acht Verbände treffen und
   10 Zerstörer 30 % verlieren – zu stark für eine rein defensive Waffe. Jetzt 0,0015, höchstens 25 %, 4 Stärke je
   Treffer: ein volles Feld trifft drei bis vier Verbände merklich. Minen bleiben Verteidigung nahe dem eigenen Hafen
   (Legeradius 300 km), nur die Hinfahrt zählt; Räumer und U-Boote sind die Antwort.
2. **Blockade.** Produktion × 0,75 kostet den Bot-Hafen an Tag 7 / 14 / 28 über 12 h 1859 / 2458 / 3631
   Stahl-Äquivalent (2 h: 310 / 410 / 605), dazu gesperrte Verkäufe und zurückgehaltene Lieferungen. Der kleinste
   Blockadeverband (2 Zerstörer, 12 KP) ist 3900 wert. Brechen: 6 Korvetten 0 % (Ø 1 Zerstörer versenkt – die
   Rundenzahl reicht nicht, Verluste bleiben, der zweite Angriff bricht), 12 Korvetten 100 %, 6 Zerstörer 100 %,
   4 Jagdbomber + 6 Korvetten 99,5 %. Gewollt: Eine Blockade lohnt nur mit Druck dahinter und ist mit eigener Flotte
   oder Allianzhilfe zu lösen.
3. **Konvois (Kartell).** Chance / erwartete Verlustquote ohne Geleit / mit 2 Korvetten / mit 2 Zerstörern:
   200 km, Wert 2000: 4,8 % / 1,4 / 0 / 0 %; 450 km, 5000: 8,5 % / 2,6 / 0 / 0 %; 700 km, 9000: 12 % / 3,6 / 0 / 0 %;
   900 km, 20000: 12 % / 3,6 / 3,0 / 0 % (2 Korvetten halten dort nicht mehr). Die erwartete Verlustquote ohne Geleit
   liegt unter der Börsengebühr (4 %) – Handel bleibt attraktiv, große Ladungen auf langen Wegen wollen Geleit.
   Erster Entwurf: Verlust bei unterlegenem Geleit 50 % (> 30 % ohne Geleit) machte schwaches Geleit schädlich; jetzt
   25 %. Kartellboote 0,8 je 1000 Warenwert (statt 1,2), höchstens 12.
4. **Offen:** Rückfahrt und Handelskonvois laufen nicht durch Minen; Börsenlieferungen sind keine Konvois; Geleitschutz
   beim Handel nur durch den Annehmenden (für die eingehende Ware), nicht durch den Anbieter beim Einstellen.

## J. Rohstofffelder (Welle 3 „Expansion“, Teil 1, Balance-Block `fields`)

Regeln in `docs/REGELN-FELDER.md`, Simulation `sim/fields.ts` (`npm run sim`, Abschnitt „Felder“, 400 feste Seeds).
Ziel: Felder sind Entscheidungen und Konflikte, kein passiver Mehrertrag.

1. **Verteilung.** Feste Kandidatenliste (`fieldSites`, Seed 7): Seefelder mit Küste in ein bis zwei Feldern Nähe,
   mindestens 230 km auseinander. Aktiv sind `count` = 28; der Server wählt nach Lage der Häfen: nie näher als 220 km
   an einem Hafen, bevorzugt Plätze mit Häfen mehrerer Spieler im Umkreis von 700 km. Neutrale Felder, die durch einen
   neuen Hafen zu nah liegen oder seit einem Tag ohne Hafen in Reichweite sind (wenn es bessere Plätze gibt), ziehen um.
2. **Ertrag.** Stufen 1/2/3 ≈ 75 / 125 / 190 Stahl-Äquivalent je Stunde, alle Arten gleich viel wert (Richtpreise).
   Netto (Unterhalt 10/15/20 Proviant, Konvoi 450 km ohne Geleit, Risiko einer Besatzung aus 2 Zerstörern + 2 Korvetten):
   68 / 114 / 173 je Stunde. Zusatzertrag gegenüber der Produktion des Bot-Hafens (Stufe 2, Mittel der Arten):
   Tag 14 (779/h): 1 Feld 14,7 %, 2 Felder 26,9 %, 5 Felder 50,4 %; Tag 28 (1127/h): 1 Feld 10,1 %, 5 Felder 34,8 %.
   Der Bot hat an Tag 14 und 28 Hafenkommandantur 5 bzw. 7, darf also nur 2 Felder halten; 5 Felder brauchen Stufe 16.
   Erster Entwurf (Stufe 2 ≈ 99/h) lag an Tag 28 bei 7,8 % für ein Feld – zu wenig; Ertrag +25 %. Abnehmender Ertrag
   von 100/85/70/60/50 auf 100/85/70/55/45 %, damit 5 Felder an Tag 14 bei etwa +50 % bleiben.
3. **Kartell.** Chance 5 % je 4-Stunden-Zyklus (≈ alle 3,3 Tage je Feld), Verband 9/12/18 Schnellboote ± 30 %.
   Mindestbesatzung (2 Korvetten bzw. 1 Zerstörer) fällt auf Stufe 1 in 63 % / 58 % der Angriffe, auf Stufe 2 und 3
   immer (Ø 3 Tage bis zum Verlust); 2 Zerstörer + 2 Korvetten halten auf allen Stufen. Erster Entwurf (4/7/11) ließ
   jede Besatzung außer auf Stufe 3 sicher – kein Risiko; jetzt lohnt eine stärkere Besatzung, die aber Schiffe bindet.
   Wache neutraler Felder 4/8/14 Schnellboote (schwächer als ein Nest; 2 Zerstörer + 4 Korvetten siegen immer).
4. **Bremse.** Höchstzahl 1 + 1 je 4 Stufen Hafenkommandantur (Stufe 0: keines), höchstens 5; Unterhalt je Feld in
   Proviant; die Besatzung belegt einen Missionsplatz und kostet ihren normalen Unterhalt (sie bleibt in unitsAway).
5. **Allianz.** Zone: Felder derselben Allianz bis 450 km verbunden (Kette); ab 3 Feldern +10 % Ertrag je Feld.
   Allianzwertung +20 Punkte je Feld und Tag (Saisonbeitrag; eine Allianz mit 5 Feldern über 28 Tage: 2800).
6. **Umsetzung.** Felder hängen am Spieler und an einem Heimathafen (`resource_field.base_id`, Ziel der Konvois),
   vorbereitet für mehrere Häfen. Ertragskonvois nutzen das Konvoi-System (Art „feld“, ohne Geleit), Blockade hält sie
   zurück; Minen wirken auf Konvois nicht. Der angefangene Zyklus geht beim Rückruf noch als Konvoi heim, bei Verlust
   durch Angriff verfällt er.
7. **Geleitabteilung (Felder 2).** Ein Teil der Besatzung (`resource_field.escort`) begleitet jeden Ertragskonvoi und
   kämpft bei Abfangversuchen mit; er verteidigt das Feld nicht, der Rest muss eine gültige Besatzung bleiben
   (`escortMinRemainCommandPoints` 6). Bewusst ohne Treibstoff und ohne eigene Mission: Die Kosten sind gebundene
   Schiffe (Unterhalt, Missionsplatz der Besatzung) und eine schwächere Feldverteidigung. Simulation (`sim/fields.ts`,
   Konvoi Stufe 2 = 500 Stahl-Äq., 450 km, 400 Seeds): Kartell fängt 6,7 % der Konvois ab (2 Schnellboote), ohne
   Geleit Ø 60 Stahl-Äq. Verlust je Tag (≈ 2 % des Ertrags); schon 1 Korvette hält zu 100 %. Gegen Kriegsgegner
   (60 % Plünderung ohne Geleit): 1 Zerstörer hält gegen 2 Zerstörer zu 71 %, 2 Zerstörer gegen 2/4 Zerstörer zu
   100/71 %, gegen 3 U-Boote zu 28 %. Kosten: Besatzung 2 Zerstörer + 2 Korvetten fällt beim Kartellangriff auf
   Stufe 1/2/3 nie; mit 1 Korvette Geleit ebenfalls nie, mit 2 Korvetten Geleit (verteidigen nur 2 Zerstörer) auf
   Stufe 3 zu 47 %. Das Geleit lohnt also vor allem im Krieg; gegen das Kartell genügt eine Korvette, wenn die
   Besatzung stark genug ist. Treibstoff je Konvoi (erster Gedanke: Hin- und Rückweg) hätte mit ≈ 65 Stahl-Äq. je Korvette
   und Konvoi mehr gekostet als der Kartellverlust – verworfen.
8. **Verstärkung.** „Besetzen“ gegen das eigene Feld fügt die Schiffe bei Ankunft der Besatzung hinzu (keine
   Mindeststärke, keine Höchstzahl, Treibstoff hin und zurück wie beim Besetzen, Missionsplatz nur während der Fahrt).
   Aus einem anderen Hafen wechseln die Schiffe in den Hafen des Felds (unitsAway wandert, Veteranen gewichtet wie bei
   der Verlegung) – so bleibt die Besatzung eine Mission eines Hafens.
9. **Radar-Vorwarnung.** Spielerangriffe auf Felder meldet das Radar des Hafens des Felds mit `radarWarningFactor`
   = 50 % seiner Vorwarnzeit (Radar 5: 17,5 statt 35 Minuten), Ereignis `field_warning`, Push und Systemnachricht.
   Halbiert, weil das Feld ≥ 220 km vor dem Hafen liegt; die Reaktion (Rückruf, sofort wirksam) braucht wenig Zeit.
   Verstärkungen erreichen das Feld meist nicht mehr rechtzeitig (Fahrzeit mehrere Stunden) – gewollt.
10. **Wochenziele.** „Felderträge“ (Zähler `feldertrag` = Wert eingelaufener Konvois zum Richtpreis, Ziel
   5000 × (1 + KZ/5) auf 1000 gerundet: ein Feld Stufe 1 auf Rang 1 liefert ≈ 12 600 je Woche, KZ 5 braucht 10 000)
   nur mit Werft und erlaubtem Feld; „Gründung“ (1 Hafen in der Woche, aus `base.created_at` gelesen) nur, wenn ein
   weiterer Hafen erlaubt und die Hafenkommandantur für das Kolonieschiff erreicht ist. Kein Auftragsbuch-Schritt:
   das Auftragsbuch ist die Einführung (elf Grundaufträge, Abschluss „Hafenmeister“); ein Gründungsauftrag (KZ 5)
   hätte den Abschluss für Anfänger um Wochen verschoben.
11. **Admiral.** Feldmissionen nehmen keinen Admiral (launchField übergeht admiralId, die Planung bietet keinen an);
   der frühere Punkt „Admiral bleibt bei der Besatzung“ tritt daher nicht auf. Die Planung sagt es jetzt ausdrücklich.
12. **Offen:** Geleitabteilung kämpft nicht bei Kartellangriffen auf das Feld mit (auch wenn gerade kein Konvoi
   fährt); jeder Konvoi kämpft mit derselben Abteilung (keine Aufteilung auf gleichzeitig fahrende Konvois);
   Admirale für Besetzungsverbände.

## K. Mehrere Häfen: Gründung und Verlegung (Welle 3 „Expansion“, Teil 2, Block `expansion`, v1.11)

1. **Freischaltung.** 2. Hafen ab Kommandozentrale 5, 3. ab 9 (Heimathafen), höchstens 3; laufende Gründungen zählen
   mit. Der Wirtschafts-Bot erreicht in 28 Tagen nur Kommandozentrale 6–7 (gieriger Ausbau, billigstes zuerst); mit
   der ersten Vorgabe 8/14 wäre der 2. Hafen für typische Spieler erst nach etwa 4 Wochen gekommen. v1.12 senkt auf
   5/9: der 2. Hafen wird im frühen Mittelspiel möglich (gebremst durch Werft 6, Hafenkommandantur 6 und die Kosten
   des Kolonieschiffs), der 3. bleibt ein Ziel für gezielten Ausbau.
2. **Kolonieschiff.** Kosten 6000 Stahl, 3000 Treibstoff, 2000 Elektronik, 2000 Proviant = 18 600 zum Richtwert; das
   sind 27 / 24 / 21 Stunden Produktion des Bot-Hafens an Tag 10 / 14 / 21 (689 / 779 / 894 je Stunde). Bauzeit 3 h
   (2 h bei Werft 6), Werft 6 und Hafenkommandantur 6, höchstens 0,2 je Werftstufe. Ladung 3000 für Startgüter.
3. **Amortisation** (`sim/expansion.ts`): Der Bot baut den neuen Hafen ab dem Startbestand (1000/500/250/500) mit 20 %
   Rüstungsanteil aus. Aufsummierte Nettoproduktion Tag 1/2/3/5/7: 1 559 / 10 128 / 22 362 / 49 588 / 80 444 →
   **amortisiert nach 3 Tagen** (Kosten Schiff + 600 km Treibstoff 18 816). Mit voller Ladung (3000, gleich verteilt,
   verlegt, nicht als Kosten gezählt) nach 2 Tagen. Nach 10 Tagen produziert die Kolonie 735/h (Kommandozentrale 4) –
   etwa so viel wie der Heimathafen an Tag 10. Erster Entwurf (27 900 Richtwert) amortisierte nach 4 Tagen, kostete aber
   31–41 Stunden Produktion; gesenkt auf 2/3, damit der Bau im Mittelspiel kein Tagewerk ist und die Amortisation
   am unteren Rand des Ziels (3–5 Tage) bleibt.
4. **Schutz.** Kolonien erben den Anfängerschutz des Heimathafens (kein neuer Anfängerschutz durch Gründen) und haben
   24 h Gründungsschutz (eigener Schutzgrund `gruendungsschutz`); erster Kartell-Überfall nach 48 h.
5. **Abstand.** Mindestens 4 Felder zu fremden, 3 zu eigenen Häfen, höchstens 900 km vom Heimathafen; kein Nest,
   Handelshafen, Rohstofffeld. Wettlauf um ein Feld entscheidet der eindeutige Index `base_field`; der Verlierer fährt
   mit Ladung heim.
6. **Verlegung.** Nur Hinfahrt (Treibstoff einfach), dauerhaft; Veteranen gewichtet gemischt, Admiral wechselt den
   Hafen. Transport in eigene Häfen ist erlaubt.
7. **Offen:** „Kolonie aufgeben“ (P5); Umbenennen eines Hafens; Ortsname aus der Karte statt „<Name> II“.
   Wochenziel „Gründung“ siehe J.10 (kein Auftragsbuch-Schritt).
