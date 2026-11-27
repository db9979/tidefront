# game-core – Entscheidungen, Teil 6

Fortsetzung von `ENTSCHEIDUNGEN-5.md`. Verbindlich bleibt `docs/REGELN.md`. Neue Abschnitte bitte hier anhängen.

## Kampfsimulator: Korrekturen aus der Prüfung und „Was fehlt zum Sieg?“ (sim)

1. **Siegregel je Kampfart (F1):** `settleBattle(report, balance, rule)` und `victoryRuleOf(kind, data)` in
   `battle-victory.ts`. „vernichtung“ (Weltereignis inkl. Finale und Sammelangriff auf Ereignisse, Feld, Konvoi,
   Blockadekampf) = `strandTroops`, sonst „landung“ (Sieger aus `resolveBattle`). Der Server ruft an allen sieben Stellen
   `settleBattle(res.report, balance, victoryRuleOf("<art>"))` statt `strandTroops` direkt; der Simulator nimmt die Regel aus
   dem Bericht (`ReportSimPreset.rule`). `bots-fields.ts` (KI-Planung) bleibt bei `strandTroops` – gleiche Wirkung.
2. **Beute dieser Kampfarten (`LootRule`):** Großflotte/Belagerung „je LP“ aus dem Bericht (tatsächliche Beute / vernichtete
   LP, im Simulator durch den Laderaum begrenzt; der Beutepool selbst steht nicht im Bericht – Hinweis), Finale aus der
   Balance (`finaleLoot`, ohne Schatz), Schatzschiff nur bei Vernichtung (sonst unbekannt), Konvoi (Spieler) aus der Ladung
   (`convoyPlunder`), Feld/Blockade/Konvoi-Abwehr keine.
3. **Sicht der eigenen Seite (F2):** `simulateBattle(…, { mine })` liefert Siegchance, Verluste („eigene“/„des Gegners“),
   Restkampfkraft (Histogramm) und Phasen aus Sicht von `mine`; FreeSim: Bericht → Seite des Lesers, Modus Kartell →
   Verteidiger („Abwehrchance“).
4. **Beute aus Berichten (F3/F4):** `DefenderInput.fixedLootFinal` – tatsächliche Beute als feste Beute wird nicht erneut
   mit `nestLoot` multipliziert (und bei Spielerhäfen nie). Verlorener Angriff ohne gespeicherte Bestände: Beuteregel
   „unbekannt“ (Anzeige „unbekannt“, Hinweis „Bestände … – Beute unbekannt“) statt 0. Abwehr (Leser verteidigt) ohne Beute:
   kein Hinweis; die Oberfläche setzt die heutigen eigenen Bestände ein (`ownStockNeeded`).
5. **Boni beidseitig geheim (F5, Nutzerentscheid):** `hideOpponentSetup` entfernt bei Spieler-Gegnern neben
   `battle.setup.<gegner>.modifiers` auch `data.attacker.modifiers`, wenn der Angreifer der Gegner ist (Altberichte und
   Blockadekampf). Eigene Werte bleiben. **Nicht** entfernt: die Zeilen „Einfluss“ des gegnerischen Admirals im
   Admiral-Abschnitt (`data.admirals.<seite>.lines`) – das ist ein bestehender, getesteter Teil des Berichts; ob er auch
   geheim sein soll, ist offen. Altbericht-Hinweis „Modifikatoren des Angreifers nicht gespeichert“ entfällt beim Kartell
   (nur Kartell-Einheiten, U4).
6. **Wetter im Probekampf (U1):** `combatWeatherOf(wind, clouds)` und `forecastCombatWeather` (Mitte der Vorhersage-Spanne).
   Missionsplanung: aus `preview.weather.atTarget.forecast`; „Lohnende Ziele“: Vorhersage am Nest zur Ankunft (Fahrzeit des
   Bestands, Unsicherheitsfaktor 1). Die „Einschätzung“ nennt ihr Urteil jetzt aus derselben Rechnung wie der Probekampf
   (gleiche Seeds, Wetter, Admiral), die Feuerkraft-Balken bleiben als Erklärung.
7. **Plansuche (U2):** `smallestWinningRaid` prüft den Vorschlag gegen 200 andere Seeds (ab 10000); hält er nicht, wächst er
   zwischen Vorschlag und Bestand (Halbierung über den Anteil). Die gemeldete Siegquote ist die geprüfte. Rechnung im Web
   Worker (`sim.worker.ts`, je Aufgabe ein Worker, Abbruch beendet ihn); ohne Worker nach einem Takt im Haupt-Thread.
8. **Phasen und Hinweise (D1):** je Phase „fand statt / vorn (mehr LP des Gegners vernichtet als eigene verloren) /
   entschied die Niederlage“; Landung und Bodenkampf getrennt. „Nicht berücksichtigt“ nur, wenn zutreffend
   (`simNotConsidered`: Wiederholungsabschlag und Schwachziel nur bei Beute aus dem Bestand, Wetter nur ohne Wetter).
   „Wracks“ entfällt (beeinflusst weder Sieg noch Beute).
9. **Freier Simulator (U3):** „Eigener Hafen“ mit Hafenmodifikatoren × Hafenkommandant (Admiral `here && stationed &&
   bereit`, Verteidigungszeilen), stationierte Verbündete zuschaltbar. Kartell mit den Modifikatoren des Hafens (wie der
   Server, ohne Admiral) und Regler „Kartellstärke“ über die Schwankung (1 ± raidStrengthSpread). Der Verwaltungsregler
   „Kartell-Stärke“ ist dem Spieler nicht bekannt und bleibt außen vor.
10. **„Was fehlt zum Sieg?“ (`win-search.ts`):** gierig aufbauen (Paket je Art ≈ 15 % des Verbandswerts, Bodentruppen samt
    Landungsschiffen, Wertung Sieg = 1 sonst ½ Anteil vernichteter LP, nahe am Ziel mit allen 100 Such-Seeds; ohne Zugewinn
    größere Pakete), dann verkleinern (erst neue Einheiten, teure zuerst, dann eigene, dann Landungsschiffe), Hürde der
    Suche Ziel + 30 % des Rests (90 → 93 %), Prüfung gegen 300 Seeds ab 20000, hält es nicht: mit eigenen Seeds (30000)
    nachlegen. Kosten = Richtpreis der neuen Einheiten (Bestand kostet nichts), Gleichstand nach Gesamtwert.
    Ausbildungszeit: je Baugebäude nacheinander, Gebäude parallel (laufende Aufträge und Strom nicht eingerechnet).
    Grenzen: Kommandopunkte je Mission, Truppenplatz, ausbildbare Arten (Baugebäude + Stufe), freie Stellplätze für neue
    Flugzeuge. Nicht erreichbar (Kommandopunkte, keine Art, kein Fortschritt) wird ehrlich gemeldet. Messung (Node):
    Nest 1–4, Ziel 0,7–0,99: 40–400 ms, 2.000–14.000 Kämpfe; gegen naives Hochskalieren des Bestands 4–8-mal günstiger.
    „Ausbilden“: `train-request.ts` legt die Mengen 2 min bereit, `TrainRow` übernimmt sie, Sprung über
    `useNav().go({ to: "troops", seg: "ausbilden" })`.

