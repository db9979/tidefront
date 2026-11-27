# Regeln: Lagebild (Kartennebel, Sensoren, Aufklärung)

**Status: freigegeben am 27.11.2026** (Entscheidungen in Abschnitt 11). Teil der Regeln (`docs/REGELN.md`). Alle Zahlen sind Startwerte
für den Balance-Block `intel` und werden vor der Umsetzung per Simulation geprüft.

## 1. Ziel

Heute sieht jeder Spieler die ganze Welt: alle Häfen, Nest-Stufen, Wracks und Felder. Künftig sieht man nur, was die
eigenen **Sensoren** erfassen oder **früher erfasst** haben. Aus vielen Quellen entsteht ein **Lagebild**, das mit der
Zeit veraltet. Aufklärung wird damit eine eigene Aufgabe mit Kosten, Risiko und Gegenmitteln.

Leitlinien:
- **Fair für Neue:** Küsten, Handelshäfen und die **Positionen** aller Häfen bleiben immer sichtbar. Niemand sucht
  wochenlang nach Zielen oder Handelspartnern.
- **Wissen hat ein Alter:** Jede Angabe trägt ihren Stand („vor 6 h“). Alte Angaben verblassen.
- **Gleiche Regeln für alle:** KI-Spieler sehen genau so viel wie Menschen.
- **Leicht für den Pi:** Sicht wird erst beim Abruf berechnet und kurz zwischengespeichert.

## 2. Was immer sichtbar ist

| Objekt | Immer sichtbar | Nur mit Sicht |
|---|---|---|
| Küsten, Gelände, Handelshäfen | alles | – |
| Eigene Häfen, Verbände, Felder, Minen | alles | – |
| Häfen anderer Spieler | Position, Name, Besitzer, Allianz-Verhältnis | Schutzstatus, Belagerung, Blockade, Ausbau (grob) |
| Piratennester | Position | Stufe, besetzt/leer, Wiederkehr |
| Rohstofffelder | Position, Art | Besitzer, Stufe, Besatzung (grob) |
| Wracks | – | Position und Inhalt |
| Verbände auf See (fremde Missionen, Konvois, Kartell) | – | Position, Kurs, Größe |
| Weltereignisse | wie bisher (werden öffentlich angekündigt) | – |
| Minenfelder | wie bisher (`REGELN-SEE.md`) | – |

Die **Allianz** teilt das gesamte Lagebild: Sicht und Wissen aller Mitglieder gelten für alle. Ein Nichtangriffspakt
teilt nichts.

## 3. Kenntnisstufen je Objekt

| Stufe | Bedeutung | Quelle (Beispiele) |
|---|---|---|
| **Sichtung** | „Da ist etwas“: Objektart, Größenklasse (klein / mittel / groß), Kurs | Radar, Radarsatellit |
| **Erkennung** | Besitzer, Stufe, Einheitentypen gerundet (auf 5, Anlagen auf 2) | Schiff oder Drohne in Sichtweite, optischer Satellit |
| **Lagebild** | Bestände, Gebäude, genaue Einheiten (wie heute) | Mission „Aufklärung“, Spion |

Größenklassen für Verbände: **klein** bis 10 Einheiten, **mittel** bis 40, **groß** darüber.

## 4. Alter des Wissens

- **Live:** Das Objekt liegt jetzt in einem eigenen Sensorbereich. Angezeigt wird der aktuelle Stand.
- **Bekannt:** zuletzt gesehen vor weniger als `staleHours` (24 h). Angezeigt wird der damalige Stand mit Zeitangabe.
- **Veraltet:** 24–`forgetHours` (72 h). Blass dargestellt, Angaben in Klammern.
- Nach 72 h fällt das Objekt auf „immer sichtbar“ (Abschnitt 2) zurück.
- **Verbände auf See** gibt es nur live. Bekannt bleibt höchstens die letzte Sichtung mit Kurs, für 2 h.

## 5. Sensoren

### 5.1 Ausguck (jeder Hafen)
- Sichtweite **120 km**, Stufe **Erkennung**, ohne Strom.

### 5.2 Radarstation (Hafengebäude, vorhanden)
- Reichweite **150 km + 40 km je Stufe**. Das entspricht 40 km je Stufe wie heute bei den Minen. Stufe 10: 550 km.
- Stufe **Sichtung** für Verbände, **Erkennung** für Häfen, Nester, Felder und Wracks im Bereich.
- **Strom:** Bei Strommangel halbe Reichweite. **Nebel:** bis −30 % (`fogRadarMax`, wie bei der Vorwarnzeit).
  **Sabotage:** keine Reichweite, solange sie wirkt.
