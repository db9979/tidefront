# game-core – Entscheidungen, Teil 4 (Prüfbericht 0.22)

Fortsetzung von `ENTSCHEIDUNGEN-3.md`. Verbindlich bleibt `docs/REGELN.md`. Neue Abschnitte bitte hier anhängen.

## S. Einstieg für neue Spieler (Prüfbericht 0.22)

1. **Erster Nest-Überfall gewinnbar.** Probekampf (100 feste Seeds) gegen Nest Stufe 1 (4 Schnellboote, 18 Miliz):
   2 Korvetten + 1 Landungsschiff + 20 Schützen siegen zu 1 %, mit 25 zu 73 %, 28 zu 95 %, 30 zu 100 %. Korvetten
   ändern gegen Stufe 1 nichts (Landungsschiff + 28 Schützen ebenfalls 95 %). **Entscheidung:** Auftrag „wache“ fordert
   30 Schützen (`GUIDE_GOALS`, Paket unverändert), „flotte“ bleibt bei 2 Korvetten und 1 Landungsschiff (für stärkere
   Nester). „Lohnende Ziele“ schlägt je Nest den kleinsten Verband aus dem Bestand vor, der im Probekampf ≥ 90 % siegt
   (game-core `smallestWinningRaid`: Halbierungssuche je Typ, teure zuerst, Truppen müssen auf die Landungsschiffe
   passen). 90 % statt der geforderten ~85 %, weil die Suche auf die festen Seeds passt (bei 30 Seeds schlug sie 25
   Schützen mit „87 %“ vor, echt 73 %); mit 100 Seeds und 90 % landet sie bei Stufe 1 auf 28 Schützen (echt ~95 %).
   Reicht der Bestand nicht, bleibt der volle Verband stehen mit dem Hinweis, wie viele Schützen fehlen.
2. **Start-Nest in ≤ 300 km.** Bei 5 von 8 Schnellwahl-Orten lag Stufe 1 bei 500–1 071 km. chooseBase legt für
   Menschen (nicht KI) ein Nest Stufe 1 an, wenn keins offen in 300 km liegt: auf einem **Seefeld vor der Küste**
   (Breitensuche über Meer/Küste ab dem Hafen, 90–300 km, Wunsch 180 km, möglichst 120 km zum nächsten Nest), nicht
   auf Häfen, Nestern, Rohstofffeldern und künftigen Feldplätzen, Handelshäfen. Seefeld statt Küste, damit nie ein
   Küstenfeld (Hafenplatz) belegt wird – auf Küste kollidierten die Start-Nester sofort mit Hafenwahl und Gründungen
   (15 Server-Tests fielen). Kein Schema: Start-Nester sind Zeilen der Tabelle nest außerhalb der Weltplätze und
   verfallen beim Saisonwechsel (`ensureNests(tx, { dropStartNests: true })` in season.ts). Bekannt ist das
   Nest über einen Lagebild-Eintrag („Hafenamt“, verblasst nach forgetHours) und dauerhaft über `guide.get.nestTarget`
   (nächstes offenes Nest Stufe 1, solange der Nest-Auftrag offen ist) – „Lohnende Ziele“ zeigt es mit Stufe und
   Markierung „Auftragsziel“, dazu immer alle bekannten Stufe-1-Nester in 300 km.
3. **Auftragsbuch sofort aktuell.** Live-Meldungen base/missions/reports (und season) invalidieren jetzt auch
   guide.get und achievements.weekly; zusätzlich holt die Auftragsleiste 1,5 s nach dem Ende eines Bau- oder
   Ausbildungs-Countdowns neu (falls die Live-Verbindung fehlt).
4. **Belohnung und Lager.** Bisher landeten Auftragsbuch-Pakete über der Lagergrenze. **Entscheidung:** Sie füllen
   das Lager nur bis zur Grenze (`deliverToStorage`), der Rest verfällt; vor dem Abholen warnt das Auftragsbuch mit der
   Menge und bietet „Lagerkomplex ausbauen“ an – kein zusätzlicher Auftrag, weil Pakete die ganze Saison abholbar
   bleiben (warten kostet nichts) und ein zwölfter Auftrag Zähler, Abzeichen und Texte („elf“) verschieben würde.
   Tagesbefehle und Wochenziele schreiben weiter über die Grenze gut (nicht Teil dieses Auftrags).
5. Kleinkram: Zähler „abholbereit“ zählte die Abschlussbelohnung doppelt (guideView zählt sie schon); „Los“ beim
   Schützen-/Schiffe-Auftrag öffnet Truppen → Ausbilden, beim Nest-Auftrag Truppen → Einsatz (lohnende Ziele);
   Hafenwahl zeigt die Nest-Stufe nur, wenn sie bekannt ist.

## T. Stabilität und Sicherheit (Prüfbericht 0.22)

1. **Fälligkeit bei Wiederholungen:** Neue Spalte `game_event.orig_due_at` (Migration durch den Integrator). Beim ersten
   Fehlversuch merkt events.ts die ursprüngliche Fälligkeit; `due_at` ist danach nur noch der Wiederholungszeitpunkt
   (2^n s). Handler, Meldungen, Tagesbefehle und Erfolge bekommen immer die ursprüngliche Spielzeit – Kampf, Fortschreibung
   und Rückkehrzeiten verschieben sich nicht, Ketten (field_tick usw.) driften nicht.
2. **Wächter** (event-watchdog.ts, Worker alle 10 min): Missionen auf outbound/returning ohne offenes Ereignis bekommen
   Ankunft bzw. Rückkehr (frühestens jetzt); hat die Ankunft schon zweimal endgültig versagt, fährt der Verband ohne Ziel
   heim (Fahrzeit der Hinfahrt, Kartell löst sich auf), statt endlos zu scheitern. Ketten: jeder Hafen hat ein offenes
   raid_launch (neu erst nach raidIntervalHours, kein Sofort-Überfall), jeder Radarposten radar_post_tick, jedes aktive
   Seekabel cable_tick (rechnet bis jetzt ab), jeder fliegende Satellit nächsten Überflug und Ende (verpasste Überflüge
   werden nicht nachgeholt), Patrouillen auf Station patrol_end/patrol_tick, Sammelangriffe Auslaufen/Ankunft. Jede
   Reparatur sperrt das Objekt und prüft erneut (keine Doppel neben einem gerade laufenden Handler). Mitglieder von
   Sammelangriffen (plan.allianceRaidId) und stationierte/haltende Verbände außer Patrouillen bleiben unberührt.
   Verwaltung → „Fehlgeschlagene Ereignisse“: Liste mit letztem Fehler, „Neu einreihen“ (lehnt ab, wenn für dasselbe
   Objekt schon ein Ereignis dieses Typs offen ist – sonst liefe eine Kette doppelt).
3. **Login:** `trustProxy` nur Loopback und private Netze (Env `TRUST_PROXY`, Vorgabe
   `loopback,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`): der Proxy im Heimnetz (und die Docker-Bridge) setzt die echte IP,
   fremde Aufrufer können X-Forwarded-For nicht mehr fälschen. Zusätzlich je Kontoname höchstens 10 Fehlversuche in
   15 min (erfolgreiche Anmeldung setzt zurück). Bewusst hingenommen: Wer einen Namen kennt, kann dieses Konto 15 min
   sperren. Zähler atomar per Lua (INCR und EXPIRE in einem Schritt; alte Schlüssel ohne Ablauf bekommen einen).
