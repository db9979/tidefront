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
