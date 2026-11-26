# TIDEFRONT – Regel-Spezifikation Meilenstein 1

Verbindlich für `packages/game-core`. Alle Zahlen stehen in `packages/balance/v1/balance.json`
und werden dort geändert, nie im Code. Zahlen sind Startwerte; Kartell und Piratennester sind seit Balance v1.1
per Simulation abgestimmt (`npm run sim`, Ergebnisse in `packages/game-core/ENTSCHEIDUNGEN.md`, Abschnitt C).

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
- Bauschlange: bis zu `building.queueSlots` Ausbauaufträge je Stützpunkt, abgearbeitet nacheinander. Die Kosten werden
  beim Einreihen bezahlt. Die Zielstufe zählt bereits eingereihte Aufträge desselben Gebäudes mit; `maxLevel` und der
  Deckel über die Kommandozentrale gelten für diese Zielstufe, eingereihte Stufen der Kommandozentrale zählen dabei mit.
  Ein Auftrag beginnt, wenn der vorige fertig ist (frühestens beim Einreihen); seine Bauzeit richtet sich nach der Zielstufe.
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

Rückruf:

- Ein eigener Verband auf der Hinfahrt kann zurückgerufen werden, auf der Rückfahrt nicht. Er kehrt sofort um und ist
  nach der bereits gefahrenen Zeit wieder daheim: Rückkehr = Rückruf + (Rückruf − Abfahrt). Am Ziel geschieht nichts.
- Treibstoff wird nicht erstattet. Transportgut kommt mit zurück. Ein durch den eigenen Überfall aufgehobener
  Nachtschild bleibt aufgehoben. Beim Ziel verschwindet der Verband sofort aus den anrückenden Verbänden.

## Vorwarnung

- Radarstation Stufe L ≥ 1: Vorwarnzeit `warningMinutesBase + warningMinutesPerLevel * L` Minuten, ohne Radar 0.
- Ein anrückender Angriff gilt als erkannt, sobald seine Ankunft höchstens die Vorwarnzeit entfernt ist.
  Erst dann sieht der Verteidiger ihn, und erst dann greift an der Börse die Sperre `under_attack`.

## Abbruch

- Ein laufender Ausbau oder Ausbildungsauftrag kann abgebrochen werden. Erstattet wird je Ressource
  `floor(Kosten * Restzeit / Gesamtdauer)`, auch über die Lagerkapazität. Der Bauplatz ist sofort frei.
- In der Bauschlange ist jeder Auftrag einzeln abbrechbar. Ein noch nicht begonnener Auftrag wird voll erstattet.
  Die Aufträge dahinter rücken nach (Start frühestens jetzt, gleiche Dauer). Hätte ein späterer Auftrag danach eine
  ungültige Stufe (die vorige Stufe desselben Gebäudes fehlt oder der Deckel über die Kommandozentrale wäre
  überschritten), wird er voll erstattet und entfernt, ebenso alle folgenden desselben Gebäudes.

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
  Ausgelegt auf eine Saison von 28 Tagen: Ein bezahlbarer Verband schlägt Stufe 1 ab Tag 1–2, Stufe 2 ab Tag 3–5,
  Stufe 3 um Tag 7–10, Stufe 4 um Tag 14–18 und Stufe 5 um Tag 21–28 mit mindestens 70 %. Die Beute einer Stufe passt
  ungefähr in die Ladung der Landungsschiffe eines solchen Verbands.
- Überfälle auf Spieler alle `raidIntervalHours` je Stützpunkt. Stärke (seit v1.1):
  - Verteidigungs-Lebenspunkte = Lebenspunkte aller Schiffe, Bodentruppen und Anlagen daheim (Flugzeuge zählen nicht).
  - Grundstärke in Booten = `raidStrengthShareOfDefense * Verteidigungs-Lebenspunkte / hp(schnellboot)`, mindestens `raidMinSchnellboote`.
  - Je Überfall wird ein Faktor gleichverteilt aus `[1 - raidStrengthSpread, 1 + raidStrengthSpread]` gezogen (eigener Seed,
    nicht der Kampf-Seed). Milizionäre = `Grundstärke * Faktor * raidMiliPerBoot`, gerundet, mindestens 1;
    Schnellboote = `Milizionäre / raidMiliPerBoot`, aufgerundet.
  - Das Kartell führt eigene Landungskapazität mit (`raidMiliPerBoot` je Schnellboot).
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

