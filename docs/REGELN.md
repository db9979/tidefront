# TIDEFRONT – Regel-Spezifikation Meilenstein 1

Verbindlich für `packages/game-core`. Alle Zahlen stehen in `packages/balance/v1/balance.json`
und werden dort geändert, nie im Code. Zahlen sind Startwerte und nicht simuliert.

## Grundsätze

- `game-core` besteht aus reinen Funktionen: kein Dateizugriff, kein Netzwerk, keine Uhr, kein `Math.random`.
- Zeit kommt als Parameter in Millisekunden seit Epoche (`nowMs`).
- Zufall kommt aus einem Generator mit Seed (`mulberry32`). Gleicher Seed, gleiche Eingabe: gleiches Ergebnis.
- Funktionen verändern ihre Eingaben nicht, sie geben neue Objekte zurück.
- Fehler (zu wenig Ressourcen, Limit erreicht) sind Rückgabewerte `{ ok: false, code }`, keine Ausnahmen.
- Kein Fremdpaket. Tests laufen mit `node --test` direkt auf den `.ts`-Dateien
  (nur löschbare Typ-Syntax: keine `enum`, keine Parameter-Properties, Importe mit Endung `.ts`).

## Ressourcen

Vier Ressourcen: `stahl`, `treibstoff`, `elektronik`, `proviant`. Strom ist eine Kapazität, kein Bestand.

- Produktion pro Stunde eines Gebäudes auf Stufe L ≥ 1: `perHour * productionGrowth^(L-1)`.
- Dazu kommt immer die Grundrate `baseTricklePerHour`.
- Strom: Angebot = `kraftwerk.powerSupplyPerLevel * L`. Bedarf = Summe `powerPerLevel * L` der Produktionsgebäude.
  Ist der Bedarf größer als das Angebot, wird die Gebäudeproduktion (nicht die Grundrate) mit `Angebot / Bedarf` multipliziert.
- Proviant-Unterhalt: Summe `upkeepPerHour * Anzahl` aller Einheiten des Stützpunkts wird von der Proviant-Rate abgezogen.
  Die Netto-Rate kann negativ sein; der Bestand fällt nie unter 0. Bei Bestand 0 und negativer Rate gilt `versorgungsmangel = true`
  (Ausbildungsstopp, Angriffswert aller eigenen Einheiten mal 0,8).
- Lagerkapazität je Ressource: `capacityBase * capacityGrowth^L` (L = Stufe Lagerkomplex, ab 0).
  Produktion füllt nur bis zur Kapazität. Beute und Lieferungen dürfen darüber hinausgehen.
- Lazy Evaluation: `settle(base, nowMs)` schreibt Bestände von `resUpdatedAt` auf `nowMs` fort.

## Gebäude

- Kosten für den Ausbau von Stufe L auf L+1: `cost * costFactor^L`, je Ressource aufgerundet.
- Bauzeit: `seconds * timeFactor^L`, höchstens `maxBuildSeconds`.
- Höchststufe `maxLevel`. Kein Gebäude außer der Kommandozentrale darf höher sein als
  `Stufe Kommandozentrale + levelCapAboveCommand`.
- Eine Bauschlange mit einem aktiven Auftrag pro Stützpunkt in Meilenstein 1.
- Kommandopunkte eines Stützpunkts: `commandPointsBase + commandPointsPerLevel * L`.
- Tiefbunker: schützt je Ressource `protectedBase * protectedGrowth^L` vor Plünderung.
- Missionsplätze: `missionSlotsBase + floor(L / 2) * missionSlotsPerTwoLevels` (Hafenkommandantur).
- Börse ab Hafenkommandantur Stufe `marketFromLevel`; Kreditlimit `creditLimitPerLevel * L`.

## Einheiten

Neun Spielereinheiten in drei Gattungen, siehe `units`. Verteidigungsanlagen siehe `defenses`, Gegner siehe `npcUnits`.

- Bau nur, wenn das Gebäude `builtIn` mindestens Stufe 1 hat und kein Versorgungsmangel herrscht.
- Bauzeit je Einheit: `seconds / (1 + buildSpeedPerLevel * (L - 1))`.
- Flugzeuge brauchen Stellplätze: `slotsPerLevel * L` (Flugfeld).
- Ein Verband darf höchstens die Kommandopunkte seines Startstützpunkts kosten.
- Bodentruppen reisen nur in Landungsschiffen: Summe `size * Anzahl` ≤ Summe `troopSpace`.
- Flugzeuge nehmen nur teil, wenn die Entfernung zum Ziel ≤ `rangeKm` ist.

## Missionen

Meilenstein 1: `ueberfall`, `aufklaerung`, `transport`.

- Reisezeit: `Entfernung / langsamste speedKmh` der Schiffe; reine Luftmissionen nach der langsamsten Luftgeschwindigkeit.
- Treibstoff: Summe `fuelPer100Km * Anzahl * Entfernung / 100`, mal 2 für Hin- und Rückweg, aufgerundet; wird beim Start abgezogen.
- Entfernung zwischen Hexfeldern: Großkreis-Entfernung der Feldmittelpunkte in Kilometern.

