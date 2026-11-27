# game-core – Entscheidungen, Teil 5

Fortsetzung von `ENTSCHEIDUNGEN-4.md`. Verbindlich bleibt `docs/REGELN.md`. Neue Abschnitte bitte hier anhängen.

## AB. Aufholhilfe (Baugutschrift für kleine Häfen und Spät-Einsteiger)

Umsetzung der Vorlage `docs/VORLAGE-AUFHOLHILFE.md` (im Haupt-Checkout) mit den Nutzerentscheiden (Messung an Ausbaupunkten, Deckel +50 %
statt +100 %, Baugutschrift, Startpaket 15 % ab Tag 8, gilt für KI, keine schnellere Bauzeit). Regeln:
`docs/REGELN.md` „Aufholhilfe“; Balance-Block `catchUp`; Kern `game-core/src/catch-up.ts`, Server
`engine/src/catch-up.ts`, Rechnung `game-core/sim/aufholhilfe.ts`.

1. **Kurve:** b = 0,5 × clamp((0,70 − r) / 0,40; 0; 1) – Beginn unter 70 %, linear bis zum Deckel +50 % bei ≤ 30 %
   (60 % → +12,5 %, 50 % → +25 %, 40 % → +37,5 %). Hysterese wie Vorlage (Wegfall ab 70 %, Wiederbeginn unter 60 %).
2. **Konto:** Betrag zum Börsen-Richtwert (Stahl = 1) in `BaseState.catchUp` (eigenes Feld, nicht in `resources`):
   Lager, Plünderung (`defenderFromBase`/`applyDefenseResult`), Handel, Transport und Kolonie-Fracht sehen es gar nicht.
   `cloneBase` kopiert es (sonst ginge es bei jedem `settle` verloren). Je Hafen, r je Spieler über alle Häfen.
3. **Verbrauch: zuerst, nicht anteilig.** `startUpgrade` verbraucht die Gutschrift vor dem Lager und deckt denselben
   Anteil jeder Ressource (abgerundet, `splitBuildCost`). Begründung: Die Gutschrift hat keinen anderen Zweck, ihr
   Zufluss ruht am Höchstbestand (24 h) – „anteilig“ hielte sie unnötig voll und bremste genau die Hilfe; sie ist nicht
   plünderbar, also gibt es keinen Grund, das Lager zuerst zu leeren. Ein fester Anteil je Ressource verhindert, dass
   die Gutschrift gezielt nur die knappe Elektronik bezahlt. Der Auftrag merkt sich `credit`; `cancelUpgrade` erstattet
   diesen Teil (anteilig wie üblich) in die Gutschrift statt ins Lager – sonst würde ein Abbruch Gutschrift in
   plünder- und handelbare Rohstoffe verwandeln.
4. **Leichtgewichtig für den Pi:** Worker-Schritt alle 10 Minuten, rechnet nur alle `refreshMinutes` (60): eine Abfrage
   `state->'buildings'` aller Häfen, `buildingValue` aus `scoring.ts` (nur gelesen), Median in `server_setting catch_up`.
   Geschrieben werden nur Häfen mit Konto oder mit Hilfe, je Hafen kurze Transaktion mit `for update` + `jsonb_set`
   (kein verlorener Verbrauch durch gleichzeitige Bauaufträge). Zufluss mit dem Bonus des vorigen Laufs, höchstens 2 h
   je Lauf (Worker-Stillstand zahlt nicht nach). Gebäudeproduktion ohne Forschungszuschläge (spart Modifikator-Abfragen).
5. **Startpaket** in `chooseBase` (Menschen und KI): ab Saisontag 8 (Tag 1 = Beginn), Median aus dem Zwischenspeicher
   (höchstens zwei Läufe alt), sonst frisch gerechnet. Einmalig, da nur der erste Hafen über `chooseBase` entsteht
   (Heimathafen lässt sich nicht aufgeben; Kolonien bekommen nichts).
6. **Missbrauch:** kein Neustart möglich (neues Konto nur per Einladung), Median nur aus Häfen ≥ 3 Tage, Gutschrift nur
   für Gebäude (Rüsten bringt nichts, Bauen beendet die Hilfe von selbst). Die Verwaltung zeigt je Spieler aktiv,
   Bonus, Bestand und Summe (Statistik → Wirtschaft).
7. **Bots** nutzen die Gutschrift automatisch (gleicher `startUpgrade`); ihre Rücklage beim Sparen rechnet nur den
   Lageranteil (`bots-plan.ts`). Sim-Bot: Gutschrift-Teile zählen nicht als eigene Bauausgaben (Rüstungsanteil).
8. **Oberfläche:** Zeile unter der Ressourcenleiste und im Bauhof (Betrag, Herkunft „Aufholhilfe“, Erklärblatt),
   Kosten im Gebäudeblatt verrechnet („Baugutschrift“ / „aus dem Lager“), Raute „ausbaubar“ nach Abzug der
   Gutschrift; Handbuch-Kapitel „Aufholhilfe“.

**Rechnung** (`node packages/game-core/sim/aufholhilfe.ts`; Median = Referenz-Bot 45 % Rüstung, „Spitze“ =
Wirtschaftsspieler 25 % Rüstung; Ausbauwert / Median nach 14 Tagen bzw. am Saisonende Tag 42):

| Einstieg (Saisontag) | ohne Hilfe +14 / Ende | **Paket 15 % + Bonus +50 %** +14 / Ende | Σ Gutschrift | höchstens / Spitze | Vergleich +100 % +14 / Ende |
|---|---|---|---|---|---|
| 8 | 58 / 96 % | **80 / 105 %** | 18 k | 69 % | 80 / 105 % |
| 15 | 35 / 70 % | **66 / 84 %** | 45 k | 55 % | 70 / 87 % |
| 22 | 25 / 42 % | **60 / 77 %** | 84 k | 51 % | 70 / 96 % |
| 29 | – / 24 % | **– / 76 %** (nach 13 Tagen) | 112 k | 50 % | – / 83 % |

- Die Baugutschrift wirkt stärker als die Vorlage (dort Rohstoffe, Bonus +100 %: Tag 22 + 14 → 54 %): sie fließt
  vollständig in Gebäude. Deshalb reicht der halbe Deckel; +100 % brächte vor allem späten Einsteigern mehr
  (Tag 22: Ende 96 % statt 77 %) und kaum Vorteil sonst.