## Saison und Wertung

- Eine Saison dauert `SEASON_DAYS` Tage (Betriebseinstellung, Vorgabe 28). Es läuft immer genau eine Saison.
- Kostenwert = Summe aller Ressourcen der Baukosten. Punkte je Kategorie = `floor(Kostenwert / 100)`, Gesamt = Summe der Kategorien.
  - **Ausbau:** Kosten aller gebauten Gebäudestufen.
  - **Militär:** Einheiten und Anlagen des Stützpunkts einschließlich der Verbände unterwegs.
  - **Kampf:** Kostenwert der gegnerischen Einheiten und Anlagen, die laut Kampfbericht der Saison vernichtet wurden
    (als Angreifer und als Verteidiger, auch gegen Nester und Kartell). Schnellboot zählt 250, Piratenmiliz 40.
  - **Beute:** Summe der Beute aus eigenen Überfällen der Saison.
- Rang nach Gesamtpunkten; Punktgleiche teilen den Rang.
- Am Saisonende: Gold, Silber und Bronze für Rang 1 bis 3 (mit Punkten), je Kategorie eine Auszeichnung für den Besten.
  Jeder Spieler erhält eine Systemnachricht mit Platz und Auszeichnungen.
- Danach wird die Welt zurückgesetzt: Stützpunkte, Missionen, Lieferungen, Wracks, Kampfberichte und Kredite verfallen,
  Nester sind wieder besetzt, die Börse steht auf Richtwert. Konten, Nachrichten und die Ruhmeshalle bleiben.
  Jeder Spieler wählt einen neuen Hafen und erhält erneut Anfängerschutz.

## Allianzen

- Eine Allianz hat einen Namen (3–32 Zeichen) und ein Kürzel (2–4 Buchstaben oder Ziffern), beide eindeutig ohne
  Groß-/Kleinschreibung, dazu eine Beschreibung (höchstens 500 Zeichen). Ein Spieler gehört höchstens einer Allianz an.
- Höchstgröße: Vorgabe 8 Mitglieder, von Admins einstellbar (2–50, `server_setting` `alliance_max_size`).
  Eine verkleinerte Höchstgröße entfernt niemanden, verhindert aber weitere Aufnahmen.
- Rollen: **Führung** (genau eine), **Offizier**, **Mitglied**. Der Gründer ist Führung.
  - Beitritt nur auf Gegenseitigkeit: Führung oder Offizier lädt ein und der Spieler nimmt an, oder der Spieler fragt an
    und Führung oder Offizier nimmt an. Liegt die Gegenrichtung schon vor, wirkt die zweite Handlung sofort als Beitritt.
  - Ausschließen: die Führung jeden außer sich, Offiziere nur Mitglieder. Rollen vergibt nur die Führung; „Führung
    übergeben“ macht die bisherige Führung zum Offizier. Auflösen darf nur die Führung.
  - Austritt jederzeit. Tritt die Führung aus, übernimmt der dienstälteste Offizier, sonst das dienstälteste Mitglied.
    Tritt das letzte Mitglied aus, ist die Allianz aufgelöst.
- **Verbündete** (dieselbe Allianz) können einander nicht überfallen: `ueberfall` auf einen verbündeten Hafen wird beim
  Planen mit `ally` abgelehnt. Aufklärung und Transport bleiben erlaubt. Wie beim Schutz zählt der Stand beim Planen;
  ein Verband, der vor dem Beitritt ausgelaufen ist, kämpft noch.
- Allianz-Chat: höchstens 500 Zeichen je Zeile, 20 Zeilen je Minute und Spieler, sichtbar sind die letzten 100 Zeilen.
- Wertung: Allianzpunkte = Summe der Gesamtpunkte der aktuellen Mitglieder; Rang nach Allianzpunkten, Gleichstand teilt den Rang.
  Das Kürzel steht in Rangliste und Spielerübersicht vor dem Namen.
