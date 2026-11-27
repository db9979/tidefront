# TIDEFRONT – Regel-Spezifikation Meilenstein 1

Verbindlich für `packages/game-core`. Alle Zahlen stehen in `packages/balance/v1/balance.json`
und werden dort geändert, nie im Code. Zahlen sind Startwerte; Kartell und Piratennester sind seit Balance v1.1
per Simulation abgestimmt, U-Boote seit v1.2, Forschung seit v1.3, Marktnachrichten seit v1.5, Wetter, Strom und Nachrichtendienst seit v1.6, Spionage-Abstimmung und Kartell gegen Forschung seit v1.7 (`npm run sim`, Ergebnisse in `packages/game-core/ENTSCHEIDUNGEN.md`, Abschnitte C–G).
**Wetter und Strom** (Wetterfeld, Stromquellen, Rangfolge bei Mangel, Wetter im Einsatz) stehen in `docs/REGELN-WETTER.md`, **Nachrichtendienst und Spionage** in `docs/REGELN-SPIONAGE.md`, **Allianzen, Diplomatie und Handel zwischen Spielern** in `docs/REGELN-SOZIAL.md`, **Erfolge (Abzeichen) und Wochenziele** in `docs/REGELN-ERFOLGE.md`, **Minen, Seeblockade und Konvois** in `docs/REGELN-SEE.md`, **Rohstofffelder** in `docs/REGELN-FELDER.md`, **KI-Spieler** in `docs/REGELN-KI.md`; alle gelten als Teil dieser Regeln.

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
- Strom (v1.6, „Wetter und Strom“): Erhält die Produktion nur den Anteil `f` ihres Bedarfs, wird die Gebäudeproduktion (nicht die Grundrate) mal `f` gerechnet.
- Proviant-Unterhalt: Summe `upkeepPerHour * Anzahl` aller Einheiten des Stützpunkts wird von der Proviant-Rate abgezogen.
  Die Netto-Rate kann negativ sein; der Bestand fällt nie unter 0. Bei Bestand 0 und negativer Rate gilt `versorgungsmangel = true`
  (Ausbildungsstopp, Angriffswert aller eigenen Einheiten mal 0,8).
- Lagerkapazität je Ressource: `capacityBase * capacityGrowth^L` (L = Stufe Lagerkomplex, ab 0).
  Produktion füllt nur bis zur Kapazität. Beute und Lieferungen dürfen darüber hinausgehen.
- Lazy Evaluation: `settle(base, nowMs)` schreibt Bestände von `resUpdatedAt` auf `nowMs` fort (seit v1.6 in Zeitschritten).

## Gebäude

- Kosten für den Ausbau von Stufe L auf L+1: `cost * costFactor^L`, je Ressource aufgerundet.
- Bauzeit: `seconds * timeFactor^L`, höchstens `maxBuildSeconds`.
- Höchststufe `maxLevel`. Kein Gebäude außer der Kommandozentrale darf höher sein als
  `Stufe Kommandozentrale + levelCapAboveCommand`.
- Bauschlange: bis zu `building.queueSlots` Ausbauaufträge je Stützpunkt, abgearbeitet nacheinander. Die Kosten werden
  beim Einreihen bezahlt. Die Zielstufe zählt bereits eingereihte Aufträge desselben Gebäudes mit; `maxLevel` und der
  Deckel über die Kommandozentrale gelten für diese Zielstufe, eingereihte Stufen der Kommandozentrale zählen dabei mit.
  Ein Auftrag beginnt, wenn der vorige fertig ist (frühestens beim Einreihen); seine Bauzeit richtet sich nach der Zielstufe.
- Kommandopunkte eines Stützpunkts: `commandPointsBase + commandPointsPerLevel * L`; ab Stufe
  `commandPointsLateFromLevel` (v1.24: 9) zählt jede Stufe `commandPointsLatePerLevel` (60) statt 30
  (KZ 8: 300, KZ 9: 360, KZ 10: 420, KZ 12: 540).
- Tiefbunker: schützt je Ressource `protectedBase * protectedGrowth^L` vor Plünderung.
- Missionsplätze: `missionSlotsBase + floor(L / 2) * missionSlotsPerTwoLevels` (Hafenkommandantur).
- Börse ab Hafenkommandantur Stufe `marketFromLevel`; Kreditlimit `creditLimitPerLevel * L`.

## Einheiten

Zehn Spielereinheiten in drei Gattungen, dazu der Spion (kämpft nicht, siehe Nachrichtendienst), siehe `units`. Verteidigungsanlagen siehe `defenses`, Gegner siehe `npcUnits`.

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

- Reisezeit: `Entfernung / langsamste speedKmh` der Schiffe (seit v1.6 mal Sturmzuschlag der Route, bis +30 %); reine Luftmissionen nach der langsamsten Luftgeschwindigkeit, bei Sturm am Hafen kein Start (`storm`).
- Treibstoff: Summe `fuelPer100Km * Anzahl * Entfernung / 100`, mal 2 für Hin- und Rückweg, aufgerundet; wird beim Start abgezogen.
- Entfernung zwischen Hexfeldern: Großkreis-Entfernung der Feldmittelpunkte in Kilometern.
- **Seewege** (Entscheidung „U. Seewege und Bordsicht“, ENTSCHEIDUNGEN-4.md): Verbände mit mindestens einem Schiff fahren
  eine Route über Wasserfelder statt der Luftlinie; Reisezeit und Treibstoff richten sich nach der Länge dieser Route
  (die Reichweite der Flugzeuge weiter nach der Luftlinie). Reine Luft- und Drohnenverbände fliegen Luftlinie.
  - Befahrbar sind See- und Küstenfelder sowie Passagen (Gibraltar, Ärmelkanal/Dover, Dardanellen–Marmarameer–Bosporus,
    Suezkanal, Öresund/Großer Belt, Messina, Kertsch; `packages/world/src/searoute.ts` PASSAGES). Das Gelände ändert sich
    dadurch nicht. An Küstenfeldern fährt ein Schiff entlang, aber nicht quer über eine Landenge: zwischen zwei
    Küstenfeldern nur über ein gemeinsames Wasserfeld, durch ein Küstenfeld nur, wenn Ein- und Ausfahrt rund um das Feld
    über Wasser verbunden sind. Auf offener See ist die Route die Luftlinie (geglättet), Umwege nur um Land.
  - Die Route wird beim Start einmal gerechnet und im Missionsplan gespeichert (Wegpunkte, Länge); Karte, Bordsicht,
    Rückruf (zurück über dasselbe Stück der Route) und Heimfahrt folgen ihr. Ältere Missionen ohne Route fahren gerade.
  - Ziel nicht über Wasser erreichbar: Fahrt bis zum erreichbaren Feld mit der kürzesten Luftlinie zum Ziel, das letzte
    Stück gerade (Landung über Land). Mit den Passagen ist jedes Küstenfeld der Karte erreichbar.
  - Patrouillen fahren ihre Runde mit Schiffen ebenfalls über die Seewege und nach der Station über die Route heim;
    Konvois (Transport, Felder, Spielerhandel) fahren die Route, ihre Fahrzeit (Felder, Spielerhandel) nach ihrer Länge.
  - Kartell-Überfälle und Börsenlieferungen fahren ebenfalls über Wasser (Kartell-Abschnitt, Börse).

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