4. **Sperren:** world-lock.ts. Spielerweite Sperre (`pg_advisory_xact_lock(7340051, playerId)`) vor Satellitenstart und
   Gründung/Verlegung, vor der Hafensperre (keine Verklemmung bei Verlegung zwischen zwei eigenen Häfen). Satelliten-ID:
   Startzeit, bei Gleichstand eins über der höchsten des Spielers. Weltsperre 7340050: Befehle (runCommand, damit auch
   KI-Spieler) und Ereignisse geteilt, season_end exklusiv – das Saisonende wartet auf laufende Befehle, neue warten auf
   das Saisonende. Befehle außerhalb von runCommand (Anmeldung, Allianzverwaltung …) sind nicht abgedeckt.
5. **Wartung:** jeder Schritt im Worker einzeln abgesichert (Fehler geloggt, die übrigen laufen). audit_run: 14 Tage.
6. **Kartenlast:** Client streut die Invalidierung von world.map nach einer „map“-Meldung zufällig über 300 ms–5 s und
   fasst sie zusammen. Server: die Häfen aller Spieler (geteilte Weltdaten) 5 s im Speicher (Env `MAP_CACHE_MS`, 0 = aus);
   jede Karten-/Saisonmeldung verwirft sie sofort, die Sichtlogik je Spieler ist unverändert. WebSocket-Herzschlag: ohne
   Meldung seit 60 s (Server-ping alle 25 s) baut der Client die Verbindung neu auf.
7. **Nachtschild-Zeitzone:** Client sendet die IANA-Zone (`Intl`), die Startstunde folgt der Sommerzeit. Alte Stände ohne
   `protection.timeZone` rechnen weiter mit dem festen Versatz; unbekannte Zonen: fester Versatz statt Ablehnung.
   Uhrzeiten in Texten (Sammelangriff, See) über `gameTimeZone()`.

## R. Wertung und Balance v1.24 (Prüfbericht-Balance v1.24)

Vom Nutzer freigegeben nach dem Prüfbericht 0.22 (Stratege, Mathematiker). Simulation `npm run -s sim`, neuer Block
`sim/v124.ts` („=== Balance v1.24 ===“), 200 Seeds je Kampffall.

### R.1 Wertung (`packages/engine/src/scoring.ts`, Balance-Block `scoring`)
- **Kartell-Abwehr × 0,25** (`scoring.npcDefenseFactor`): Kampfpunkte aus Berichten ohne angreifenden Spieler
  (Kartell-Überfall, Großflotte gegen Hafen, Konvoi, Feld) und aus Angriffen auf die Weltereignisse in
  `scoring.npcWorldEventKinds` (Großflotte, Belagerungsring) zählen nur ein Viertel. Nester, Schatzschiff und
  Spielerkämpfe zählen voll, Beute immer voll. Grund: „Kartell anlocken“ (Bunkerlinie als Köder) war ein Punkte-Schneeball;
  der Nachtschild kostete so Punkte.
- **Richtpreis-Gewichtung**: `resValue` bewertet Ressourcen mit `market.refPrice` (Stahl 1, Treibstoff 1,8, Elektronik 3,
  Proviant 0,6) – für Ausbau, Militär, Kampf (Einheiten/Anlagen) und Beute. Vorher zählte jede Ressource 1, ein Tausch
  Elektronik → Stahl über die Börse brachte ×2,8 Punkte. NPC-Festwerte (Schnellboot 250, Miliz 40) bleiben.
  Folge: Punktzahlen steigen insgesamt (Gebäude/Einheiten mit Elektronik und Treibstoff stärker).
- **Neuberechnung der laufenden Saison**: Geprüft – Punkte der laufenden Saison werden **nirgends gespeichert**.
  `computeStandings` leitet sie bei jedem Abruf (Rangliste, 30 s Zwischenspeicher im Prozess; Allianzwertung, Tagesbericht)
  aus `base.state`, laufenden Missionen, `battle_report` (seit Saisonbeginn) und `daily_challenge` ab; gespeichert wird
  erst am Saisonende (`season_result`, `season_alliance_result`). Mit dem Deploy gelten die neuen Regeln also sofort
  rückwirkend für die ganze Saison, ohne Migration, Marker oder Admin-Knopf – idempotent per Konstruktion (Test
  `engine/test/scoring.test.ts`: alte v1.23-Berichte, zweimal gerechnet = gleich). `field_score` (Feldpunkte der Allianzen)
  ist eine eigene Wertung und unverändert.
- **Näherungen**: Verluste aus alten Berichten werden mit den *heutigen* Kosten bewertet (Kampfpanzer 576 statt 944
  Richtwert – betrifft nur bereits vernichtete Kampfpanzer); Weltereignis-Berichte ohne `report.worldEvent.kind` zählen
  voll (alle Weltereignis-Kämpfe schreiben die Art seit Einführung mit).

### R.2 Werte

| Wert | v1.23 | v1.24 |
|---|---|---|
| `pirates.raidStrengthShareOfDefense` | 0,55 | 0,40 |
| Startrampe `requires.kommandozentrale` | 8 | 7 (Forschungsamt 5, Radarstation 6 unverändert) |
| `intel.satellite.discountPerLevel` / `discountMax` | 0,04 / 0,2 | 0,10 / 0,3 (ab Rampe 4) |
| Radarsatellit | 6000/2500/4500 (24 000) | 5500/2200/4000 (21 460) |
| Nest 4 Beute | 9500/3800/1500/2700 | 10750/4300/1700/3050 (× 1,13, auf 50 gerundet) |
| Nest 6 Beute | 8000/8000/11000/2000 | 10400/10400/14300/2600 (× 1,3) |
| Elektrolyse `electrolysisRatio` | 10 | 6 |
| Chipfabrik `perHour` | 30 | 45 |
| Zerstörer `bonus.korvette` | 1,3 | 1,6 |
| Kampfpanzer Kosten / KP | 500/100/80/40, 4 | 300/60/50/30, 2,5 |
| `weather.forecast.skillPerLevel` | 0,15 | 0,20 |
| KZ `commandPointsLateFromLevel` / `LatePerLevel` | – | 9 / 60 |
| `lagerkomplex.capacityGrowth` | 1,5 | 1,5 (nicht geändert) |

- **Kampfpanzer 2,5 KP**: Kommandopunkte sind schon heute nicht ganzzahlig (Schützen 0,15, Pioniere 0,3); alle Prüfungen
  rechnen mit Toleranz 1e-9, die Oberfläche zeigt KP mit Nachkommastelle. Daher 2,5 statt 3.
- **Vorhersage**: `skillPerLevel` 0,20 statt `minFactor` 0,6 – Funkmesstechnik hat nur 2 Stufen; so erreicht der
  Bestwert (1 − 0,4 − 0,1 = 0,5) genau den dokumentierten `minFactor`, und die Forschung lohnt sich spürbar mehr.
  `minFactor` 0,6 hätte nur die Zahl angepasst, ohne dass die Forschung mehr bringt.
- **Lagerkomplex bleibt 1,5**: Mit 1,4 stiege der höchste Füllstand des Wirtschafts-Bots auf 70–100 % (Tag 42: voll, Ware
  verfällt), des Rüstungs-Bots auf 51–74 % (1,5: 47–64 % bzw. 24–56 %). Das schadet – nicht geändert.