## Währung „Taler“, 0-Taler-Hinweis, gegnerischer Admiral im Bericht (tal)

1. **Name (Nutzerentscheid):** Die Währung heißt für Spieler „Taler“, Kurzform „T“ (statt „Kredite“/„Kr“ – klang nach
   geliehenem Geld). Taler ist Singular = Plural („1 Taler“, „2.000 Taler“, „Taler fehlen“), Dativ „in Talern“.
   „Kreditlimit“ heißt „Kasse“ („Kasse voll: höchstens 45.000 Taler bei Hafenkommandantur 9“), „Kreditkonto“ im
   Börsenkopf „Konto“. Interne Bezeichner (`credits`, `creditLimit`, Spalten, API-Felder, Icon-Id `credits`) bleiben,
   keine Datenmigration; das Icon ist jetzt eine Talermünze (Rändelung, „T“). Umgestellt: Web, Engine (Mails, Push,
   Nachrichten, Erfolge/Wochenziele/Tagesbefehle, Fehlertexte), Balance-Texte (nur `kaufmann`, keine Zahlen, Version
   unverändert), docs/REGELN*.md, Kommentare/Testnamen mit. Historische Einträge (CHANGELOG, ENTSCHEIDUNGEN-1…4,
   VORLAGE-*, BAUAUFTRAG) bleiben.
2. **Sprachprüfung (`test/taler-wording.test.ts`):** sucht „Kredit…“ und „Kr“ (als eigenes Wort) in apps/web, apps/api,
   apps/worker, packages/engine (Quelltext ohne Kommentare; kleiner Lexer, da TypeScript 7 keine JS-API hat), in allen
   Zeichenketten der balance.json und in docs/REGELN*.md. Bezeichner sind englisch und treffen das Muster nicht.
3. **0 Taler an der Börse:** Sperrgrund „Du hast 0 Taler. Verkaufe zuerst Rohstoffe – z. B. Proviant (Überschuss).“
   (`lib/remedies/surplus.ts`). Überschuss = größter Bestand (alle Rohstoffe teilen die Lagergröße, also höchste
   Lagerfüllung), die gerade gewünschte Ware nur, wenn sonst nichts da ist; Menge = was über halb vollem Lager liegt,
   sonst ein Viertel, ab 100 auf Zehner abgerundet, in der Order auf „Max“ der Verkaufsseite begrenzt. „Was hilft?“
   (Code `funds`, auch `admiral_funds`) bietet „N Proviant verkaufen“ an: `NavTarget market` mit `side`/`qty`, App
   baut die Börse neu auf und belegt die Order vor.
4. **Sprungziele auf den aktuellen Bildschirm ausblenden:** `NavApi.here(t)` (App.tsx) – Börse (gleicher Unterreiter,
   ohne Vorwahl), Gebäudeblatt, Basis, Truppen-Unterreiter, Karte, Meldungen-Unterreiter, Forschung. `RemedyPanel`
   filtert solche Knöpfe allgemein (z. B. kein „Zur Börse“ auf der Börse).
5. **Gegnerischer Admiral im Spielerkampf:** `report.get` (und damit die Bericht-Mail) liefert vom Admiral eines
   Spieler-Gegners nur `{ name, rankName, hidden: true }` – keine Spezialisierung, kein Einfluss, keine Erfahrung, kein
   Wurf (`hideOpponentAdmiral` in report-sim-view.ts, passend zu „Boni geheim“). Eigener Admiral vollständig;
   Kartell/Nester (kein Spieler-Gegner) unverändert. Web zeigt „Rang Name (Einfluss geheim)“.

## Lagezentrum (Meldungen → Lage) und feste Lieferzeit der Börse (lag)

- **Lagezentrum, Server statt Client-Zusammenbau.** Erster Reiter „Lage“ in Meldungen (Startseite; `?bericht=` öffnet
  weiter die Berichte). Gewählt: eine schlanke Abfrage `lage.get` (engine `lage.ts`, `lage-wait.ts`, `lage-types.ts`),
  weil der Client sonst `base.get` für jeden Hafen bräuchte (je Abruf Settle, Modifikatoren, Gebäude-/Einheitenlisten,
  Lagebild, Stationierte …) – das Lagezentrum soll aber alle Häfen zeigen. `lage.get` liest nur gespeicherte Zeilen:
  Häfen (Bau-, Ausbildungs-, Forschungsschlange, Nachtschild, Satelliten), eigene Missionen, eigene Konvois (Empfänger
  oder Absender, Transporte nur als Verband), Lieferungen ohne Konvoi, laufende Verträge, offene Weltereignisse,
  Saisonende, Zählungen abholbarer Erfolge/Wochenziele, eigene Aufklärungs-/Erkundungsberichte der letzten
  `intel.staleHours`. Teuer ist nur `modsOf` je Hafen (Radar-Vorwarnzeit, Lager). Kein `processDue`, keine Karte.
  Gemessen (Mac, Test mit 2 Häfen, 13 Zeilen): ~12 ms; auf dem Pi grob ×5–10. Tagesbefehle, Auftragsbuch, ungelesene
  Nachrichten und die letzten 5 Berichte („Zuletzt passiert“) nimmt der Client aus ohnehin geladenen Abfragen.
- **Gruppen:** „Gleich / heute“ (Termine ≤ 24 h, erkannte Angriffe rot ganz oben mit Erkennungszeit und Vorwarnzeit),
  „Unterwegs“ (Verbände, Konvois mit Fortschrittsbalken), „Wartet auf dich“ (Belohnungen, leere Bauschlange, freie
  Ausbildungsplätze Werft/Kaserne/Flugfeld, freie Missionsplätze, Lager ≥ 90 %, Versorgungsmangel,
  Aufholhilfe-Gutschrift, Lagebilder fremder Häfen mit ≥ 3.000 plünderbarem Warenwert, die in ≤ 6 h veralten),
  „Zuletzt passiert“. Jede Zeile trägt ein Sprungziel (Karte mit Mission/Konvoi/Ereignis, Gebäudeblatt, Basis,
  Truppen-Reiter, Forschung, Börse → Verträge, Bericht, Erfolge); vor dem Sprung wird der betroffene Hafen aktiv.
  Live über `lib/live.ts` (lage.* mit base/missions/reports/market/season), Countdown je Sekunde.