- Radarstation Stufe L ≥ 1: Vorwarnzeit `warningMinutesBase + warningMinutesPerLevel * L` Minuten, ohne Radar 0; seit v1.6 mal Stromanteil des Radars und Nebelfaktor.
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
- **Kriegsglück** (seit v1.4, `combat.luck`): Vor jeder Phase würfelt jede Seite einen W20 (`die`), zuerst der
  Angreifer, dann der Verteidiger, Phase für Phase – auch für Phasen, die entfallen (feste Reihenfolge). Der Wurf ist ein
  Faktor auf **allen** Schaden dieser Seite in dieser Phase (Salven, Flak, Bomben, Torpedos, U-Jagd, Minensperren), zusätzlich
  zum Rundenzufall: 1 = Panne `min` (0,8 = −20 %), 20 = Volltreffer `max` (1,2 = +20 %), 2 bis 19 gleichmäßig von
  `innerMin` (0,85) bis `innerMax` (1,15), also etwa 1,8 Prozentpunkte je Augenzahl. Im Mittel neutral: Die Faktoren der
  Augen k und 21 − k ergeben zusammen genau 2, der Erwartungswert ist exakt 1. Die Würfe sind deterministisch aus dem
  Kampf-Seed (eigener Strom, der Rundenzufall bleibt unverändert) und stehen im Bericht je Phase und Seite.
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
- Der Kampfbericht enthält je Phase: Bestände vorher und nachher beider Seiten, den ausgeteilten Schaden je Einheitentyp,
  die W20-Würfe beider Seiten (seit v1.4) und einen Schlüssel `entscheidend` (der Einheitentyp mit dem meisten ausgeteilten Schaden).

## Veteranen

- Jeder Stützpunkt führt je Einheitentyp eine **Erfahrung** (Durchschnitt je Einheit, `veterancy`), gültig für die
  Saison. Rang aus der Erfahrung (`veterans.ranks`, v1.4): **Rekrut** ab 0, **Erprobt** ab 15 (Angriff +5 %),
  **Veteran** ab 40 (+10 %), **Elite** ab 80 (+15 %); höchstens `maxXp` (100).
- Der Rangbonus ist ein Modifikator `attackUnit.<Typ>` der Quelle „Veteranen“ und wirkt im Kampf nur auf Einheiten dieses
  Typs (Angreifer und Verteidiger), multiplikativ mit Forschung. Anlagen, Kartell und Nester sammeln keine Erfahrung.
- **Gewinn** nach jedem Kampf je Typ, der dabei war: Erfahrung je überlebender Einheit = `xpWin` (10) bei Sieg bzw.
  `xpLoss` (4) bei Niederlage, mal Stärkefaktor = gegnerische / eigene Lebenspunkte vor dem Kampf, begrenzt auf
  `ratioMin`–`ratioMax` (0,5–2). Der Gewinn verteilt sich auf den ganzen Bestand des Typs (daheim und unterwegs):
  neu = alt + Überlebende × Gewinn / Bestand.
- **Verluste** kosten anteilig: vor dem Gewinn alt × (1 − `lossPenalty` × verlorene / (Bestand + verlorene)), `lossPenalty`
  0,5. Rückkehrer aus Lazarett, Reparatur und beschädigte Flugzeuge zählen nicht als verloren.
- **Verwässerung:** Neu ausgebildete Einheiten sind Rekruten (0); der Schnitt sinkt als gewichteter Mittelwert
  alt × Bestand / (Bestand + neue).
- Der Verteidiger erhält seine Erfahrung sofort nach dem Kampf, der Angreifer, wenn sein Verband heimkehrt.

## Admirale

- Ernennen in der Hafenkommandantur (Truppen → Admirale), Block `admirals`: Plätze 1 + 1 je 5 Stufen Hafenkommandantur,
  höchstens 3; Kosten 2 000 Kredite und 400 Elektronik. Name aus einer festen Liste (oder ausgelost).
- Ränge nach Erfahrung: Kapitän zur See (0), Konteradmiral (100), Vizeadmiral (300), Admiral (700); Wirkung 50 / 70 /
  85 / 100 % der vollen Boni. Eine Spezialisierung beim Ernennen, eine zweite ab Vizeadmiral: Angriff, Verteidigung,
  Landungstrupp, Logistik, Aufklärung, Beutemeister, U-Boot-Taktik (Werte in `admirals.specs`, je Rolle `mission`,
  `defense`, `harbor`).
- **Landungstrupp** (docs/VORLAGE-ADMIRALE.md): auf Mission Angriff der Landtruppen +10 % (`attack.land`), deren
  Lebenspunkte +8 % (`hp.land`), Minenschaden an den eigenen Landungstruppen −30 % (`mineDamage`); als Hafenkommandant
  (Verteidigung, auch gegen das Kartell) Lebenspunkte der Landtruppen +6 %. Kampfwert voll ausgebildet etwa +10 % bei
  Landungen und Nestern, im Seegefecht keiner – das Gegenstück zu „Angriff“ zur See.
- **Beutemeister:** zusätzlich feste Nestbeute +10 % (`nestLoot`), weiter durch den Laderaum begrenzt.
- **Umschulung:** Admirale, die vor dem Landungstrupp ernannt wurden, dürfen ihre erste Spezialisierung einmal kostenlos
  wechseln (nicht unterwegs; Rang, Erfahrung und zweite Spezialisierung bleiben). Neu ernannte haben keine Umschulung.
- **KI-Spieler** ernennen ab Hafenkommandantur 1 einen Admiral zu denselben Kosten: Freibeuter „Landungstrupp“ (führt
  ihre Überfälle, im Probekampf eingerechnet), Festung „Verteidigung“ als Hafenkommandant; Händler keinen.
