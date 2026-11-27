# game-core – Entscheidungen, Teil 2 (Abschnitte F–K)

Fortsetzung von `ENTSCHEIDUNGEN.md` (dort Übersicht und Teil 1). Verbindlich bleibt `docs/REGELN.md`.

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

### F2. Offene Punkte (erledigt)

- Erledigt: Kartell-Überfälle rechnen mit dem Wetter am Hafen (`raid_arrive` übergibt `battleWeather`). Das Kartell hat
  keine Flugzeuge; Sturm schwächt die Flugzeuge des Verteidigers, Wolken seinen Luftschlag. Der Kampfbericht trägt das
  Wetter (Test in `engine/test/luecken.test.ts`).
- Erledigt: Fronten (Kalt-, Warmfront, Okklusion) sind auf der Wetterkarte gezeichnet, der Wolkenschirm folgt den Fronten
  statt pauschal nach Osten versetzt (Abschnitt F4).
- Erledigt: Erkannte Angriffe bleiben erkannt: Der Erkennungszeitpunkt steht im Missionsplan (`plan.detectedAtMs`,
  `engine/radar.ts`); fällt danach der Strom des Radars aus oder zieht Nebel auf, bleibt die Anzeige.
- Erledigt: Tagesbefehle zu Wetter und Strom: Speicherwerk ausbauen (`speicherwerk`), Stromüberschuss im Speicher halten
  (`stromspeicher`), Mission trotz Sturm (`sturmfahrt`, Sturmanteil der Route ≥ 0,2), Windpark oder Solarfeld ausbauen
  (`windsolar`, nur mit Kraftwerk) und gleichzeitig 40 % der Höchstleistung aus Wind und Sonne erzeugen (`oekostrom`;
  zählt beim Abruf der Befehle wie Vorrat und Produktion).

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

### F4. Fronten und Wolkenschirm

- **Geometrie** (`src/weather-fronts.ts`, rein): Jedes Tief trägt eine Warmfront (1,4 Radien, Peilung Zugrichtung
  +15° … +45°, bei Zug nach Ost also Ost bis Südost) und eine Kaltfront (1,8 Radien, +105° … +140°, Süd bis Südwest),
  je fünf Abschnitte. Ab der Lebensmitte wächst eine Okklusion (bis 0,9 Radien, +40°); Warm- und Kaltfront beginnen
  dann am Okklusionspunkt. Die Zugrichtung kommt aus `vLat`/`vLon` des Systems; keine neuen Balance-Werte, kein Zustand.
- **Wolken:** statt der nach Osten versetzten Glocke das Maximum aus Kern (0,75), Schirm vor der Warmfront (0,85, Mitte
  0,35 Radien voraus, zum Warmsektor schmal), Kaltfrontband (0,6, 0,2 Radien breit) und Okklusion (0,65), jeweils mal
  Stärke; über das Frontende hinaus weich auslaufend. Wind und Sturm bleiben unverändert.
- **Wirkung aufs Jahresmittel** (Start 1. Januar, alle 3 h): Bewölkung Nordsee 0,88 → 0,85, Irland 0,86 → 0,84,
  Biskaya 0,59 → 0,57, Mittelmeer 0,35 → 0,35, Atlantik 0,74 → 0,76; Sonnenertrag Nordsee +5 %, Irland +3 %,
  Biskaya +2 %, Mittelmeer +0,4 %, Atlantik −2 %. Das Mittelmeer (Eichpunkt der Solarfelder) bleibt praktisch gleich;
  `solarPowerPerLevel` daher unverändert. Bei Spielerfahrung beobachten.
- **Karte** (`apps/web/src/map/weather-fronts.ts`): `weatherFrontsAt` liefert die Linienzüge für Tiefs ab Stärke 0,35
  (wie die T-Schilder). Kaltfront blau mit Dreiecken, Warmfront rot mit Halbkreisen, Okklusion violett im Wechsel; die
  Zeichen stehen auf der Zugseite (links in Laufrichtung des Linienzugs). Zeichen in Bildschirm-Pixeln, neu gestrichen
  bei Zoomsprung × 1,5; nah herangezoomt etwas zurückgenommen.

### F5. Vorhersage mit Unsicherheit (v1.18, Block `weather.forecast`, Regeln in docs/REGELN-WETTER.md)

- **Anlass:** Das Wetter ist deterministisch; Stromkurve, Sturmwarnung und Zielwetter der Planung zeigten exakt das
  spätere Wetter (100 % Trefferquote). Gewünscht: realistische Unsicherheit, ohne laufende Spiele zu ändern.