- **Zahl am Navigationszeichen „Meldungen“** (links, Messing; rot pulsierend bei Angriff): nur Dringendes –
  erkannte Angriffe + Nachfristen + Häfen mit leerer Bauschlange + abholbare Belohnungen (Erfolge, Wochenziele vom
  Server; Tagesbefehle, Auftragsbuch vom Client). Eigene Kurzabfrage `lage.badge` (nur Häfen, Modifikatoren, Angriffe,
  Verträge, zwei Zählungen), damit nicht bei jeder Meldung die ganze Lage gerechnet wird. Ungelesene Berichte/Nachrichten
  bleiben die rote Zahl rechts. Die Konvoi-Zeile der Basis-Versorgung bleibt unverändert.
- **Feste Lieferzeit der Börse (Nutzerentscheid, Fairness):** `market.deliveryHours: 4` – jeder Börsenkauf kommt nach
  genau 4 h an (game-core `market/delivery.ts`: `deliveryTravelMs`, `deliveryRiskKm`); auch am Hafen eines
  Handelshafens. Der Konvoi fährt den Seeweg in dieser Zeit (Position = Anteil der Fahrzeit, also passend schneller oder
  langsamer). Kartellrisiko mit fester Strecke `deliveryHours × convoySpeedKmh` = 180 km statt Entfernung (über
  `cartelMinDistanceKm`): erwarteter Verlust ohne Geleit 0,7 % (Warenwert 2.000) / 0,9 % (5.000) / 1,2 % (10.000) /
  1,8 % (20.000), Obergrenze 8 % × 30 % = 2,4 % erst ab ~30.500 Warenwert (wie bisher die Obergrenze). Lieferverträge
  (auch Albers/Falkenberg) unverändert, laufende Lieferungen unverändert (gespeicherte Ankunft). Ohne `deliveryHours`
  gilt die alte Regel. Balance-Version nicht gehoben (Integrator).
## Zeiten und Bestände live (liv)

Nutzerwunsch: Alle angezeigten Zeiten und Bestände passen sich laufend an, nicht erst nach erneutem Öffnen (Beispiel
Gebäudeblatt Stahlwerk: „Fehlt: 194 Stahl · ca. 55:59 min“ und „Stahl 341 / 535“ blieben stehen).

1. **Eine gemeinsame Uhr (`lib/time.ts`):** `useNow(stepMs)` liest einen einzigen Zeitgeber (`useSyncExternalStore`)
   statt `setInterval` je Komponente/Zeile. Er tickt auf volle Sekunden, nur solange jemand zuhört, ruht in
   versteckten Tabs (`visibilitychange`, beim Zurückkehren sofort ein Tick) und meldet eine neue Serverzeit
   (`noteServerTime`) sofort. `stepMs` rundet ab – die Komponente zeichnet nur neu, wenn sich der gerundete Wert ändert
   (Listen mit langen Fristen 30–60 s). `useCountdownNow(...ziele)`: sekündlich, solange ein Ziel ≤ 1 h entfernt ist,
   sonst minütlich. App.tsx tickt nicht mehr selbst (früher zeichnete die ganze App jede Sekunde neu); die Kopfleiste
   holt sich die Uhr selbst.
2. **Hochrechnung (`lib/live-base.ts`):** `liveBaseAt(base, now)`/`useLiveBase(base)` liefern die Hafenansicht mit
   Beständen aus Stand der Abfrage (`serverNow` der base.get-Antwort, per Objektidentität aus dem Query-Cache) plus
   Förderung je Stunde bis zur Lagergrenze, Verbrauch nie unter 0 (`live.res.ts`, unverändert). Taler werden nicht
   hochgerechnet (keine Rate). `liveStoredAt`: Stromspeicher mit `grid.now.charge` je Stunde, zwischen 0 und Kapazität,
   nur bis zur nächsten vollen Stunde (danach gilt die Kurve; der 30-s-Abruf liefert sie).
3. **„Was hilft?“ live:** `useRemedy` rechnet jede Sekunde mit dem hochgerechneten Hafen und `now` der Uhr –
   Fehlmenge, „Bestand / Bedarf“, „in ca. …“ und Kurzfassung sinken laufend. Das Gebäudeblatt prüft den Ausbau schon
   mit hochgerechneten Beständen: reicht es, verschwindet der Blocker und „Ausbau auf N“ wird aktiv, ohne Neuladen.
   Hinweise mit Fristen nennen die Restzeit („fertig in 12 min, 18:40 Uhr“, „nächste Rückkehr in 5 min“) und nutzen
   `now` statt `Date.now()`.
4. **Nachladen bei fälligen Zeitpunkten (`lib/due.ts`, `due-times.ts`):** Bau/Ausbildung/Forschung fertig, Mission
   angekommen/zurück, Angriff trifft ein, Lieferung da, Nachtschild an/aus → 1,5 s und 8 s danach base.get und
   Berichte neu holen (ein Zeitgeber für den nächsten Zeitpunkt; vergangene Zeitpunkte lösen nie erneut aus). Kommt
   vorher eine Live-Meldung, ist der Abruf ohnehin schon frisch.
5. **Einheitliche Formate:** `fmtDuration` (Restzeit, aufgerundet): „45 s“ (unter 1 min), „56 min“, „1 h 05 min“,
   „2 h“, „2 T 3 h“ – nie mehr „55:59 min“. `fmtAgo` (abgerundet): „gerade eben“, „vor 12 min“, „vor 2 h“, „vor 3 T“.
   `fmtAt`: „18:00“, „morgen 06:00“, „gestern 21:15“, sonst „27.11. 18:00“; `fmtTime` = dasselbe mit „Uhr“ (alle
   Aufrufer, doppelte „Uhr“ entfernt; „Lagebild vom …“ → „Lagebild mit Stand …“); `fmtRange` „23:00–morgen 06:00 Uhr“.
   Serverzeit → Geräteuhr nur bei Versatz > 2 s (sonst würde 18:00:00 durch Millisekunden Laufzeit zu 17:59).
   Eigene Formatierer ersetzt: Kartenschilder (Weltereignisse, Blockade: `hours()`), Satelliten-Überflug auf der
   Karte, Börse `when()`, Saisonleiste („noch 5 T 3 h“ statt „noch 5 Tage“), Lagebild-Reiter `ago`, Lagebild-Alter
   `agoText`, Sammelangriff-Fristen, Strom-Warnung („ab morgen 06:00 Uhr (in 9 h 12 min)“). Bewusst nicht:
   Verwaltungsseiten (Admin), Regeltexte mit festen Dauern („alle 4 h“, „24 Stunden gesperrt“).

**Bestandsaufnahme (vorher → nachher):**