- Ein Admiral führt einen Verband (Auswahl in der Missionsplanung; wirkt nur auf diesen Verband, auch gegen
  Weltereignisse und Rohstofffelder – nach einer Feldeinnahme bleibt er bei der Besatzung, siehe REGELN-FELDER.md) oder ist
  **Hafenkommandant** (höchstens einer): Er führt daheim die Verteidigung, auch gegen das Kartell, und wirkt passiv auf den
  Hafen (Quelle „Hafenkommandant“). Unterwegs, verwundet oder gefangen fehlt er daheim.
- Erfahrung nur bei Sieg: zerstörte gegnerische Lebenspunkte / 60, 5 bis 120 je Kampf.
- Nach einer Niederlage mit über 70 % verlorenen Lebenspunkten W20 aus dem Kampf-Seed: 1 gefallen, 2–5 gefangen (48 h
  oder Lösegeld 1 500 Kredite), 6–12 verwundet (12 h), sonst unversehrt. Bericht: beide Admirale, Einfluss, Erfahrung, Wurf.

## Freibeuter-Kartell

- Nester der Stufen 1 bis 5 mit fester Besatzung und Beute (`pirates.nestLevels`), neu besetzt nach `nestRespawnHours`.
  Fahrplan (ausgelegt auf die ersten 28 Tage der Saison, die seit `SEASON_DAYS` = 42 sechs Wochen dauert): Ein bezahlbarer
  Verband schlägt Stufe 1 ab Tag 1–2, Stufe 2 ab Tag 3–5, Stufe 3 um Tag 7–10, Stufe 4 um Tag 14–18 und Stufe 5 um
  Tag 21–28 mit mindestens 70 %. In den Wochen 5 und 6 bleibt Stufe 5 das höchste Nest; Ziele sind dann Weltereignisse
  (werden mit dem Saisonfortschritt stärker und reicher), Felder, der 3. Hafen und andere Spieler. Die Beute einer Stufe passt
  ungefähr in die Ladung der Landungsschiffe eines solchen Verbands.
- Stufe 6 (seit v1.15, „Inselfestung“, Spätspiel Woche 5–6): ≈ Stufe 5 × 1,35; ein voller Verband siegt an Tag 28 zu
  etwa 15 %, ab Tag 35 zu 74 %. Fünf feste Inseln (`LATE_NEST_POINTS`, an `nestSites()` angehängt), eigene Wiederkehr
  `respawnHours` 24 h, Beute 29 000 Einheiten (viel Elektronik). migrate/Seed trägt fehlende Plätze nach (vorhandene
  Nester bleiben; Feld mit Hafen erst beim Saisonwechsel). Kein Freischalten nach Saisontag (ENTSCHEIDUNGEN-3.md N).
- Überfälle auf Spieler alle `raidIntervalHours` je Stützpunkt. Der Verband läuft vom Nest mit dem kürzesten Seeweg
  (unter den drei nächsten nach Luftlinie) über Wasser zum Hafen (Seewege, Entscheidung U): Vorlauf 1 h auf offener
  See, mal Umwegfaktor (Seeweg / Luftlinie), höchstens 3 h. Karte, Radar und Position folgen der Route.
- Stärke der Überfälle (seit v1.1):
  - Verteidigungs-Lebenspunkte = Lebenspunkte aller Schiffe (auch U-Boote), Bodentruppen und Anlagen daheim (Flugzeuge zählen nicht).
    Seit v1.13 gewichtet mit `raidHpWeights` (je ID, sonst je Gattung, sonst 1): Schiffe kämpfen nicht am Boden und zählen
    halb (`see` 0,5), Minenräumer 0,1, Landungsschiffe, Kolonieschiffe und Minenleger gar nicht; Bodentruppen und Anlagen voll.
  - Grundstärke in Booten = `raidStrengthShareOfDefense * Verteidigungs-Lebenspunkte / hp(schnellboot)`, mindestens `raidMinSchnellboote`.
  - Forschung des Verteidigers (seit v1.7): Vom Zuwachs der Lebenspunkte durch Modifikatoren (`hp` je Gattung, Anlagen
    `anlage`) zählt das Kartell den Anteil `raidResearchWeight` (0,5) mit; ohne Forschung unverändert.
  - Je Überfall wird ein Faktor gleichverteilt aus `[1 - raidStrengthSpread, 1 + raidStrengthSpread]` gezogen (eigener Seed,
    nicht der Kampf-Seed). Milizionäre = `Grundstärke * Faktor * raidMiliPerBoot`, gerundet, mindestens 1;
    Schnellboote = `Milizionäre / raidMiliPerBoot`, aufgerundet.
  - Das Kartell führt eigene Landungskapazität mit (`raidMiliPerBoot` je Schnellboot).
  - Die Miliz trifft die Bunkerlinie so hart wie Bodentruppen (`piratenmiliz.attack.anlage` = `land` = 5, seit v1.13; vorher
    1). Eine Bunkerlinie bleibt ein starker Schutz, hält aber nicht mehr jeden Überfall auf.
- Kein Überfall während Nachtschild, Anfängerschutz oder Schutz nach Niederlage. Greift ein Schutz erst während der Anfahrt,
  dreht der Verband bei Ankunft ohne Kampf ab; der Verteidiger erhält dazu einen Bericht (`abgewiesen`).
- Kartell und Nester haben keine U-Boote und keine U-Jagd (v1.2): U-Boote sind für sie unverwundbar. In v1.13 per
  Simulation geprüft und so belassen (U-Boot-Verbände sind gegen Nester nicht besser als Zerstörer;
  `packages/game-core/ENTSCHEIDUNGEN-3.md`, Abschnitt L).

## Weltereignisse des Kartells

Zeitlich begrenzte Ereignisse auf der Karte, die alle Spieler betreffen und Zusammenarbeit belohnen. Werte unter
`worldEvents`, Kern in `packages/game-core/src/world-events.ts`.

- **Planung:** Das erste Ereignis einer Saison entsteht frühestens `firstSpawnAfterHours` nach Saisonbeginn, danach
  je eines im Abstand `spawnIntervalHours` (gleichverteilt, ganze Stunden). Die Art wird nach `kindWeights` gezogen;
  findet sie kein Ziel, wird eine andere Art versucht, sonst nach `retryHours` erneut. Endet die Saison in weniger als
  `minSeasonHoursLeft` Stunden, entsteht keines mehr.
- **Ziele:** Häfen im Anfängerschutz sind nie Ziel und nie Bezug. Die Belagerung trifft nur einen Hafen ohne jeden Schutz,
  der nicht schon belagert ist.