### R.3 Kommandopunkte im Spätspiel
Befund (Abschnitt L.8): Die Rüstung des 45-%-Bots fällt ab Tag 28 auf 8 k/Woche und an Tag 42 auf 0, weil die KP voll sind.
Kleinster Eingriff: **ab KZ 9 gibt jede Stufe 60 statt 30 KP** (KZ 8: 300 → KZ 9: 360, KZ 10: 420, KZ 12: 540). KZ 1–8
unverändert, damit Zielfenster und Nest-6-Sieg des Referenz-Bots (erreicht nur KZ 8) gleich bleiben. Eine KP-Senke
braucht es nicht: Nach den KP begrenzt der Unterhalt (Proviant/Versorgungshof). Prüfung mit einem „Spätspiel-Bot“
(`runBot(..., { lateGame: true })`: baut bei vollen KP die Kommandozentrale, bei knappem Proviant den Versorgungshof):

| Rüstung je Woche (Tag 7/14/21/28/35/42) | KZ an Tag 42 | Woche 4 / 5 / 6 |
|---|---|---|
| Referenz-Bot (billigster Ausbau) | 8 | 8 k / 9 k / 0 |
| Spätspiel-Bot, 30 je Stufe (v1.23) | 13 | 17 k / 8 k / 8 k |
| Spätspiel-Bot, v1.24 | 12 | 21 k / 18 k / 10 k |

Wer die Kommandozentrale ausbaut, rüstet also weiter; der Referenz-Bot (baut die KZ nicht gezielt) bleibt bei 0 in Woche 6 –
das ist sein Bauverhalten, kein Regelstillstand.

### R.4 Prüfbericht (Simulation nach allen Änderungen)
- **Zielfenster der Nester** (erster Prüftag ≥ 70 %): Stufe 1 Tag 1 (Ziel 1–2), 2 Tag 3 (3–5), 3 Tag 7 (7–10),
  4 Tag 14 (14–18), 5 Tag 21 (21–28) – **alle im Fenster**, unverändert gegenüber v1.23. Netto je Angriff (Bot-Verband):

| Tag | Nest 3 | Nest 4 | Nest 5 |
|---|---|---|---|
| 14 | 9 910 (v1.23 9 803) | 13 444 (9 155) | −6 555 (−20 599) |
| 21 | 9 519 | 14 988 (12 012) | 13 811 (13 551) |
| 28 | 9 085 | 14 933 (11 972) | 19 169 (17 180) |

  Nest 4 liegt damit klarer über Nest 3; die Stufen 3 → 4 → 5 steigen gleichmäßiger (Tag 28: 9,1 k / 14,9 k / 19,2 k).
- **Nest 6**: Beute 73 580 Richtwert (vorher 56 600). Sieg des Verbands mit vollen KP Tag 28/35: 63 % / 71 % (v1.23:
  15 % / 74 % – billigere Kampfpanzer und Zerstörer-Bonus helfen). Netto Tag 28 +6 720 (v1.23 −23 098), Tag 35 +7 946;
  mit 2 Landungsschiffen mehr (gleiche KP) 91 % und **+36 331** – deutlich über Nest 5 (≈ 20 000). Die Beute (37 700 Einheiten)
  passt erst in ~10 Landungsschiffe; wer Nest 6 wirklich ausräumen will, nimmt mehr Laderaum mit (Handbuch sagt das schon).
- **Kartell 0,40**: Sieg des Kartells gegen typische Verteidigungen weiter ≈ 0 %, Wache mit 20 Schützen weiter ≈ 50 %.
  Bleibender Verlust je Überfall gegen den Bot-Hafen halbiert: Tag 7 14,1 → 7,0 h, Tag 14 18,9 → 9,2 h, Tag 21 23,4 → 12,4 h,
  Tag 28 20,6 → 10,9 h Produktion.
- **Zerstörer gegen Korvette 1,6**: 10 Korvetten gegen 4 Zerstörer – Verlust der Korvetten 3 227 → 4 052, der Zerstörer
  3 617 → 3 257 (Zerstörer gewinnt den Gleichwert-Kampf jetzt knapp, vorher die Korvetten).
- **Elektrolyse 6**: Ausbau „KW 1 + Wind 7 + Sonne 4 + Speicher 4 + Elektr. 5“ (Nordsee März) 221 → 369 Treibstoff/Tag,
  amortisiert nach 9 statt 11 Tagen. **Chipfabrik 45**: Elektronik des Bots Tag 28 85 → 125/h.
- **Satellit**: Startrampe ab KZ 7; Radarsatellit 21 460 = 2,4 h Produktion je Tag Laufzeit an Tag 28 (Ziel 2–3 h,
  Regelwerk 11.3); optisch mit Rampe 4: 13 370.
- Nicht umgesetzt (P3 Mathematiker, nicht freigegeben): Versorgungshof 80 → 100, Nest-6-Wiederkehr 24 → 12 h.

## U. Seewege und Bordsicht

Freigegeben vom Nutzer (27.11.2026). Regeln: docs/REGELN.md (Missionen, „Seewege“), docs/REGELN-LAGEBILD.md 5.4/5.8.

- **Wegsuche** (`packages/world/src/searoute.ts`): A* über die Hex-Nachbarn, Kosten = Großkreis-km zwischen den
  Feldmittelpunkten, Schätzung = Luftlinie zum Ziel. Befahrbar: See, Küste, Passagen. Das Gelände bleibt unverändert
  (Nest- und Feldplätze hängen daran); die Passagen (`PASSAGES`: Gibraltar, Dover/Ärmelkanal, Dardanellen–Marmarameer–
  Bosporus, Suez, Öresund/Großer Belt, Messina, Kertsch) sind eine eigene Liste nur für die Wegsuche.
- **Küste ist Ufer, keine Landbrücke.** Würde jedes Küstenfeld frei befahren, führen Schiffe quer über Italien (zwei
  Küstenfelder breit), Jütland oder den Isthmus von Suez. Darum: zwischen zwei Küstenfeldern nur über ein gemeinsames
  Wasserfeld, durch ein Küstenfeld (nicht Start/Ziel) nur, wenn Ein- und Ausfahrt rund um das Feld über Wasser
  verbunden sind (Zustand der Suche = Feld × Einfahrtsrichtung). Mit den Passagen ist jedes Küstenfeld und jedes Nest
  aus dem Atlantik erreichbar (Test).
- **Glättung:** Die Hex-Kette wird über Sichtlinien auf Wasser (Proben alle 8 km) geglättet; auf offener See ist die
  Route die Luftlinie, sonst ein Linienzug um Land. Ohne Glättung wäre jede Fahrt durch das Zickzack bis zu 15 % länger.
- **Gespeichert im Plan:** `mission.route = { hexes, km, partial? }`; `distanceKm` bleibt die Luftlinie (Reichweite der
  Flugzeuge), Fahrzeit und Treibstoff nach `route.km` (`missionTravelKm`). `planMission` rechnet die Route selbst, wenn
  der Verband ein Schiff enthält (alle Aufrufer – Spieler, Allianz-Ops, Weltereignisse, Felder, Gründung, Verlegung,
  Bots – nutzen dieselbe Funktion); `route: null` erzwingt die Luftlinie. Reine Luft-/Drohnenverbände: Luftlinie.