| Anzeige | vorher | nachher |
|---|---|---|
| Kopfleiste Bestände, Füllbalken, Ressourcenblatt „Voll/Leer in …“ | live (App-Uhr) | live (eigene Uhr der Leiste); Ressourcenblatt-Uhrzeit mit Serverzeit |
| Kopfleiste Strom: Speicher-% | Stand der Abfrage (30 s) | live hochgerechnet (`liveStoredAt`) |
| Versorgung: Speicher x/y, Balken | Stand der Abfrage | live |
| Versorgung: „Vorrat reicht noch N h“ (Proviant) | Stand der Abfrage, ganze h | live, „3 h 20 min“ |
| Gebäudeblatt: Kosten-Rotfärbung, Sperrgrund, Ausbau-Knopf, „ausbaubar“-Raute | live | live |
| Gebäudeblatt/Forschung/Ausbildung „Was hilft?“: Fehlt, Bestand/Bedarf, „in ca.“ | **eingefroren** beim Öffnen | **live** (sekündlich) |
| Ausbildung: Höchstmenge, Kosten-Rotfärbung | Stand der Abfrage | live |
| Missionsplanung: Ladung (Bestand, Höchstmenge) | Stand der Abfrage | live |
| Missions-/Spionage-/Aufklärungsplanung: „Ankunft … · zurück …“ | **eingefroren** (Vorschau einmal) | Vorschau minütlich neu |
| Sammelangriff: „Ankunft frühestens“ | nur bei Eingabe neu | minütlich |
| Börse: Verkaufsbestand der Order, Spielerhandel „hast“, „Was fehlt zum Sieg?“-Kosten | Stand der Abfrage | live |
| Abholen mit Lagerwarnung (Tagesbefehle, Wochenziele, Erfolge, Auftragsbuch) | Stand der Abfrage | live (aktiver Heimathafen) |
| Bauhof „noch …“, „beginnt in …“, Fortschrittsbalken, Forschungszeile | live | live, neues Format |
| Ausbildung „noch …“, Missionen „Ankunft/Zurück in …“, Angriffsbanner, Eingehend, Gäste | live | live, neues Format |
| Abschluss (Bau fertig, Mission angekommen) | Live-Meldung oder 30-s-Abruf | zusätzlich Nachladen 1,5 s/8 s nach dem Zeitpunkt |
| Nachtschild | Zeitraum ohne Restzeit; nach Ende alter Zeitraum bis Abruf | „bis 06:00 Uhr (noch 2 h 10 min)“, „beginnt in …“; Nachladen an Start/Ende |
| Blockadebanner „blockiert bis …“ | ohne Restzeit, blieb nach Ende stehen | „· noch …“, verschwindet bei Ablauf |
| Blockade halten (eigene Mission) | nur bei Neuzeichnen | live |
| Sabotage, Weltereignisse, Satellit „noch …“, Saison, Tagesbefehle/Wochenziele, Verträge (Fälligkeit/Nachfrist), Admirale, Marktnachrichten, Kurszeile, Felder/Geleit, Finale, Diplomatie | live (eigene Uhren, 1–60 s) | live (gemeinsame Uhr), neues Format |
| Kartenschilder mit Restzeit (Schatzschiff, Großflotte, Armada, Belagerung, Blockade) | **eingefroren** bis neue Kartendaten | minütlich neu gebaut |
| Lagebild-Reiter „vor X min“ | Stand der Abfrage (60 s) | minütlich live, `fmtAgo` |
| Lagebild-Alter in Zielen/Feldblatt („Stand: vor 2 h“) | live über Elternuhr | `fmtAgo`, Serverzeit statt Gerätezeit |
| Börse „frei ab“, Handelspause, Kursänderung 24 h, Lieferung „Ankunft …“ | live (Börsenuhr) | live, Uhrzeit über `fmtAt` |
| Aufholhilfe-Gutschrift | Stand der Abfrage (30 s) | unverändert: die Ansicht liefert keinen Zufluss je Stunde |
| Wetter „bei Ankunft (…)“, Stromkurve | Vorhersage je Abruf | unverändert (stündliche Kurve), Uhrzeiten einheitlich |

Tests: `test/zeit-anzeige.test.ts` (Formate, Hochrechnung mit Lagergrenze/0-Grenze, fällige Zeitpunkte),
E2E `24-live-zeit.spec.ts` mit Playwright-Uhr (Abrufe und WebSocket währenddessen angehalten, damit der Server die
vorgespulte Zeit nicht zurückstellt): Gebäudeblatt offen → Bestand steigt, Wartezeit sinkt, Blocker weg, Ausbau
aktiv; Bauhof-Countdown läuft ohne Neuladen.

## Empfohlenes Geleit je Frachtwert (Nutzerentscheid)

- **Regelkern** `escort-advice.ts` / `escort-search.ts` (rein, Browser, Server-Tests, KI-Spieler):
  `expectedCartelGroup(Wert, riskKm, market)` liefert genau den Verband, den der Server würfelt (`cartelConvoyForce`:
  Schnellboote nach Warenwert – nicht zufällig, daher keine Spanne), dazu Chance (`cartelChance`, Börse/Vertrag mit
  `marketChanceFactor`) und erwarteten Verlust ohne Geleit (Chance × `lossShareUnescorted` × Wert). `probeEscort`
  rechnet `resolveBattle` (Kartell greift an, Geleit verteidigt mit den Modifikatoren des Heimathafens) mit
  `settleBattle` + `victoryRuleOf("konvoi")` wie `fightEscort` auf dem Server. **Ohne Wetter**: Ort und Zeit des Überfalls
  (25–75 % der Fahrt) stehen vorab nicht fest.
- **Empfehlung** `recommendEscort`: günstigste Mischung aus den Kriegsschiffen daheim (Schiff mit Seewaffen, nicht
  verdeckt, ohne Truppen-/Laderaum – Landungs- und Kolonieschiffe dürfen mitfahren, werden aber nicht empfohlen), die
  die Gruppe in ≥ 90 % der Probekämpfe abwehrt. Kosten zum Richtpreis: Treibstoff hin und zurück (`fuelCost`) +
  Proviant-Unterhalt für die Stunden, die die Schiffe fehlen (läuft auch daheim – hier bewusst der Fahrt zugerechnet,
  wie gewünscht) + erwartete Schiffsverluste (Chance × mittlerer versenkter Baukostenwert). Suche: je Typ allein
  (Halbierung), je Typpaar (zwei Zeiger), ganzer Bestand verkleinert (teure Typen zuerst); 100 Such-Seeds, danach
  Prüfung mit 200 frischen Seeds (ab 20.000) – hält sie dort nicht, wächst sie um das Schiff, das am meisten hilft.
  Kommandopunkte werden beachtet; Treibstoffmangel wird gemeldet. Reicht der Bestand nicht: `short` mit der
  Siegchance aller Kriegsschiffe daheim und „es fehlen etwa N Zerstörer oder M Korvetten“ (je Typ kleinste Zusatzzahl,
  höchstens 60, die zwei billigsten nach Baukosten).
- **Abwägung**: ersparter Verlust = Verlust ohne Geleit − Chance × (1 − Siegchance) × `lossShareEscortBeaten` × Wert;
  „Lohnt sich“ wenn größer als die Kosten, sonst „Lohnt sich nicht (erwarteter Verlust nur ~N T)“. Kriegsgegner sind
  nicht eingerechnet (Geleit kann trotzdem sinnvoll sein; der Kasten sagt das bei kurzer Strecke).