- **Stärke:** Faktor `1 + seasonGrowth * Saisonfortschritt`. Bezugs-Lebenspunkte = Median der Verteidigungs-Lebenspunkte
  (wie beim Kartell-Überfall) der Bezugshäfen, mindestens `minReferenceHp`. Schnellboote =
  `max(Mindestzahl, round(Bezug * Anteil * Faktor / hp(schnellboot)))`.
- **Kampf auf See:** Missionen gegen Ereignisse sind nur Überfälle (`event_needs_raid`). Der Kartellverband verteidigt
  ohne Anlagen. Sinken alle seine Schiffe, ertrinken seine Truppen an Bord und zählen als Verluste; der Verband ist dann
  vernichtet (Bericht: Sieg des Angreifers). Verluste des Verbands bleiben bestehen. Beute wird stets durch die
  Ladekapazität der überlebenden Schiffe begrenzt (proportional gekürzt). Wracks entstehen wie sonst am Kampfort.
  Kampfpunkte zählen wie bei jedem Kampfbericht.
- **Schatzschiff:** entsteht auf einem Seefeld `spawnKmFromBase` km von einem zufälligen Hafen und fährt über Seefelder
  zu einem Piratennest (Kartellhafen), Streckenlänge `routeKm`, Dauer `durationHours`; die Zeit verteilt sich nach
  Strecke. Begleitschutz mit `escortShareOfDefense` und `minEscort` (Bezug: alle Häfen außerhalb des Anfängerschutzes),
  Beute `loot * (1 + lootSeasonGrowth * Fortschritt)`, auf 10 gerundet. Beim Planen wird der früheste Abfangpunkt
  berechnet (erster Zeitpunkt, zu dem die Fahrzeit des langsamsten Schiffs zur Position des Schatzschiffs nicht größer
  ist als die verstrichene Zeit); das Ziel ist das Feld dieses Punktes. Gibt es keinen bis zum Ende der Route:
  `intercept_impossible`; käme der Verband erst nach dem Ende an: `too_late`. Nur der erste Verband, der den
  Begleitschutz vernichtet, erhält die Beute; das Ereignis endet. Später Ankommende finden es leer
  (Bericht `weltereignis_leer`). Erreicht es den Hafen, ist die Beute verloren.
- **Großflotte:** Region um einen zufälligen Hafen (`regionRadiusKm`), Ziele sind bis zu `maxTargets` Häfen außerhalb
  des Anfängerschutzes, nach Entfernung zum Mittelpunkt. Sammelpunkt: Seefeld bis drei Felder vor dem ersten Hafen.
  Ankündigung `announceHours` vorher per Karte, Systemnachricht an alle und Push an die Ziele. Verband aus Schnellbooten
  (`shareOfDefense`, `minSchnellboote`, Bezug: Median der Lebenspunkte der Zielhäfen) und `miliPerBoot` Milizionären
  je Boot. Seit v1.16 (`raidWeights`) zählen die Schiffe daheim im Bezug gewichtet wie beim Kartell-Überfall
  (`pirates.raidHpWeights`: Kriegsschiffe halb, Landungs-, Kolonieschiffe und Minenleger gar nicht; ohne Forschung). Danach greift
  sie alle `attackIntervalHours` den nächsten Hafen an (Kampf wie Kartell-Überfall: eigene Landungskapazität, Beute
  ohne Laderaumgrenze); ein Hafen unter Nachtschild, Anfängerschutz oder Schutz nach Niederlage wird übersprungen.
  Ihre Verluste bleiben. Sind alle Schnellboote versenkt oder alle Ziele abgearbeitet, endet sie. Spieler können sie
  jederzeit davor angreifen (Ziel: ihr aktuelles Feld; der Kampf findet bei Ankunft statt, solange sie besteht).
- **Belagerung:** Ring aus Schnellbooten (`shareOfDefense`, `minSchnellboote`, Bezug: der belagerte Hafen) für
  `durationHours`. Wirkung: keine Börsenkäufe (`siege`; Lieferungen, die schon unterwegs sind, kommen an) und
  `productionPenalty` der Gebäudeproduktion: alle `tickMinutes` wird dieser Anteil der Gebäudeproduktion seit dem
  letzten Abzug abgezogen (nicht bei vollem Lager, nie unter 0), zuletzt beim Ende bzw. Bruch. Der Besitzer kann den
  Ring nicht selbst angreifen (`own_siege`); andere Spieler brechen ihn, indem sie den Verband vernichten.
- **Beute für Schaden** (Großflotte, Belagerung): Beutepool `lootPool * Stärkefaktor` (Großflotte: plus ihre Beute aus
  Hafenangriffen). Je Angriff erhält der Angreifer `Pool * vernichtete Lebenspunkte / Anfangs-Lebenspunkte`, höchstens
  den noch nicht ausgezahlten Rest, begrenzt durch den Laderaum.
- **Saisonende:** Alle Ereignisse und Beiträge verfallen; die Planung beginnt in der neuen Saison von vorn.

## Schutz

- Nachtschild: `nightShieldHours` Stunden täglich, Startstunde wählt der Spieler (ohne Wahl kein Nachtschild). Eigene Angriffe heben
  ihn für diese Nacht auf.
- Änderung von Startstunde oder Zeitzone (auch Ausschalten): Die neue Einstellung gilt erst `nightShieldChangeHours` Stunden nach
  der Änderung; bis dahin gilt die alte, ein laufendes Fenster der alten endet spätestens dann. Die nächste Änderung ist ebenfalls
  erst nach `nightShieldChangeHours` erlaubt (`shield_cooldown`). So lässt sich der Schild nicht nach einer Radarwarnung gegen einen
  schon anrückenden Angriff einschalten. Die Wahl bei der Gründung gilt sofort. Zeitzone: −840 bis +840 Minuten.
- Anfängerschutz `beginnerDays` Tage. Nach verlorener Verteidigung `afterDefeatShieldHours` Stunden Schutz.
- Der Anfängerschutz endet vorzeitig mit dem ersten eigenen Überfall auf einen Spielerhafen (`pvp.beginnerEndsOnPlayerRaid`,
  beim Auslaufen bzw. Beitritt zu einem Sammelangriff auf einen Hafen; Nester, Felder, Weltereignisse, Blockaden,
  Aufklärung nicht) – in allen Häfen des Spielers (`protection.beginnerEndedAtMs`). Ein Rückruf stellt ihn nicht wieder her.

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
  (`Seeweg vom nächsten Handelshafen / convoySpeedKmh`; nächster Hafen und Entfernung über Wasser, Seewege). Verkaufte Ware wird sofort abgezogen, Kredite sofort gutgeschrieben.