- **Nicht über Wasser erreichbar** (heute nur Binnenland, kein Spielziel): Fahrt zum erreichten Feld mit der kürzesten
  Luftlinie zum Ziel, letztes Stück gerade (Landung über Land), `partial: true`.
- **Position unterwegs** (`packages/game-core/src/route-position.ts`, gemeinsam für Server und Karte): Anteil der
  Fahrzeit = Anteil der Routenlänge; Rückruf: Wendepunkt auf der Route, Heimfahrt dasselbe Stück zurück (Dauer wie
  bisher = gefahrene Zeit); Patrouille: Runde über die Seewege der Wegpunkte (`patrol.loop`), Heimweg nach der Station
  als Linienzug ab der Position (`patrol.homePath`); Kampagne: Abschnitt und Heimweg mit eigener Route
  (`route`/`homeRoute`); Admiral-Heimkehr: Route der Besatzung rückwärts, Fahrzeit nach ihrer Länge. Konvois
  (Transport, Felder, Spielerhandel) fahren die Route (Abfangpunkt, Position); Fahrzeit der Feld- und Handelskonvois nach
  Routenlänge. Kartellverbände und Börsenlieferungen: siehe Nachtrag U.1.
- **Abwärtskompatibel:** Missionen ohne `route` (vor der Umstellung gestartet) fahren weiter gerade.
- **Rechenzeit** (Entwicklerrechner, ohne Zwischenspeicher, 300 zufällige Küstenpaare): Median 0,9 ms, p90 3,1 ms,
  höchstens 6–11 ms (New York → Odessa, fast die ganze Karte durchsucht). Ergebnis je Start/Ziel im Zwischenspeicher
  (2 000 Einträge, LRU; Treffer < 1 µs), Missionen tragen die Route im Plan, nichts wird je Takt neu gesucht. Auf dem
  Raspberry Pi (etwa 5–8× langsamer) höchstens rund 0,1 s je neuem Paar – unkritisch.
- **Bordsicht 105 km** (`intel.fleetSight.warshipKm` 80 → 105, `intel.patrol.shipSightKm` 100 → 105): Die Mittelpunkte
  der Nachbarfelder liegen 100,5 km entfernt; 80 km erfassten nur das eigene Feld, 105 km das eigene und alle sechs
  Nachbarn (Test), das übernächste Feld (174 km) nicht.
- **Aufhellung wandert mit:** Die Nebel-Ebene rechnet die Felder ohne die eigenen bewegten Sensoren (Verband,
  Patrouille) einmal je Datenstand; die Sicht dieser Verbände spart die Karte im gedrosselten Ticker (250 ms) an der
  aktuellen Position aus. Der Nebel ist in Blöcke zu 8 × 8 Feldern geteilt; neu gezeichnet werden nur Blöcke, in denen
  sich ein Feld geändert hat (praktisch nur beim Überfahren eines Feldmittelpunkts). Sensoren tragen dafür `missionId`.

### Balance-Auswirkung (eigene Messung, `npm run -s sim` rechnet mit festen Entfernungen und bleibt unverändert)

Verhältnis Seeweg / Luftlinie aus Küstenhäfen (jedes 7. Küstenfeld) zu den Zielen:

| Ziele | Median | p75 | p90 | Anteil > 1,1 | Anteil > 1,5 | Summe Weg/Luft |
|---|---|---|---|---|---|---|
| Nester ≤ 400 km | 1,00 | 1,15 | 1,47 | 31 % | 9 % | 1,35 |
| Nester ≤ 800 km | 1,06 | 1,23 | 1,83 | 43 % | 16 % | 1,47 |
| Rohstofffelder ≤ 400 km | 1,00 | 1,06 | 1,20 | 23 % | 5 % | 1,12 |
| Häfen ≤ 800 km | 1,08 | 1,34 | 2,31 | 47 % | 21 % | 1,57 |

Die nahen Ziele, die Spieler und Bots tatsächlich wählen (nächstes Nest, Felder in Hafennähe), sind im Median gleich
lang; teurer werden Ziele hinter Land (Mittelmeer ↔ Adria, Nordsee ↔ Ostsee, Golf von Biskaya ↔ Mittelmeer), dort
oft das 2- bis 4-fache. Das ist gewollt (Geografie zählt, Meerengen werden wertvoll). **Vorschlag: Schiffstempo nicht
pauschal anheben** – es würde die Fahrten auf offener See (Mehrheit) beschleunigen, ohne die Umwege zu treffen. Falls
Spieler in Binnenmeeren (Ostsee, Adria, Schwarzes Meer) benachteiligt wirken, eher gezielt: Treibstoff je km für
Fahrten mit Route um 10 % senken oder weitere Passagen (z. B. Nord-Ostsee-Kanal ist im Raster schon offen) prüfen.
Nicht geändert.

### U.1 Nachtrag: Kartell und Börse über Wasser (freigegeben 27.11.2026)

- **Ufer-Regel bestätigt** (Küstenfelder sind Ufer, keine Landbrücke).
- **Kartell-Überfälle** (`packages/engine/src/kartell-route.ts`, `handlers.ts` raidLaunch): Ausgangsnest = unter den
  drei nächsten Nestern (Luftlinie) das mit dem kürzesten Seeweg. Bisher lief jeder Überfall in fester Zeit
  (`RAID_LEAD_MS` = 1 h) unabhängig von der Entfernung; das Kartell hat keine eigene Geschwindigkeit. Damit Takt und
  Stärke unverändert bleiben, gilt: **Vorlauf = 1 h × (Seeweg / Luftlinie), höchstens 3 h.** Auf offener See bleibt es
  bei 1 h; nur Häfen hinter Land (Adria, Ostsee, Buchten) bekommen mehr Vorlauf. Die Route steht im Plan (`route`):
  Karte (Pfeil und Kurs), Sicht und Radar-Erkennung folgen ihr über `fleetPosition`; Kartellverbände ohne Route (vor
  der Umstellung ausgelaufen) laufen weiter gerade vom nächsten Nest. Großflotte (springt zwischen Zielen) und
  Belagerung (steht) fahren nicht; das Schatzschiff fuhr schon vorher eine Breitensuche über Seefelder – unverändert.
- **Börsenlieferungen:** nächster Handelshafen und Entfernung über Wasser (`nearestTradePortBySea`, Börse, Basis,
  Hafenwahl, Karteninfo); Lieferzeit = Seeweg / `convoySpeedKmh`. Lieferungen haben keine Position auf der Karte.
- **Messung** (alle 529 Küstenfelder ohne Nest, feste Nestplätze; eigene Rechnung, `npm run -s sim` rechnet ohne
  Kartell-Fahrt und bleibt unverändert):

  | | Median | p75 | p90 | max | Anteil 1 h | Anteil > 1,5 h | am Deckel 3 h |
  |---|---|---|---|---|---|---|---|
  | Kartell-Vorlauf | 60 min | 61 min | 71 min | 158 min | 74 % | 1 % | 0 % |

  Die Radar-Vorwarnung beträgt 10 + 5 min je Stufe und war durch den Vorlauf auf 60 min gedeckelt. Bis Radar Stufe 10
  ändert sich nichts; ab Stufe 11 bekommen einzelne Häfen hinter Land bis zu ~1 h mehr Vorwarnung (p90 bei Stufe 15:
  71 statt 60 min). Die Stärke wird beim Auslaufen festgelegt (`raidStrengthShareOfDefense` 0,40) und ändert sich
  nicht; der Takt (`raidIntervalHours`) läuft ab dem Auslaufen weiter. **Kartell-Überfälle werden nicht entwertet**,
  kein Balance-Wert geändert. Börse: Seeweg / Luftlinie zum nächsten Handelshafen Median 1,00, p90 1,36, max 3,1.