- **Strecken je Ort:** Börse `deliveryRiskKm` (fest 180 km), Geleitfahrt = Seeweg zum Handelshafen, fehlt bis zur
  Ankunft (4 h). KI-Vertrag: Strecke = Fahrzeit × `convoySpeedKmh` (Seeweg; der Server würfelt mit der Luftlinie –
  die Chance ist eher etwas zu hoch), Schiffe fehlen so lange wie der Konvoi fährt. Spielervertrag und Geleit des
  Anbieters im Spielerhandel: Partner/Käufer unbekannt → Richtstrecke 500 km, im Kasten genannt (die Kartellgruppe
  und damit Empfehlung und Siegchance hängen nur am Warenwert).
- **Oberfläche:** Kasten „Geleitschutz“ (`EscortAdvice.tsx`) in Börsen-Order, Spielerhandel (Anbieter), KI- und
  Spielerverträgen (Kauf); „Empfehlung übernehmen“ setzt die Mengen. Konvoi-Blatt: „Probekampf gegen das Kartell“
  für eigene Konvois (Geleit gegen die Gruppe zur Ladung, 200 Prüf-Seeds).
- **KI-Spieler:** Börsenkäufe ab 10.000 Warenwert (`BOT_ESCORT_MIN_VALUE`) mit der Empfehlung, wenn sie `ok` ist und
  der Treibstoff reicht; scheitert das Geleit beim Kauf, kaufen sie ohne. Kleinere Käufe weiter ohne Geleit.
- Keine Balance-Änderung, keine Schemaänderung.

## Hotfix „Welle 0“ aus der Abschlussprüfung 0.38 (hot)

- **Weltereignis-Flut (ST-01/AN-01, kritisch):** Lag der Nachfolger eines Spawns hinter der Finale-Ankündigung bzw.
  Saisonende − `minSeasonHoursLeft` (auch im Retry-Pfad ohne Ziel), plante der Handler keinen; der Worker-Planer
  (`ensureWorldEventPlanner`, alle 10 min) setzte dann `max(jetzt, Saisonstart + firstSpawnAfterHours)` = sofort.
  Fix: Der Planer ist an den Verlauf gebunden – `earliestNextSpawn` = max(letztes entstandenes gewöhnliches Ereignis
  der Saison + `spawnIntervalHours[0]`, letzter Versuch (erledigtes `world_event_spawn` der Saison) + `retryHours`).
  Damit greifen die bestehenden Grenzen (Ankündigung, Saisonende − 36 h) auch im Planer, und er plant nichts mehr.
  Bewusst **kein** „geparkter“ Merker-Eintrag im game_event: die Kartell-Aufklärung zeigt das nächste ausstehende
  `world_event_spawn` als „nächstes Ereignis“ an und hätte dann einen Scheintermin gemeldet. Erledigte Ereignisse
  bleiben 3 Tage (cleanup), Versuche liegen höchstens `retryHours` auseinander – das reicht als Merker.
  Zusätzlich Deckel `worldEvents.maxConcurrent` = 2 (Balance-Wert, ohne Versionssprung; fehlt er: kein Deckel):
  sind so viele gewöhnliche Ereignisse offen (ohne Finale), behandelt der Handler den Spawn wie „kein Ziel“
  (neuer Versuch nach `retryHours`). Der Deckel sitzt im Handler, nicht in `spawnWorldEvent` (Verwaltung/Tests
  dürfen weiterhin gezielt anlegen). Regressionstest `world-events-season.test.ts`: ganze Saison im 10-min-Takt mit und
  ohne Finale – höchstens ein Ereignis je Tag, Abstand ≥ 48 h, keines nach der Ankündigung bzw. in den letzten 36 h.
  Gegenprobe ohne die Bindung: Test schlägt fehl (2 je Tag schon mit Deckel).
- **market_news (AN-02):** Ursache wie vom Prüfer korrigiert – der Abgleich beendeter Ereignisse (48 h) fügte nach dem
  Ausklingen jede Runde eine sofort tote Zeile ein. `upsertNews` legt keine Zeile mehr an, deren Ende + Abklingen
  schon vorbei ist. Neue Spalte `market_news.effective_until` (= ends_at + fade_minutes, vom Server bei jedem
  Schreiben gesetzt) mit Index `market_news_live`; `liveRows` und `market.news` filtern darüber (Zeilen ohne Wert
  fallen auf den alten Ausdruck zurück). Eine erzeugte Spalte geht nicht (timestamptz + interval ist nicht immutable).
  Wartung (`cleanup` → `pruneMarketNews`): trägt fehlende `effective_until` nach und löscht Zeilen, die seit 48 h
  ausgeklungen und älter als 48 h sind. Spalte nullable, damit die Migration ohne Nachtrag läuft.
- **Spielersperren (TE-01):** alle Sperren auf `player` mit `FOR NO KEY UPDATE` (Handel, Verträge, Spielerhandel,
  Admirale, Wochenziele, Seekabel, Komfort, Einladungen). Geändert wird nur trader/JSON, nie der Schlüssel; FK-Inserts
  (Nachricht, Mission, Zähler) warten nicht mehr. Test `player-locks.test.ts` (lock_timeout 1 s) plus Quelltext-Wächter.
- **Wackelige Server-Tests (TE-02):** Zufallsquelle der Engine injizierbar (`setRandomSeedSource` in store.ts, nur
  Tests); auch der Planer zieht die Art jetzt über `randomSeed`. fields2 „Geleitabteilung“ und luecken
  „Weltereignisse“ setzen einen festen Seed (`TF_TEST_SEED` überschreibt). Probe über 80 Seeds: luecken scheitert bei
  4 von 80 (der Jäger versenkt die kleine Großflotte vor dem Hafenangriff) – echte Würfelabhängigkeit, jetzt fest.
  Schwellen unverändert.
- **U-Boote halten nichts (TST-01, Nutzerentscheid Variante C, Teil A):** neue Siegregel `halten` für Konvoi und Feld
  (`victoryRuleOf`): wie `vernichtung`, aber getauchte Einheiten zählen nicht als haltend – bleiben nur sie übrig, ist
  der Konvoi bzw. das Feld verloren; die U-Boote überleben (im Bericht als Überlebende, Feld: sie kehren heim, auch
  nach einem verlorenen Spielerangriff). Gegen NPC-Verbände sonst unverändert (`vernichtung`, ENTSCHEIDUNGEN-3).
  Weltereignis, Finale und Blockadekampf bleiben `vernichtung`. `escortCapable` schließt getauchte Typen aus (keine
  U-Boot-Empfehlung, KI-Geleit ebenso). Simulator, Probekampf, Bericht-Nachrechnen und KI-Feldplanung nutzen dieselbe
  Regel. Armada-U-Jagd kommt erst nach Simulation. Texte: Handbuch (Kampfablauf, Kartell und Schutz), Seefahrt,
  Felder, REGELN.md, REGELN-SEE.md.
