# game-core – Entscheidungen, Teil 8

Fortsetzung von `ENTSCHEIDUNGEN-7.md` (voll). Verbindlich bleibt `docs/REGELN.md`. Neue Abschnitte bitte hier anhängen.

## Weltpolitik Stufe 2: Sturmzeit, globaler Ruf, Ächtung; optischer Satellit sieht U-Boote (28.11.2026)

Auftrag: die bisher „nach einer Live-Saison“ verschobenen Punkte jetzt umsetzen (Grundlage `docs/VORLAGE-WELTPOLITIK.md`
mit den Nutzerentscheidungen am Ende, `docs/REGELN-WELTPOLITIK.md`; Lagebild `docs/REGELN-LAGEBILD.md` 5.6). Die
Balance-Version bleibt; im Block `politik` sind nur Werte ergänzt (`gezeit.kinds` + `sturmzeit`, `effects.sturmzeit`,
`seerat.aechtung` an, neuer Unterblock `ruf`). Wirtschaftswerte (Kosten, Produktion) unverändert.

### Sturmzeit

1. **Vierte Gezeit-Art im Plan-Würfel.** `weltlagePlan` würfelt schon eine Reihenfolge über *alle* Arten
   (gleichverteilt unter den Permutationen, deren erste Art nicht in `notFirst` steht) und nimmt die ersten drei – mit vier
   Arten kommen je Saison drei, keine doppelt, die Kartellfehde nie zuerst. Der Zufallsverbrauch bleibt gleich (ein Wurf
   für die Reihenfolge, je Fenster Streuung und Gut), die **Termine ändern sich nicht**: 200 Seeds, kleinster Abstand
   ≥ 5 Tage, frühester Beginn ≥ Tag 9,5, spätestes Ende ≤ Tag 31,5 (Test `politik-stufe2.test.ts`). Jede Art kommt in
   200 Seeds mindestens 100-mal vor. Laufende Saisons behalten ihren gespeicherten Plan.
2. **Nur Sturmschwelle und Sturmstärke, nie `systemEveryHours`.** `effects.sturmzeit`: `stormFrom` × 0,875 (0,8 → 0,7),
   `stormStrength` × 1,1 (Wind der Tiefs), dazu wie in der Vorlage Konvoi-Kartellchance × 0,5 und Schatzschiff-Gewicht × 2.
   Die Klemme 0,5 … 1,75 gilt auch hier.
3. **Wie das Wetterfeld die Sturmzeit kennt.** Das Wetter ist eine reine Funktion von Ort, Zeit und `weather`-Balance;
   33 Stellen lesen die globale Balance, der Client rechnet Karte, Vorhersage und Probekampf selbst. Statt alle Stellen auf
   `balanceAt(t)` umzustellen, trägt `setStormWindows` (`weather-storm.ts`) die Sturmzeit-Fenster des Plans ins
   Wetterfeld ein (`stormWindowsOf(base, plan)`: Zeitraum, Schwelle absolut, Stärke). `computeWeather` multipliziert im
   Fenster den Wind der Tiefs, `storm` und die Vorhersage nutzen `stormFromAt(wb, ms)`; der Zwischenspeicher je Ort und
   Minute trägt einen Schlüssel der Fenster. Damit rechnen Route bei Abfahrt, Kampf, Vorhersage und Karte zu *jedem*
   Zeitpunkt dasselbe, auch für die Zukunft (Vorhersage über das Fensterende hinaus). Eingetragen wird auf dem Server bei
   jedem `seasonPlan` (meta, Ansichten), höchstens minütlich aus `balanceNow`, in den Ereignissen politik_start/-end und
   seerat_close (Worker) und im Wartungslauf nach `ensurePolitikPlan`; im Client beim Laden von `meta`. `balanceAt` setzt
   zusätzlich `weather.stormFrom` der wirksamen Balance (Anzeige „jetzt“).