- Jeder Handel liefert Journalzeilen (doppelte Buchführung): Summe aller Kredit-Buchungen einschließlich Gebührenkonto ist 0,
  ebenso die Summe je Ressource zwischen Spieler, Markt und Lieferung.
- Garantie, die Tests prüfen: Keine Folge von Käufen und Verkäufen ohne vergangene Zeit, nach der der Spieler von jeder
  Ressource mindestens so viel hält wie vorher (Bestand plus Lieferungen), erhöht seine Kredite.
  Startet der Kurs am Richtwert, steigt außerdem sein zum Richtwert bewerteter Gesamtwert nicht.
  Ein Kauf unter Richtwert ist erlaubt: Das ist eine Wette auf die Rückkehr des Kurses, kein Gewinn aus dem Nichts.
- Auslegungen des Börsenkerns stehen in `packages/game-core/src/market/ENTSCHEIDUNGEN.md` und gelten als Teil dieser Regeln.

## Marktnachrichten

Die Welt verschiebt vorübergehend den **Richtwert** je Ressource, nie den Kurs; der Kurs folgt über die Rückkehrformel.
Werte unter `market.news` (seit v1.5), Kern `packages/game-core/src/market/news.ts`, Server `packages/engine/src/market-news*.ts`.

- **Einfluss** = Nachricht (Ressource, Richtung, Prozent `pct` vom Grundrichtwert, Grund, Beginn, Ende): voll bis zum Ende,
  danach linear abklingend. Unter `minPct` keine Nachricht. Ändert sich die Wirkung eines Anlasses, endet die alte sofort.
- **Weltereignisse** (ab dem Entstehen, nach dem Ende `fadeHours` 24–36 h abklingend): Großflotte (angekündigt oder
  laufend) Treibstoff und Proviant `pct × Stärkefaktor`, höchstens `maxPct` (12–15 %); Belagerung Proviant +10 %;
  Schatzschiff erbeutet Stahl und Elektronik −10 %, entkommen +5 %, je `holdHours` voll ab dem Ausgang.
- **Kriegslage** (Treibstoff): `calm + perWar × laufende Kriege + perRaid × Kartell-Überfälle (24 h)`, begrenzt auf
  `[calm, max]` = −4 … +8 %, ganze Prozent.
- **Knappheit** (je UTC-Tag; aktive Häfen = Spieler in `activeDays` Tagen gesehen): Tageswert = `fillWeight × (neutralFill −
  Median Bestand / Median Lagerkapazität) + deficitWeight × Anteil Häfen mit negativer Netto-Produktion`, ±`max` (10 %);
  Wirkung = Mittel der letzten `window` Tageswerte, ganze Prozent. Unter `minBases` (3) aktiven Häfen keine Wirkung.
- **Saisonende:** letzte `days` (7) Tage Stahl und Elektronik tageweise je 1/7 bis +8 %. **Grenzen:** Summe je Ressource
  ±`maxTotal` (25 %); effektiver Richtwert = Grundrichtwert × (1 + Versatz), der Versatz folgt der Summe ≤ `maxChangePerHour` (5 %) je Stunde.
- **Schutzregeln:** Rückkehr, Angebot und Handel nutzen den effektiven Richtwert. `price_bounds` bleibt am
  **Grundrichtwert** (Anlässe, die Spieler mit auslösen können, verschieben den harten Korridor nicht). Kursband und Pause
  bleiben (Vergleich mit den tatsächlichen Kursen vor 1 h / 24 h); bei 5 %/h löst eine Nachricht allein keine Pause aus.
  Die **Garantie** der Börse gilt mit dem effektiven Richtwert unverändert; ohne Nachrichten ist alles bit-gleich.
- **Ablauf und Anzeige:** Weltereignisse schreiben ihre Nachricht bei Beginn und Ende; ein Worker-Job wertet alle 10 Minuten
  die Lage aus (Knappheit täglich) und schreibt den Versatz fort. `market.news` zeigt wirkende Nachrichten und die der
  letzten 24 h; Push „Marktnachricht“ (Vorgabe aus) ab `pushMinPct` (5 %). Saisonende: alles verfällt.

## Saison und Wertung

- Eine Saison dauert `SEASON_DAYS` Tage (Betriebseinstellung, Vorgabe 42). Es läuft immer genau eine Saison.
- Kostenwert = Ressourcen der Baukosten zum Börsen-Richtpreis (v1.24, `market.refPrice`: Stahl 1, Treibstoff 1,8,
  Elektronik 3, Proviant 0,6; vorher Summe aller Ressourcen). Punkte je Kategorie = `floor(Kostenwert / 100)`,
  Gesamt = Summe der Kategorien. Die Punkte werden nicht gespeichert, sondern bei jedem Abruf aus Stand und
  Kampfberichten berechnet; eine geänderte Wertung gilt sofort für die ganze laufende Saison.
  - **Ausbau:** Kosten aller gebauten Gebäudestufen.
  - **Militär:** Einheiten und Anlagen des Stützpunkts einschließlich der Verbände unterwegs.
  - **Kampf:** Kostenwert der gegnerischen Einheiten und Anlagen, die laut Kampfbericht der Saison vernichtet wurden
    (als Angreifer und als Verteidiger, auch gegen Nester und Kartell). Schnellboot zählt 250, Piratenmiliz 40.
    Abwehr ohne angreifenden Spieler (Kartell-Überfall, Großflotte, Konvoi, Feld) zählt nur `scoring.npcDefenseFactor`
    (v1.24: × 0,25). Eigene Angriffe auf Großflotte und Belagerungsring zählen voll (Nutzerentscheid 27.11.2026,
    `npcWorldEventKinds` leer), ebenso Nester, Schatzschiff und Spielerkämpfe.
  - **Beute:** Wert der Beute aus eigenen Überfällen der Saison (zum Richtpreis).
  - **Befehle:** Punkte aus abgeholten Tagesbefehlen der Saison samt Serienbonus (bereits Punkte, kein Kostenwert;
    siehe Abschnitt Tagesbefehle).