- **Texte:** Handbuch Wertung liest `npcDefenseFactor`, `npcWorldEventKinds` (leer → „zählen voll“) und `armadaFactor`
  aus der Balance; „Kartell und Schutz“ nennt die Schiffsverluste daheim und den Gewichtungsanteil aus
  `pirates.raidHpWeights.see` statt des widersprüchlichen Satzes; KI-Kapitel (Händler überfällt Nester bis Stufe
  `nestMaxLevel`, alle drei nehmen Felder und bieten Verträge, „KI-Spieler“ statt „Bot“); Begrüßung „Menü → Handbuch“;
  REGELN.md Paketschlüssel 50/25/15/10; REGELN-SEE „seit 0.36“. Nest-6-Zahlen (REGELN.md, M-02) bleiben bis zur
  Balance-Entscheidung.
## Navigationsumbau und Welle-1-Oberfläche (nav, nach 0.38.0)

Nutzerentscheid: voller Umbau jetzt (Option B der Abschlussprüfung), nicht nur die kleinen Schritte. Plan mit
Vorher/Nachher: `.claude/review-0.22/NAVI-PLAN.md`.

- **Basis** hat zwei Unterreiter: **Lage** (Startseite der App, „Was steht an?“ – Wartet auf dich mit „Alle
  abholen“, Aufträge, Gleich/heute, Unterwegs, Zuletzt passiert) und **Hafen** (Kopf, Bauhof, Gebäude, Zeitleiste,
  Versorgung, Schutz). Angriffs-, Sabotage-, Weltereignis-, Blockade- und Saisonende-Banner stehen über beiden. Die
  Navigation behält den zuletzt gewählten Unterreiter in der Sitzung; Gebäude-Sprünge („Los“, „Was hilft?“, Lage)
  öffnen den Hafen. `?sub=hafen` in der Adresse hält den Hafen beim Neuladen.
- **Karte**: Knopf **Sichtungen** öffnet als Blatt das frühere Lagebild (Sensoren, Sichtungen, fremde Patrouillen,
  Radarposten, Satelliten); „Karte“ im Blatt zentriert direkt. Der Fachbegriff „Lagebild“ (Wissensstufe) bleibt.
  Wetter-Ebene standardmäßig aus (`tf-wetter` muss „an“ sein), Legende mit „?“-Raute (Nest, Stufe unbekannt).
- **Truppen**: Einsatz · Ausbilden · Abwehr. **Meldungen**: Berichte · Nachrichten · Allianz · Rangliste (vier Reiter,
  kein Scrollpfeil); die Rangliste hat innen Wertung · Bilanz · Erfolge. Meldungen öffnet bei Ungelesenem dort
  (Berichte vor Nachrichten), sonst im zuletzt gewählten Reiter.
- **Eine Zahl je Reiter**: Basis = neue dringende Lage-Einträge inkl. abholbereiter Belohnungen (Messing, bei Angriff
  Siegel pulsierend, ohne Zahl nur die Raute), Meldungen = ungelesene Berichte + Nachrichten. Bedeutung im
  `aria-label` des Knopfs („Basis, 3 Einträge warten in der Lage“). Karte, Truppen, Börse ohne Zahl.
- **Desktop ab 1024 px** (`useDesktop`): Navigationsleiste links, Karte immer sichtbar (bleibt beim Reiterwechsel
  geladen), rechts Seitenleiste (≈ 540 px) mit dem Reiter, Planung, Handbuch oder Forschung. Im Reiter „Karte“ wird
  das Feld-/Missionsblatt zur rechten Seitenleiste; Antippen der Karte aus einem anderen Reiter wechselt zu „Karte“.
  Blätter (`Sheet`) sind am Desktop eine rechte Schublade. Mobil unverändert.
- **Deep-Links**: `?tab=` wie bisher, dazu `&sub=`; Aliase `meldungen`, `allianz`, `nachrichten`, `rangliste`,
  `erfolge`, `lage`, `hafen`, `sichtungen`/`lagebild` (die Server-Benachrichtigungen mit `?tab=allianz` und
  `?tab=meldungen` liefen vorher ins Leere). Erfolgs-Benachrichtigung: `?tab=berichte&sub=erfolge`.
  `NavTarget` neu: `lage`, `sichtungen`; `meldungen.sub` zusätzlich `bilanz`, „lagebild“ führt zu den Sichtungen.
- **Alle abholen** (TST-09): schmale Schnittstelle `claimAll()` (`apps/web/src/lib/claim-all.ts`). Der Endpunkt
  `rewards.claimAll` kommt von Welle 1 (w1); bis dahin `SERVER_CLAIM_ALL = false` → Einzelabholungen nacheinander
  (Auftragsbuch samt Abschluss, Tagesbefehle, Wochenziele, Erfolge), danach **eine** gebündelte Folgeabfrage statt
  acht je Abholung. Knopf ab zwei Belohnungen in „Wartet auf dich“. Integrator: Schalter auf `true`, sobald der
  Server-Endpunkt liegt (kein Probieren per 404, das wäre ein Konsolenfehler).
- **Zielzeilen** (TST-05/UI-13/M-16): „Nester in der Nähe“ statt „Lohnende Ziele“. Stufe unbekannt oder Siegchance
  unter 50 % → „Aufklären“ als Hauptknopf, „Angreifen“ nur als Zweitknopf mit Kennzeichen „zu stark“/„aussichtslos“;
  unter 10 % fragt „Angreifen“ (Liste) und „Auslaufen“ (Planung) nach. Netto nennt den abgezogenen Treibstoff.
- Kleinere Punkte: UI-01 (Ausbilden: Name ≥ 112 px, sonst Stepper in zweiter Zeile), UI-09 (Stromfeld ≥ 58 px,
  Kraftwerk-Symbol statt „KW“), UI-10 (Hafenwechsler 44 px), TST-04 (`avgLuck` nur über nicht entfallene Phasen),
  TST-07 (Weltereignis-/Finale-Banner zentriert die Karte auf das Ereignis und öffnet sein Blatt), TST-11 (Satelliten
  nennen nur fehlende Voraussetzungen, sonst „Startrampe bauen“), TST-13 (Wind in Bericht, Simulator und Mail in Bft),
  TST-16 (Belohnungszeile nennt nur Quellen mit Anzahl), TST-17 („Ruhige See“ bei aktivem Finale clientseitig
  ausgeblendet – die Servertexte ändert der Hotfix an market-news), TST-19 (Finale-Banner ohne Kleinschreibung nach
  Punkt, keine Wirkung „bis +0 %“).