- **Niemand überholt die Spitze:** höchstens 69 % des Ausbaus der Spitze. Der Einsteiger an Tag 8 endet bei 105 % des
  Medians – die Hilfe endet bei ihm schon nach etwa einer Woche (71 %), den Rest holt er selbst auf, weil der
  Median-Ausbau gegen Saisonende abflacht (ohne Hilfe 96 %).
- Wer von Anfang an mitspielt, bekommt nichts (Σ 0).

## AE. Saisonfinale „Leviathan“

Umsetzung von docs/VORLAGE-SAISONFINALE.md mit den Nutzerentscheidungen (1a Abzug ohne Strafe, Restbeute verfällt,
Ruhmeshalle „entkommen“; 2b Kampfpunkte × 0,5; 3 zentraler Ort, Vorhuten bei weit verteilten Häfen; 4b KI tragen bei,
Titel/Ruhmeshalle nur Menschen; 5a Tag 36 Ankündigung, Tag 38 12:00 + 72 h; 6a Beute ohne Laderaumgrenze).

1. **Ereignisart `finale`** in der Tabelle `world_event` (Weltereignis wie die anderen, aber nicht in `WORLD_EVENT_KINDS`:
   nie zufällig geplant). Eigene game_event-Typen `finale_announce`, `finale_appear`, `finale_end`; der Planer hängt an
   `ensureWorldEventPlanner` (eine Ankündigung je Saison). Gewöhnliche Weltereignisse enden ab der Ankündigung
   (`ordinaryEventsUntil`).
2. **Zeiten** als Tage nach Saisonbeginn (35,5 / 37,5) plus 72 h, bezogen auf 42 Tage; andere Saisonlängen
   proportional (auch die Dauer), Ende immer vor dem Saisonende.
3. **Flaggschiff** als NPC-Einheit `flaggschiff` (eine Sektion, 1 000 LP) in `balance.npcUnits`; Teilschaden bleibt so
   über mehrere Angriffe erhalten. Wert in der Wertung 2 375 je Sektion (gleicher Wert je LP wie Schnellboot + 8 Miliz).
4. **Abschnitt** = 0,5 × K / hp(Schnellboot) Boote – genau wie in der Rechnung der Vorlage (K in LP der Kriegsschiffe
   und Flugzeuge, die Boote kommen mit ihrer Miliz, Schaden ≈ 1,5 × K). Mindestens 4 Boote.
5. **Vorhuten** (Frage 3b als Automatik): Spannweite der Teilnehmerhäfen > 1 500 km → je ferner Hafen (> 400 km vom
   Sammelpunkt) eine Vorhut höchstens 400 km vor ihm, nahe Häfen teilen sich eine. Vorhuten sind nur weitere
   Kampforte derselben Geschwader (gemeinsamer Bestand), keine eigenen Verbände; eine Mission fährt zum nächsten
   Kampfort. Nach dem Versenken der Geschwader bleibt nur der Sammelpunkt (Ankunft an einer Vorhut: Bericht ohne Kampf).
6. **Aktiv** heißt: `player.last_seen_at` (oder Anmeldung) in den letzten 72 h; KI-Spieler zählen immer.
7. **Allianz-Schaden** nur von menschlichen Mitgliedern zum Kampfzeitpunkt, mitgeschrieben in `world_event.data.finale`
   (Entscheidung 4b gilt auch für den Titel „Leviathan-Flotte“). Der Gesamtschaden (Anteile, Erfolg) enthält die KI.
8. **Ruhmeshalle:** neue Tabelle `season_finale_result` (eine Zeile je Saison; bleibt über das Saisonende, anders als
   `world_event`). Sie erscheint in der Ruhmeshalle der beendeten Saison; bis dahin stehen Ergebnis und Titel in der
   Systemnachricht an alle und im Kartenblatt. **Migration erzeugt der Integrator** (`drizzle-kit generate`).
9. **Erfolg „Armada-Jäger“** (Zähler `armada`, Modus max, keine Wochenziele): Anteil am Gesamtschaden in ganzen Prozent.
10. **Vor dem Erscheinen** werden Missionen abgelehnt, die vorher ankämen (`finale_not_yet`); ein Sammelangriff, der zu
    früh ankommt, findet keinen Gegner (Bericht ohne Kampf).
11. **Verwaltung:** „Saisonfinale vorziehen“ (`admin.startFinale`, Engine `startFinaleNow`) kündigt sofort an; ein
    beendetes Finale der Saison wird ersetzt (Ergebnis gelöscht), ein laufendes nicht.
12. **Wertung:** eine abgegrenzte Stelle in `scoring.ts` (`armada` in `reportScore`) mit `scoring.armadaFactor`; sie ersetzt nur den NPC-Faktor. Armada-Kämpfe sind keine Spielerkämpfe, die PvP-Faktoren bleiben dort 1.
## Baukosten umverteilen: stufenabhängige Kostenmischung (Balance v1.29)

**Anlass:** Wirtschaftsprüfung 0.24.2 – Stahl ist die ganze Saison einziger Engpass (≈ 1 % ungenutzt), Treibstoff 57 %,
Elektronik 66 %, Proviant 43 % bleiben liegen, weil Bauen fast nur Stahl kostet. Nutzerentscheid: Baukosten umverteilen.

1. **Mechanik statt Werte-Hack:** Das Kostenmodell kannte je Stufe nur `costFactor`. Neu `building.costShift`
   (`perLevel`, `max`, `to`) in `upgradeCost`: Beim Ausbau L → L+1 wird der Anteil `min(max, perLevel × L)` des Stahls
   vor dem Aufrunden wertgleich zum Börsen-Richtpreis (`market.refPrice`) auf die Zielmischung umgelegt; optional je
   Gebäude `costShiftTo`. Stufe 0 bleibt gleich, höhere Stufen verlagern mehr; Gesamtwert gleich (Aufrunden je
   Ressource: ≤ 5,4 Richtwert je Stufe mehr), Bauzeiten unverändert. Ohne `costShift` gilt die alte Formel.