4. **Messung** (Winter, ganze Karte, 20 Tage, Stichprobe jede 7. Stunde): Felder mit Wind ≥ Sturmschwelle 0,14 % (≥ 0,7)
   bzw. praktisch 0 % (≥ 0,8) → mit Sturmzeit 0,45 %; Schiffsbremsung (Wind ≥ 0,5) 8,5 % → 10,1 %. Stärke 1,15 hätte 0,64 % /
   10,9 % ergeben. 1,1 bleibt spürbar (dreimal so viel Sturm), ohne die Fahrzeiten zu verzerren. Nebenwirkung: Windkraft
   liefert in den 72 h etwas mehr (kein Wirtschaftswert geändert).

### Globaler Ruf

5. **Gerechnet beim Lesen, kein Zähler.** Wie das Ansehen: aus Verträgen, Gesuchen, `trade_ledger` (Gebühren), Berichten
   (Schwachziel, Hilfe, Kartell-Abwehr), `blockade` und Merkern (`politik-ruf.ts`). Kein Job, keine Doppelbuchung; jede
   Buchung hat einen Beleg (`ref`). Eine Saison bringt einige Hundert Belege je Mensch – eine Abfrage je Quelle.
6. **Merker ohne neue Tabelle.** Pakt mit einem Menschen gekündigt (für den Paktbruch) und Ächtung liegen in
   `ansehen_merker` mit `ki_id = 0` (kein KI-Spieler), kinds `ruf_pakt_ende` (ref `pakt:<id>:<Erlöschen>:<Partei>`) und
   `aechtung` (ref `sitzung:<id>:<Ende>`). Das Ansehen filtert auf echte KI-IDs und sieht sie nicht. **Keine
   Schemaänderung** (eine eigene Tabelle `ruf_merker` war vorgesehen; ohne Migration lassen sich die Servertests nicht
   fahren, und die Zeilen passen in die vorhandene Form).
7. **Buchungen genau nach Vorlage 3.3**, Abweichungen:
   - *Handel* zählt die Gebühr je Geschäft mit genau einem Menschen (Börse, KI-Verträge). Geschäfte zwischen zwei Menschen
     (Spielerhandel, Spielerverträge) zählen gar nicht – einfacher und strenger als „Partner mit Absprache-Verbindung
     nicht“; Freunde können sich so keinen Ruf zuschieben. Gebühren in Waren zählen nicht.
   - *Schwachziel* liest `report.attacker.weakTarget` (nach der Kriegsprüfung gesetzt) und nur Überfälle auf Menschen;
     Sammelangriffe zählen nicht (die Schwachziel-Kürzung liegt dort nicht im Bericht je Teilnehmer).
   - *Blockade*: −3 je angefangenem Tag ab Beginn; Minen zählen nicht (nicht im Auftrag genannt, schwer einem Hafen
     zuzuordnen). Krieg wird zum Beginn der Blockade geprüft.
   - *Weltereignis-Beteiligung* (+4 in der Vorlage) ist nicht Teil der beauftragten Liste und fehlt vorerst.
   - *Anfängerschutz*: die ersten 7 Tage ab Anmeldung (nicht der Hafenschutz, der durch eigene Angriffe früher endet).
   - *Paktbruch* unter Menschen: Merker für alle Menschen der kündigenden Partei; Überfall auf ein Mitglied der
     Ex-Partei (Mitgliedschaft heute) oder Kriegserklärung der eigenen Partei an sie ≤ 48 h nach dem Erlöschen, einmal.
