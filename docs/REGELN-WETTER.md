# TIDEFRONT – Wetter und Strom (Balance v1.6)

Teil von `docs/REGELN.md` (dort aus Platzgründen ausgelagert). Verbindlich für `packages/game-core`.

Werte unter `weather`, `power` und bei den Gebäuden in `balance.json`; Kern in
`packages/game-core/src/weather.ts` und `power.ts`.

## Wetterfeld

Rein und deterministisch aus Ort, Zeit und `weather.seed`; einzige Zufallsquelle ist `mulberry32`.

- Alle `systemEveryHours` (12) Stunden entsteht im Westen ein Wettersystem (Seed aus Grund-Seed und Zeitfenster): 62 % Tiefs
  (Breite 44–66°, Zug 32–60 km/h nach Osten), sonst Hochs (Azorenhoch, langsam). Lebensdauer `systemLifeHours` (108 h),
  Stärke sinusförmig über die Lebenszeit, Wirkung als Glocke um den Kern. Ein Saisonstart liegt in einem anderen Zeitfenster
  als der vorige: jede Saison hat ihr eigenes Wetter.
- Größen je Ort (alle 0–1): **Wind** = Klima + Tiefs − Hochs + Rauschen über Raum und Zeit; **Bewölkung** ebenso;
  **Nebel** an den Nebelküsten (Neufundland, Nordsee, Ärmelkanal) bei wenig Wind, eher nachts und unter Hochdruck;
  **Tageslicht** = Sinus der Sonnenhöhe aus Breitengrad, Uhrzeit (UTC und Länge) und Jahreszeit (Datum), nachts 0.
  **Sturm** ab Wind `stormFrom` (0,8).
- Klima: Nordatlantik, Nordsee und Skandinavien windiger und wolkiger, Mittelmeer und Nordafrika sonniger; im Winter
  etwas mehr Wind und Wolken. Jahresmittel (Simulation): Nordsee Wind 0,56, Sturm 7 %; Mittelmeer Wind 0,21, nie Sturm.
- Das Feld wird je Ort und Minute zwischengespeichert; die Karte rechnet dasselbe Feld im Browser.

## Stromquellen

- **Kraftwerk:** `powerSupplyPerLevel * L` (60) bei jedem Wetter, verbraucht `fuelPerHourPerLevel * L` (3) Treibstoff je
  Stunde. Bei Treibstoff 0 läuft es nur so weit, wie Treibstoff nachkommt (Grundrate und Raffinerie): Auslastung so, dass
  der Treibstoff-Bestand bei 0 bleibt. Ohne Zufluss liefert es nichts; dann tragen Wind, Sonne und Speicher die Last.
- **Windpark:** `windPowerPerLevel * L * Wind` (80), bei Wind über `stormCutoff` (0,95) abgeschaltet.
- **Solarfeld:** `solarPowerPerLevel * L * Tageslicht * (1 − cloudLoss * Bewölkung)` (150, cloudLoss 0,7).
- **Speicherwerk:** Kapazität `storagePerLevel * L` (200), Lade- und Entladeleistung `storageRatePerLevel * L` (40) je
  Stunde. Überschuss lädt bis zur Kapazität, bei Mangel wird bis zur Leistung entladen. Der Ladezustand steht im
  Stützpunkt (`powerStored`).

## Verbraucher und Rangfolge bei Mangel

Rangfolge (`powerRank`, Bedarf `powerPerLevel * L`):

1. Radarstation (5): Vorwarnzeit mal versorgtem Anteil, ganz ohne Strom keine Vorwarnung.
2. Produktionsgebäude (wie bisher): Gebäudeproduktion mal versorgtem Anteil.
3. Werft, Kaserne, Flugfeld (je 3), nur solange dort eine Ausbildung läuft: Ausbildung anteilig langsamer.
4. Forschungsamt (5), nur solange eine Forschung läuft: Forschung anteilig langsamer.

Das Angebot (Erzeugung plus Entladung) wird in dieser Reihenfolge verteilt; jeder Rang erhält `min(Rest, Bedarf)`.

## Fortschreibung

`settle` integriert in Schritten von `power.stepMinutes` (30) Minuten, an der Uhr ausgerichtet; das
Wetter am Hafen gilt je Schritt. Ein Schritt wird geteilt, wenn der Speicher voll oder leer wird, der Treibstoff 0 erreicht
oder ein Ausbildungs- bzw. Forschungsauftrag endet; dazwischen sind alle Raten konstant. Zweimal fortschreiben ergibt
dasselbe wie einmal. Der Hafen kennt seine Lage (`site`, aus dem Feld).

## Ausbildung und Forschung

Die Fertigstellung wird **beim Start** mit der Stromprognose bestimmt: Der Auftrag schreitet
mit dem versorgten Anteil seines Rangs voran, mindestens mit `power.minSpeed` (0,25); die Prognose rechnet bis
`horizonHours` (336) voraus, danach mit dem letzten Tempo. Danach steht die Zeit fest (Ereignisse `training_complete`
und `research_complete` bleiben unverändert); spätere Änderungen am Hafen verschieben sie nicht.

## Wetter im Einsatz

- **Reise:** Wetter entlang der Route bei Abfahrt (`routeSamples` = 9 Punkte zwischen Start und Ziel). Sturmanteil je Punkt
  = 0 bis Wind `shipSlowFrom` (0,5), linear bis 1 bei `shipSlowFull` (0,9). Reisezeit der Schiffe mal
  `1 + shipSlowMax * mittlerer Sturmanteil` (höchstens +30 %). Reine Luftmissionen starten bei Sturm am Hafen nicht
  (`storm`); mit Schiffen läuft der Verband aus.
- **Kampf:** Wetter am Kampfort zum Kampfzeitpunkt. Aller Schaden von Flugzeugen (Luftkampf, Luftschlag) beider Seiten mal
  `1 − airStormPenalty * Sturmanteil` (0,6); der Luftschlag der Bomber zusätzlich mal `1 − cloudStrikePenalty * Bewölkung`
  (0,3). Flak und Schiffe sind nicht betroffen. Der Bericht enthält das Wetter.
- **Nebel und Radar:** Vorwarnzeit mal `1 − fogRadarMax * Nebel` am Hafen (bis −30 %), als Modifikator-Quelle „Wetter“
  (auf ganze Prozent gerundet, nur mit Radarstation).
- **Nebel und Aufklärung:** Ab Nebel `fogScoutFrom` (0,35) am Ziel ist das Lagebild unsicher (`uncertain`): Bestände auf
  zwei gültige Stellen, Einheiten und Anlagen auf 5 gerundet; ab `fogScoutHeavy` (0,65) grob (eine Stelle, auf 10).
  Gebäude bleiben genau.