Ablauf am Ziel:

- `ueberfall`: Kampf bei Ankunft. Der Verteidiger erhält seinen Endbestand (Überlebende plus Rückkehrer), die Beute wird
  abgezogen. Die Einheiten des Angreifers aus `final` kehren mit der Beute nach der Reisezeit heim; erst dann verlassen
  alle entsandten Einheiten `unitsAway`.
- `aufklaerung`: kein Kampf. Bei Ankunft entsteht ein Lagebild des Ziels (Bestände abgerundet, Gebäude, Einheiten daheim,
  Anlagen, Bunkerschutz); bei einem Nest dessen Besatzung. Der Verband kehrt vollständig heim.
- `transport`: Bei Ankunft wird die Ladung dem Zielstützpunkt gutgeschrieben, auch über die Lagerkapazität. Ziel kann nur
  ein Spielerstützpunkt sein. Der Verband kehrt leer heim.

## Vorwarnung

- Radarstation Stufe L ≥ 1: Vorwarnzeit `warningMinutesBase + warningMinutesPerLevel * L` Minuten, ohne Radar 0.
- Ein anrückender Angriff gilt als erkannt, sobald seine Ankunft höchstens die Vorwarnzeit entfernt ist.
  Erst dann sieht der Verteidiger ihn, und erst dann greift an der Börse die Sperre `under_attack`.

## Abbruch

- Ein laufender Ausbau oder Ausbildungsauftrag kann abgebrochen werden. Erstattet wird je Ressource
  `floor(Kosten * Restzeit / Gesamtdauer)`, auch über die Lagerkapazität. Der Bauplatz ist sofort frei.

## Kampf

Automatisch, höchstens `maxRoundsPerPhase` Runden je Phase.

1. **Luftkampf:** Abfangjäger beider Seiten, Angriffswert `luft`. Wer danach mehr Jäger-Lebenspunkte hat, besitzt Luftüberlegenheit.
2. **Luftschlag:** Zuerst feuern Flak und Schiffe mit ihrem `luft`-Wert auf die Bomber. Überlebende Bomber greifen Schiffe (`see`) und Anlagen (`anlage`) an.
   Mit Luftüberlegenheit mal `airSuperiorityBomberBonus`, gegen fremde Luftüberlegenheit mal `airSuperiorityBomberMalus`.
3. **Seegefecht:** Schiffe gegeneinander (`see`), Küstenbatterien feuern mit.
4. **Landung:** Nur wenn Landungsschiffe überleben. Truppen über der verbliebenen Kapazität gehen verloren.
   Minensperren wirken einmal, Pioniere halbieren den Schaden. Dann Bodenkampf: Truppen treffen Bodentruppen mit `land`
   und die Bunkerlinie mit `anlage`. Verteidigende Bodentruppen und Bunkerlinie feuern mit `land`, Küstenbatterien feuern
   mit `land` mit, sind im Bodenkampf aber kein Ziel und zählen nicht für den Sieg.

Schadensregeln:

- Schaden einer Seite je Runde = Summe über ihre Einheitentypen `Angriff * Anzahl`, verteilt auf die gegnerischen Typen
  der Phase proportional zu deren gesamten Lebenspunkten. `bonus[zieltyp]` multipliziert den Anteil gegen diesen Typ.
- Jede Runde wird der Schaden mit einem Zufallsfaktor aus `[1 - randomSpread, 1 + randomSpread]` multipliziert.
- Beide Seiten schießen gleichzeitig. Verluste = `floor((Restschaden + Schaden) / hp)`. Der Restschaden unterhalb der
  Lebenspunkte einer Einheit wird je Einheitentyp und Seite über alle Runden und Phasen des Kampfs mitgeführt;
  er verfällt erst, wenn der Typ ausgelöscht ist oder der Kampf endet.
- Der Angreifer gewinnt, wenn nach der Landung keine verteidigenden Bodentruppen und keine Bunkerlinie mehr stehen und eigene Bodentruppen leben.

Nach dem Kampf:

- Beute je Ressource: `min(Bestand - Bunkerschutz, …) * maxShareOfUnprotected`, mal Wiederholungsfaktor
  (`repeatFactors` nach Anzahl der Angriffe desselben Angreifers binnen `repeatWindowHours`),
  insgesamt begrenzt durch `cargo` der überlebenden Landungsschiffe; bei Knappheit proportional gekürzt.
- Schwachziel: Ist die Stärke des Ziels (Summe aller Gebäudestufen) kleiner als `weakTargetBelowShare` mal der Stärke des
  angreifenden Stützpunkts, wird die Anteilsbeute zusätzlich mit `weakTargetLootFactor` multipliziert.
- Piratennester geben ihren festen `loot` statt eines Anteils, ebenfalls durch `cargo` begrenzt; keine Schwachziel-Regel.
- Wracks: `wreckShare` der Stahl- und Elektronikkosten versenkter Schiffe beider Seiten bleiben als Wrackfeld am Kampfort.
  Das Wrackgut verfällt linear und ist nach `wreckHours` Stunden verschwunden. Jede eigene Mission, die das Feld erreicht,
  birgt Wrackgut bis zur freien Ladekapazität ihrer Schiffe (nach der Beute) und bringt es mit heim.