- **Spieler gegen Spieler** (Vorlage „Mehr Spieler gegen Spieler“, freigegeben 27.11.2026, alle Empfehlungen; Block `pvp`): gilt für
  jeden Kampfbericht mit Spieler auf beiden Seiten (Überfall, Sammelangriff, Blockadekampf, Konvoi, Feld). Nur die
  Wertung ändert sich; Beute und Verluste bleiben. Ein geplünderter Spieler verliert weiterhin keine Punkte – die
  Paarbremse verhindert, dass zwei Freunde so Punkte erzeugen.
  - **Rang zum Tagesbeginn:** Beim ersten Abruf des Spieltags (Worker alle 10 min, sonst erster Kampf oder Rangliste)
    hält der Server Rang und Gesamtpunkte aller Spieler fest (`server_setting pvp_rank_snapshot`). Jeder Spielerkampf
    speichert daraus `report.pvp` = { Rang und Punkte beider, Kopfgeld, Mutfaktor, Absprache }.
  - **Kopfgeld:** Ziel auf Rang 1/2/3 (mit Punkten), Angreifer schlechter platziert (oder ohne Rang): Kampfpunkte des
    Angreifers × (1 + `bountyByRank`) = ×1,5/1,35/1,2, nicht die Beute. Kampfpunkte des Kopfgeld-Ziels aus diesem Kampf
    × `bountyDefenseFactor` (0,5) – auch bei Absprache.
  - **Mutfaktor:** m = √(Punkte Ziel / Punkte Angreifer), begrenzt `mutMin`–`mutMax` (0,5–1,5; Angreifer ohne Punkte 1,5)
    auf Kampf- und Beutepunkte des Angreifers. Kopfgeld × Mut höchstens `maxFactor` (2).
  - **Paarbremse:** Spielerkämpfe desselben Paares (beide Richtungen; Sammelangriff: jeder Teilnehmer mit dem Ziel)
    innerhalb von `pairWindowHours` (72 h) zählen × `pairFactors` 1/0,5/0,25/0 nach Zahl der früheren Kämpfe im
    Fenster. Der Angreifer nimmt die Stufe seines Paares, der Verteidiger die niedrigste der beteiligten Paare. Aus den
    Berichten der Saison abgeleitet (auch für ältere Berichte ohne Stempel), nichts gespeichert.
  - **Absprache-Sperre:** Kein Kopfgeld und Mutfaktor höchstens 1, wenn ein Beteiligter mit dem Ziel in den letzten
    `collusionDays` (7) Tagen ein Handelsangebot angenommen hat, ein Transport zwischen ihnen ankam, einer beim anderen
    stationiert war, sie in derselben Allianz oder im Pakt sind oder waren (Austritt, Ausschluss, Auflösung, Paktende
    werden in `server_setting pvp_ties` gemerkt). Beim Kampf geprüft und im Bericht festgehalten.
  - **Verwaltung „Auffällige Paare“:** Paare mit ≥ `suspiciousFights` (3) Spielerkämpfen in `suspiciousDays` (7) Tagen
    oder mit Siegen ohne Verluste des Verteidigers; „Bericht aus der Wertung nehmen“ setzt `report.pvpExcluded` (Kampf
    und Beute beider Seiten zählen 0; für die Paarbremse zählt der Kampf weiter).
  - **KI-Spieler:** Der Freibeuter wählt unter seinen erlaubten Zielen Kopfgeld-Ziele zuerst.
  - Nachtschild und Schutz nach Niederlage bleiben unverändert.
- Rang nach Gesamtpunkten; Punktgleiche teilen den Rang.
- Am Saisonende: Gold, Silber und Bronze für Rang 1 bis 3 (mit Punkten), je Kategorie eine Auszeichnung für den Besten
  (für Befehle: „Pflichtbewusstester Kapitän“), dazu „Grünster Hafen“ für den meisten genutzten Ökostrom in einem Hafen
  (v1.21, mindestens 1000 Strom-Stunden, ohne Punkte; [REGELN-STROM.md](REGELN-STROM.md)). Der Endstand hält alle fünf
  Kategorien fest.
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
  | Forschung abschließen | m | Forschungsamt | 1 |
  | Speicherwerk ausbauen | m | Speicherwerk ≥ 1, nächste Stufe ≤ 12 h | nächste Stufe (mindestens 2) |
  | Stromüberschuss halten | l | Speicherwerk, Ziel über dem Ladestand | Speicher auf 60 % der Kapazität (auf 10 gerundet) |
  | Windpark oder Solarfeld ausbauen | l | Kraftwerk, nächste Stufe ≤ 12 h | Summe beider Stufen + 1 |
  | Strom aus Wind und Sonne | m | Windpark oder Solarfeld, Ziel über der Erzeugung jetzt | 40 % der Höchstleistung, auf 10 gerundet (bester Abruf des Tages) |
  | Mission trotz Sturm | m/s | Werft oder Flugfeld | 1 (Aufklärung, Transport oder gewonnener Überfall mit Sturmanteil der Route ≥ 0,2) |
  | Ziel erkunden (Nachrichtendienst) | l/m | Nachrichtendienst, Ziel erreichbar | 1 / 2 gelungene Erkundungen |

- Fortschritt zählt nur für Geschehen am selben Spieltag (Zeitpunkt des Ereignisses) und nur nach der Vergabe:
  Ausbau, Ausbildung, Anlagen, Kampf, Aufklärung, Transport, Wrack und Beute aus den verarbeiteten Ereignissen,
  Börsenhandel (Kreditbetrag des Handels) und Bauschlange (höchste Länge) aus den Befehlen. Vorrat, Produktion,
  Forschung zählt beim Abschluss (Ereignis). Kommandozentrale, Nachrichten und die Strom-Befehle werden aus dem Zustand
  gelesen: beim Abruf und Abholen, nach jedem abgeschlossenen Ausbau des Spielers und alle 10 Minuten im Worker-Takt
  (nur Spieler mit offenen Befehlen dieser Art). Es zählt der beste Stand des Tages – wer erst abends nachsieht, behält
  den Höchststand von Ökostrom, Stromspeicher oder Vorrat vom Mittag (auf 10 Minuten genau).
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

## Auftragsbuch

- Elf Grundaufträge auf der Basis (Reihenfolge wie in der Oberfläche): Kraftwerk Stufe 1; Stahlwerk Stufe 1; Raffinerie
  und Versorgungshof Stufe 1; Kommandozentrale Stufe 1; Kaserne Stufe 1; 30 Schützen (daheim und unterwegs; `GUIDE_GOALS`); Werft
  Stufe 1; 2 Korvetten und 1 Landungsschiff; ein eigener gewonnener Überfall auf ein Piratennest (Kampfbericht der
  Saison); Hafenkommandantur Stufe 3; Radarstation und Tiefbunker Stufe 1.