2. **Werte:** `perLevel` 0,03, `max` 0,35 (ab Stufe 12), `to` Elektronik 75 % / Proviant 25 %; Kaserne und
   Versorgungshof `costShiftTo` Proviant 50 % / Elektronik 50 %. **Kein Treibstoff:** Treibstoff war im ersten Versuch
   (40 % Treibstoff) beim aktiven Spieler sofort Engpass (0 % ungenutzt, ausgefallene Nester) – er wird für Fahrten
   gebraucht. Verlagert (alle Gebäude, Werte `mix`-Rechnung): bis Stufe 6 −11 % Stahl, bis 10 −21,5 %, bis 12 −27 %,
   bis 15 −33 %. Beispiel Kommandozentrale Stufe 9 → 10: vorher 15 378 St / 3 845 Tr / 3 845 El, jetzt 11 226 St /
   3 845 Tr / 4 883 El / 1 730 Pr.
3. **Startphase:** Stufen 0–2 verlagern 0–6 %, Startbestände bleiben (Kommandozentrale Tag 3 unverändert: passiv 1,
   aktiv 3). Einheiten-, Unterhalts- und Forschungskosten unverändert.
4. **Oberfläche/Server:** alle Kosten kommen aus `upgradeCost` (Views, Bots, Wertung, Aufholhilfe); der Bauhof
   (`Base.tsx` levelCost) rechnete die Formel selbst nach und nutzt jetzt `upgradeCost` aus dem Regelkern.
   Gebäudekarten zeigen Proviant automatisch (Kosten-Komponente ist generisch). Handbuch nennt keine Gebäudekosten.
5. **Aufholhilfe:** `splitBuildCost` teilt jede Ressource anteilig, also auch Proviant – Test in `cost-shift.test.ts`.
6. **Bots:** keine Änderung an `bots-econ.ts` nötig. Die Engine-Bots gewichten Erzeuger ohnehin nach Knappheit;
   `bots-sim.test.ts` (8 Tage) grün mit vier Startzeiten; Gebäudestufen Tag 8 Händler/Festung/Freibeuter 68/65/65
   statt 65/58/61, Punkte 884/1166/1804 statt 679/839/1647.
7. **Wertung:** Ausbaupunkte = Kostenwert zum Richtpreis, durch die Wertgleichheit praktisch unverändert
   (`social.test.ts`: Stahlwerk 1→2 261 → 263,8 durch Aufrunden).

**Rechnung** (`econ.ts` der Wirtschaftsprüfung, Spätspiel-Bot 45 % Rüstung, 42 Tage; „ref“ = Standard-Bot,
„spät“ = Spätspiel-Ausbau; ungenutzt = Endbestand Tag 42 / gesamter Zufluss inkl. Start, Grundrate, Extern;
Engpass = Rohstoff mit der niedrigsten mittleren Lagerfüllung der Woche):

| Lauf | ungenutzt St / Tr / El / Pr vorher | **nachher** | KZ Tag 42 | Ausbauwert 42 Tage |
|---|---|---|---|---|
| passiv ref | 1 / 57 / 66 / 43 % | **0 / 47 / 35 / 22 %** | 8 → 9 | 503 k → 708 k |
| aktiv ref | 1 / 32 / 60 / 69 % | **0 / 5 / 5 / 28 %** | 12 → 13 | 2,42 M → 3,77 M |
| passiv spät | 13 / 41 / 50 / 13 % | **12 / 41 / 16 / 0 %** | 12 → 13 | 319 k → 434 k |
| aktiv spät | 28 / 11 / 57 / 48 % | **25 / 6 / 21 / 33 %** | 16 → 17 | 1,65 M → 2,18 M |

| Engpass je Woche (2. knappster) | W1 | W2 | W3 | W4 | W5 | W6 |
|---|---|---|---|---|---|---|
| aktiv ref vorher | St (El 20 %) | St (El 17 %) | St (El 15 %) | St (El 15 %) | St (Tr 12 %) | St (Tr 10 %) |
| **aktiv ref nachher** | St (El 16 %) | St (El 8 %) | St (El 4 %) | St (El 2 %) | St (El 1,5 %) | Tr (St 1,1 %) |
| passiv ref vorher | St (El 15 %) | St (El 23 %) | St (El 22 %) | St (El 22 %) | St (El 21 %) | St (El 22 %) |
| **passiv ref nachher** | St (El 14 %) | St (El 18 %) | St (El 16 %) | St (El 12 %) | St (El 10 %) | St (El 9 %) |
| aktiv spät vorher | St | St | St | Tr | Tr | Tr |
| **aktiv spät nachher** | St | St | El | Tr | Tr | Tr |

- **Ziel erreicht beim aktiven Spieler:** alle vier Rohstoffe knapp (5/5/28 % statt 32/60/69 %), Stahl und
  Elektronik binden gemeinsam, ab Woche 6 auch Treibstoff.
- **Passiver Spieler (keine Belohnungen, keine Fahrten):** Elektronik 66 → 35 %, Proviant 43 → 22 %; Stahl bleibt
  Engpass, weil die Rüstung (45 % der Ausgaben, Einheitenkosten unverändert, stahllastig) ihn bindet. Treibstoff
  57 → 47 %: Treibstoff ist der Fahrtrohstoff; mehr Treibstoff in Baukosten machte den aktiven Spieler knapp
  (s. o.). Bewusst so gelassen.
- **Treibstoff aktiv:** Der Rechen-Bot spart nie für Fahrten; an Tag 36–42 fiel 1 Nest aus (vorher 0), „spät“
  6 statt 2 Ausfälle. Ein Spieler hält Fahrtreibstoff zurück; im Auge behalten (Live-Daten), ggf. Raffinerie.
- **Schnelleres Wachstum:** Rohstoffe, die vorher lagen, werden verbaut – Ausbauwert +40–55 %, das ist bei Faktor
  1,5 je Stufe etwa **eine Stufe** am Saisonende (KZ 12 → 13). Nest-Zielfenster (`npm run sim`, „Erster Prüftag mit
  ≥ 70 %“) **unverändert**: Stufe 1 Tag 1, 2 Tag 3, 3 Tag 7, 4 Tag 14, 5 Tag 21. Nur der Bot mit 30 % Rüstung
  erreicht Stufe 4/5 an Tag 14/18 statt 18/21; die 42-Tage-Kette erreicht Nest 4 an Tag 11 statt 12, Nest 5 an Tag
  19 statt 20; gedachtes Nest 6 ×1,3–1,5 an Tag 42 100 % statt 84/63/37 % (Tag 28/35 gleich).

