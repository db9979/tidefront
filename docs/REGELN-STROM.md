# TIDEFRONT – Ökostrom, Elektrolyse, Seekabel (Balance v1.21)

Ergänzt [REGELN-WETTER.md](REGELN-WETTER.md) (Stromquellen, Rangfolge, Fortschreibung). Kern:
`packages/game-core/src/power.ts` (Fortschreibung) und `power-green.ts` (Ökostrom, Elektrolyse, Kabel, Grün-Anteil);
Server: `packages/engine/src/power-cable.ts` (Befehle, Abrechnung), `power-cable-view.ts` (Ansicht), `weather.ts`
(Modifikator-Quelle „Ökostrom“, Stromkurve). Begründungen und Simulationszahlen: `packages/game-core/ENTSCHEIDUNGEN-3.md`,
Abschnitt O; Simulation `node packages/game-core/sim/power-green.ts`.

## Ökostrom und Überschuss

- **Ökostrom** ist Strom aus Windpark und Solarfeld, außerdem Strom aus einem Seekabel (es trägt nur Ökostrom) und die
  Ladung des Speichers, soweit sie aus Ökostrom stammt.
- Reihenfolge je Augenblick: Ökostrom deckt den Bedarf zuerst, dann lädt er den Speicher; das Kraftwerk deckt den Rest.
  **Lastfolge (0.21.3):** Das Kraftwerk regelt nach – es liefert genau, was Ökostrom, Kabelbezug und Speicher offen
  lassen, und verbrennt anteilig Treibstoff (Auslastung = offener Bedarf ÷ Volllast). Es lädt den Speicher nicht. Der Speicher merkt sich den Ökostrom-Anteil seiner Ladung (`powerLog.storedGreen`) und gibt
  ihn beim Entladen anteilig ab.
- **Überschuss** = Erzeugung − Bedarf − Speicherladung. Davon ist nur der Ökostrom-Rest nutzbar, in dieser Reihenfolge:
  1. **Elektrolyse** (bis zu ihrer Aufnahme), 2. **Seekabel** des abgebenden Hafens (bis zur Stationsleistung),
  3. der Rest **verfällt**. Kraftwerksüberschuss entsteht nicht mehr, weil das Kraftwerk
  nachregelt; ohne Treibstoff läuft es nur so weit, wie Treibstoff nachkommt.
- Die Stromkurve (Basis → Versorgung) zeigt den Überschuss je Stunde als Streifen unter der Achse: „→ Treibstoff“,
  „→ Partner“, „verfällt“, dazu den verfallenden Ökostrom als Hinweis auf Elektrolyse oder Kabel.

## Elektrolyse (Gebäude `elektrolyse`)

- Aufnahme `electrolysisPerLevel * L` (40) Strom je Stunde, `electrolysisRatio` (6, bis v1.23: 10) Strom-Stunden → 1
  Treibstoff, also höchstens 6,7 Treibstoff je Stunde und Stufe. Braucht selbst keinen Strom. Kosten 160 Stahl, 90 Elektronik, 35 s.
- Nimmt **nur Ökostrom-Überschuss** auf, nie Kraftwerksstrom (sonst würde Treibstoff zu mehr Treibstoff: 3 Treibstoff
  → 60 Strom → 6 Treibstoff). Weil Ökostrom zuerst den Bedarf deckt, kann mehr Kraftwerk den Ökostrom-Überschuss nur
  verringern; die Kraftwerk-Drosselung bei Treibstoff 0 bleibt eindeutig.
- An der Lagergrenze nimmt sie nur so viel auf, wie der Treibstoffverbrauch gerade abnimmt; der Rest geht ins Kabel
  oder verfällt.

## Seekabel (Gebäude `seekabel`, Tabelle `power_cable`)

- Verbindet zwei Häfen bis `power.cable.maxKm` (600) km: eigene Häfen sofort, Häfen von Mitgliedern derselben Allianz
  nach Zustimmung des Empfängers. Beide Häfen brauchen eine Seekabel-Station (Stufe 1). Jeder Hafen hat höchstens ein
  Kabel (abgebend oder empfangend, auch eine offene Anfrage zählt) – es gibt keine Ketten und keine Weiterleitung.