- Erfüllung prüft der Server aus dem Stand des Hafens (packages/engine/src/guide.ts), auch für früher Erledigtes.
- Jeder erfüllte Auftrag gibt ein abholbares Ressourcenpaket, passend zum nächsten Schritt (`balance.guide.steps`):

  | Auftrag | Paket |
  |---|---|
  | Kraftwerk | Stahl 200, Treibstoff 50 |
  | Stahlwerk | Stahl 300, Treibstoff 50, Elektronik 20 |
  | Raffinerie und Versorgungshof | Stahl 400, Treibstoff 100, Elektronik 100 |
  | Kommandozentrale | Stahl 300, Treibstoff 50, Proviant 200 |
  | Kaserne | Stahl 600, Proviant 400 |
  | 30 Schützen | Stahl 300, Proviant 600 |
  | Werft | Stahl 800, Treibstoff 300, Elektronik 100 |
  | 2 Korvetten, 1 Landungsschiff | Stahl 400, Proviant 400 |
  | Piratennest | Treibstoff 800, Elektronik 200 |
  | Hafenkommandantur 3 | Stahl 600, Elektronik 250 |
  | Radarstation und Tiefbunker | Stahl 600, Treibstoff 200, Elektronik 200, Proviant 300 |

- Abschlussbelohnung, sobald alle elf abgeholt sind (`balance.guide.final`): Stahl 2.000, Treibstoff 1.000,
  Elektronik 600, Proviant 1.000; Abzeichen **Hafenmeister** für diese Saison (Rangliste und Spielerübersicht neben
  dem Namen); einmalig −1 Stunde Bauzeit (`buildBoostSeconds` 3.600). Die Verkürzung wirkt direkt an der Bauschlange:
  Der laufende Ausbau wird um bis zu eine Stunde früher fertig (frühestens sofort), die wartenden Aufträge rücken um
  dieselbe Spanne vor. Läuft kein Ausbau, gilt sie für den nächsten, der gestartet wird. Kein Modifikator.
- Summe aller Pakete 13.420 Ressourcen, etwa 1,5 Tage Anfangsproduktion. Simulation (`npm run sim`): der Bot mit
  Auftragsbuch liegt nach dem Abschluss gleichbleibend etwa 1,5 Tage vor dem ohne (Tag 28: +9 % Ausgaben); der Vorsprung
  wächst nicht weiter.
- Abholen ist ein Befehl mit Idempotenz-Schlüssel (`guide.claim`, `guide.claimFinal`) und gelingt je Spieler, Saison und
  Auftrag genau einmal, auch bei gleichzeitigen Aufrufen. Ressourcen füllen den Heimathafen höchstens bis zur
  Lagerkapazität (Bestände darüber bleiben, sinken aber nicht); der Rest verfällt und steht als `lost` in der Antwort.
  Die Oberfläche warnt vor dem Abholen und bietet „Lagerkomplex ausbauen“ an; abholbar bleibt jeder Auftrag die Saison.
- Start-Nest (Einstieg): Bei der Hafenwahl eines menschlichen Spielers (chooseBase) gibt es ein unbesiegtes Nest der
  Stufe 1 in höchstens 300 km (`START_NEST_KM`, Luftlinie). Fehlt es, legt der Server eines auf einem freien Seefeld
  direkt vor der Küste an, übers Wasser vom Hafen erreichbar, 90–300 km entfernt (Wunsch 180 km, möglichst 120 km
  Abstand zu anderen Nestern), nicht auf Häfen, Nestern, Rohstofffeldern/-plätzen oder Handelshäfen; das Gelände bleibt.
  Das Nest steht im Lagebild des Spielers (Quelle „Hafenamt“), und das Auftragsbuch nennt es mit Stufe als Ziel des
  Nest-Auftrags (`nestTarget`, auch unter Kartennebel), solange der Auftrag offen ist. KI-Spieler bekommen keins.
  Start-Nester verfallen beim Saisonwechsel (die Weltplätze bleiben).
- „Lohnende Ziele“ (Truppen → Einsatz): je Nest der kleinste Verband aus dem Bestand daheim, der im Probekampf
  (100 feste Seeds, ohne Wetter) mindestens 90 % gewinnt (game-core `smallestWinningRaid`); reicht der Bestand nicht,
  der volle Verband und wie viele Schützen fehlen. Stufe-1-Nester in 300 km und das Auftragsziel stehen immer dabei.
- Saison: Abholungen werden je Saison gespeichert (Tabelle `guide_claim` mit `season_id`, die alte Saison bleibt
  erhalten). In der neuen Saison sind alle Aufträge und die Abschlussbelohnung wieder offen.

## Allianzen, Diplomatie, Handel

Allianzen (Rollen, Beitritt, Chat, Wertung), Diplomatie (Nichtangriffspakt, Krieg, Frieden) und Handel zwischen
Spielern (Treuhand, Gebühr, Börsenwert, Handelsstatistik) stehen in `docs/REGELN-SOZIAL.md`. Kurz: Verbündete
(`ally`) und Paktpartner (`pact`) können einander nicht überfallen; im Krieg entfällt die Schwachziel-Kürzung der Beute.

## Modifikatoren

- Ein Modifikator ist ein Faktor auf einen Spielwert; fehlt er, gilt 1. Werte (Schlüssel in `Modifiers`):
  Angriff je Gattung des Schützen (`attack.see|land|luft|anlage`), je verwendetem Angriffswert
  (`attackVs.see|luft|land|anlage|uboot`, `uboot` = U-Jagd) und je Einheitentyp (`attackUnit.<id>`); Lebenspunkte je
  Gattung (`hp.*`); Tempo je Gattung (`speed.see|luft`); Treibstoffverbrauch (`fuel`); Bauzeit Gebäude (`buildTime`);
  Ausbildungszeit je ausführendem Gebäude (`trainingTime.werft|kaserne|flugfeld|anlagen`); Gebäudeproduktion je
  Ressource (`production.*`, nicht die Grundrate); Lagerkapazität (`storage`); Bunkerschutz (`bunker`);
  Radar-Vorwarnzeit (`radarWarning`, auch Nebel als Quelle „Wetter“); Ladekapazität (`cargo`); Beute-Anteil (`loot`, nur Anteilsbeute, nicht feste
  Nestbeute); Minenschaden an den eigenen Landungstruppen (`mineDamage`); Tarnung (`stealth`: Faktor auf die
  Vorwarnzeit, die das Ziel gegen eigene Überfälle hat); Forschungsdauer (`researchTime`); Spionage (`spyAttack`,
  `spyDefense`: Faktor, der in Würfelpunkte umgerechnet wird, `round((Faktor − 1) × 10)`).
- Quelle **Sabotage** (Nachrichtendienst): Eine laufende Sabotage im eigenen Hafen wirkt als Modifikator (siehe dort).
- **Kombination:** Quellen (Forschung, Veteranen, Wetter, Admirale, künftig Ereignisse) werden je Wert **multipliziert**.
  Innerhalb einer Technik wirken Stufen additiv: Faktor = 1 + Wirkung je Stufe × Stufe.