## Börse für die kleine Runde: Rückkehr 24 h, Handelsbilanz, gleitendes Tageslimit, Saisonchart (Balance v1.30)

Vom Nutzer freigegeben (Runde 3–10 Menschen + 3 KI). Rechnung des Analysten: `/tmp/tf-review/boerse/sim.ts`,
`sim-ergebnis.txt` (Stahl-Kurs relativ zum Richtwert, 6 Wochen, N = Spielerzahl):

| Variante | N=3 Stahl Ø / Prov Ø / Pausen | N=6 | N=10 |
|---|---|---|---|
| Status quo (Halbwertszeit 12 h) | 1,37 / 0,78 / 2 | 1,45 / 0,75 / 66 | 1,47 / 0,74 / 3 |
| nur 72 h bzw. 168 h | 1,55 / 0,54 / 0 (168 h: Grenze 525) | 1,56 / 0,54 / 5 | 1,56 / 0,54 / 5 |
| **dyn. Richtwert + 24 h (gewählt)** | **1,50 / 0,67 / 0** | **1,52 / 0,67 / 2** | **1,52 / 0,66 / 1** |

1. **Rückkehr 12 → 24 h** (`market.reversionHalfLifeHours`). Längere Halbwertszeiten (72/168 h) klebten den Stahlkurs an
   die Obergrenze; 24 h hält Knappheit spürbar, ohne dass der Kurs anschlägt.
2. **Handelsbilanz** als Marktnachricht (`news.tradeBalance`, Quelle `handelsbilanz`, Schlüssel `handelsbilanz`; Kern
   `tradeBalancePct`/`cappedNetBuys` in `news.ts`, Server `syncTradeBalance` in `market-news-sources.ts`):
   - Netto-Käufe je Spieler aus dem Journal: Börsenhandel (`trade_id` „t-…“), Zeile des Kontos `market` je Ressource
     (Kauf: Markt gibt ab → negativ, daher Netto = −Summe). Spielerhandel, Lieferungen, Saisonabschluss zählen nicht.
     Nur die laufende Saison (ab `season.starts_at`), höchstens `windowHours` (72 h). Neuer Index `ledger_t` auf `t_ms`.
   - **⅓-Deckel:** „Anteil eines Spielers an der Summe gedeckelt“ ist zirkulär, wenn man am gedeckelten Ergebnis misst.
     Auslegung: Bezug ist die **gesamte Bewegung** G = Σ |Netto je Spieler|; jeder Spieler zählt höchstens G/3 mit seinem
     Vorzeichen. Ein einzelner Großhändler bewegt den Richtwert also zu einem Drittel, ab drei gleich starken Händlern
     zählt alles. Als ganzzahliger Teiler `playerShareDivisor: 3` statt 0,3333 (sonst zählten drei Gleiche nicht voll).
   - **Aktive Häfen** (≥ `minPorts` 3): Häfen von KI-Spielern (nicht abgeschaltet, `bot_settings.active` ≠ false) und von
     Menschen, die in `scarcity.activeDays` (7) Tagen gesehen wurden. Darunter endet eine laufende Nachricht sofort.
   - Ganze Prozent (wie Kriegslage), sonst jede 10-Minuten-Runde eine neue Zeile; Halten 1 h + 1 h Abklingen, damit ein
     stehender Worker die Wirkung auslaufen lässt. Zählt in die Summe (±25 %) und folgt mit ≤ 5 %/h.
   - Grenzen (`price_bounds`) und Kursband bleiben am Grundrichtwert bzw. an den echten Kursen; die Wertung
     (`resValue`) bleibt am festen Grundrichtwert. Nebenbei behoben: die Anzeige der Grenzen in der Börse
     (`calc.ts allowedRange`) rechnete mit dem effektiven statt dem Grundrichtwert.
   - Aufwand für den Pi: eine Join-Abfrage über die Journalzeilen der letzten 72 h (Index auf `t_ms`) und ein `count`
     über Häfen, im vorhandenen 10-Minuten-Lauf.
3. **Tageslimit gleitend** (`window.ts`): Fächer je volle Stunde in `TraderState.tradeHours` (`{ h, q }`, höchstens 24).
   Ein Fach zählt bis 24 h nach Beginn seiner Stunde (frei nach 23–24 h, Anzeige „frei ab HH:00“) – so bleibt der
   Zustand klein und die Freigabezeit ist eine glatte Uhrzeit. **Alte Zustände** (`dailyDayIndex`/`dailyVolume`): der
   Zähler des laufenden Spieltags gilt als ein Fach zur Stunde der letzten Mitternacht (Spielzeit) und wird damit genau
   wie bisher um Mitternacht frei; ein älterer Tag zählt nicht. Beim nächsten Handel wird nur noch `tradeHours`
   geschrieben. `market.get` liefert zusätzlich `dailyReleases` (wann wie viel frei wird); die Order zeigt „… wieder frei
   ab HH:MM“ und für zu große Mengen, ab wann sie passen (`freeAtMs`). **KI-Spieler** lesen den Rest weiter aus
   `dailyLimit − dailyUsed` der Börsenansicht und handeln damit automatisch im gleitenden Fenster.
4. **Saisonchart:** eigene Tabelle `market_price_hour (resource, hour_ms, price, ref)`, Schlüssel (resource, hour_ms).
   Der 10-Minuten-Lauf schreibt je abgeschlossene Stunde einmal den Kurs zum Stundenende (letzter Handel davor mit
   Rückkehr zum aktuellen effektiven Richtwert) und den effektiven Richtwert; fehlende Stunden bis 24 h rückwirkend
   (der Marktverlauf reicht 24 h), nie vor dem Start des Marktes. Saisonende: Tabelle geleert (`clearMarketNews`), Kurse
   wie bisher auf Grundrichtwert. `market.chart` (je Ressource ≤ ~1.000 Punkte) ist eine eigene Abfrage, damit das
   30-s-Nachladen von `market.get` klein bleibt. Anzeige: Zeitraum 1 h / 24 h (aus den Handeln, mit Kursband) und
   7 Tage / Saison (Stundenkurse) mit Grundrichtwert (gestrichelt) und effektivem Richtwert (gepunktet, Treppe).
