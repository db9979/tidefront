# TIDEFRONT – Wetter und Strom (Balance v1.6, Wettermodell v1.9, Vorhersage v1.18)

Teil von `docs/REGELN.md` (dort aus Platzgründen ausgelagert). Verbindlich für `packages/game-core`.

Werte unter `weather`, `power` und bei den Gebäuden in `balance.json`; Kern in
`packages/game-core/src/weather.ts` und `power.ts`, Vorhersage in `weather-forecast.ts`.

## Wetterfeld

Rein und deterministisch aus Ort, Zeit und `weather.seed`; einzige Zufallsquelle ist `mulberry32`.

- Alle `systemEveryHours` (18) Stunden entsteht im Westen ein Wettersystem (Seed aus Grund-Seed und Zeitfenster):
  66 % **Tiefs** (Entstehung 44–62° N, 62–30° W; Zug 32–60 km/h nach Osten und 0,02–0,08° je Stunde nach Norden, also
  nach Nordost; Lebensdauer `systemLifeHours` 108 h), sonst **Hochs** (Azorenhoch, 30–46° N, 5–15 km/h,
  Lebensdauer `highLifeHours` 170 h ± 10 %). Stärke sinusförmig über die Lebenszeit. Im Mittel sind gleichzeitig etwa
  vier Tiefs und drei Hochs aktiv. Ein Saisonstart liegt in einem anderen Zeitfenster als der vorige: jede Saison hat ihr
  eigenes Wetter.
- **Wind** = Klima + Tiefs − Hochs + Rauschen. Ein Tief bläst im Kern schwächer und am stärksten im Ring um etwa einen
  Radius (`0,3·g + 0,7·q·e^(1−q)`, q = Abstand²/Radius²), an der Südflanke um bis zu 30 % stärker, an der Nordflanke
  schwächer, und im Winter kräftiger als im Sommer (× 0,75 + 0,25·cos Jahreszeit).
- **Klimawind** mäßig (Grund 0,27, Norden +0,05, Mittelmeer −0,05, Süden −0,04, im Winter im Norden etwas mehr); Stürme
  bringen die Tiefs. Regionale Winde: **Mistral** (Golf von Lion, Winter), **Meltemi** (Ägäis, Sommer), **Levante/Poniente**
  (Straße von Gibraltar, ganzjährig), **Bora** (Adria, Winter).
- **Bewölkung** = Klima (Norden wolkiger, Mittelmeer im Sommer fast klar, im Winter halb bedeckt) + Wolken der Tiefs nach
  ihren **Fronten** − Hochs + Rauschen. Jedes Tief trägt eine Warmfront (vom Kern nach Ost bis Südost, 1,4 Radien) und
  eine Kaltfront (nach Süd bis Südwest, 1,8 Radien), bezogen auf seine Zugrichtung; ab der Lebensmitte holt die Kaltfront
  die Warmfront ein, vom Kern bis zum Okklusionspunkt (bis 0,9 Radien) liegt die Okklusion. Wolken: breiter Schirm vor
  der Warmfront (dichtester Streifen 0,35 Radien voraus), schmales Schauerband an der Kaltfront, dicht um Kern und
  Okklusion, lichter Warmsektor dazwischen. Die Wetterkarte zeichnet die Fronten der Tiefs ab Stärke 0,35: Kaltfront blau
  mit Dreiecken, Warmfront rot mit Halbkreisen, Okklusion violett im Wechsel; die Zeichen zeigen die Zugrichtung.
- **Nebel** an den Nebelküsten – Neufundlandbank, Nordsee, Ärmelkanal, Portugal – nach Jahreszeit (Sommer am meisten,
  Übergangszeiten mittel, Winter wenig), nur bei wenig Wind (`still = 1 − (Wind − 0,2)/0,45`, ab Wind 0,65 kein Nebel, also
  nie bei Sturm), nachts etwas dichter und unter Hochdruck häufiger.
- **Tageslicht** = Sinus der Sonnenhöhe aus Breitengrad, Uhrzeit (UTC und Länge) und Jahreszeit, nachts 0.
- **Sturm** ab Wind `stormFrom` (0,8). Anzeige in **Beaufort** = `round(Wind · 11,25)`: Bremsung der Schiffe ab Wind 0,5
  ≈ 6 Bft (starker Wind), Sturm 0,8 = 9 Bft.
- Das Feld wird je Ort und Minute zwischengespeichert; die Karte rechnet dasselbe Feld im Browser.

### Klima je Region (Simulation über drei Jahre, alle 3 h)