8. **Wirkung.** Berüchtigt ist jetzt Ruf ≤ −30 (ersetzt den Stufe-1-Ersatz „Mittel des Ansehens“, der nur ohne
   Balance-Block `ruf` gilt). Angesehen (≥ +30) hebt „Bekannt“ bei allen KI-Spielern auf „Vertraut“ (Bonus, Kontingent,
   Pakt); „Misstraut“ bleibt misstraut. Die Vorlage-Idee „Ansehen = Ruf + eigener Anteil ± 20“ ist bewusst nicht gebaut:
   sie hätte die Schwellen des laufenden Ansehens mitten in der Saison verschoben. Keine Wirkung auf Börsenpreise und
   Rang (Nutzerentscheid 7).
9. **Sichtbarkeit (Pranger-Schutz).** Eigener Ruf mit Verlauf unter Saison → Welt; in der Rangliste bei anderen nur das
   Zeichen der äußeren Stufen (Wert `null`), beim eigenen Eintrag mit Wert. Die Rangliste rechnet den Ruf aller 60 s neu.

### Ächtung

10. **Aktiviert** (`seerat.aechtung` an). Option nur in Wochensitzungen und nur, wenn es beim Öffnen Berüchtigte gibt
    (`withAechtung` beim seerat_open – so greift sie auch in der laufenden Saison, deren Sitzungen ohne die Option geplant
    wurden). Kein Name auf dem Stimmzettel: getroffen wird, wer beim Schluss berüchtigt ist (`aechtungTargets`). Normale
    Auszählung; die KI-Präferenzen enthalten die Ächtung nicht, die KI stimmt also nie dafür. Wirkung 72 h ab Schluss,
    höchstens bis zur Finale-Sperre; das Wochenfenster bleibt „Ruhige See“. Während der Ächtung lehnt auch der Freibeuter
    ab (Vorlage: „keine KI-Verträge und Gesuche“); Kopfgeld + 0,2 (Maximum, nicht Summe mit + 0,1). Ergebnis an alle ohne
    Namen („N berüchtigte Kapitäne“), die Geächteten erhalten eine eigene Nachricht. Stimmgewicht 1 je Mensch.

### Optischer Satellit sieht getauchte U-Boote

11. `liveLevelAt(…, "submarine")` nimmt den Streifen eines optischen Satelliten mit (Stufe Sichtung, nicht unter Wolken);
    Radarsatellit, Radar und Ausguck bleiben blind. `fleetsInSight` zählt die U-Boote dann bei der Größe mit und markiert
    reine U-Boot-Verbände `submerged` (Wissen, Karte, Sichtungen). Der Überflug schreibt sie wie alle Verbände ins Wissen.
    Server-Test mit einem eingefügten Verband, dessen Position zum Überflug (fast) genau auf einem klaren Feld liegt;
    die Testzeit wird wie in `lagebild3.test.ts` nach dem Wetter gewählt.

Fortsetzung von `ENTSCHEIDUNGEN-7.md`. Verbindlich bleibt `docs/REGELN.md`. Neue Abschnitte bitte hier anhängen (je Thema
ein eigener Abschnitt).

## Balance v1.38 – Welle 5 der Abschlussprüfung 0.38 („nach Live-Daten“, w5)

Grundlage: `.claude/review-0.22/ABSCHLUSS-0.38.json` (Plan Welle 5: AN-04, M-05, AN-08, M-04, ST-09, M-06, ST-14, ST-15,
M-08, ST-16, M-14, M-17), die Rollenberichte von Analyst, Mathematiker und Stratege, `ENTSCHEIDUNGEN-7.md` (v1.35–v1.37).
Ein Hebel je Problem. Gemessen mit `npm run sim` und `npm run sim:saison -- --strict` (Seed 4242, 42 Tage, 3 KI + 4 passive
Menschen). Der Saisonlauf ist trotz Seed nicht vollständig reproduzierbar (zwei Läufe desselben Stands weichen bei Kampf +
Beute um 2 Punkte und bei den Weltereignis-Wächtern ab); daher je Stand mindestens zwei Läufe.

### Neue Messung im Saisonlauf (`sim/saison-wirtschaft.ts`)