- Der **abgebende** Hafen schickt seinen Ökostrom-Rest nach der Elektrolyse ins Kabel, höchstens `cablePerLevel * L`
  (30) Strom je Stunde (`state.cable.sent`).
- Alle `tickMinutes` (10) wird abgerechnet (Ereignis `cable_tick`): beide Häfen werden fortgeschrieben, das Gesendete
  kommt mit `1 − lossPer100Km * km / 100` an (10 % je 100 km; bei 600 km 40 %), höchstens bis der **Kabelpuffer** des
  Empfängers voll ist (`bufferHours` (2) Stunden seiner Stationsleistung) und nur so viel, wie der Empfänger bezahlen
  kann. Der Rest geht verloren.
- **Preis:** Der Abgebende legt ihn fest, 0 bis `maxPrice` (2) Kredite je angekommener Strom-Stunde (0 = Allianzhilfe;
  zwischen eigenen Häfen immer 0). Bezahlt wird je Abrechnung über das Journal (`trade_ledger`, Buchung
  `kabel-<id>:<Zeit>`: `player:<Empfänger>` −, `player:<Abgebender>` +); der Prüflauf bleibt ausgeglichen. Preisänderungen
  gelten ab der nächsten Abrechnung.
- Der **Empfänger** zieht bei Mangel aus dem Puffer, vor dem Speicher, bis zu seiner Stationsleistung. Kabelstrom wird
  weder gespeichert noch elektrolysiert noch weitergeleitet. Er zählt als Ökostrom.
- **Trennen:** jede Seite jederzeit (Puffer verfällt, zuvor wird abgerechnet); eine Anfrage kann der Empfänger ablehnen,
  der Anbieter zurückziehen. Bei der Abrechnung wird ein Kabel automatisch getrennt, wenn ein Hafen nicht mehr besteht,
  den Besitzer gewechselt hat oder die Spieler nicht mehr in derselben Allianz sind. Saisonende: alle Kabel verfallen.
- **Sabotage:** Kriegsgegner (nur sie) können eine Seekabel-Station sabotieren (Nachrichtendienst, Ziel „Seekabel“,
  übliche Dauer und Sperrfrist). Solange die Sabotage an einer der beiden Stationen läuft, sendet bzw. bezieht diese
  nichts, und eine Abrechnung in dieser Zeit verliert die ganze Sendung.

## Grüner Hafen

- Ökostrom-Anteil = Ökostrom am gedeckten Bedarf in den letzten `power.green.windowHours` (24) Stunden (Stundenwerte in
  `state.powerLog.hours`, mit der laufenden Stunde). Ab `shareMin` (60 %) und mindestens `minTotal` (24) Strom-Stunden
  gedecktem Bedarf gilt der Hafen als **Grüner Hafen**: Gebäudeproduktion aller Ressourcen +`bonus` (3 %), als
  Modifikator-Quelle „Ökostrom“ im Info-Blatt (wie Wetter, Forschung). Die Elektrolyse ist keine Gebäudeproduktion und
  erhält den Bonus nicht.
- Erfolg **„Grüner Hafen“** (Zähler `oekostrom`): genutzter Ökostrom aller Häfen (Bedarf, Elektrolyse, Kabel; nicht
  verfallen) – Bronze 10 000, Silber 75 000, Gold 300 000 Strom-Stunden. Der Server liest die Saisonsumme
  `powerLog.greenUsed` beim Abruf der Erfolge und Wochenziele und nach Bau/Forschung und zählt den Zuwachs.
- **Wochenziel „Ökostrom“** (ab 90 Strom Höchstwert aus Wind und Sonne im Heimathafen): Ziel = Höchstwert × 30,
  gerundet auf 500.
- **Saisonauszeichnung „Grünster Hafen“** (`best_oekostrom`): der Spieler mit dem meisten genutzten Ökostrom in einem
  seiner Häfen (mindestens 1000), in Saisonnachricht und Ruhmeshalle; zählt nicht zu den Punkten.

## KI-Spieler

Der Händler gewichtet Windpark (Norden, ab 47° N) bzw. Solarfeld (Süden) und baut eine Elektrolyse, sobald Wind und
Sonne zusammen mindestens Stufe 3 haben (höchstens halb so viele Elektrolyse-Stufen). Bei akutem Strommangel baut er
weiter zuerst ein Kraftwerk. Kabel legt die KI nicht.