5. **Knappheit je Spieltag:** der Code nutzte schon `gameDayIndex` (Spielzeitzone); nur Kommentar und REGELN.md sagten
   noch „UTC-Tag“ – korrigiert, Servertest prüft den gespeicherten Tag.
6. **„neu ab“ in der Order** (UTC-Mitternacht) entfällt; ersetzt durch die gleitende Freigabe.

## Berichte im Kampfsimulator und Berichtsansicht wie die E-Mail

1. **Kampfbedingungen im Bericht:** `resolveBattle` legt `battle.setup` ab (game-core `battle-setup.ts`): je Seite
   Versorgungsmangel, kampfwirksame Modifikatoren (attack, attackVs, attackUnit, hp, cargo, loot, nestLoot,
   mineDamage; neutrale Werte weggelassen), Kartell-Regeln (troopSpaceBonus, unlimitedCargo), Schwachziel,
   Wiederholungsabschlag, Bunkerschutz, feste Nestbeute. **Bestände des Ziels werden nicht gespeichert** (nur
   `shareLoot`), damit der Bericht nicht den ganzen Hafenbestand des Gegners offenlegt. Rückwärtskompatibel: optionales Feld.
2. **Geheimhaltung:** Ist der Gegner des Lesers ein Spieler, entfernt `report.get` dessen Modifikatoren
   (`modifiersHidden`); der Simulator rechnet ihn neutral und sagt das („Forschung und Admiral des Gegners unbekannt –
   mit 0 gerechnet“). Kartell, Nester und Weltereignisse sind kein Geheimnis. Gilt auch für alte Berichte.
3. **Vorbelegung** (`reportSimPreset`, game-core): Verbände = `before` beider Seiten (Verteidiger getrennt in
   Einheiten/Anlagen), Wetter = `battle.weather`, Kriegsglück des echten Kampfs = Mittel der Würfelfaktoren je Seite
   (nur zur Anzeige; der Simulator rechnet wie üblich 50× mit festen Seeds). Beute: feste Nestbeute aus `setup`, sonst
   die tatsächliche Beute als feste Beute (mit Hinweis). **Alte Berichte:** Angreifer-Eingaben aus `data.attacker`
   (lag dort schon bei Überfall/Nest/Kartell/Welt/Blockade …), Verteidiger neutral, Bunkerschutz aus
   `data.protectedPerResource`; jeweils mit Hinweis. Option „Mit meinen heutigen Werten rechnen“ ersetzt die eigene
   Seite durch die aktuellen Modifikatoren/Versorgung des aktiven Hafens.
4. **Aufklärungsberichte** (Nest mit Besatzung, Hafen-Lagebild): derselbe Knopf rechnet den eigenen Bestand daheim
   gegen das Ziel (Forschung des Ziels unbekannt). Dazu „Angreifen planen“, Entfernung und Probekampf; „Wiederholen“
   bleibt Nebenaktion. Sichtungen und Spionage: kein Simulator.
5. **E-Mail:** Kampfberichte (alle Arten mit `battle`, außer Spionage) erhalten unter dem Knopf den Link
   „Im Kampfsimulator öffnen“ → `/?tab=berichte&bericht=ID&sim=1`; die App öffnet nach Anmeldung den Bericht und gleich
   das Simulator-Blatt. Rechte: `report.get` (nur eigene bzw. Allianz-geteilte Berichte). Push öffnet weiter nur den Bericht.
6. **Berichtsansicht = E-Mail-Aufbau:** `report.get` liefert zusätzlich die Bausteine der ausführlichen E-Mail
   (`blocks`, `covered`, `simulable`; `reportViewFor`), die App zeichnet sie im eigenen Stil (Banner, Kacheln, Tabellen
   mit Symbolen, Kennzahlen). Tabellenzellen tragen dafür optional `icon` (Einheit/Anlage/Ressource); die E-Mail
   nutzt weiter Textsymbole. Der Phasenverlauf (Würfel, Schaden) bleibt als „Gefechtsverlauf“, die bisherigen
   Spezialansichten stehen unter „Alle Einzelheiten“; Lagebild-Berichte (Posten, Patrouille, Sichtung, Satellit)
   zeigen ihre eigene Ansicht weiter offen. Arten ohne E-Mail-Abschnitt: nur Banner plus bisherige Ansicht.
7. Nicht umgesetzt: Siegchance vor dem Kampf im Bericht (wird nicht gespeichert), Fahrzeit (nur Entfernung).
## Aufklärung auf Sicht und lebendige Nester (Vorlage docs/VORLAGE-NESTER.md, Fragen 1–10 jeweils a)

### Teil 1: Aufklärung auf Sicht
1. **Wendepunkt rein in game-core** (`recon-sight.ts`): exakter Schnittpunkt des Weges (Seeweg-Felderkette bzw. gerade
   Linie, Projektions-km) mit dem Kreis Lagebild-Reichweite um das Ziel; `km` in den Einheiten der Fahrzeit
   (Großkreis-km je Abschnitt wie `pointAlongRoute`), damit `routeAt(…, upToKm)` die Position ohne neue Route liefert.
2. **Einschalter `sightRecon` in `MissionInput`**, gesetzt von `launchMission`, `missionPreview` und `planNaval` (nur
   für Art „aufklaerung“). Patrouille, Posten, Minen, Geleit usw. planen mit Grundart „aufklaerung“ und dürfen nicht
   umkehren – deshalb kein Automatismus über die Art. Balance-Block `intel.sightRecon` (fehlt er: wie bisher).
3. **Kampagne:** Der nächste Abschnitt beginnt am **Feld** des Wendepunkts (Seeweg von dort), nicht am exakten Punkt –
   die Wegsuche arbeitet mit Feldern; die Abweichung (≤ halbe Feldbreite) ist auf der Karte nicht zu sehen.
   Mindestfahrzeit nur für den ersten Abschnitt („beim Auslaufen“).
4. **„Aufklärer gesichtet“** prüft Ausguck und Radar des Zielhafens am Wendepunkt mit `liveLevelAt` und den
   Gegenmitteln aus `fleetMods` (Funkdisziplin, Tarnanstrich); vorher zählte nur „Hafen hat Radar“.

