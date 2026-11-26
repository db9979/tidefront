# TIDEFRONT – Regel-Spezifikation Meilenstein 1

Verbindlich für `packages/game-core`. Alle Zahlen stehen in `packages/balance/v1/balance.json`
und werden dort geändert, nie im Code. Zahlen sind Startwerte; Kartell und Piratennester sind seit Balance v1.1
per Simulation abgestimmt, U-Boote seit v1.2 (`npm run sim`, Ergebnisse in `packages/game-core/ENTSCHEIDUNGEN.md`, Abschnitt C).

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

Zehn Spielereinheiten in drei Gattungen, siehe `units`. Verteidigungsanlagen siehe `defenses`, Gegner siehe `npcUnits`.

- Bau nur, wenn das Gebäude `builtIn` mindestens Stufe `requiresLevel` (Vorgabe 1) hat und kein Versorgungsmangel herrscht.
  Fehlt das Gebäude ganz: `building_required`; liegt es unter der Mindeststufe: `building_level`.
- Bauzeit je Einheit: `seconds / (1 + buildSpeedPerLevel * (L - 1))`.
- Flugzeuge brauchen Stellplätze: `slotsPerLevel * L` (Flugfeld).
- Ein Verband darf höchstens die Kommandopunkte seines Startstützpunkts kosten.
- Bodentruppen reisen nur in Landungsschiffen: Summe `size * Anzahl` ≤ Summe `troopSpace`.
- Flugzeuge nehmen nur teil, wenn die Entfernung zum Ziel ≤ `rangeKm` ist.
- **U-Boote** (`uboot`, seit v1.2): Gattung See, gebaut in der Werft ab Stufe 3 (`requiresLevel`), ohne Truppenraum
  und Ladung. Sie sind getaucht (`submerged`): Sie können nur von Einheiten mit **U-Jagd** (Angriffswert `uboot` > 0)
  getroffen werden – nicht von Bombern, Küstenbatterien, Flak, Landungsschiffen oder dem Kartell. Reisezeit,
  Treibstoff, Kommandopunkte und Unterhalt gelten wie für jedes Schiff.
- Angriffswert `uboot` (U-Jagd, Vorgabe 0): Schaden gegen getauchte U-Boote. In v1.2 haben ihn Korvette und Zerstörer.

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
   Getauchte U-Boote sind kein Ziel des Luftschlags.
3. **U-Boot-Angriff:** Die U-Boote beider Seiten feuern gleichzeitig `combat.torpedoSalvos` Salven (v1.2: 1) mit `see`
   auf die Überwasserschiffe des Gegners (keine Anlagen). Niemand schießt zurück. Ohne U-Boote oder ohne Ziele entfällt die Phase.
4. **Seegefecht:** Schiffe gegeneinander (`see`), Küstenbatterien feuern mit. U-Boote feuern weiter mit `see` auf Schiffe;
   Ziel sind sie nur für die U-Jagd: Jede Einheit mit `uboot` > 0 feuert zusätzlich zu ihrer Salve über Wasser eine
   U-Jagd-Salve (`uboot`) auf die gegnerischen U-Boote, verteilt nach deren Lebenspunkten, mit demselben Zufallsfaktor.
   Das Seegefecht endet vorzeitig, wenn keine Seite die andere mehr treffen kann.
5. **Landung:** Nur wenn Landungsschiffe überleben. Truppen über der verbliebenen Kapazität gehen verloren.
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
- Wracks: `wreckShare` der Stahl- und Elektronikkosten versenkter Schiffe (auch U-Boote) beider Seiten bleiben als Wrackfeld am Kampfort.
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
  - Verteidigungs-Lebenspunkte = Lebenspunkte aller Schiffe (auch U-Boote), Bodentruppen und Anlagen daheim (Flugzeuge zählen nicht).
  - Grundstärke in Booten = `raidStrengthShareOfDefense * Verteidigungs-Lebenspunkte / hp(schnellboot)`, mindestens `raidMinSchnellboote`.
  - Je Überfall wird ein Faktor gleichverteilt aus `[1 - raidStrengthSpread, 1 + raidStrengthSpread]` gezogen (eigener Seed,
    nicht der Kampf-Seed). Milizionäre = `Grundstärke * Faktor * raidMiliPerBoot`, gerundet, mindestens 1;
    Schnellboote = `Milizionäre / raidMiliPerBoot`, aufgerundet.
  - Das Kartell führt eigene Landungskapazität mit (`raidMiliPerBoot` je Schnellboot).