- **Entscheidung:** Das echte Wetter (`weatherAt`) bleibt unverändert und allein maßgeblich für Reise, Kampf, Strom,
  Aufklärung, Radar. Nur Anzeigen der Zukunft rechnen mit `forecastWeatherAt` (neues Modul `weather-forecast.ts`,
  rein). Drei Fehlerquellen, weil sie der Wetterpraxis entsprechen und einfach erklärbar sind: Zeitverschiebung der
  Systeme (bis ±3 h), Wind und Nebel relativ (±5 % je 3 h, höchstens ±30 %), Bewölkung absolut (±0,04 je 3 h,
  höchstens ±0,25). Fehlermuster je Ausgabe (alle 3 h) fest, damit die Anzeige nicht flackert; Vorlauf ab „jetzt“,
  damit die erste Stunde zum Wetterkärtchen passt.
- **Spannbreite** mit `bandShare` 0,8 der Höchstwerte statt 1,0: Bei 1,0 traf sie 97–99 % und war bei 24 h über
  4 Bft breit (nutzlos); bei 0,6 nur 61–73 %. 0,8 trifft 79–89 % (mit dem Vorlauf steigend).
- **Genauigkeit:** Funkmesstechnik (vorhanden, 2 Stufen) −15 % je Stufe, Radarstation (ab Stufe 1) −10 %, Untergrenze
  0,5. Bewusst pauschal je Hafen und ohne Strombedarf: eine Regel, die man im Infotext nachrechnen kann. Simulation:
  Faktor 0,6 senkt die mittlere Abweichung um 40 %.
- **Unverzerrt:** Rauschen symmetrisch um 0; Simulation Verzerrung Wind < 0,003 bei mittlerer Abweichung bis 0,066;
  Bewölkung −0,01 bei 24 h durch Kappung bei bedecktem Himmel (hingenommen).
- **Strom:** `integrateGrid`/`powerForecast` nehmen eine optionale Wetterquelle; ohne Angabe das echte Wetter (settle
  unverändert). Die Fertigstellung von Ausbildung und Forschung bleibt beim Start mit dem echten Wetter festgelegt
  (bindende Zusage, nicht Vorhersage); sie verrät die Zukunft nur als Uhrzeit. Bei Bedarf später überdenken.
- **KI-Spieler:** nutzen keine künftigen Wetterwerte (nur `productionRates` jetzt und `missionPreview`); keine
  Änderung nötig.
- **Bekannte Grenze:** Das Wetterfeld ist im Browser nachrechenbar (Seed in der Balance, die Karte rechnet es selbst).
  Wer den Client auseinandernimmt, kann das echte künftige Wetter berechnen. Die Karte zeigt nur die Gegenwart;
  eine serverseitige Wetterkarte wäre nötig, um das zu verhindern (offen, nicht in v1.18).

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
   ~~**Offen:** Der Server übergibt die Modifikatoren noch nicht.~~ **Erledigt (L6):** `raidLaunch` ruft
   `composeRaid(state.units, state.defenses, balance, randomSeed(), mods)` mit `mods = modsOf(…)` auf.

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
   „bessere Vorschau“ ist damit als längere Vorwarnung umgesetzt, nicht als genaueres Lagebild (kommt mit dem geplanten Lagebild-System).
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
7. **Status ohne Buchführung bei der Rückkehr:** „unterwegs“ = die Mission in `admiral.mission_id` ist outbound,
   returning oder (Feldbesatzung) stationed. Weltereignis-Missionen nehmen einen Admiral mit wie jeder Überfall
   (Missionsrolle, Erfahrung und Schicksalswurf gegen den Kartellverband, Bericht unter `admirals`). Feldmissionen
   siehe J 11.

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
4. **Rückfahrt und Handelskonvois (Lücken geschlossen).** Die Rückfahrt kreuzt Felder wie die Hinfahrt (Strecke
   Ziel → Hafen, nach Rückruf ab dem Wendepunkt, eigener Würfelstrom). Simulation (`sim/naval.ts`, Überfall-Verband
   hin und zurück durch dasselbe Feld, Stärke nach der Hinfahrt): 4,2 / 8,9 / 18,6 / 28,6 % Verlust bei Stärke
   25 / 50 / 100 / 150 – etwa das Doppelte der Hinfahrt, weil das Feld nur wenige Treffer an Stärke verliert. Gewollt:
   Wer an einem verminten Hafen vorbei angreift, zahlt zweimal; ein volles Feld bleibt eine starke, aber teure Abwehr
   nahe dem eigenen Hafen. Ladung über dem Laderaum der Überlebenden sinkt (wie beim Kapern). Handelskonvois haben keine
   Schiffe – daher ein deterministischer Ladungsverlust: min(25 %, Stärke × 0,0015) × `cargoLossFactor` 0,5 ×
   (1 − Räumschutz des Geleits) = 1,9 / 3,8 / 7,5 / 11,3 % je Feld (Räumer + Korvette im Geleit: 0,5–2,8 %). Mit 0,5
   liegt ein volles Feld unter dem Kartellverlust ohne Geleit (30 %), aber über der Börsengebühr (4 %): Handel durch
   fremde Minen lohnt Geleit mit Räumern. Feindlich = gegen Absender **und** Empfänger (sonst träfe der Verkäufer den
   eigenen Handel mit Felder vor dem eigenen Hafen). Börsenlieferungen bleiben bewusst ausgenommen (keine Konvois),
   ebenso Ertragskonvois der Felder (J 6) und das Geleit des Annehmenden auf seiner Rückfahrt (sie ist der Konvoiweg).
