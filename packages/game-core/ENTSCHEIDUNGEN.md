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
    (`unlimitedCargo`). Bootszahl aufgerundet. Zur Verteidigung zählen Schiffe und alle Anlagen, keine Bodentruppen
    und keine Flugzeuge.
11. **Flugreichweite:** `planMission` lehnt einen Verband ab (`out_of_range`), wenn ein Flugzeugtyp das Ziel nicht
    erreicht, statt die Flugzeuge still zu Hause zu lassen.
12. **Verteidigungsanlagen bauen** ist in REGELN nicht geregelt (kein `builtIn`). Umgesetzt über `startTraining`:
    keine Gebäudevoraussetzung, keine Beschleunigung, eigener Bauplatz `anlagen`, kein Stopp bei Versorgungsmangel.

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

## C. Auffälligkeiten in balance.json und REGELN.md (nicht geändert)

- **`maxBuildSeconds` (432000 s) wird nie erreicht.** Die längste Bauzeit ist Kommandozentrale 19 auf 20 mit
  120 * 1,4^19, rund 71700 s (knapp 20 Stunden). Der Test prüft die Kappung deshalb mit verkleinerter Obergrenze.
- **Früher ohne Regel, seit Stand 2 geregelt und umgesetzt** (`resolution.ts`): Schwachziel (Stärke = Summe der
  Gebäudestufen), Wrack-Verfall (linear, Bergung durch eigene Missionen), Radar-Vorwarnzeit, Abbruch von Bau und
  Ausbildung. Wer den Spielerstützpunkt eines anderen Spielers angreift, wird nach seinem Startstützpunkt gemessen.
- **Restschaden wird seit Stand 2 mitgeführt** (vorher verfiel er je Runde, kleine Verbände waren wirkungslos).
- **Simulation** (`npm run sim`, 200 Seeds je Fall), Stand 2 mit `balance.json` v1:
  - Kartell-Überfälle gewinnen nur gegen völlig unverteidigte Stützpunkte. Schon 20 Schützen halten die Mindeststärke
    (4 Boote, 24 Miliz) auf; gegen Schiffe und Anlagen skaliert nur die Bootszahl, die Miliz bleibt bei 6 je Boot und
    verliert den Bodenkampf. Vorschlag zum Prüfen: `raidStrengthShareOfDefense` an der Bodenverteidigung messen oder
    `raidMiliPerBoot` erhöhen.
  - Nester: Stufe 1 fällt schon mit 2 Korvetten, 1 Landungsschiff, 60 Schützen; Stufe 3 erst mit einem Verband aus
    8 Zerstörern, Bombern, 5 Landungsschiffen, Panzern und 350 Mann; Stufe 4 und 5 hielt jeder getestete Verband.
    Die Sprünge zwischen den Stufen sind groß.
  - Ein gieriger Bau-Bot erreicht nach 7 Tagen rund 300 Stahl je Stunde und Kommandozentrale 4.
- **Nest-Besatzung** steht in `nestLevels` als flache Schlüssel neben `loot`; der Code ordnet sie über die IDs den
  Einheiten oder Anlagen zu.