Je KI und Woche: Füllgrad (Bestand ÷ Lager), Lager in Stunden Produktion und ungenutzter Anteil (Bestand ÷ bisherige
Netto-Produktion) je Rohstoff; abgeholte Belohnungen (Tagesbefehle, Wochenziele, Erfolge) ÷ Wochenproduktion und dasselbe
für einen **aktiven Menschen** (alle Tagesbefehle 3/3, Serienbonus, drei Wochenziele und Wochenbonus bei der KZ des
Heimathafens – die KI holt nur einen Teil ab); Elektrolyse (Stufen, Treibstoff daraus in % der Treibstoffproduktion,
verfallener Strom); Forschungswert ÷ Gebäudewert; PvP-Siege. Im JSON-Bericht (`SIM_OUT`) unter `wirtschaft`.

### Befunde vorher (v1.37, Stand 0.48.3) und Hebel

1. **Rohstoffmix (AN-04).** Das Lager begrenzt nie (Füllgrad 1–29 %). Stahl bleibt der Engpass (13–32 h Lager),
   **Proviant läuft am stärksten über** (40–92 h, ungenutzt bis 28 %), Treibstoff nicht mehr (26–35 h, ungenutzt 7–22 % –
   seit 0.38 haben Börsenhandel der KI, Kolonie-Unterhalt und die Nest-6-Rücklage den Überlauf aufgezehrt). Ein erster
   Versuch mit dem Vorschlag aus 0.38 (`costShift.to` Elektronik 0,55, Proviant 0,25, **Treibstoff 0,20**) brachte
   Treibstoff nichts (Woche 1 sogar 54 h) und ließ Elektronik überlaufen (30–49 h). **Hebel:** `building.costShift.to`
   Elektronik 0,75 → **0,65**, Proviant 0,25 → **0,35** (wertgleich, Stufe 0 unverändert). Treibstoff bewusst nicht.
2. **Chipfabrik-Kosten (M-05).** Amortisation 1,88 × Stahlwerk (Raffinerie 1,38 ×). **Hebel:** Kosten 200/60/20 →
   **150/40/10** (Richtwert 368 → 252) – Amortisation ≈ 1,29 × Stahlwerk, also wie die Raffinerie. Versorgungshof bleibt,
   solange Proviant überläuft.
3. **Belohnungshöhe (AN-08).** Ein aktiver Mensch bekommt aus Befehlen, Serie und Wochenzielen **119 % / 89 % / 63 % / 49 %
   / 39 %** der Wochenproduktion einer KI (Woche 1–5; in 0.38 waren es 73–76 % in Woche 1–2). Die KI holt 14–29 % ab.
   **Hebel:** Tagesbefehle 400/1000/2500 → **200/500/1250** (Wachstum 0,3 je KZ bleibt), jetzt in der Balance
   (`achievements.daily.tierValue`, `stageGrowth`; challenge-pool.ts liest sie). Wochenziele unverändert. Punkte unverändert.
4. **Satellit (M-04, ST-09)** – erledigt in v1.35 (Entscheid 11B); nicht angefasst (paralleler Entwickler Lagebild/Satellit).
5. **Elektrolyse (M-06).** Bestätigt als Falle: Der Händler baute bis Tag 35 **26 Stufen** für **2 %** seines Treibstoffs;
   `npm run sim`: „KW 3 + Wind 4 + Sonne 2 + Speicher 2 + Elektrolyse 3“ bringt 3 Treibstoff-Wert je Tag. **Hebel (Information
   statt Zahl):** Das Gebäudeblatt der Elektrolyse rechnet aus der Stromvorhersage der Basis (Überschuss je Stunde in der
   Elektrolyse plus verfallender Ökostrom, ohne den Kabelstrom), was die nächste Stufe an Treibstoff je Tag brächte und in
   wie vielen Tagen die Baukosten zum Richtpreis zurück sind; über 14 Tage rät es ab („erst mehr Wind und Sonne“)
   (`electrolysisAdvice`, `ElectrolysisAdvice.tsx`). Die KI (Händler) baut die nächste Stufe nur noch, wenn derselbe Rat
   „lohnt“ sagt (`bots-plan.ts greenWeights`). Keine Zahl der Elektrolyse geändert.