- Im Kampf gelten die Modifikatoren jeder Seite nur für ihre eigenen Einheiten und Anlagen (Lebenspunkte, Angriff);
  der Angreifer bringt Minenschaden, Ladung und Beute-Anteil mit, der Verteidiger seinen Bunkerschutz.
  Kartell und Piratennester haben keine Modifikatoren.
- Reise: Tempo je Gattung vor der Wahl des langsamsten Schiffs (bzw. Flugzeugs); Treibstoff vor dem Aufrunden.
- Bauzeit nach der Kappung durch `maxBuildSeconds`. Produktion und Lager wirken in der Fortschreibung; ändern sie
  sich (Forschung fertig), wird zuvor bis zu diesem Zeitpunkt fortgeschrieben.

## Forschung

- Gebäude **Forschungsamt** (`research.building`). Es läuft höchstens **eine** Forschung je Stützpunkt.
- Technik `t` von Stufe L auf L+1: Kosten `cost * research.costFactor^L` (je Ressource aufgerundet, beim Start bezahlt),
  Dauer `seconds * research.timeFactor^L / (1 + researchSpeedPerLevel * (Stufe Forschungsamt − 1))`.
- Voraussetzungen: Forschungsamt mindestens Stufe 1 bzw. `requiresBuildingLevel` (3 oder 5), Vorgänger-Techniken
  mit Mindeststufe (`requires`), Höchststufe `maxLevel` (1–3). Wirkung je Stufe 5–12 %; voll erforscht höchstens
  ±25 % in einem Bereich.
- Abbruch: Erstattung nach Restzeit (abgerundet), wie beim Ausbau.
- Zweige und Techniken (v1.3; Wirkung je Stufe × Höchststufe, Rang = nötige Stufe des Forschungsamts):

  | Zweig | Technik | Wirkung je Stufe | Stufen | Rang | Voraussetzung |
  |---|---|---|---|---|---|
  | Seefahrt | Dampfturbinen | Tempo Schiffe +8 % | 3 | 1 | – |
  | Seefahrt | Schiffspanzerung | Lebenspunkte Schiffe +6 % | 3 | 1 | – |
  | Seefahrt | Sonar | U-Jagd +10 % | 2 | 3 | Dampfturbinen 1 |
  | Seefahrt | Prisenrecht | Beute-Anteil +10 % | 2 | 3 | Schiffspanzerung 1 |
  | Seefahrt | Torpedoleitsysteme | Angriff U-Boote +8 % | 3 | 5 | Sonar 1 |
  | Heer | Infanteriewaffen | Angriff Bodentruppen +5 % | 2 | 1 | – |
  | Heer | Drillausbildung | Ausbildungszeit Kaserne −10 % | 2 | 1 | – |
  | Heer | Verbundpanzerung | Lebenspunkte Bodentruppen +5 % | 3 | 3 | Infanteriewaffen 1 |
  | Heer | Pioniertechnik | Minenschaden −12 % | 2 | 3 | Drillausbildung 1 |
  | Heer | Festungsbau | Lebenspunkte Anlagen +8 % | 3 | 5 | Pioniertechnik 1 |
  | Luftfahrt | Funkmesstechnik | Radar-Vorwarnzeit +12 % | 2 | 1 | – |
  | Luftfahrt | Strahltriebwerke | Tempo Flugzeuge +8 % | 3 | 1 | – |
  | Luftfahrt | Luftkampftaktik | Angriff gegen Luftziele +6 % | 3 | 3 | Funkmesstechnik 1 |
  | Luftfahrt | Tarnanstrich | Vorwarnzeit des Gegners −10 % | 2 | 3 | Funkmesstechnik 2 |
  | Luftfahrt | Präzisionsbomben | Angriff Jagdbomber +8 % | 3 | 5 | Luftkampftaktik 1 |
  | Wirtschaft | Hochofen | Stahlproduktion +8 % | 3 | 1 | – |
  | Wirtschaft | Logistik | Treibstoff −8 %, Ladekapazität +8 % | 3 | 1 | – |
  | Wirtschaft | Lagertechnik | Lagerkapazität +10 % | 2 | 1 | – |
  | Wirtschaft | Fertigbau | Bauzeit Gebäude −8 % | 3 | 3 | Hochofen 1 |
  | Wirtschaft | Stahlbetonbunker | Bunkerschutz +12 % | 2 | 3 | Lagertechnik 1 |
  | Nachrichtendienst | Verschlüsselung | Abwehr gegen Spione +1 (`spyDefense` +0,1) | 2 | 2 | – |
  | Nachrichtendienst | Agentenschulung | Erfolgswert Spione +1 (`spyAttack` +0,1) | 2 | 2 | – |

- **Durchbruch-Würfel:** Jede abgeschlossene Forschung würfelt einen Prozentwurf (W100, 1–100). Die Chance steht vor
  dem Start offen im Info-Blatt und wird beim Start festgehalten: `baseChance + perBuildingLevel * Stufe Forschungsamt`,
  höchstens `maxChance` (v1.3: 10 % + 2 Punkte je Stufe, höchstens 25 %). Durchbruch, wenn der Wurf ≤ Chance × 100.
  Der Wurf ist deterministisch aus einem beim Start gespeicherten Seed, wird beim Abschluss (Ereignis
  `research_complete`) gezogen und mit Technik, Stufe, Chance und Ergebnis gespeichert.
- Bei einem Durchbruch wählt der Spieler eine Belohnung: (a) die gerade erforschte Technik erhält eine Stufe zusätzlich,
  sofern sie noch nicht auf Höchststufe ist, sonst automatisch (b); (b) die nächste gestartete Forschung dauert
  `speedFactor` (0,5) so lange – genau einmal; wird diese Forschung abgebrochen, bleibt die Belohnung erhalten. Bis zur
  Wahl kann keine neue Forschung beginnen. Dieselbe Wahl erneut ändert nichts; eine andere wird abgelehnt.
  Durchbrüche kosten nichts und setzen nichts ein. Bei Durchbruch gibt es eine Systemnachricht und eine Benachrichtigung.
- Forschung gilt **je Saison**: Mit dem Stützpunkt wird sie zum Saisonende gelöscht.

## Mehrere Häfen

Gründung von Außenposten per Kolonieschiff, Verlegung zwischen eigenen Häfen und Transport in eigene Häfen stehen in
`docs/REGELN-EXPANSION.md` (Teil dieser Regeln).