### Teil 2: Lebendige Nester
5. **Wurf bei der Eroberung ziehen, nicht bei der Wiederbesetzung.** `nestConquered` speichert sofort den Wurf der
   nächsten Besetzung und `loot_at` = Wiederbesetzung; so gibt es keinen Schreibzugriff „lazy beim Abruf“ und keine
   Wettläufe. Der Wurf bleibt geheim: Lagebild-Daten werden für leere Nester nicht geschrieben (`nestLagebild` → null).
   Neue Nester und alte Zeilen ohne Wurf würfelt `ensureNestRolls` (einmalig, beim ersten Kartenabruf bzw. Hafenamt;
   `update … where roll is null`, also ohne Überschreiben); ohne Wurf rechnet alles mit der Mitte (Stand bis v1.30).
6. **Erholung je Einheitenart** mit `round(max(Überlebende, 70 % × Wurf) + 5 % × Wurf × h)`, gedeckelt auf den Wurf.
   Überlebende = `report.defender.final` (inkl. Lazarett/Reparatur). Anlagen: bis 12 h nach dem Kampf die überlebenden,
   danach der volle Wurf. Ein zweiter verlorener Überfall setzt Überlebende und Zeitpunkt neu (keine Summen).
7. **Lagebild unter `intel_sighting.data.lagebild`** mit eigenem `atMs`. Der Upsert der Live-Erkennung behält
   `data.lagebild` per SQL (`case … jsonb_build_object`), damit Ausguck/Radar ein frisches Lagebild nicht löschen.
   „Genau“ prüft der Server (`lagebildExact`: ≤ `staleHours`, gleiche Besetzung `lootAtMs`); `world.map` liefert sonst
   `lagebild: null`. Ohne Kartennebel lädt die Karte das Wissen nur für Nester (Wurf bleibt Lagebild-Sache).
8. **Probekampf über die Spanne:** `nestWinRate` nimmt `defenders` (Lauf i gegen `defenders[i mod n]`, Seed i); Spanne =
   100 Würfe aus `sampleRolls` (fester Seed je Stufe), „ungünstig“ = Faktor 120 % und jede vorhandene Anlage +1,
   „günstig“ = 80 % und −1. Vorschlag ohne Lagebild = `smallestWinningRaid` mit diesen 100 Verteidigern (Mittel ≥ 90 %).
9. **KI:** `botNestDefender` – Lagebild hochgerechnet, sonst ungünstigster Wurf; Probekämpfe je Nest (ohne Lagebild je
   Stufe zusammengefasst), höchstens `botMaxNests` (6) je Zug. Freibeuter und Festung nehmen erkannte Nester ohne
   Lagebild (schwankende Stufen) in ihre Aufklärungsziele, der Händler nicht. Der bots-Test „Angriffssperre“ setzt vor
   Schritt 5 wieder Korvetten (der Freibeuter kann inzwischen ein aufgeklärtes Nest überfallen haben).
10. **„Lohnende Ziele“** (Wunsch des Nutzers): Werte je erkanntem Nest (Besatzung mit Symbolen, Anlagen, Beute, Alter
    des Lagebilds) unter „Details“, Kurzzeile mit Spanne der Siegchance und „Netto etwa …“ = Siegchance × Beutewert
    (Richtpreis, Laderaum des Vorschlags) − erwartete Verluste (Probekampf, Ausbildungskosten zum Richtpreis) −
    Treibstoff hin und zurück (Seeweg). Ohne Lagebild als Bereich (Beute 100 … 130 %). Sortierung: lohnend und
    erreichbar (Vorschlag ≥ 90 %, Netto > 0) zuerst. Aufgeklärte Nester in der Nähe stehen zusätzlich in der Liste.
11. **Zielfenster bestätigt** mit der echten Umsetzung (`sim/nest-living.ts`, auch in `npm run sim`; Bot-Verband,
    erster Prüftag ≥ 70 %): Zufallsnest S1 T1, S2 T3, S3 T7, S4 T14, S5 T21, **S6 T38** (Ziel 35–38; fest T31);
    ungünstigster Wurf S2 T5, S3 T10, S4 T21, S5 T28, S6 T38. Einstieg: Stufe 1 fest, Vorschlag 1 Landungsschiff +
    28 Schützen (Probe 95 %), Auftrags-Verband 100 %.
12. **Pi-Last** (Kartenabruf, 10 Spieler, ~75 Nester, Mac): vorher erster Abruf Ø 6,9 ms / zwischengespeichert Ø 5,0 ms,
    nachher Ø 11,3 ms / Ø 5,6 ms. Der erste Abruf enthält das einmalige Würfeln aller Nester (≈ 75 Updates); danach
    +0,5 ms je Abruf (Nest-Wissen, Hochrechnung). KI-Zug Median 35–43 ms (bots-sim, drei Startzeiten).
13. **Schema** (Migration erzeugt der Integrator): `nest.roll jsonb`, `nest.garrison jsonb`, `nest.garrison_at
    timestamptz`, `nest.loot_at timestamptz`, alle nullable.
## Lieferverträge mit KI und zwischen Spielern (Balance v1.31)

Umsetzung von `docs/VORLAGE-LIEFERVERTRAEGE.md`, Nutzerentscheid: Fragen 1–8 und 10 jeweils Empfehlung a, Frage 9
abweichend: **Verträge zwischen Spielern sofort**, mit Schutz. Regeln: `docs/REGELN.md`, Abschnitt Lieferverträge.

1. **Datenmodell:** eine Tabelle `market_contract`, eine Zeile je Vertrag bzw. Abo-Tranche (`abo_id` = id der ersten
   Tranche). Beide Parteien sind Spielerzeilen (KI-Spieler sind Spieler); `kind` ki|spieler. Beträge in ganzen Cent,
   Treuhand im Journal auf `escrow:mc-<id>` (Anzahlung des Käufers bzw. voller Preis der KI-Käuferin, Pfand des Verkäufers,
   Ware der KI-Verkäuferin). Preis als `buyer_unit`/`seller_unit` (Differenz = Gebührentopf); so rechnen KI- und
   Spielerverträge mit derselben Abwicklung (`settleContract`, rein, Summe in Cent geht auf).