6. **Kolonie (ST-14)** – erledigt in v1.35 (Entscheid 12 B+C).
7. **Forschung in der Wertung (ST-15).** Forschungswert = 4–24 % des Gebäudewerts der KI; ohne Wertung rechnet sich
   Forschung in 42 Tagen kaum. **Hebel:** `scoring.researchFactor` **0,5** – die Kosten aller erforschten Stufen zählen zur
   Hälfte zum **Ausbau** (`researchScoreValue`). → bitte bestätigen.
8. **Verträge (M-08, „verdichten“).** KI-Verträge waren fast immer teurer als die Börse (Bezugskurs max/min plus 4 %
   Grundaufschlag; 1-Tages-Vertrag bei ruhigem Kurs 1,045 gegen Sofortkauf 1,04). **Hebel:** `market.contracts.baseFee`
   0,04 → **0,025**: Ein kurzer Vertrag liegt bei ruhigem Kurs etwa auf Höhe des Sofortkaufs (1-Tages-Vertrag 1,03 + Mengenteil
   gegen 1,04), längere etwas darüber. Den Vorschlag „Bezugskurs E statt max/min“ verworfen: Er öffnet eine Geldmaschine
   (Sofortkauf bei gedrücktem Kurs + Terminverkauf an die KI zum erwarteten Kurs, +4–13 %) und bräche die geprüfte Garantie
   in REGELN.md. Mit 0,025 bleibt der Aufschlag a ≥ 0,025 + 0,005 − 0,02 (Charakterbonus) > 0, alle Garantie-Tests laufen.
   **Oberfläche verdichtet, keine Funktion gestrichen:** ein Satz statt Regelblock (Regeln aufklappbar), laufende eigene
   Verträge zuerst, KI-Angebote je Richtung als eine Zeile mit Ressourcen-Knöpfen statt einer Zeile je Angebot (Kontingent im
   Formular), Spielerangebote nur bei Bedarf als Liste, „Selbst einen Vertrag anbieten“ samt Regeln aufklappbar.
   **Vertragsnutzung lässt sich im Saisonlauf nicht messen** (passive Menschen schließen nichts ab, die KI schlägt nur
   Angebote vor) – Live-Daten: Verwaltung → Statistik → Nutzung je System („vertraege“).
9. **PvP-Anreiz (ST-16).** Im Saisonlauf 0 Spielerkämpfe (passive Menschen unter Schutz bzw. Schwachziel), also nicht
   messbar. **Hebel:** `scoring.pvpFactor` **1,5** auf die Kampfpunkte **beider Seiten** eines Spielerkampfs (vor Kopfgeld,
   Mutfaktor, Paarbremse; Beute unverändert) – Angriff lohnt mehr, und wer seine Flotte daheim hat, punktet bei der Abwehr.
   → bitte bestätigen.
10. **Jagdbomber gegen Zerstörer (M-14).** Verlusttausch 10 Jagdbomber gegen 10 Zerstörer 17,7 : 1 (50 Kämpfe). **Hebel:**
    Zerstörer `attack.luft` 60 → **45**: 6,4 : 1 – der Zerstörer bleibt der Konter, Bomber sind kein reiner Verlust mehr
    (35 gäbe 3,3 : 1, zu weich). Kartell, Nester und Armada haben keine Flugzeuge – keine Wirkung auf die Wächter.
11. **Kommandopunkte (M-17).** KZ 8 war die teuerste Stufe je KP (501 gegen 334/376). **Hebel:**
    `commandPointsLateFromLevel` 9 → **8** (KZ 8: 330 statt 300 KP, jede Stufe ab 8 +30 gegenüber v1.37).

