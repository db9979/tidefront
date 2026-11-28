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