- Verteidiger: `defenseRepairShare` der zerstörten Anlagen und `hospitalShareDefender` der Bodentruppen kehren zurück.
- Angreifer: `hospitalShareAttacker` der Bodentruppen kehren zurück, nur bei Sieg. `aircraftDamagedShare` der verlorenen Flugzeuge beider Seiten gelten als beschädigt und kehren zurück.
- Der Kampfbericht enthält je Phase: Bestände vorher und nachher beider Seiten und einen Schlüssel `entscheidend` (der Einheitentyp mit dem meisten ausgeteilten Schaden).

## Freibeuter-Kartell

- Nester der Stufen 1 bis 5 mit fester Besatzung und Beute (`pirates.nestLevels`), neu besetzt nach `nestRespawnHours`.
- Überfälle auf Spieler alle `raidIntervalHours` je Stützpunkt. Stärke: Schnellboote so viele, dass ihre Lebenspunkte
  `raidStrengthShareOfDefense` der Lebenspunkte der Verteidigung (Schiffe und Anlagen) entsprechen, mindestens `raidMinSchnellboote`;
  je Boot `raidMiliPerBoot` Milizionäre. Das Kartell führt eigene Landungskapazität mit.
- Kein Überfall während Nachtschild, Anfängerschutz oder Schutz nach Niederlage.

## Schutz

- Nachtschild: `nightShieldHours` Stunden täglich, Startstunde wählt der Spieler. Eigene Angriffe heben ihn für diese Nacht auf.
- Anfängerschutz `beginnerDays` Tage. Nach verlorener Verteidigung `afterDefeatShieldHours` Stunden Schutz.

## Börse Stufe 1

Kurs `p` je Ressource, Richtwert `ref`, Markttiefe `depth`.

- Rückkehr zum Richtwert: `p(t) = ref + (p - ref) * 0.5^(Δt / reversionHalfLifeHours)`; wird vor jedem Handel angewendet.
- Handel über Menge `q`: Kurswirkung `i = q / depth`. Kauf: `p' = p * (1 + i)`. Verkauf: `p' = p / (1 + i)`.
  Ausführungskurs ist das Mittel aus `p` und `p'`.
- Kauf kostet `q * Ausführungskurs * (1 + fee)`, Verkauf bringt `q * Ausführungskurs * (1 - fee)`; Kredite auf zwei Nachkommastellen, zulasten des Spielers gerundet.
- Ablehnungsgründe (Code in Klammern), in dieser Reihenfolge geprüft:
  Börse nicht freigeschaltet (`locked`), Handelspause (`halted`), Menge nicht positiv und ganzzahlig (`bad_qty`),
  Kurswirkung über `maxImpactPerTrade` (`impact`), mehr als `tradesPerMinute` (`rate`),
  Tageslimit `dailyLimitShareOfStorage * Lagerkapazität` je Ressource überschritten (`daily_limit`),
  Verkauf bei erkanntem Angriff auf den Stützpunkt (`under_attack`),
  Verkauf würde das Kreditlimit überschreiten (`credit_limit`), Bestand oder Kredite reichen nicht (`funds`),
  erwarteter Kurs weicht um mehr als `slippageTolerance` ab (`slippage`),
  neuer Kurs außerhalb `[floorFactor, ceilFactor] * ref` (`price_bounds`).
- Kursband: Würde `p'` um mehr als `hourBand` vom Kurs vor einer Stunde oder mehr als `dayBand` vom Kurs vor 24 Stunden abweichen,
  wird der Handel abgelehnt (`band`) und der Markt für `haltMinutes` angehalten.
- Gekaufte Ware wird nicht sofort gutgeschrieben, sondern als Lieferung mit Ankunftszeit zurückgegeben
  (`Entfernung zum Handelshafen / convoySpeedKmh`). Verkaufte Ware wird sofort abgezogen, Kredite sofort gutgeschrieben.
- Jeder Handel liefert Journalzeilen (doppelte Buchführung): Summe aller Kredit-Buchungen einschließlich Gebührenkonto ist 0,
  ebenso die Summe je Ressource zwischen Spieler, Markt und Lieferung.
- Garantie, die Tests prüfen: Keine Folge von Käufen und Verkäufen ohne vergangene Zeit, nach der der Spieler von jeder
  Ressource mindestens so viel hält wie vorher (Bestand plus Lieferungen), erhöht seine Kredite.
  Startet der Kurs am Richtwert, steigt außerdem sein zum Richtwert bewerteter Gesamtwert nicht.
  Ein Kauf unter Richtwert ist erlaubt: Das ist eine Wette auf die Rückkehr des Kurses, kein Gewinn aus dem Nichts.
- Auslegungen des Börsenkerns stehen in `packages/game-core/src/market/ENTSCHEIDUNGEN.md` und gelten als Teil dieser Regeln.