- **Rechenzeit:** Kartell-Plan = 3 Wegsuchen, Börse = 10 (je Hafen einmal, danach Zwischenspeicher); über alle 529
  Küstenfelder zusammen 4,6 s auf dem Entwicklerrechner, also unter 10 ms je Hafen und Auslaufen.

## W. Spielerbindung und Admin-Kennzahlen

1. **Neue Benachrichtigungsarten** (`NOTICE_KINDS`): `daily` (Tagesbefehle bereit / Serie in Gefahr), `idle`
   (Bauschlange leer), `nest` (Nest wieder besetzt), `comeback` (Rückhol-E-Mail, nur E-Mail). Push-Vorgabe: die drei
   Erinnerungen an; E-Mail-Vorgabe: aus (Bauschlange und Nest gebündelt wie Ausbau), `comeback` an. Jede Art ist in den
   Einstellungen einzeln schaltbar; der Abmeldelink schaltet auch `comeback` ab.
2. **Auslösen und Entprellung:** „Bauschlange leer“ entsteht beim Abschluss des letzten Bauauftrags (event-notices.ts,
   einmal je Abschluss) mit demselben Push-Tag wie „Ausbau fertig“ – auf dem Gerät ersetzt sie diese Meldung und nennt
   beides. Die übrigen prüft der Worker jede Minute (retention.ts, winback.ts); Tabelle `player_nudge` (Spieler,
   Schlüssel) sperrt jede Meldung genau einmal (erst sperren, dann senden). „Tagesbefehle bereit“ 9–18 Uhr Spielzeit,
   nur wer in den letzten 7 Tagen, aber heute noch nicht da war und heute keinen Morgenbericht als Push bekam.
   „Serie in Gefahr“ 18–23 Uhr ab 2 Tagen Serie, nicht wenn in den letzten 30 Minuten online. „Nest wieder besetzt“
   nur an den Sieger des letzten gewonnenen Überfalls auf das Nest, höchstens 3 Std. nach der Wiederbesetzung.
3. **Morgenbericht für neue Spieler an:** Schema-Vorgaben von `morning_summary.enabled` und `.push` auf `true`; die
   Registrierung legt die Zeile mit diesen Vorgaben an. Bestehende Spieler bleiben unverändert (ohne Zeile gilt weiter
   `SUMMARY_DEFAULT` = aus; vorhandene Zeilen behalten ihre Werte).
4. **Rückhol-E-Mail:** an Menschen mit bestätigter Adresse, 3–7 Tage nicht da, 10–20 Uhr Spielzeit, einmal je Pause
   (Schlüssel `winback:<last_seen_at in ms>` – last_seen ändert sich erst bei Rückkehr). Inhalt aus vorhandenen Daten:
   Saison und Saisontag, Rang und Punkte, Angriffe und Plünderung seit dem letzten Besuch, Lagerfüllstand (voll =
   Produktion verfällt), gerissene Tagesserie, leere Bauschlange. Statt einer Spalte `winback_sent_at` nutzt sie die
   gemeinsame Entprellungstabelle (gleiche Wirkung, keine Änderung an `player_email`).
5. **Admin-Kennzahlen** (admin-kpi.ts, tRPC `adminStats.kpi`): Menschen und KI-Spieler getrennt (`bot_profile`).
   Tages-Aktivität `player_activity_day` (Spieler, Spieltag) – eingetragen von `touchLastSeen` (höchstens alle 5 Min.,
   idempotent je Tag); Kohorten-Retention Tag 1/7/14 nach Registrierung, nur Menschen, nur erreichte Tage zählen.
   Erst ab Einführung erfasst – ältere Kohorten sind unvollständig (die Oberfläche nennt „erfasst seit“).
6. **Meilensteine mit Saisontag** (Tag 1 = Saisonstart, je Meilenstein Anzahl, erster und Median-Tag): erster Sieg je
   Neststufe aus den Kampfberichten, zweiter Hafen aus `base.created_at` (aufgegebene Kolonien fehlen). Nicht
   ableitbar sind KZ-Stufe, Missionsplätze und Startrampe: der Worker trägt sie alle 10 Minuten aus den Hafen-Zuständen
   in `player_milestone` ein (auf ~10 Min. genau; der erste Lauf nach Einführung trägt den Bestand mit „jetzt“ ein).
   Satellit mit der Startzeit aus dem Zustand.
7. **Abschlussquoten:** Tagesbefehle (vergeben/erledigt/abgeholt, je Stufe, Spieler-Tage mit allen drei abgeholt) und
   Wochenziele im gewählten Zeitraum, nur Menschen.
8. **Laufzeit je tRPC-Aufruf:** Middleware an der Wurzel-Prozedur (apps/api/src/trpc.ts), Ringpuffer der letzten 256
   Messungen je Prozedur im Speicher des API-Prozesses (rpc-timing.ts), p50/p95 nach Nearest-Rank; nach Neustart leer.

## V. Oberfläche und Bedienung

1. **Allianz unter Truppen statt Meldungen.** Meldungen hatte sieben Reiter; „Allianz“ lag als siebter meist außerhalb
   der sichtbaren Leiste (Tippen + seitlich wischen + Tippen). Unter Truppen ist sie der vierte Reiter neben Einsatz,
   Ausbilden, Abwehr – zwei Tipps, ohne Wischen, und dort, wo Stationieren und Sammelangriff ohnehin hingehören.
   Die Alternative „Meldungen in Post und Rang teilen“ hätte eine sechste Hauptnavigation oder einen zusätzlichen
   Klick für Berichte bedeutet. Sprungziele „Was hilft? → Allianz“ führen über App.navTo auf Truppen → Allianz; die
   Hinweistexte der Engine („Annehmen unter Truppen → Allianz“) und das Handbuch sind angepasst.
2. **Reiterleisten** (ui.tsx `Segments`) sind Tabs im ARIA-Muster: Pfeiltasten/Pos1/Ende, nur der gewählte Reiter in
   der Tab-Reihenfolge, `aria-controls` auf ein `SegmentPanel` (Meldungen, Truppen, Börse).
3. **Menü statt „?“** in der Kopfleiste (Symbol + „Menü“): Blatt mit Handbuch, Einstellungen, Verwaltung (nur Admins),
   Abmelden. Einstellungen/Verwaltung öffnen direkt, ohne Umweg über das Handbuch.
4. **Missionsplanung:** Die Mini-Karte liegt hinter einer Deckfläche („Karte bedienen“), damit Wischen die Seite rollt
   (die Karte selbst setzt touch-action none); „Fertig“ sperrt wieder. Neulinge (nur Heimathafen, Kommandozentrale bis
   Stufe 3) sehen zuerst Überfall und Aufklärung; zielbezogene Arten (Besetzen, Abfangen, Posten angreifen) und die
   gewählte Art bleiben immer sichtbar. Besetzen bietet nur Schiffe an (Server: field_ships_only).