| Ort | Wind Ø | Sturm Jahr | Sturm Winter | ≥ 7 Bft | ≤ 2 Bft | Wolken Ø (Winter/Sommer) | Nebel ≥ 0,45 Jahr / Sommer |
|---|---|---|---|---|---|---|---|
| Bergen (60,4° N) | 0,48 | 2,5 % | 8,3 % | 23 % | 0,7 % | 0,93 / 0,84 | – |
| Nordsee (55° N, 4° O) | 0,49 | 4,0 % | 12,7 % | 26 % | 0,7 % | 0,92 / 0,81 | 3,4 % / 12,5 % |
| Irland West | 0,50 | 5,1 % | 15,3 % | 30 % | 0,8 % | 0,91 / 0,79 | – |
| Brest | 0,44 | 2,0 % | 5,5 % | 16 % | 2,5 % | 0,82 / 0,69 | – |
| Biskaya | 0,36 | 0,5 % | 1,1 % | 7 % | 7 % | 0,70 / 0,47 | – |
| Neufundlandbank | 0,30 | 0 % | 0 % | 0,4 % | 8 % | 0,64 / 0,52 | 16,7 % / 47 % |
| Portugal | 0,30 | 0,1 % | 0,3 % | 1,4 % | 15 % | 0,63 / 0,48 | 5,3 % / 15,7 % |
| Azoren | 0,25 | 0 % | 0 % | 0,5 % | 42 % | 0,54 / 0,39 | – |
| Golf von Lion | 0,38 | 1,5 % | 5,4 % | 13 % | 19 % | 0,55 / 0,17 | – |
| Ägäis | 0,29 | 0 % | 0 % | 0 % | 22 % | 0,50 / 0,12 | – |
| Levante (Ostmittelmeer) | 0,21 | 0 % | 0 % | 0 % | 65 % | 0,46 / 0,08 | – |

Im Sommer gibt es im Nordatlantik praktisch keine Stürme; Mittelmeer-Stürme sind selten (Mistral).

## Stromquellen

- **Kraftwerk:** `powerSupplyPerLevel * L` (60) bei jedem Wetter, verbraucht `fuelPerHourPerLevel * L` (3) Treibstoff je
  Stunde. Bei Treibstoff 0 läuft es nur so weit, wie Treibstoff nachkommt (Grundrate und Raffinerie): Auslastung so, dass
  der Treibstoff-Bestand bei 0 bleibt. Ohne Zufluss liefert es nichts; dann tragen Wind, Sonne und Speicher die Last.
- **Windpark:** `windPowerPerLevel * L * Wind` (90), bei Wind über `stormCutoff` (0,95) abgeschaltet.
- **Solarfeld:** `solarPowerPerLevel * L * Tageslicht * (1 − cloudLoss * Bewölkung)` (180, cloudLoss 0,7).
- Ertrag je Stufe im Jahresmittel (v1.9): Windpark Nordsee 44, Biskaya 32, Mittelmeer 23; Solarfeld Mittelmeer 35,
  Biskaya 25, Nordsee 14 (Kraftwerk 60 für 3 Treibstoff/h).
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
- **Planung:** Die Vorschau zeigt zusätzlich die **Vorhersage** für das Ziel zur voraussichtlichen Ankunft (Wind, Wolken,
  Nebel mit Spannbreite, „Sturm möglich“; siehe „Vorhersage“). Nur Anzeige – der Plan speichert das Routenwetter bei
  Abfahrt, bei Ankunft gilt das tatsächliche Wetter am Kampfort. Das Routenwetter bei Abfahrt ist gemessen (Jetzt-Wetter)
  und gilt unverändert.
- **Weltereignisse:** Missionen gegen Großflotte, Schatzschiff und Belagerungsring planen mit dem Wetter der Route
  (Vorschau und Plan wie oben); ihre Kämpfe und die Hafenangriffe der Großflotte rechnen mit dem Wetter am Kampfort.
- **Nebel und Radar:** Vorwarnzeit mal `1 − fogRadarMax * Nebel` am Hafen (bis −30 %), als Modifikator-Quelle „Wetter“
  (auf ganze Prozent gerundet, nur mit Radarstation).
- **Nebel und Aufklärung:** Ab Nebel `fogScoutFrom` (0,35) am Ziel ist das Lagebild unsicher (`uncertain`): Bestände auf
  zwei gültige Stellen, Einheiten und Anlagen auf 5 gerundet; ab `fogScoutHeavy` (0,65) grob (eine Stelle, auf 10).
  Gebäude bleiben genau.


## Vorhersage (v1.18)

Das tatsächliche Wetter bleibt unverändert und gilt für Reise, Kampf, Strom, Aufklärung und Radar. Alles, was die
Oberfläche für die Zukunft zeigt, ist eine **Vorhersage** (`forecastWeatherAt`): Stromkurve über 24 h samt
Mangelwarnung, Wettervorhersage am Hafen, Sturmwarnung und das Wetter am Ziel in der Missionsplanung.
Werte unter `weather.forecast`:

- **Ausgabe:** Alle `issueEveryHours` (3) Stunden wird die Vorhersage neu ausgegeben. Ihr Fehlermuster ist
  deterministisches Rauschen aus Seed, Ausgabezeitpunkt, Ort und Zielzeit (weich über 8 h); innerhalb einer Ausgabe
  bleibt es fest, nur der Vorlauf wächst stetig – nichts flackert.
- **Vorlauf** L = Zielzeit − jetzt (Stunden); für Gegenwart und Vergangenheit gilt das echte Wetter. Höchstabweichung
  je 3 h Vorlauf, gedeckelt:

  | Größe | je 3 h | höchstens | Art |
  |---|---|---|---|
  | Zeitliche Verschiebung der Systeme | `shiftPer3h` 0,375 h | `shiftMaxHours` 3 h (ab 24 h) | Wetter kommt früher/später |
  | Wind | `windPer3h` 5 % | `windMax` 30 % (ab 18 h) | relativ |
  | Bewölkung | `cloudsPer3h` 0,04 | `cloudsMax` 0,25 (ab knapp 19 h) | absolut (Anteil) |
  | Nebel | `fogPer3h` 5 % | `fogMax` 30 % | relativ |

  Vorhersage = echtes Wetter zur Zeit `t + n₁·Verschiebung`, Wind mal `1 + n₂·Abweichung`, Bewölkung plus
  `n₃·Abweichung`, Nebel mal `1 + n₄·Abweichung`, jeweils auf 0–1 begrenzt; `n` liegt in [−1, 1], symmetrisch um 0
  (Rauschen × 2, gekappt). Tageslicht ist Astronomie und bleibt exakt; Sturm = vorhergesagter Wind ≥ `stormFrom`.
- **Spannbreite** (`forecastRange`): Vorhersage im Zeitfenster ±Verschiebung, erweitert um die Abweichung, beides mit
  `bandShare` (0,8) der Höchstwerte. Die Kurve zeigt sie als Band um das Angebot aus Wind und Sonne (Kraftwerk und
  Speicher wie vorhergesagt), die Wetterkästchen Wind von–bis, die Planung Wind/Wolken/Nebel von–bis und die
  Wirkung auf Flugzeuge und Luftschlag von–bis. „Sturm möglich“, wenn der obere Rand `stormFrom` erreicht.
  Sturmwarnung „ab etwa hh:mm (±Verschiebung)“.
- **Genauigkeit** (`forecastSkill`, je Hafen): Unsicherheit mal `1 − skillPerLevel · Stufe(skillTech) − radarBonus`
  (Funkmesstechnik −15 % je Stufe, Radarstation ab Stufe 1 −10 %), nicht unter `minFactor` (0,5). Bestwert heute
  0,6 (Funkmesstechnik 2 und Radar). Der Faktor wirkt auf Abweichung und Verschiebung.
- **Simulation** (6 Orte × 300 Ausgaben, `test/weather-forecast.test.ts`; Faktor 1 / 0,6):

  | Vorlauf | Wind, mittl. Abweichung | relativ | Bewölkung, mittl. Abw. | Verzerrung Wind | Spannbreite trifft |
  |---|---|---|---|---|---|
  | 3 h | 0,011 / 0,007 | 3 % / 2 % | 0,02 / 0,01 | +0,001 | 79 % |
  | 6 h | 0,022 / 0,013 | 6 % / 3 % | 0,04 / 0,03 | +0,001 | 82 % |
  | 12 h | 0,044 / 0,026 | 11 % / 7 % | 0,08 / 0,05 | +0,001 | 85 % |
  | 18 h | 0,066 / 0,039 | 17 % / 10 % | 0,12 / 0,07 | −0,002 | 89 % |
  | 24 h | 0,065 / 0,039 | 17 % / 10 % | 0,13 / 0,08 | −0,001 | 89 % |

  Im Mittel unverzerrt (Wind unter 0,003; Bewölkung −0,01 bei 24 h durch die Begrenzung auf 0–1 bei bedecktem
  Himmel). Bei 24 h ist das Wind-Band im Mittel 0,26 breit (gut 3 Bft), „Sturm möglich“ in 16 % der Fälle.
- **Unverändert exakt:** Wetterkärtchen „Am Hafen“, Feldzeile und Wetterkarte (Jetzt-Wetter), Routenwetter bei Abfahrt
  (Zeitzuschlag, Startverbot), Kampf- und Aufklärungswetter, Fortschreibung (`settle`) und die beim Start festgelegte
  Fertigstellung von Ausbildung und Forschung.
- **KI-Spieler** kennen nur Jetzt-Wetter und -Strom (`productionRates` zum Zeitpunkt jetzt) und die Vorschau
  (`missionPreview`, ab v1.18 mit Vorhersage); das echte künftige Wetter fragen sie nicht ab.