- **U-Boote** sieht das Radar nie.
- Die bisherige **Vorwarnzeit** bleibt unverändert. Ein erkannter Angriff erscheint jetzt zusätzlich als Verband auf
  der Karte.

### 5.3 Mobile Radarstation (neu)
- Neue Missionsart **„Radarposten errichten“**: mindestens 5 Pioniere und 1 Landungsschiff fahren zu einem freien
  Küstenfeld oder einem eigenen Rohstofffeld. Bei Ankunft entsteht der Posten; die Pioniere bleiben als Besatzung.
- Kosten beim Errichten: 1 500 Stahl, 1 000 Elektronik. Voraussetzung: Radarstation 3 im Ausgangshafen.
- Reichweite **250 km**, Stufe Sichtung/Erkennung wie die Radarstation. Betrieb: **3 Treibstoff je Stunde** aus dem
  Hafen, dem der Posten gehört. Ohne Treibstoff fällt er aus.
- Höchstens **2 Posten** je Spieler, mit Hafenkommandantur 8 höchstens 3. Mindestabstand 300 km zueinander.
- **Angreifbar:** Ein Posten ist ein Ziel wie ein Rohstofffeld. Er verteidigt sich mit seiner Besatzung und
  20 Lebenspunkten Anlage. Wird er zerstört, sind die Pioniere verloren.
- **Abbauen:** Rückruf der Besatzung. Ein Teil der Kosten (50 %) kommt mit zurück.

### 5.4 Patrouille (neue Missionsart)
- Verband aus **Korvetten, Zerstörern, U-Booten** und/oder **Aufklärungsdrohnen**. Dazu **2–4 Wegpunkte** auf See,
  die er im Kreis abfährt.
- **Dauer** 4, 8 oder 12 h, danach Heimfahrt. Treibstoff wie eine normale Fahrt über die ganze Strecke.
- **Sichtweite** um die aktuelle Position, Stufe **Erkennung**: Schiffe **100 km**, Drohnen **200 km**.
  U-Boote sehen nur andere U-Boote (Sonar, siehe 5.7).
- **Drohnen** sind schnell (300 km/h) und brauchen höchstens 800 km Reichweite bis zum fernsten Wegpunkt. Sie fliegen
  höchstens 6 h.
- **Risiko:** Kommt eine Patrouille in die Radarreichweite eines fremden Hafens, kann dieser abfangen:
  - Drohnen werden von **Abfangjägern** angegriffen, sofern der Hafen welche hat. Je Jäger 15 % Abschuss je Drohne,
    höchstens 75 %.
  - Gegen Schiffe gibt es in Stufe 2 keinen automatischen Kampf, nur die Sichtung. Gezielt angreifen lassen sich
    Patrouillen erst mit dem späteren Seekampf-Paket.
- Wer von einer Patrouille erfasst wird, bekommt die Meldung **„Fremde Patrouille gesichtet“**, sofern sie in seiner
  eigenen Sicht liegt.

### 5.5 Aufklärungskampagne (Erweiterung der Mission „Aufklärung“)
- Statt eines Ziels bis zu **4 Ziele** nacheinander (Häfen, Nester, Felder). Jedes Ziel bekommt wie heute ein
  **Lagebild**.
- Unterwegs **Erkennung** in **150 km** um die Route (`scoutRevealKm`, heute nur für Minen).
- Die Vorwarnzeit gilt bei jedem Ziel neu. Wer erkannt wird, bekommt wie heute die Meldung „Aufklärer gesichtet“.

### 5.6 Satelliten (spät)
- Neues Gebäude **Startrampe**: Voraussetzung Kommandozentrale 8, Forschungsamt 5 und Radarstation 6 (erreichbar
  etwa ab Tag 28–35, siehe Abschnitt 11). Kosten der Rampe Stufe 1: 3 000 Stahl, 1 000 Treibstoff, 1 000 Elektronik.
  Neuer Forschungszweig
  **Raumfahrt** mit 2 Techniken:
  - **Optischer Satellit** (Stufe 1): Erkennung, aber nicht durch Wolken. Felder mit Bewölkung über 0,6 bleiben
    verdeckt.
  - **Radarsatellit** (Stufe 2): sieht durch Wolken und Nebel, aber nur Sichtung.