5. **Kontrast und Größe:** slate-600 = #67624f (≥ 4,5:1 auf allen Papiertönen), Fließtext und Kleinbeschriftungen
   mindestens 11 px (Kartenbeschriftungen in map/ ausgenommen). Tippflächen ≥ 44 px auch für „Was hilft?“, die
   Kapitel-Pillen des Handbuchs (Pille bleibt 32 px, Tippfläche 44 px) und kompakte Stepper.
6. **Börse:** Kurse mit zwei Nachkommastellen und „Kr“ („1,00 Kr“ statt „1,000“, das wie eine Tausendergruppe las);
   Unterreiter vor dem einklappbaren Kopf; „Nachrichten“ heißt „Marktlage“ (Schlüssel bleibt `nachrichten`).
7. **Lagebild:** eigene Sensoren und Sichtungen zuerst, Satelliten unten, eingeklappt solange weder Satellit noch
   Startrampe da ist; die Voraussetzung der Startrampe kommt aus der Balance (`buildings.startrampe.requires`).
   „Lohnende Ziele“ ohne Kampfeinheiten: „Aufklären“ ist die Hauptaktion, „Angreifen“ bleibt grau mit „Was hilft?“
   (neuer Hinweis `no_combat_units`).
8. **Wetterebene dezenter:** Grunddeckkraft 0,7, Isobaren blasser, Windfahnen der Übersicht erst ab Zoom
   LOD_OVERVIEW. Bei prefers-reduced-motion keine weichen Überblendungen (harte Stufen); die Schicht bewegt sich sonst
   nicht (Neuzeichnen je 15-Minuten-Fenster).
9. **Kleinigkeiten:** Stromfeld zeigt bei ausgeglichener Bilanz „gedeckt“ und ohne Speicher die Kraftwerk-Auslastung
   („KW 64 %“); Produktionsgebäude nennen die Grundproduktion; Forschungsstatus als Zeile im Bauhof; Ladeanzeigen
   erkennen Drosselung (429) und Fehler und bieten „Erneut versuchen“; Inhalte laden mit Kartenskelett. Desktop ab
   1024 px: Inhalt bis max-w-3xl, Karte volle Breite.

## X. Bots nach Prüfbericht

Ursachen des Bau-Stillstands (zufallsabhängig, traf je nach Startzeit jede Spielweise):
- **Strom-Sperre:** Seit das Kraftwerk nachregelt (0.21.3), liegt der Stromfaktor oft bei 0,99999…. `chooseBuild` sah
  darin Strommangel und bot nur das Kraftwerk an – stand es am Deckel der Kommandozentrale, baute der Bot gar nichts
  mehr (Festung 11–20 Stufen an Tag 8, alle Rohstoffe flossen in die Rüstung). Jetzt: Mangel erst unter 99,5 %, dann
  Kraftwerk, Wind/Sonne, Raffinerie bzw. Kommandozentrale; findet sich nichts, geht der normale Ausbau weiter.
- **Rüstungs-Tropf:** Der Rüstungsanteil lag knapp unter dem Ziel, also kaufte jeder Zug (Freibeuter alle 12–25 Min.)
  ein paar Einheiten mit dem knappen Stahl; Kommandozentrale und Lager wurden nie bezahlbar (Freibeuter KZ 2–4 über
  Wochen, Hunderte Schützen ohne Landungsschiff). Jetzt: Phasen je Hafen mit Hysterese (Rüstung zuerst bis zum
  Zielanteil, dann Ausbau zuerst bis 75 % des Ziels), Rücklage für den nächsten Ausbau (auch bei voller Bauschlange),
  Losgröße höchstens 45 % des Vorrats je Rohstoff, keine Truppen ohne Transportraum (statt dessen für das
  Landungsschiff sparen).
- **Patrouillen:** nur noch, wenn im Zug kein Angriff möglich war, höchstens alle 24 h und mit zwei freien Auftragsplätzen.
- **Gründung:** Schwelle Festung 9 → 5, Händler 7 → 5 (Freibeuter bleibt 5). Die Gründung läuft vor der Wirtschaft:
  eine KZ-Stufe vorher Vorrang für Werft/Hafenkommandantur/Lager (Stufen aus der Balance), dann Rücklage der
  Schiffskosten und freie Werft (früher belegten Korvetten die Werft – kein Bot gründete).
- **Händler** überfällt Nester bis Stufe 2 (`nestMaxLevel`, Probekampf 8 Durchläufe alle gewonnen, Heimwache der Schiffe 50 %).
- **Hafenwahl:** Bots, die Nester überfallen, wählen unter den guten Küstenfeldern eines mit ≥ 2 Nestern der Stufe 1–2
  in 150–600 km (sonst fand der Freibeuter je nach Lage tagelang kein schaffbares Ziel).
- **Raumfahrt:** Voraussetzungen der Startrampe (aus der Balance, jetzt KZ 7) werden zwei KZ-Stufen vorher nachgezogen;
  steht die Rampe, kommen die Satelliten-Techniken zuerst (doppelter Forschungsanteil). Probekampf je Stufe und bis zu
  6 Startversuche (Lagebild 3) bleiben.

Messung (`packages/engine/test/bots-progress.ts`, 4 Startzeiten, Bereich min–max; vorher: Stand 0.22.1 mit v1.23,
nachher: mit v1.24). Spalten: KZ, Häfen, Gebäudestufen, Startrampe, gewonnene Nest-Überfälle, höchste besiegte Neststufe, Satelliten.

| Tag | Bot | vorher KZ / Häfen / Stufen / Rampe / Siege / Nest / Sat | nachher KZ / Häfen / Stufen / Rampe / Siege / Nest / Sat |
|---|---|---|---|
| 14 | Händler | 4–5 / 1 / 86–91 / 0 / 0 / 0 / 0 | 4–5 / 1 / 85–96 / 0 / 0–9 / 0–2 / 0 |
| 14 | Festung | 3–4 / 1 / 57–71 / 0 / 2–11 / 1–2 / 0 | 4–6 / 1 / 73–93 / 0 / 9–14 / 2 / 0 |
| 14 | Freibeuter | 5–6 / 1 / 63–83 / 0 / 4–10 / 1–3 / 0 | 5–6 / 1–2 / 81–123 / 0 / 4–21 / 2–4 / 0 |
| 28 | Händler | 6 / 1 / 111–123 / 0 / 0 / 0 / 0 | 6–7 / 2 / 204–224 / 0 / 11–34 / 1–2 / 0 |
| 28 | Festung | 5–7 / 1 / 78–96 / 0 / 12–28 / 2–3 / 0 | 6 / 2 / 147–185 / 0 / 27–40 / 2–3 / 0 |
| 28 | Freibeuter | 6–8 / 1–3 / 95–168 / 0 / 22–35 / 3–5 / 0 | 8–9 / 3 / 241–257 / 1 / 52–61 / 3–6 / 0 |
| 41 | Händler | 6–7 / 1–2 / 128–191 / 0 / 0 / 0 / 0 | 8–9 / 3 / 309–370 / 0 / 32–69 / 2 / 0 |
| 41 | Festung | 5–7 / 1 / 85–112 / 0 / 25–43 / 2–6 / 0 | 6–8 / 2–3 / 201–224 / 0 / 42–71 / 2–6 / 0 |
| 41 | Freibeuter | 7–9 / 1–3 / 102–294 / 0–1 / 38–72 / 3–5 / 0 | 9–10 / 3 / 346–361 / 1 / 80–123 / 3–6 / 1–3 |

