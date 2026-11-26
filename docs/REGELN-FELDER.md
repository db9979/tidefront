# Rohstofffelder (Welle 3 „Expansion“, Teil 1)

Teil der Regeln (`docs/REGELN.md`). Werte im Balance-Block `fields`; fehlt er, gibt es keine Felder.
Begründung und Simulation: `packages/game-core/ENTSCHEIDUNGEN.md`, Abschnitt J, und `sim/fields.ts`.

## Felder

- Rohstofffelder liegen auf **See** (nie an Land), vor den Küsten. Arten: **Ölfeld** (Treibstoff), **Erzbucht**
  (Stahl), **Fischgrund** (Proviant), **Elektronik-Wrack** (Elektronik – kein Wrackfeld zum Bergen). Stufen 1–3.
- Ertrag je Stunde (Stufe 1/2/3): Ölfeld 42/70/105 Treibstoff, Erzbucht 75/125/190 Stahl, Fischgrund 125/210/315
  Proviant, Elektronik-Wrack 25/42/63 Elektronik (gleicher Wert zum Richtpreis).
- Verteilung deterministisch aus einer festen Kandidatenliste (Seed `siteSeed`, Abstand ≥ 230 km). Aktiv sind `count`
  (28) Felder; bevorzugt dort, wo Häfen mehrerer Spieler im Umkreis von `preferKm` (700 km) liegen, nie näher als
  `minKmFromBase` (220 km) an einem Hafen. Neutrale Felder, die durch einen neuen Hafen zu nah liegen oder seit einem
  Tag ohne Hafen in Reichweite sind (wenn es bessere Plätze gibt), ziehen um. Saisonwechsel: alle Felder neu, Besitz
  und Feldpunkte verfallen.

## Einnehmen

1. **Aufklärung** (normale Missionsart, Ziel: das Feld) zeigt Wache bzw. Besatzung und Besitzer.
2. **Besetzen** (eigene Missionsart): nur Schiffe; mindestens ein bewaffnetes, zusammen ≥ `minGarrisonCommandPoints`
   (6) Kommandopunkte. Neutrale Felder bewacht eine Kartell-Wache (4/8/14 Schnellboote, Seekampf wie bei einem Nest,
   schwächer). Besetzte Felder anderer Spieler: Kampf gegen deren Besatzung (mit deren Modifikatoren).
   Schutzregeln wie beim Überfall: nicht gegen Verbündete oder Paktpartner, nicht gegen einen geschützten Besitzer
   (Schutz seines Heimathafens); das Auslaufen hebt den eigenen Nachtschild auf.
3. Nach dem Sieg bleibt die **Mindestbesatzung** (kleinste Auswahl bewaffneter Kampfschiffe ≥ 6 KP) oder auf Wunsch
   („Ganzer Verband bleibt“) alle Schiffe als Besatzung; der Rest fährt heim. Reichen die Überlebenden nicht oder ist
   die Höchstzahl erreicht, ist das Feld danach neutral und unbewacht.
4. Die Besatzung ist eine Mission im Status „stationiert“: sie **belegt einen Missionsplatz**, ihr Unterhalt läuft
   weiter, sie verteidigt das Feld. **Rückruf** (Truppen → Meine Felder oder Infoblatt): das Feld wird neutral, der
   angefangene Ertrag geht noch als Konvoi heim. Ohne Wache kehrt das Kartell nach `guardRespawnHours` (6 h) zurück.
5. Felder gehören einem Spieler **und** einem Heimathafen (dem Hafen, der sie genommen hat); dorthin gehen Ertrag und
   Unterhalt.

## Ertrag und Unterhalt

- Alle `deliveryHours` (4 h) wird abgerechnet: Ertrag × Rangfaktor × Zonenbonus läuft als **Konvoi** (Art „Feld“,
  ohne Geleit, `convoySpeedKmh` 40 km/h) zum Heimathafen. Das Kartell fängt wie bei anderen Konvois gelegentlich ab,
  Kriegsgegner können ihn abfangen. Eine **Blockade** des Heimathafens hält ihn zurück. Minen wirken nicht.
- Unterhalt je Feld: 10/15/20 Proviant je Stunde (Stufe 1/2/3), vom Heimathafen (höchstens der Bestand).
- Bei Verlust des Felds durch Angriff verfällt der angefangene Zyklus.

## Bremse

- Höchstzahl: 1 + 1 je 4 Stufen der Hafenkommandantur (Stufe 0: keines), höchstens 5.
- Abnehmender Ertrag nach Reihenfolge der Einnahme: 100 / 85 / 70 / 55 / 45 %.

## Angriffe

- **Spieler**: „Angreifen“ auf der Karte (Missionsart Besetzen). Sieger übernimmt mit seiner Besatzung; die alte
  Besatzung ist vernichtet. Hält die Besatzung, bleiben ihre Verluste.
- **Kartell**: je Lieferzyklus und besetztem Feld Chance `cartelRaidChance` (5 %); Ankunft nach
  `cartelRaidLeadMinutes` (60 min, Push und Nachricht vorab), Verband 9/12/18 Schnellboote ± 30 %. Unterliegt die
  Besatzung, wird das Feld neutral und das Kartell bewacht es wieder.
- Berichte für beide Seiten, Push und Systemnachricht an den Besitzer.

## Allianz-Einflusszone

- Felder derselben Allianz, die über Ketten mit Abstand ≤ `zoneLinkKm` (450 km) verbunden sind, bilden eine Zone
  (auf der Karte durch Linien und Hof sichtbar). Ab `zoneMinFields` (3) Feldern: +10 % Ertrag je Feld der Zone.
- Allianzwertung: +20 Punkte je besetztem Feld und Tag (am Saisonende zur Summe der Mitglieder addiert).

## Erfolge

- Zähler `felder` (je Einnahme), Erfolg **Landnahme**: 1 / 5 / 20 Felder (Bronze/Silber/Gold).