- **Start** je Satellit: optisch 5 000 Stahl, 2 000 Treibstoff, 3 500 Elektronik (≈ 19 100 Stahl-Gegenwert), Radarsatellit
  6 000 Stahl, 2 500 Treibstoff, 4 500 Elektronik (≈ 24 000). Lebensdauer **7 Tage**, höchstens
  **1 Satellit** je Spieler (2 mit Raumfahrt 2).
- **Bahn:** Alle **6 h** ein Überflug über einen Nord-Süd-Streifen von **600 km** Breite. Der Streifen wandert bei jedem
  Überflug um 1 400 km nach Westen weiter. Nach etwa einem Tag ist die ganze Karte einmal erfasst. Jeder Überflug
  dauert **20 Minuten**: So lange ist der Streifen live, danach „bekannt“.
- Der nächste Überflug ist vorher bekannt (Anzeige „nächster Überflug in 2 h 10 min über …“).

### 5.7 U-Boote und Sonar
- U-Boote sind für Radar, Satelliten und Ausguck **unsichtbar**.
- Sehen können sie nur Einheiten mit U-Jagd (`attack.uboot` > 0: Korvette, Zerstörer) auf Patrouille oder im Hafen,
  in **60 km**, mit Forschung **Sonar +40 km je Stufe**.
- U-Boote auf Patrouille sehen andere U-Boote in 60 km.

## 6. Gegenmittel

- **Tarnnetze** (neue Technik im Zweig Heer, 2 Stufen): Optische Satelliten und der Ausguck erkennen den eigenen Hafen
  nur noch als **Sichtung**. Die Stufe 2 wirkt auch auf eigene Felder und Radarposten.
- **Störsender** (neues Hafengebäude, Voraussetzung Radarstation 5): Fremde Radarreichweite (Häfen, Posten,
  Radarsatellit) im Umkreis von **200 km** sinkt um **25 %** je Stufe, höchstens 50 % (Stufe 2). Braucht 10 Strom je
  Stufe. **Nachteil:** Der Störsender selbst ist für fremdes Radar in 600 km als Sichtung erkennbar.
- **Tarnanstrich** (vorhanden): wirkt weiter auf die Vorwarnzeit. Zusätzlich verringert er die Sichtweite fremder
  Sensoren auf eigene Flugzeuge um 20 % je Stufe.
- **Funkdisziplin:** Admirale mit Spezialisierung „Aufklärung“ halbieren die Radar-Sichtweite fremder Sensoren auf
  ihren Verband (heute schon −25 % Vorwarnzeit).

## 7. Auswirkungen auf Planung und Kampf

- **Missionsplanung:** Ziele sind auch ohne Sicht wählbar, die Positionen sind ja bekannt. Ohne Erkennung zeigt die
  Planung **„Lage unbekannt“** statt Stufe und Besatzung. Ohne Erkennung gibt es keinen Probekampf.
- **Nester:** Ohne Sicht ist die Stufe unbekannt. Ein Überfall auf ein unerkanntes Nest ist erlaubt, aber ein Risiko.
- **Feldmissionen:** Die Besatzung eines fremden Felds wird nur mit Erkennung angezeigt (heute „erst aufklären“).
- **Kampfberichte** enthalten wie bisher alles über den Gegner, mit dem man gekämpft hat. Das zählt als Lagebild.
- **Spionage:** unverändert. Die Desinformation wirkt jetzt auch auf Sichtungen: Gemeldete Größenklassen dürfen um
  eine Stufe falsch sein.

## 8. Darstellung

- **Kartennebel:** Felder außerhalb jeder Sicht werden leicht graublau überlagert. Live-Bereiche sind klar; ihre
  Grenzen zeichnet eine gestrichelte Linie je Sensor (Kreis, Satellitenstreifen).
- **Zeichen:** Live-Objekte voll. Bekannte Objekte blasser, mit Zeitstempel im Feld-Blatt („Stand: vor 5 h, Radar
  Hafen X“). Veraltete in Klammern.
- **Verbände:** Fremde Verbände erscheinen als Pfeil mit Größenklasse und Kurs; erkannte mit Besitzerfarbe.
- **Neue Schicht** in der Karte: „Sensoren“ (an/aus) zeigt die Reichweiten aller eigenen Sensoren.
- **Neuer Reiter** „Lagebild“ unter Meldungen: letzte Sichtungen, fremde Patrouillen, nächster Satellitenüberflug.