Zweiter Hafen ab Tag: vorher Händler 35/41/–/–, Festung nie, Freibeuter 25/33/38/–; nachher Händler 16–19,
Festung 15–24, Freibeuter 11–15. Die Analysten-Läufe mit Stillstand (Freibeuter KZ 2 bis Tag 31, Festung 20 Stufen an
Tag 8) traten mit den Ursachen oben auf; in 16 Testläufen (8 Tage, verschiedene Startzeiten) danach hatte jeder Bot
55–71 Stufen. Offen gegenüber der Modellkurve: die Nest-Stufe steigt langsamer (Stufe 3 meist erst Tag 14–28, Stufe 5–6
beim Freibeuter ab Tag 14–28, Festung meist 2–3); die Festung erreicht die Startrampe in 41 Tagen noch nicht (KZ 6–8).
`bots-sim.test.ts` läuft jetzt mit fester Startzeit (`BOT_SIM_T0`) und prüft zusätzlich: Freibeuter gewinnt mehr
Überfälle als der Händler.

## Y. Lektorat 0.22 – Sprache und Einheitlichkeit

1. **Namen statt Kennungen:** Weltereignis-Arten, Sabotageziel Seekabel, Berichtsarten (posten, sichtung, patrouille,
   kampagne), Missionsarten und alle Techniken haben deutsche Namen in Web und Engine. Die Techniknamen der Engine
   stehen nur noch in `engine/src/names.ts` (`TECH_NAMES`, von research.ts weitergereicht). `nameOf()` macht
   unbekannte IDs wie `label()` lesbar (ae → ä …). Test `game-core/test/namen.test.ts` verlangt für jede Balance-ID,
   jede Missionsart und jeden Fehlercode (aus den Quellen gelesen) einen Namen bzw. Text.
2. **Mehrzahl:** gemeinsame Hilfen `nOf(n, eins, viele)` (Web `lib/names.ts`, Engine `names.ts`, mail-report-kit
   reicht sie weiter) und `countName/countsText` (Engine, Tabelle wie Web-`PLURAL`) für Push und Morgenbericht.
3. **Begriffe:** „Hafen“ statt „Stützpunkt“, „KI-Spieler“ statt „Bot“ (Verwaltung darf „Bot“), „Piratennest“,
   Gebäude „Seekabel“, abgeschaltete Funktionen „in dieser Saison“, „Einstellungen → Verwaltung“ statt „Admin-Menü“,
   Versorgungsmangel „Angriff −20 %“, „Kredite“ im Fließtext („Kr“ nur in Kurszetteln und Zahlenzeilen).
4. **Zeiten:** Sabotage-Ende in Serverzeit (`clock`), nicht UTC; das Börsen-Tageslimit nennt die Uhrzeit des
   Tageswechsels in Spielerzeit. Dauern in Zahlenzeilen „h“/„min“, im Satz „Stunden“.
5. **Zahlen:** Faktoren mit Dezimalkomma („×0,85“), Mengen mit Tausenderpunkt auch in Engine-Texten.
6. **Handbuch:** Zahl und Namen der Forschungszweige und die Spanne der Forschungsamt-Stufen kommen aus der Balance.
7. **Remedy-Kurzfassungen** im Stichwortstil „Fehlt: …“.

## Z. Lagerwarnung für Tagesbefehle, Wochenziele und Erfolge

Seit 0.24.0 liefern diese Belohnungen nur bis zur Lagergrenze des Heimathafens (`deliverToStorage`). Jetzt warnt
die Oberfläche wie im Auftragsbuch – aber genauer und einheitlich:

1. **Server:** `dailyView`, `weeklyView` und `achievementsView` liefern `storage` = Lager des **Heimathafens**
   (Name, Kapazität, abgerechneter Bestand; `engine/src/reward-storage.ts`). Bewusst nicht der aktive Hafen: die
   Belohnung geht immer in den Heimathafen. `claimChallenge`, `claimWeekly` und `claimAchievement` geben `lost`
   zurück (Belohnung und Serien-/Wochenbonus zusammengezählt; Kredite verfallen nie).
2. **Web:** eine Komponente `RewardClaim` (`components/RewardClaim.tsx`) ersetzt den Knopf „Abholen“: verfiele etwas,
   zeigt sie je Ressource „verfiele X von Y“, dazu Lager Bestand/Kapazität und den Heimathafen, die Knöpfe
   „Lagerkomplex ausbauen“ (wechselt bei Bedarf in den Heimathafen) und „Trotzdem abholen“. Nach dem Abholen hängt
   `lostNote()` „Lager voll: … verfallen.“ an die Bestätigung.
3. **Wochenbonus** wird in die Vorhersage einbezogen, wenn das Ziel das letzte offene der laufenden Woche ist (wie auf
   dem Server). Der **Serienbonus** der Tagesbefehle nicht: seine Ressourcen stehen nicht in der Ansicht; was davon
   verfällt, nennt aber die Bestätigung (`lost`).
4. Das Auftragsbuch behält seine eigene, kürzere Warnung (nicht angefasst).

## AD. Admirale: Landungstrupp, Beutemeister bei Nestern, Umschulung, KI-Admirale (VORLAGE-ADMIRALE.md)

Umgesetzt wie freigegeben, alle Empfehlungen (1a, 2a, 3a, 4a, 5a, 6a):

1. **Landungstrupp** (`admirals.specs.landung`): Mission `attack.land` +10 %, `hp.land` +8 %, `mineDamage` −30 %;
   Hafenrolle als `defense` (nicht `harbor`): `hp.land` +6 % – `harbor` ist im Code die passive Wirkung (Radar,
   Bunker), Kampfwerte des Hafenkommandanten laufen über `defense` (auch gegen Kartell und für Feldbesatzungen wie
   bisher). Rangfaktor, Kosten, Plätze, Risiko unverändert. Nachgerechnet mit der Vorlagenrechnung gegen Balance v1.25:
   Kampfwert-Tabelle identisch (Admiral Landungstrupp Nest 5 +10,6 %). Der knappe T28-Bot-Verband liegt heute bei
   Nest 5 (k = 0,49) mit 59 % statt 51 % Sieg; mit Admiral Landungstrupp 79 % (Vorlage 74 %), Kapitän 69 %.
   Unit-Test (`game-core/test/admirals-landung.test.ts`) mit festem Verband und 200 Seeds: ohne 45–70 %, Admiral
   ≥ +12 Punkte, Kapitän dazwischen, „Angriff“ darunter; Kampfwert-Bonus Nest 5 zwischen +7 und +14 %.
2. **Beutemeister:** neuer Modifikator-Schlüssel `nestLoot` (skalar), wirkt in `computeLoot` nur auf `fixedLoot`
   (Piratennester), danach Laderaum-Kappung wie bisher. Sammelangriff mittelt ihn wie `loot`.
3. **Umschulung:** Spalte `admiral.retrain_free boolean not null default true` (**Migration durch den Integrator**,
   lokal nur zum Testen erzeugt: `ALTER TABLE "admiral" ADD COLUMN "retrain_free" boolean DEFAULT true NOT NULL;`).
   Der Vorgabewert gibt allen bestehenden Admiralen die Umschulung; `appointAdmiral` setzt false. Befehl
   `retrainAdmiral` (Router `admiral.retrain`): nur erste Spezialisierung, nicht auf spec1/spec2, nicht unterwegs
   (die Missionswirkung soll während der Fahrt nicht wechseln), kostenlos; Code `admiral_retrain_used`.