5. **Geleit des Anbieters.** Beim Einstellen eingetragen (`player_offer.escort`), aber ohne Schiffe zu binden: Offene
   Angebote dürfen Tage stehen, gebundene Schiffe dafür wären teurer als der Nutzen. Bei Annahme läuft das Geleit aus
   dem Angebotshafen aus, begleitet die Ware zum Käufer und fährt heim (Treibstoff hin und zurück, Missionsplatz).
   Best effort: Fehlen Schiffe, Treibstoff oder Platz, fährt die Ware ohne Geleit (Hinweis an den Anbieter) – der
   Handel scheitert nie am Geleit. Nur ein Geleit je Ware (Konvoi hat eine Geleitmission): stellt der Anbieter eines,
   kann der Annehmende keines stellen (`offer_escorted`); die Oberfläche blendet die Auswahl dann aus.

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
   kämpft bei Abfangversuchen mit; er verteidigt das Feld nicht (seit 12/13: gegen das Kartell doch, und die
   Abteilung teilt sich auf gleichzeitige Konvois auf), der Rest muss eine gültige Besatzung bleiben
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
11. **Admiral.** Feldmissionen (Aufklärung, Besetzen, Verstärkung) nehmen einen Admiral mit (Missionsrolle). Nach der
   Einnahme bleibt er bei der Besatzung: Status „unterwegs“ (stationierte Mission zählt als aktiv), Posten in der
   Admiralsansicht, kein Hafenkommandant. Er führt die Besatzung bei Spieler- und Kartellangriffen auf das Feld
   (Missionsrolle, nicht `defense`: er führt einen Verband, keinen Hafen), Erfahrung und Schicksalswurf wie üblich;
   die Geleitabteilung führt er nicht. Er kehrt mit der Besatzung heim (Rückruf, Niederlage). Verstärkung mit Admiral:
   er übernimmt eine Besatzung ohne Admiral (Hafenwechsel wie die Schiffe); höchstens ein Admiral je Besatzung.
   Bewusst einfach: kein eigener Status „bei Besatzung“ (Anzeige als Posten). Abziehen ohne Rückruf: siehe 14.
12. **Geleitabteilung gegen das Kartell.** Kartellangriffe auf das Feld sind eine Stunde vorher gemeldet; die
   Abteilung kehrt dafür zurück und kämpft mit der ganzen Besatzung – auch wenn gerade kein Konvoi fährt. Gegen
   Spielerangriffe (nur Radar-Vorwarnung mit halber Zeit) verteidigt sie weiter nicht. Folge (`sim/fields.ts`): die
   Besatzung 2 Zerstörer + 2 Korvetten fällt auf keiner Stufe, gleich wie groß ihr Geleit ist (vorher mit 2 Korvetten
   Geleit auf Stufe 3 zu 47 %). Das Geleit kostet gegen das Kartell nichts mehr, nur gegen Spieler.
13. **Aufteilung auf gleichzeitige Konvois.** Bei 450 km und 40 km/h fahren alle 4 h ein Konvoi, also etwa drei
   zugleich. Statt dass jeder mit der vollen Abteilung kämpft, teilt sie sich im Moment des Kampfs anteilig nach
   Warenwert (je Schiffstyp, größte Reste, Gleichstand: älterer Konvoi; `splitEscort`). Verluste der Anteile werden
   der Besatzung und der Abteilung abgezogen. Simulation: Kartell gegen drei gleich große Konvois, 1 Korvette Geleit
   hält im Mittel je Konvoi 33 %, 2 Korvetten 67 % (Anteile 1/1/0); volle Deckung erst ab drei Schiffen. Gewollt:
   Geleit für viele Konvois kostet mehr Schiffe; die Rechnung bleibt fair (jedes Schiff schützt genau einen Konvoi).