- Server: nur Texte („Truppen → Allianz“ → „Meldungen → Allianz“, „Meldungen → Lagebild“ → „Karte → Sichtungen“,
  „Meldungen → Erfolge“ → „Meldungen → Rangliste → Erfolge“), Wind in Bft in der Kampfbericht-Mail. Keine Schema-,
  keine Balance-Änderung.


## Abschlussprüfung 0.38 – Welle 1: Fehler und Technik

- **TST-02 Geleitstrecken wie gebucht.** Seewege sind richtungsabhängig; das Geleit fährt immer vom eigenen Hafen los
  (`planNaval` → `missionRoute(own → Ziel)`). `engine/trade-routes.ts`: `escortTripKm(own, ziel)`. Börse: Basis-Ansicht
  liefert `market.port.escortKm` (Hafen → Handelshafen); `distanceKm` bleibt die Lieferstrecke. Spielervertrag mit
  bekanntem Partner: je Angebot `route { riskKm (Luftlinie, wie der Server würfelt), escortKm, travelMs }`, ebenso die
  KI-Vorschau (`quote.route`). Partner noch offen (Angebot einstellen, Spielerhandel): `partnerKm` = Median der
  Geleitstrecken zu den Heimathäfen der anderen Spieler (höchstens 40), Rückfall 500 km.
- **TST-08** Schnellknöpfe der Order auf „Max“ gekappt; der Geleit-Kasten rechnet nur für kaufbare Mengen.
- **TST-03** Vertragsgrenze: eigener Code `contract_limit` (statt `daily_limit` der Börse) mit eigenem Text. Vorab je
  Angebot `room`/`overLimit` über `market.contractWindowRoom` – dieselbe Bedingung wie `maxWindowLoad ≤ limit`
  (Zufallsprobe im Test); „Annehmen“ ist dann gesperrt.
- **M-07 Kaufmann nach Gebühren.** Neuer Zähler `handel_gebuehr` (ganze Taler Börsengebühr je Geschäft ab
  `minCountedTradeCredits`), Schwellen 400 / 2.000 / 8.000 (Vorschlag Mathematiker). Balance-Eintrag geändert
  (`achievements.list.kaufmann`), Version nicht gehoben. Das Wochenziel „Handel“ zählt weiter Geschäfte. Bereits
  erreichte Stufen bleiben; der neue Zähler beginnt bei 0 (kein Nachrechnen aus dem Journal). Rundreise-Farmen kostet
  jetzt die volle Gebühr je Zählpunkt (8.000 T für Gold statt 4.000 T) – ganz geschlossen ist der Hebel damit nicht;
  wer ihn ganz schließen will, hebt die Schwellen so, dass Gebühren ≥ Belohnungswert (rund 3.000/12.000/36.000).
- **TE-06** Spielersperre (`lockTraders`/`lockPlayers`) vor den Grenzprüfungen in Angebot, Annahme, KI-Abschluss und
  Spielerhandel-Angebot; Sperrreihenfolge bleibt Häfen → Spieler.
- **TE-04** Live-Verbindungen in `engine/live-sockets.ts` (`LiveHub`): close-Handler vor der Sitzungsprüfung, danach
  nur offene Sockets; Sitzung alle 10 min neu geprüft (DB-Fehler trennt nicht); höchstens 5 Sockets je Spieler, der
  älteste wird mit 4408 geschlossen.
- **TE-07** Eine Spielzeitzone: `gameTimeZone()` in `game-core/time-zone.ts` (TZ, wenn Intl sie kennt, sonst
  Europe/Berlin; `:/etc/localtime` fällt zurück). Alle Stellen (Namen, Diplomatie, Mails, Verträge, Admin) nutzen sie.
- **TE-08** `runCommand` (jetzt `engine/command-run.ts`) wiederholt bei 40P01/40001/55P03 bis zu zweimal mit kurzem
  Zufallsabstand; die Transaktion samt `command_log` ist dann zurückgerollt, derselbe Schlüssel gilt weiter.
- **TE-03** E2E: `reserveField` wählt und reserviert ein Rohstofffeld in einer Transaktion unter Advisory-Lock.
  **TE-16** `*.tsbuildinfo` in `.gitignore`.
- **AN-07 Push bündeln, Ruhezeit.** Dringendes (Angriff, Allianz-Ops, Test) sofort. Ruhezeit = laufendes
  Nachtschild-Fenster des Heimathafens (ohne Nachtschild keine Ruhezeit – bewusst: der Spieler hat dann keine Nacht
  angegeben). In der Ruhezeit wird alles andere gesammelt; Routine (Bau, Ausbildung, Verband, Lieferung, Bauschlange
  leer, Markt) wird auch tagsüber gesammelt und höchstens alle 15 min als ein Push zugestellt („3 Meldungen“, Titel
  mit Anzahl). Ablage ohne Schemaänderung in `mail_digest` mit `kind = "push:<art>"`; die Mail-Bündelung überspringt
  diese Zeilen, das Aufräumen nach 3 Tagen gilt für beide. Der Morgenbericht (selbst gewählte Uhrzeit) geht direkt.
- **AN-06 Rückholung.** Zweite Stufe nach 10–14 Tagen (`winback2:<last_seen>`, eigener Betreff „Noch da, Kapitän?“).
  Ohne bestätigte Adresse, aber mit Push-Abo, kommen beide Stufen als Push (Art `comeback`, Push-Vorgabe jetzt an;
  Einstellungen zeigen die Art auch bei Push). Saisonwechsel (`season-notice.ts`): einmal je Saison (`season:<Nr>`)
  Mail und Push „Saison N hat begonnen“ mit Platz der Vorsaison an alle Menschen, die seit dem Start noch nicht da
  waren, 9–21 Uhr Spielzeit, bis 48 h nach dem Start.
- **TST-09 „Alle abholen“** (`rewards.claimAll`, `engine/rewards-claim.ts`): Auftragsbuch (Schritte, dann Abschluss),
  Tagesbefehle, Wochenziele, Erfolge in einer Transaktion, je Belohnung ein Savepoint über denselben Kern wie die
  Einzelabholung (`claim…In`). Lagergrenze: Würde etwas verfallen, bleibt die Belohnung liegen (`skipped`); mit
  `allowLoss` wie bisher bis zur Grenze. Codes `nothing`, `storage_full`.
- **Lage (TST-15, TX-08, TST-16):** „Beitrittsanfragen“ (Führung/Offiziere, zählt fürs Navigationszeichen) und
  „Einladung in die Allianz“ unter „Wartet auf dich“, Sprung `{ to: "alliance" }`; „Anfängerschutz endet in …“ in den
  letzten 24 h als dringender Termin; Belohnungstext nennt nur Quellen mit Anzahl, `urgent.rewardSources`.
- Keine Schemaänderung.

### Nachtrag Welle 1: Nutzerentscheide Ruhezeit und Kaufmann