2. **Gebühr:** Kauf bei der KI: Käufer zahlt max(K,E)·(1+a), die KI bekommt das abzüglich 4 % des Bezugskurses. Verkauf
   an die KI: der Spieler bekommt min(K,E)·(1−a), die KI zahlt 4 % des Bezugskurses zusätzlich (sonst wäre der Grundaufschlag
   beim Verkauf kein Abschlag). Spielerverträge: Verkäufer bekommt den Preis minus 4 %.
3. **Anteilige Erfüllung:** Die Anzahlung deckt 25 % je erfüllter Einheit; bezahlbar ist die größte Menge q mit
   Preis(q) ≤ Anzahlung − Strafe(Menge − q) + Konto. Sind beide Seiten säumig (Spielervertrag), zahlt jede ihre Strafe auf
   ihren Fehlteil (auch wenn er sich überschneidet) – beide haben ihre Pflicht verletzt, die Strafen gehen in den Topf.
4. **Konvoi:** Abwicklung (Zahlung, Abbuchung, Abfahrt) zur Fälligkeit minus Fahrzeit, damit der Konvoi zur Fälligkeit
   ankommt. Ist der Seeweg länger als die Laufzeit (ferner Rotbart), fährt er nach einer Minute und kommt später; das
   Angebot nennt die Fahrzeit. Geleit: der Käufer gibt es beim Abschluss an, es läuft bei Abfahrt aus (best effort,
   eigener Savepoint; scheitert es, fährt die Ware ohne Geleit und die Nachricht sagt es).
5. **Erfolge bei Lieferung:** „bei Lieferung“ heißt bei der Abwicklung (Abbuchung beim Verkäufer, Abfahrt des Konvois) –
   dann ist das Geschäft vollzogen; ein abgefangener Konvoi ändert daran nichts (wie beim Spielerhandel).
6. **Abo und Kündigung:** Kündigen beendet das ganze Abo (alle offenen Tranchen), die Strafe steht zusammengezählt am
   Knopf. Offene Verträge zählen Abo als einen; Angebote an Spieler zählen mit (sie binden eine Sicherheit).
7. **Tageslimit:** Vertragslieferungen werden zum Abwicklungszeitpunkt ins Fenster gebucht und vorher als „nächste 24 h“
   vorgemerkt (`TradeContext.reservedQty`, `market.get dailyReserved`; die Order zieht die Vormerkung vom freien Rahmen ab).
   Das 50-%-Fenster prüft jedes 24-h-Fenster, das eine neue Lieferung enthält (`maxWindowLoad`); Abo-Tranchen liegen genau
   24 h auseinander und teilen sich nie ein Fenster. KI-Spieler bekommen keine Vormerkung (sie sind Gegenpartei).
8. **Handelsbilanz:** zählt die Journalzeilen `mc-…` der Menschen (Ware an bzw. von `player:<id>`), KI-Spieler nicht –
   sonst höben sich Kauf beim und Verkauf an den Menschen im selben Vertrag auf. Börse und Verträge je Spieler werden vor
   dem ⅓-Deckel addiert.
9. **R_T:** nur die angekündigte, tageweise steigende Saisonend-Nachricht (bekannt bis zum Saisonende). Eine
   Kartell-Armada-Nachricht gibt es noch nicht als Marktnachricht; kommt sie, gehört sie in `priceInputs.rAt`.
10. **Spielerverträge – Absprache-Schutz (Frage 9b, Entscheidung):** Verträge zwischen **verbundenen** Spielern sind
    **erlaubt**, zählen aber nicht für Erfolge und Tagesbefehle (`counts = false`, Hinweis beim Annehmen). Gründe: Mitglieder
    einer Allianz sind immer verbunden – eine Sperre verböte gerade die natürlichste Nutzung (Verbündete beliefern sich);
    Werte verschieben geht auch heute schon mit Allianz-Angeboten im Spielerhandel. Der eigentliche Missbrauch (Rohstoffe
    schieben, Kopfgeld umgehen) ist anders begrenzt: Preisband ±20 % (höchstens 20 % des Werts als Geschenk), Paarbremse
    20.000 Kredite Börsenwert je Paar und 7 Tage (also ≤ 4.000 Kredite Wertverschiebung je Woche), 4 % und alle Strafen in
    den Gebührentopf, Lieferung abfangbar; Rohstoffe und Kredite geben keine Wertungspunkte. Jede Lieferung eines
    Spielervertrags trägt das Paar in `pvp_ties` ein (7 Tage verbunden: kein Kopfgeld untereinander) – genau wie die
    Vorlage für 9b verlangt; `pvp.ts` musste dafür nicht geändert werden.
11. **Ohne KI-Spieler** zeigt der Reiter, dass es keine KI-Verträge gibt; abgeschaltete oder gerade entfernte KI bieten
    nichts an. Angebote an einen bestimmten Spieler dürfen nicht an KI-Spieler gehen (`bad_target`).
12. **Saisonende:** außerplanmäßig noch offene Verträge: Treuhand gegen `season:<n>` ausgebucht (wie offene Angebote im
    Spielerhandel); Kredite und Häfen werden ohnehin zurückgesetzt, eine echte Rückbuchung wäre wirkungslos.
13. **Pi-Last:** keine periodischen Läufe; je Vertrag höchstens drei Ereignisse (Erinnerung, Abwicklung, Nachfrist). Die
    KI-Kontingente rechnet erst der Abruf des Reiters (je KI ein Lagerabgleich), die Handelsbilanz-Abfrage bekommt einen
    zweiten Zweig über denselben Zeitindex.
14. **KI-Spieler im Wirtschaftszug** (`bots-econ.ts`): sehen Treuhandware und -kredite nicht mehr im Lager bzw. Konto und
    planen damit automatisch ohne sie; der freie Börsenrahmen berücksichtigt `dailyReserved` (für KI 0). Sie bedienen
    KI-Verträge ohne eigenen Zug (Abwicklung als Ereignis). **Nutzen:** der Händler nimmt im Zug (`bots-contracts.ts`,
    aus `offersTurn`) höchstens ein öffentliches Vertragsangebot eines Spielers an, wenn es ihm mindestens 3 % gegenüber dem
    Kurs bringt und sein Lager es trägt (liefern ab 40 % Füllung und doppeltem Bestand, kaufen bis 60 %) – wie faire Angebote
    im Spielerhandel. Das ist ein Spielervertrag (Band, Konvoi, Strafen in den Topf); KI-Spieler bieten selbst keine an und
    schließen keine Verträge untereinander (Vorlage, Abgrenzung).