14. **Erledigt:** Wochenziel-Art für Felder (siehe 10). **Admiral abziehen ohne Rückruf** (`fieldAdmiralRecall`,
   `fields-admiral.ts`): Der Admiral fährt allein in den Hafen des Felds, Fahrzeit = Entfernung ÷ Geschwindigkeit des
   schnellsten Schiffs der Balance (Korvette 60 km/h). Gewählt statt eines festen Werts, weil die Fahrzeit dann mit der
   Entfernung wächst wie jede andere Fahrt und ein Admiral nie schneller ist als ein Verband; ohne Treibstoff und
   Missionsplatz (ein Kurierboot ist kein Verband, die Besatzung belegt ihren Platz weiter). Umsetzung ohne
   Schemaänderung als Mission `admiral_heimkehr` (Status „returning“, leere Einheiten, normales `mission_return`);
   `activeMissionCount` und die Missionszahl der Hafenansicht zählen sie nicht. Status „unterwegs“ ergibt sich wie
   sonst aus der Mission, Posten „kehrt allein von … heim“, Meldung „Admiral zurück“. Gefangene ziehen nicht ab,
   verwundete schon (sie heilen daheim weiter). Danach kann ein anderer Admiral die Besatzung per Verstärkung
   übernehmen. Knopf am eigenen Feld und in der Admiralsansicht.

## K. Mehrere Häfen: Gründung und Verlegung (Welle 3 „Expansion“, Teil 2, Block `expansion`, v1.11)

1. **Freischaltung.** 2. Hafen ab Kommandozentrale 5, 3. ab 8 (Heimathafen, bis v1.13: 9), höchstens 3; laufende Gründungen zählen
   mit. Der Wirtschafts-Bot erreicht in 28 Tagen nur Kommandozentrale 6–7 (gieriger Ausbau, billigstes zuerst); mit
   der ersten Vorgabe 8/14 wäre der 2. Hafen für typische Spieler erst nach etwa 4 Wochen gekommen. v1.12 senkt auf
   5/9: der 2. Hafen wird im frühen Mittelspiel möglich (gebremst durch Werft 6, Hafenkommandantur 6 und die Kosten
   des Kolonieschiffs), der 3. bleibt ein Ziel für gezielten Ausbau.
   Mit der 42-Tage-Saison senkt v1.14 den 3. Hafen auf Kommandozentrale 8: Die 42-Tage-Simulation (L8) zeigt den
   Rüstungs-Bot an Tag 42 erst auf Stufe 8 und nur den reinen Wirtschafts-Bot an Tag 37 auf Stufe 9.
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
7. **Verwalten (P5).** *Kolonie aufgeben:* nur Kolonien, nur ohne laufende Bewegungen (eigene Verbände von dort, eigene
   Verlegungen/Transporte/Lieferungen dorthin, Gäste, Blockade, Belagerung, erkannter Angriff, offene Angebote, Feld).
   Einheiten und Bestände **verfallen** statt automatisch heimzufahren: eine Zwangsverlegung bräuchte eine Mission
   ohne Ausgangshafen (die Zeile hängt per Kaskade am Hafen) und wäre ein Sofort-Rückzug aus jeder Lage; so bleibt die
   Verlegung eine bewusste Fahrt mit Reisezeit. Admirale (Personen) wechseln in den Heimathafen, Minenfelder bleiben
   (base_id null). Unerkannte Angreifer drehen bei Ankunft um („Ziel existiert nicht mehr“), damit das Aufgeben
   keinen Hinweis auf verdeckte Verbände gibt. Keine Schemaänderung nötig: mission/admiral/minefield/resource_field
   hängen per Kaskade am Hafen und werden vorher geprüft bzw. umgehängt; game_event, delivery, convoy, player_offer
   und world_event haben keinen Fremdschlüssel und werden durch die Sperrgründe abgedeckt (eigene Ereignisse des
   Hafens werden gelöscht). *Umbenennen:* jeder eigene Hafen, Zeichen wie Allianznamen, Länge wie „Hafen wählen“
   (2–32), eindeutig unter den eigenen Häfen. *Ortsname:* nächster von gut 170 Küstenorten der Karte
   (`world/places.ts`, ohne Handelshäfen), gestuft 120/450 km, sonst nach Meer/Region; Doppel bekommen „II“.
   *Belagerung:* den Ring um einen eigenen Hafen darf man aus einem anderen eigenen Hafen brechen – das ist echte
   Hilfe von außen; aus dem belagerten Hafen bliebe es ein Ausfall gegen die eigene Blockade, wie bisher gesperrt.
   *Spielerhandel:* Freischaltung nach der höchsten Hafenkommandantur aller Häfen – dieselbe Regel wie für die Börse
   (Freischaltung, Kreditlimit) und die Admiral-Plätze, damit eine junge Kolonie nicht erneut Stufe 3 braucht; das
   Tageslimit der Börse bleibt am Heimathafen, weil es eine Mengen-, keine Freischaltgröße ist.
8. **Gründung als Ziel:** Wochenziel „Gründung“ siehe J.10 (bewusst kein Auftragsbuch-Schritt).