- Saisonende: Allianzen, Mitgliedschaften, Chat und Verträge bleiben bestehen. Allianzpunkte werden nicht in
  `season_result` festgehalten.

## Diplomatie

- Parteien sind Allianzen und Spieler ohne Allianz. Für eine Allianz handeln Führung und Offiziere. Tritt ein Spieler
  einer Allianz bei (oder gründet eine), erlöschen seine eigenen Verträge; es gelten die der Allianz. Beim Auflösen einer
  Allianz erlöschen ihre Verträge. Die Gegenseite erhält jeweils eine Systemnachricht.
- **Nichtangriffspakt:** Eine Seite bietet an, die andere nimmt an (bietet sie ihrerseits an, gilt er sofort). Solange er
  gilt, wird `ueberfall` zwischen den Parteien beim Planen mit `pact` abgelehnt. Kündigen kann jede Seite; der Pakt gilt
  dann noch 24 Stunden (Kündigungsfrist) und erlischt danach. Ein offenes Angebot kann zurückgezogen oder abgelehnt werden.
- **Krieg:** Eine Seite erklärt ihn einseitig. Er beginnt nach 12 Stunden Vorlauf. Bei bestehendem Pakt (auch während der
  Kündigungsfrist) ist keine Kriegserklärung möglich (`pact_active`), im Krieg kein Paktangebot (`at_war`).
  Im Krieg entfällt bei gegenseitigen Überfällen die **Schwachziel-Kürzung** der Beute: Maßgeblich ist, ob bei der
  Ankunft des Verbands (Kampfzeitpunkt) Krieg herrscht. Alle übrigen Regeln (Schutz, Wiederholungsfaktor, Ladung) gelten weiter.
- **Frieden:** Die erklärende Seite kann die Kriegserklärung während des Vorlaufs zurückziehen. Sonst bietet eine Seite
  Frieden an; bietet die andere ebenfalls an, endet der Krieg sofort.
- Jede Änderung (Angebot, Pakt, Kündigung, Kriegserklärung, Frieden) erzeugt Systemnachrichten an die Betroffenen.

## Handel zwischen Spielern

- Angebot: gibt Menge X einer Ressource oder Kredite, will Menge Y einer anderen Ressource oder Kredite (ganze Zahlen ≥ 1).
  Sichtbar für alle oder nur für die eigene Allianz (nur mit Allianz). Höchstens 10 offene Angebote je Spieler.
  Einstellen und Annehmen erst ab Hafenkommandantur Stufe `marketFromLevel` (wie die Börse).
- **Treuhand:** Beim Einstellen wird die angebotene Ware sofort aus dem Hafen (bzw. die Kredite vom Konto) abgezogen,
  Börsenkurse, Tages- und Kreditlimits sind nicht beteiligt. Rückzug durch den Anbieter erstattet sofort und vollständig,
  auch über die Lagerkapazität.
- **Annahme:** Nur durch einen anderen Spieler mit Hafen; ein Allianz-Angebot nur durch ein Mitglied derselben Allianz,
  der der Anbieter noch angehört (`not_ally`). Der Annehmende zahlt sofort. Ein Angebot kann genau einmal angenommen werden
  (`offer_gone`). Ressourcen reisen auf beiden Seiten als Lieferung mit Reisezeit `Entfernung der Häfen / convoySpeedKmh`
  (mindestens eine Minute) und werden bei Ankunft gutgeschrieben, auch über die Lagerkapazität. Kredite werden sofort gutgeschrieben.
- **Gebühr:** je empfangener Seite 2 % (Ressourcen ganzzahlig abgerundet, Kredite auf Cent abgerundet); einstellbar über
  `server_setting` `player_trade_fee` (0 bis 0,2). Die Gebühr verlässt das Spiel.
- Saisonende: Offene Angebote verfallen ohne Erstattung (wie Kredite und Lieferungen).