- **Kaufmann-Schwellen bleiben** bei 400 / 2.000 / 8.000 Taler Börsengebühr (Nutzerentscheid).
- **Ruhezeit für Pushes einstellbar** (ersetzt „Ruhezeit = nur Nachtschild“ aus AN-07): Jeder Spieler stellt sie in
  den Einstellungen ein (Karte „Ruhezeit“, volle Stunden), Vorgabe 23–7 Uhr Spielzeitzone, abschaltbar; gilt für alle
  Geräte. Mit laufendem Nachtschild gilt dessen Fenster zusätzlich (das spätere Ende zählt). Angriffe, Allianz-Ops und
  die Testnachricht gehen immer sofort; der Morgenbericht (selbst gewählte Uhrzeit) ebenfalls.
  Kern `engine/push-quiet.ts` (`quietEndMs` rein, Fenster über Mitternacht), Schnittstelle `push.quiet` /
  `push.setQuiet({ on, fromMin, toMin })` (Code `bad_time`, wenn Beginn = Ende).
- **Ablage ohne Schemaänderung** in `server_setting` unter `push_quiet:<Spieler-ID>` (JSON); fehlt der Eintrag, gilt
  die Vorgabe. Bewusst keine neue Tabelle/Spalte, weil sie eine Migration bräuchte. Soll es sauberer werden, wäre
  eine Spalte `push_quiet jsonb` an `player` oder eine Tabelle `push_quiet(player_id, on, from_min, to_min)` der Ort.
## Weltpolitik: Gezeit, Ansehen je KI, Gesuche, Seerat (Spiellogik, Server, API; Oberfläche folgt)

Grundlage `docs/VORLAGE-WELTPOLITIK.md` mit den Nutzerentscheidungen; Regelwerk `docs/REGELN-WELTPOLITIK.md`.
- **Fundament:** `balanceAt(base, plan, ms)` rein in game-core, Kopie nur bei wirkendem Fenster (sonst gleiche Referenz,
  damit nichts ohne Gezeit anders rechnet), Zwischenspeicher je Menge wirkender Fenster. Plan als Zeilen
  (`politik_fenster`), nicht als Balance-Wert: der Seerat ändert ihn zur Laufzeit. `meta` liefert wirksame Balance,
  Grundbalance, Plan und `validUntilMs`; der Client lädt `meta` zum Wechsel neu (trpc.ts). Faktoren, die nicht als
  Balance-Wert existieren (Produktion, Spielerhandelsgebühr, Weltereignis-Beute), stehen in `politikNow`.
- **Ein Wirkungs-Platz trotz Wochensitzungen (Entscheid 10):** Wochenbeschlüsse überlappen nie eine Gezeit
  (`weeklyEffect`: hinter eine laufende schieben, vor einer beginnenden kürzen, < 12 h entfällt). Ohne diese Regel
  hätte die Woche 4 (Tag 29–31) fast immer mit der dritten Gezeit zusammengelegen.
- **Seerat tagt immer (Entscheid 11)**, das Quorum ⌈N/2⌉ bleibt (sonst Vorgabe). Allianzdeckel exakt gelöst
  (T = R / (1 − |C|·0,4)) statt schrittweise; reichen die Gewichte außerhalb nicht, werden gedeckelte Allianzen
  angeglichen. Gleichstand → Ruhige See.
- **Ansehen statt kiRefuses:** `kiAccess` ersetzt das Ja/Nein über eine Funktion (`kiRefuses` ruft sie, `kiFor` liefert
  Bonus/Kontingent/Ablehnung). Gerechnet beim Lesen aus Verträgen, Gesuchen, Berichten und Merkern (`ansehen_merker`
  nur für gekündigte KI-Pakte) – kein Zähler, der auseinanderlaufen kann. Sperre nach Überfall
  `max(raidBlockHours 72, attackBlockHours 24)`; `attackBlockHours` bleibt für den Fall ohne `politik`-Block.
  „Berüchtigt“ = Mittel über alle aktiven KI-Spieler ≤ − 30 (bis der globale Ruf kommt). Bot-Code unverändert.
- **Gesuche:** nur „Liefern“ an (Geleit/Feld per `gesuche.kinds` vorbereitet). Treuhand beim Anbieten aus dem KI-Lager,
  Kontingent wird für das Gesuch nicht geprüft (die KI hat die Menge selbst erbeten), Tagesbefehl-Platz Art `gesuch`
  (nicht neu würfelbar). Abrechnung im Wartungslauf und beim Lesen der KI-Ansicht.
- **Während einer Gezeit** ein Weltereignis weniger zugleich (`maxConcurrent − 1`); „keines mit derselben Ressource“
  (VORLAGE 3.1) noch nicht.
- **Nicht umgesetzt:** Sturmzeit (Entscheid 2), globaler Ruf/Ächtung (vorbereitet, aus), Gesuche Geleit/Feld/Nest,
  „Gezeit lenkt Angebote“, Morgenbericht-Zeile, Simulator (`sim/`) mit Plan, Vorankündigung „Gemeinsame Aktion“ 12 h
  früher (nur die Beute + 20 %). Keine Migration (Tabellen `politik_fenster`, `seerat_sitzung`, `seerat_stimme`,
  `ki_gesuch`, `ansehen_merker` nur im Schema).

## Weltpolitik: Oberfläche und Paktangebot der KI (nach dem Navigationsumbau)

- **Kein neuer Reiter:** Abschnitt „Weltpolitik“ auf Basis → Lage zwischen „Unterwegs“ und „Wartet auf dich“
  (Sprungziel `politik` für Gezeit-, Seerat- und Paktzeilen); Gesuche bei den Tagesbefehlen; Ansehen auf der KI-Karte
  der Verträge; wirkende Regler als Hinweis an Order, KI-Verträgen, Börsenkonvoi, Konvoi-Probekampf und Spielerhandel
  (`EffectHint`, Server liefert `lines` mit Schlüssel, Ende und Wert danach). Restzeiten laufen live (`useCountdownNow`).
- **Unangekündigte Gezeit** zeigt der Kalender ohne Art („angekündigt 24 h vorher“); der Plan selbst bleibt in `meta`
  (der Client braucht ihn für `balanceAt`), ist also für Neugierige lesbar – bewusst hingenommen.
- **Handbuch** liest die Grundbalance (`meta.baseBalance`), sonst stünden während einer Gezeit deren Werte als Regel da.
- **Paktangebot der KI (Nutzerentscheid):** im Wartungslauf (`offerKiPacts`, zusammen mit den Gesuchen) als normale
  Diplomatie-Zeile `angeboten` mit `proposed_by` = KI; Merker `pakt_angebot` sperrt 7 Tage (auch nach Ablehnung).
  Nur für Menschen ohne Allianz – in einer Allianz verhandelt die Führung für alle, das Ansehen gilt aber je Mensch.
  Annehmen/Ablehnen über `politik.acceptPakt/declinePakt` (prüft, dass es ein KI-Angebot an diesen Menschen ist) bzw.
  die vorhandene Diplomatie.