- Kein Überfall während Nachtschild, Anfängerschutz oder Schutz nach Niederlage. Greift ein Schutz erst während der Anfahrt,
  dreht der Verband bei Ankunft ohne Kampf ab; der Verteidiger erhält dazu einen Bericht (`abgewiesen`).
- Kartell und Nester haben keine U-Boote und keine U-Jagd (v1.2): U-Boote sind für sie unverwundbar.

## Schutz

- Nachtschild: `nightShieldHours` Stunden täglich, Startstunde wählt der Spieler (ohne Wahl kein Nachtschild). Eigene Angriffe heben
  ihn für diese Nacht auf.
- Änderung von Startstunde oder Zeitzone (auch Ausschalten): Die neue Einstellung gilt erst `nightShieldChangeHours` Stunden nach
  der Änderung; bis dahin gilt die alte, ein laufendes Fenster der alten endet spätestens dann. Die nächste Änderung ist ebenfalls
  erst nach `nightShieldChangeHours` erlaubt (`shield_cooldown`). So lässt sich der Schild nicht nach einer Radarwarnung gegen einen
  schon anrückenden Angriff einschalten. Die Wahl bei der Gründung gilt sofort. Zeitzone: −840 bis +840 Minuten.
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
  - **Befehle:** Punkte aus abgeholten Tagesbefehlen der Saison samt Serienbonus (bereits Punkte, kein Kostenwert;
    siehe Abschnitt Tagesbefehle).
- Rang nach Gesamtpunkten; Punktgleiche teilen den Rang.
- Am Saisonende: Gold, Silber und Bronze für Rang 1 bis 3 (mit Punkten), je Kategorie eine Auszeichnung für den Besten
  (für Befehle: „Pflichtbewusstester Kapitän“). Der Endstand hält alle fünf Kategorien fest.
  Jeder Spieler erhält eine Systemnachricht mit Platz und Auszeichnungen.
- Danach wird die Welt zurückgesetzt: Stützpunkte, Missionen, Lieferungen, Wracks, Kampfberichte und Kredite verfallen,
  Nester sind wieder besetzt, die Börse steht auf Richtwert, Tagesbefehle und Serien verfallen. Konten, Nachrichten und die Ruhmeshalle bleiben.
  Jeder Spieler wählt einen neuen Hafen und erhält erneut Anfängerschutz.

## Tagesbefehle

- Spieltag: Tageswechsel um 0:00 Uhr in der Zeitzone des Servers (`TZ`, Vorgabe `Europe/Berlin`).
- Jeder Spieler mit Hafen erhält je Spieltag drei Tagesbefehle: Slot 0 **leicht**, Slot 1 **mittel**, Slot 2 **schwer**,
  jede Art höchstens einmal am Tag. Vergeben wird beim ersten Abruf des Tages (Ansicht, Befehl oder Fortschritt);
  die Auswahl ist deterministisch aus Spieler, Tag und Slot und hängt vom Stand des Hafens ab.