4. **KI-Admirale** (`engine/src/bots-admiral.ts`): Freibeuter/Festung ab Hafenkommandantur 1 im Heimathafen über
   `appointAdmiral` (gleiche Kosten). Damit die Börse die Kredite nicht laufend ausgibt, hält `marketTurn` bis zur
   Ernennung `creditReserve` (2 000) zurück. Freibeuter: bereiter Admiral steht in `TurnCtx.admiral`; Probekampf von
   `raidNest`/`raidPlayer` rechnet seine Missionswirkung ein, `tryLaunch` gibt `admiralId` beim ersten Überfall aus
   dem Hafen mit. Festung: Ernennung macht ihn zum Hafenkommandanten; abberufen → nächster Zug setzt ihn wieder ein.
   Bewusst nicht: Lösegeld, zweite Spezialisierung, Admiral für Feldmissionen.
5. **Oberfläche:** Spezialisierung beim Ernennen wählbar (generisch aus der Balance); Umschulung im Admiralblatt mit
   zweistufiger Bestätigung; neue Pfadtexte („Angriff der Truppen“, „Minenschaden“, „Nestbeute“). Der Probekampf der
   Missionsplanung rechnete den gewählten Admiral bisher **nicht** ein – jetzt schon (`withAdmiralMods`, nennt ihn
   über dem Ergebnis). Zusatz (Nutzermeldung): `admiralView` liefert `have`/`missing`; die Kachel „Admirale“ zeigt
   die Raute nur bei freiem Platz **und** bezahlbar, sonst „Platz frei – fehlt: …“; beim Ernennen Kosten rot und
   Sperrgrund mit „Was hilft?“ statt Fehler nach dem Klick.
6. `sim/admirals.ts` nicht erweitert (Vorlage Abschnitt 7 nennt es optional); die Belegrechnung steckt in den Tests.

## AA. Spieler gegen Spieler: Kopfgeld, Mutfaktor, Paarbremse (Vorlage PvP, alle Empfehlungen)

Umgesetzt mit den empfohlenen Antworten 1a–7a; Zahlen im eigenen Balance-Block `pvp` (die Vorlage nannte
`scoring.pvp` – eigener Block, damit `scoring` unberührt bleibt). Regeln: REGELN.md „Saison und Wertung“ und „Schutz“.

1. **Kern rein** (`game-core/src/pvp.ts`): `pvpStamp` (Kopfgeld, Mutfaktor, Absprache), `stampFactors` (Kampf
   = Kopfgeld × Mut ≤ maxFactor, Beute = Mut, Abwehr = 0,5 für Kopfgeld-Ziele), `pairIndexes`/`pairFactor`
   (Paarbremse, gleitendes 72-h-Fenster, Reihenfolge Zeit, dann Bericht-ID).
2. **Rekonstruierbar aus den Berichten:** Jeder Kampfbericht mit Spieler auf beiden Seiten bekommt beim Speichern
   (`storeReport`, `storeNavalReport` → `withPvpStamp`) `report.pvp` mit Rang und Punkten beider zum Tagesbeginn,
   Kopfgeld, Mutfaktor und Absprache. Die Paarbremse leitet `scoring.ts` (`pvpFactors`) bei jedem Abruf aus der
   Reihenfolge der Saisonberichte ab – sie gilt damit auch für ältere Berichte ohne Stempel (dort ohne Kopfgeld/Mut).
3. **Rang zum Tagesbeginn:** `server_setting pvp_rank_snapshot`, gerechnet beim ersten Abruf des Spieltags (Worker-
   Wartung alle 10 min, sonst erster Kampf oder Rangliste) – keine echte 0:00-Aufnahme, aber höchstens ~10 min danach;
   Ausbau/Militär sind dann schon „heute“. Kein Rangwechsel während der Anfahrt ausnutzbar. Ein Nachzügler-Ereignis mit
   älterem Zeitpunkt nimmt die neuere Aufnahme (kein Zurückrechnen). Spieler ohne Eintrag: ohne Rang, 0 Punkte.
4. **Kopfgeld nur mit Punkten:** Zu Saisonbeginn stehen alle punktgleich auf Rang 1 – ohne Punkte kein Kopfgeld.
   „Schlechter platziert“ = höhere Rangzahl oder ohne Rang; Gleichplatzierte bekommen keins.
5. **Halbe Abwehr auch bei Absprache:** Die Absprache-Sperre nimmt dem Angreifer Kopfgeld und Mut > 1, die halbe
   Verteidigung der Spitze bleibt (strenger als der Wortlaut, verhindert Punkteschieben zur Spitze durch Freunde, die
   sich absichtlich aufreiben).
6. **Sammelangriff:** Wertung bleibt wie bisher beim eingetragenen Angreifer (erster Teilnehmer); Rang/Mut von ihm.
   Absprache, wenn irgendein Teilnehmer mit dem Ziel verbunden war; Paarbremse zählt jeden Teilnehmer mit dem Ziel,
   der Angreifer nimmt die Stufe seines Paares, der Verteidiger die niedrigste der beteiligten Paare.
7. **Absprache-Quellen:** angenommenes Handelsangebot (`player_offer`), angekommener Transport (Bericht `transport`),
   Stationierung (Mission `stationierung`, laufend oder ≤ 7 Tage), dieselbe Allianz jetzt, aktiver Pakt jetzt, und
   beendete Allianz/Pakt: Austritt, Ausschluss, Auflösung und Paktende schreiben `server_setting pvp_ties`
   (Paar → Zeitpunkt, Einträge > 7 Tage fallen beim Schreiben weg; `engine/src/pvp-ties.ts`). Ohne Schemaänderung.
8. **Ausgenommene Berichte** (`report.pvpExcluded`, Verwaltung) zählen für beide 0, für die Paarbremse aber weiter.
9. **Anfängerschutz-Ende:** neues Feld `protection.beginnerEndedAtMs` (Kolonien erben es); gesetzt in `planMission`
   bei Überfall mit `playerHarbor` (nur `launchMission` auf einen Spielerhafen und Beitritt zu einem Sammelangriff auf
   einen Hafen – nicht Felder, Radarposten, Blockade, die intern ebenfalls „ueberfall“ planen). Die übrigen Häfen des
   Spielers per `jsonb_set` (`endBeginnerElsewhere`). Ein Rückruf stellt den Schutz nicht wieder her.
10. **Geplünderter verliert keine Punkte** – bleibt laut Vorlage; die Paarbremse schließt die Lücke.
11. **KI:** Der Freibeuter sortiert erlaubte Spielerziele nach Kopfgeld (nur wenn er schlechter platziert ist), dann
    Entfernung. Die KI-Erlaubnis für Angriffe auf Menschen und die 12-h-Sperrfrist bestanden schon.
12. **Oberfläche:** Rangliste „+50 %“ neben dem Namen und Satz in der Spielerübersicht; Missionsplanung (Überfall auf
    einen Spielerhafen) und Kartenblatt zeigen Kopfgeld, Mutfaktor, Paarbremse und Absprache (`social.pvpTarget`);
    Missionsplanung warnt „Dein Anfängerschutz endet damit“; Kampfbericht nennt Kopfgeld/Mut/Absprache; Verwaltung
    „Auffällige Paare“ mit „Bericht aus der Wertung nehmen“.

Fortsetzung in `ENTSCHEIDUNGEN-5.md`.