## Konvois: Börse und Verträge auf See, Konvoi-Blatt, fremde Konvois im Lagebild

Nutzerentscheid (6 Punkte). Regeln: `docs/REGELN-SEE.md` (Abschnitt Konvois), `docs/REGELN.md` (Börse, Lieferverträge).

1. **Fehler Kartenposition:** Konvois fuhren auf dem Server schon über die Route (Seewege), die Karte zeichnete eine
   Gerade und bewegte das Schiff linear. Neu: `convoyPosition` in `game-core/route-position.ts` (Anteil der Fahrzeit auf
   der Route, Abschnitte in Großkreis-km wie `pointAlongRoute`) für Server (`naval-convoy-view.ts`) und Karte
   (`apps/web/src/lib/convoy.ts`, `map/naval.ts`: Linienzug über die Wegpunkte, Schiff alle 2 s neu gesetzt). Der
   Abfangpunkt rechnet wie bisher `interceptPoint` über die Route (`buildRoute` aus denselben Wegpunkten); ein Test zeigt,
   dass beide Rechnungen auf dasselbe Feld (±1) kommen.
2. **Börsenkäufe** fahren als Konvoi `boerse` vom nächsten Handelshafen (`nearestTradePortBySea` liefert jetzt auch das
   Feld) zum Käuferhafen, Absender `null` (Anzeige „Handelshafen …“). Ankunft unverändert aus `executeTrade`. Geleit
   optional in der Order (`market.trade.escort`, `attachTradeEscort` wie im Spielerhandel); scheitert das Geleit, wird
   der ganze Kauf abgelehnt (nichts halb). **Lieferverträge** fahren als Konvoi `vertrag`; Albers (Händler) und
   Falkenberg (Festung) bekommen `convoy: true` (Abfahrt zur Fälligkeit minus Fahrzeit wie bei Rotbart). Für Verkäufe an
   die KI fährt die Ware des Spielers ebenso als Konvoi zum KI-Hafen (Verlust trägt dann die KI, bezahlt ist bei
   Abwicklung). Alte Lieferungen ohne Konvoi und alte Verträge mit `delivery = abstrakt` bleiben, wie sie sind.
   **Minen:** Börsenkonvois bleiben ausgenommen (fremde Felder vor dem eigenen Hafen sollen die Börse nicht entwerten);
   Vertragskonvois zählen wie Handelskonvois (Rotbart/Spielerverträge taten das schon).
3. **Balance (Integrator hebt die Version):** `convoys.marketChanceFactor` 0,5, `marketMaxChance` 0,08 für `boerse` und
   `vertrag`. Rechnung (erwarteter Verlust ohne Geleit = Chance × `lossShareUnescorted` 0,3):
   - typischer Kauf 400 km, Warenwert 5.000: (0,02 + 0,04 + 0,02) × 0,5 = 4 % → **1,2 %**;
   - Kauf 1.000 km, 10.000: (0,02 + 0,10 + 0,04) × 0,5 = 8 % → **2,4 %** (Obergrenze);
   - jeder Kauf höchstens 8 % × 30 % = **2,4 %**, mit unterlegenem Geleit 8 % × 25 % = 2 %; unter 150 km nie.
   Zum Vergleich: Börsengebühr 4 %, Handelskonvois bis 12 % × 30 % = 3,6 %. Ziel „≤ 3–5 %“ ist eingehalten, Börsenkäufe
   bleiben lohnend; für große Käufe lohnt Geleit. Kartellverband nach Warenwert wie bisher. Die Order zeigt Chance und
   erwarteten Verlust des konkreten Kaufs (`cartelExpectedLoss`).
4. **Abfangen** bleibt Kriegsgegnern und dem Kartell vorbehalten (`convoy_not_enemy` unverändert, Test).
5. **Konvoi-Blatt:** Antippen eines Felds mit Konvoi (≤ 70 km von der aktuellen Position) zeigt Art, Absender →
   Empfänger (Hafen), Ladung, Geleit, Ankunft, Route (Seeweg km, Wegpunkte) bzw. Kurs. Für Kriegsgegner „Abfangen“ mit
   Abfangpunkt und Ankunft aus `mission.preview` (previewIntercept, alle Schiffe daheim) und Weiter zur Missionsplanung
   (launchIntercept). Einen Probekampf gegen ein Konvoi-Geleit gibt es (noch) nicht – der Kampfsimulator gehört
   dev-simulator; das Blatt nennt stattdessen, ob gekämpft wird (Geleit) oder kampflos geplündert.
6. **Lagebild:** Mit Kartennebel erscheinen fremde Konvois (auch neutrale und verbündete) nur in Sensorreichweite der
   Partei (`liveAt(..., "fleet")`, Allianz teilt Sicht): Sichtung = Position, Kurs, Größenklasse der Ladung
   (`cargoSizeClass` nach Warenwert, 2.000/10.000); Erkennung dazu Art, Absender, Empfänger, Geleit ja/nein. Genaue
   Ladung und Geleit nur mit Lagebild des Zielhafens (Wissen `base` mit Stufe `lagebild`, nicht veraltet) – das gilt mit
   Nebel auch für Kriegsgegner (Route und Zeiten sehen sie weiter, damit Abfangen planbar bleibt). Fremde ohne Krieg:
   keine Route, kein Ziel, keine Zeiten. Ohne Nebel wie bisher (eigene und feindliche mit Ladung). Konvoi-Sichtungen
   werden nicht als Wissen gespeichert (sie sind nur live).
7. **KI-Spieler** kaufen weiter über `trade` (ohne Geleit); ihre Börsenkonvois sind ebenso überfallbar. Keine eigene
   Geleit-Logik – der erwartete Verlust (≤ 2,4 %) ist kleiner als die Gebühr.
8. **Schema:** keine Änderung (Spalte `convoy.kind` ist Text; neue Werte `boerse`, `vertrag`).