- Pool (Art, Stufen, Voraussetzung, Ziel; `s` = Stufe der Kommandozentrale):

  | Art | Stufen | Voraussetzung | Ziel |
  |---|---|---|---|
  | Ausbauten abschließen | l/m/s | – | 1 / 2 / 3 |
  | Bauschlange füllen | l/m | – | 2 / `queueSlots` Aufträge gleichzeitig |
  | Bodentruppen ausbilden | l/m/s | Kaserne | 15 / 40 / 100 × (1 + s/4), auf 5 gerundet |
  | Schiffe in Dienst stellen | l/m/s | Werft | 1 / 2 / 4 + ⌊s/6⌋ |
  | Flugzeuge ausbilden | l/m/s | Flugfeld | 1 / 2 / 4 + ⌊s/6⌋ |
  | Verteidigungsanlagen errichten | l/m/s | – | 1 / 2 / 3 + ⌊s/5⌋ |
  | Vorrat anlegen | l/m/s | Ziel über dem Bestand | knappste Ressource: Bestand + 15 / 30 / 50 % des Lagers, höchstens 95 % |
  | Produktion steigern | m/s | Produktionsgebäude | Rate einer Ressource × 1,15 / 1,35 (mindestens +1) |
  | Kommandozentrale ausbauen | s | nächste Stufe ≤ 12 h Bauzeit | Stufe s + 1 |
  | Piratennest besiegen | m/s | Werft und Kaserne | Stufe ≥ max(1, k − 1) / k, k = min(5, 1 + ⌊s/3⌋) |
  | Kartell-Überfall abwehren | s | Anfängerschutz vorbei | 1 |
  | Aufklärung durchführen | l/m | Werft oder Flugfeld | 1 / 2 |
  | Transport zu Mitspielern | m/s | Werft, andere Spieler | 1 / 2 (zählt bei Ankunft) |
  | Börsenhandel | l/m/s | Börse offen | 300 / 1.000 / 3.000 Kredite × (1 + (Hafenkommandantur − 3)/2) |
  | Wrackgut bergen | m/s | Werft oder Flugfeld | 300 / 1.000 × (1 + s/5) |
  | Nachricht an Mitspieler | l | andere Spieler | 1 |
  | Beute machen | m/s | Werft und Kaserne | 1.500 / 4.000 × (1 + s/4) |
  | Überfall ohne eigene Verluste gewinnen | s | Werft und Kaserne | 1 |

- Fortschritt zählt nur für Geschehen am selben Spieltag (Zeitpunkt des Ereignisses) und nur nach der Vergabe:
  Ausbau, Ausbildung, Anlagen, Kampf, Aufklärung, Transport, Wrack und Beute aus den verarbeiteten Ereignissen,
  Börsenhandel (Kreditbetrag des Handels) und Bauschlange (höchste Länge) aus den Befehlen. Vorrat, Produktion,
  Kommandozentrale und Nachrichten werden beim Abruf und beim Abholen aus dem Zustand gelesen.
- Belohnung je Befehl: Ressourcenpaket im Wert 400 / 1.000 / 2.500 × (1 + 0,3·s) (Stahl 40 %, Treibstoff 25 %,
  Elektronik 15 %, Proviant 20 %, auf 10 gerundet; s bei der Vergabe) und 3 / 6 / 12 Punkte der Kategorie Befehle.
  Abholen ist ein Befehl mit Idempotenz-Schlüssel und gelingt genau einmal; die Ressourcen werden auch über die
  Lagerkapazität gutgeschrieben. Erfüllte Befehle früherer Tage bleiben bis zum Saisonende abholbar.
- Neu würfeln: einmal je Spieltag ein noch nicht erfüllter Befehl des Tages, kostenlos. Neue Art derselben Stufe,
  die an diesem Tag noch nicht vorkommt; Fortschritt beginnt bei 0, Belohnung bleibt.
- Serie: Ein Tag ist abgeschlossen, wenn alle drei Befehle dieses Tages abgeholt sind. Schließt er an den zuletzt
  abgeschlossenen Tag an, wächst die Serie um 1, sonst beginnt sie bei 1. Serienbonus beim Abschluss: Tag 3 +10 Punkte,
  Tag 7 +25 Punkte, danach jeder 7. Tag 10 Punkte mehr (14: +35, 21: +45, …), dazu ein Ressourcenpaket im Wert
  Punkte × 150 × (1 + 0,3·s). Die Serie gilt als unterbrochen, wenn weder heute noch gestern abgeschlossen wurde.