## 9. Technik (für die Umsetzung)

- **Sicht** wird beim Abruf der Karte berechnet: Liste aktiver Sensoren je Spieler bzw. Allianz (Kreise, Streifen),
  daraus die Live-Menge der Objekte. Das Ergebnis wird **60 s** zwischengespeichert. Keine Rasterberechnung über alle
  5 733 Felder: Es werden nur Objekte gegen Kreise geprüft (Häfen, Nester, Felder, Wracks, Missionen; jeweils
  höchstens einige Hundert).
- **Wissen** speichert eine neue Tabelle `intel_sighting` (Besitzer = Spieler oder Allianz, Objektart, Objekt-ID,
  Stufe, Zeitpunkt, Daten als JSON). Sie wird nur beim Abruf und bei Missionsankünften aktualisiert (Upsert) und
  alle 72 h aufgeräumt.
- Der **Server** liefert der Karte nur, was der Spieler sehen darf. Der Client erhält keine verdeckten Daten.
- **Bots** rufen dieselbe Sicht ab. Der Freibeuter plant Patrouillen und Kampagnen vor Angriffen.

## 10. Stufen der Umsetzung

| Stufe | Inhalt | Ergebnis für Spieler |
|---|---|---|
| **1 Grundgerüst** | Abschnitte 2–4, Ausguck, Radarstation (5.1, 5.2), Allianz-Sicht, Kartennebel, Feld-Blatt mit Stand, Planung „Lage unbekannt“ | Nest-Stufen und fremde Verbände nur noch mit Sicht; Radar wird wichtiger |
| **2 Aufklärung** | Patrouille (5.4), Kampagne (5.5), mobile Radarstation (5.3), U-Boote/Sonar (5.7), Reiter „Lagebild“ | Aktiv aufklären, Posten bauen, Patrouillen abfangen |
| **3 Satelliten** | Startrampe, Raumfahrt, Bahnen mit Wolken (5.6), Tarnnetze und Störsender (6) | Spätspiel-Ziel, Gegenmittel |

Jede Stufe wird ein eigenes Release mit Migration, Tests (auch E2E) und Simulation.

## 11. Entscheidungen (27.11.2026)

1. **Hafenpositionen** bleiben immer sichtbar (Name, Besitzer, Verhältnis).
2. **Nest-Positionen** bleiben immer sichtbar; Stufe und Zustand nur mit Sicht.
3. **Satellit fair bemessen** (Rechnung zum Börsen-Richtwert: Stahl 1, Treibstoff 1,8, Elektronik 3; Produktion nach
   `ENTSCHEIDUNGEN-3.md` L8: Tag 28 ≈ 1 130–1 340/h, Tag 35 ≈ 1 170–1 440/h):
   - Erster Entwurf 6 000 / 3 000 / 8 000 = **35 400** Stahl-Gegenwert ≈ **30 h Produktion** für 7 Tage – zu teuer; dazu
     Kommandozentrale 10 als Voraussetzung, die laut Simulation in 42 Tagen niemand erreicht.
   - Ziel: Ein Satellit soll etwa **2–3 h Produktion je Tag Laufzeit** kosten, also eine Woche Rundumsicht etwa so viel
     wie ein bis zwei gewonnene Überfälle auf ein Nest 6 (Netto +10–18 k je Angriff, Beute 56 600).
   - Ergebnis: optisch **≈ 19 100** (≈ 16 h Produktion an Tag 35 ≈ 2,3 h je Tag), Radarsatellit **≈ 24 000** (≈ 20 h, sieht
     durch Wolken, nur Sichtung). Startrampe ab Kommandozentrale 8 / Forschungsamt 5 / Radarstation 6, also ab etwa Tag
     28–35 für gezielten Ausbau. Vor Stufe 3 per Simulation gegen den Wert des Wissens prüfen (z. B. gewonnene
     Nest-Angriffe mit vs. ohne Lagebild) und gegebenenfalls nachjustieren.
4. **Kartennebel abschaltbar:** Server-Einstellung `intel_fog` (Verwaltung, Vorgabe an). Aus = alle sehen alles wie bis
   0.17; Sensoren und Aufklärung laufen weiter, ihre Daten werden nur nicht mehr gebraucht.