### KI-Fehler, im Saisonlauf gefunden

- **Weltereignis außer Flugreichweite:** Die Festung scheiterte an einem gewinnbaren Belagerungsring in 1 190 km mit
  `out_of_range`, weil der Verband Jagdbomber und Abfangjäger enthielt; die Ausweichverbände ließen zugleich die
  Landungsschiffe weg und bestanden den Probekampf nicht. Jetzt zuerst nur die Flugzeuge außer Reichweite weglassen
  (`bots-world-events.ts`). Häufigster Grund bleibt ein voller Missionsplatz im Heimathafen (Felder, Nestfahrten).
- **Wächter „Angriffe auf Weltereignisse“ war schon vorher rot:** Beide Vorher-Läufe (0.48.3) endeten mit `--strict` auf
  Exit 1 (Festung 0 Angriffe bei 2 bzw. 4 Ereignissen in Reichweite; einmal auch der Freibeuter).

### Kennzahlen vorher (v1.37, 0.48.3) und nachher (v1.38)

`npm run sim:saison -- --strict`, je zwei Läufe (Spanne). `npm run sim` läuft fehlerfrei durch.

| Kennzahl | vorher (2 Läufe) | nachher (2 Läufe) | Ziel |
|---|---|---|---|
| Exit-Code `--strict` | 1 / 1 (Wächter Weltereignisse) | **0 / 0** | 0 |
| Kartellverlust je Tag (Median KI) | 4–5 % | 3–4 % | ≤ 10 % |
| Kampf + Beute am Gesamtrang (Median KI) | 25–27 % | 23–25 % | ≤ 50 % |
| Tagesbefehle am Gesamtrang | 1 % | 1 % | ≤ 5 % |
| KI-Sieg Nest 6 | Tag 40 | Tag 37–40 | Tag 35–41 |
| Weltereignis-Angriffe Festung / Freibeuter | 0 / 0–2 | 1–2 / 2 | ≥ 1, wenn in Reichweite |
| Belohnung aktiver Mensch ÷ KI-Produktion, Woche 1/2/3/4/5 | 119/89/63/49/39 % | 69/57/41/31/24 % | – |
| Lager in h, Stahl/Treibstoff/Elektronik/Proviant (Mittel KI, Tag 21) | 20/35/48/92 | 13–15/29–31/38–44/59–80 | – |
| Elektrolyse-Stufen Händler Tag 35 (Anteil am Treibstoff) | 26 (2,4 %) | 7–8 (1,3–1,7 %) | – |
| Forschungswert ÷ Gebäudewert (KI) | 6–13 % | 7–12 % (zählt jetzt zur Hälfte zum Ausbau) | – |
| Punkte Freibeuter / Festung / Händler am Ende | 46 649–49 219 / 32 577–33 105 / 33 788–34 168 | 41 131–47 484 / 29 824–35 048 / 35 053–35 254 | – |

Rohstoffmix: Die Verschiebung zu Proviant ist im Saisonlauf kleiner als das Rauschen zwischen zwei Läufen (die KI verkauft
Überschuss ohnehin an der Börse); sie wirkt vor allem für Menschen, die nicht handeln. Treibstoff liegt in Woche 1 höher
(50 h statt 29 h), weil die Chipfabrik weniger Treibstoff kostet; ab Woche 2 wie vorher.

### Bewusst nicht

- Kein zweiter Hebel je Punkt (Raffinerie-Produktion, Wachstum der Belohnungen, Bomber-Bonus gegen Landungsschiffe).
- Satellit und Kolonie (erledigt), Weltpolitik und Lagebild (paralleler Entwickler).
- Keine Schemaänderung, keine Migration. Neue Balance-Felder: `scoring.researchFactor`, `scoring.pvpFactor`,
  `achievements.daily` (Typen in game-core).
