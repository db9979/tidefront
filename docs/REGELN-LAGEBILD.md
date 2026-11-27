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
- Neues Gebäude **Startrampe**: Voraussetzung Kommandozentrale 7 (v1.24, vorher 8), Forschungsamt 5 und Radarstation 6 (erreichbar
  etwa ab Tag 28–35, siehe Abschnitt 11). Kosten der Rampe Stufe 1: 3 000 Stahl, 1 000 Treibstoff, 1 000 Elektronik.
  Neuer Forschungszweig
  **Raumfahrt** mit 2 Techniken:
  - **Optischer Satellit** (Stufe 1): Erkennung, aber nicht durch Wolken. Felder mit Bewölkung über 0,6 bleiben
    verdeckt.
  - **Radarsatellit** (Stufe 2): sieht durch Wolken und Nebel, aber nur Sichtung.
- **Start** je Satellit: optisch 5 000 Stahl, 2 000 Treibstoff, 3 500 Elektronik (≈ 19 100 Stahl-Gegenwert), Radarsatellit
  5 500 Stahl, 2 200 Treibstoff, 4 000 Elektronik (≈ 21 500; bis v1.23 6 000 / 2 500 / 4 500 ≈ 24 000). Lebensdauer **7 Tage**, höchstens
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

### 5.8 Bordsicht (Entscheidung vom 27.11.2026)
- **Jeder eigene Verband auf See sieht unterwegs** – auf Hin- und Rückfahrt, bei allen Missionsarten (Überfall,
  Transport, Verlegung, Gründung, Feldmissionen, Allianz-Ops, Blockade vor dem Ziel). Sicht um die aktuelle Position;
  maßgeblich ist die beste Einheit im Verband:
  - Kriegsschiffe (Korvette, Zerstörer, Minenräumer) **80 km** Erkennung,
  - Transporter (Landungsschiff, Kolonieschiff, Minenleger) **40 km** Erkennung,
  - Aufklärungsdrohne **200 km** Erkennung,
  - Flugzeuge (Jäger, Bomber) **120 km**, nur Sichtung von Verbänden (Objekte erfassen sie nicht),
  - U-Boote sehen nur andere U-Boote (Sonar, 5.7).
- Live während der Fahrt. Was der Verband überfährt, bleibt als „bekannt“ im Wissen (Quelle „Verband aus …“); gespeichert
  wird sparsam beim Kartenabruf, höchstens alle 60 s je Partei. Die Allianz teilt mit.
- Patrouillen behalten ihre größeren Werte (Schiffe 100 km, Drohnen 200 km) und bleiben das Werkzeug für gezielte
  Aufklärung. Balance-Block `intel.fleetSight`.
- **Karte:** gestrichelter Sichtkreis um eigene Verbände, der mitwandert (am Kartenrahmen beschnitten).

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
| **1 Grundgerüst** ✔ umgesetzt (Balance v1.17) | Abschnitte 2–4, Ausguck, Radarstation (5.1, 5.2), Allianz-Sicht, Kartennebel, Feld-Blatt mit Stand, Planung „Lage unbekannt“ | Nest-Stufen und fremde Verbände nur noch mit Sicht; Radar wird wichtiger |
| **2 Aufklärung** ✔ umgesetzt (Balance v1.20) | Patrouille (5.4), Kampagne (5.5), mobile Radarstation (5.3), U-Boote/Sonar (5.7), Bordsicht (5.8), Reiter „Lagebild“ | Aktiv aufklären, Posten bauen, Patrouillen abfangen |
| **3 Satelliten** ✔ umgesetzt (Balance v1.23) | Startrampe, Raumfahrt, Bahnen mit Wolken (5.6), Tarnnetze und Störsender (6) | Spätspiel-Ziel, Gegenmittel |

Jede Stufe wird ein eigenes Release mit Migration, Tests (auch E2E) und Simulation.

### Stufe 1: Umsetzung und Abweichungen

Umgesetzt in `packages/game-core/src/intel.ts` (Reichweiten, Kenntnisstufen, Alter, Größenklassen),
`packages/engine/src/intel-*.ts` (Sicht je Partei mit 60-s-Zwischenspeicher, Wissen in `intel_sighting`, gefilterte
Kartenansicht, Abfragen für Planung, Felder und KI-Spieler), `apps/web/src/map/intel.ts` (Nebel, Sensorgrenzen,
Verbandspfeile) und Verwaltung → Lagebild (`intel_fog`). Balance-Block `intel` mit den Startwerten aus Abschnitt 4 und 5.

Abweichungen (begründet):
- **Entfernungen in Projektions-Kilometern** (gerader Abstand der Feldmitten wie auf der Karte gezeichnet) statt
  Großkreis: Server und Karte prüfen dieselben Kreise; Nebelgrenze und gestrichelter Kreis stimmen überein. Im hohen
  Norden und Süden weicht das um einige Prozent vom Großkreis ab.
- **Strommangel** ist schwarz-weiß: Ist das Radar nicht voll versorgt, gilt die halbe Reichweite (kein gleitender Wert).
- **Rohstofffelder:** Die Stufe bleibt wie die Art immer sichtbar (feste Weltdaten, nötig für Ertrag und Planung);
  verborgen sind Besitzer, Wache/Besatzung, Einflusszone und Wiederkehr der Wache. Ohne Sicht heißt ein Feld „unbekannt“.
- **Rundung der Erkennung** (auf 5 bzw. 2) ist als Regel vorhanden, wird in Stufe 1 aber nicht gebraucht: Erkennung zeigt
  hier nur Stufe, Zustand, Schutz und Besitzer; Einheiten zeigt weiter nur das Lagebild (Aufklärung, Kampfbericht).
- **Lagebild aus Berichten:** Aufklärung und Kampfberichte (auch Feld- und Seeberichte) schreiben das Ziel als Lagebild
  für die Partei des Absenders. Spionage-Dossiers und das Wissen des Verteidigers über den Angreifer folgen mit Stufe 2.
- **Wissen** liegt je Partei (`p:<Spieler>`, `a:<Allianz>`); gelesen wird die Allianz und alle Mitglieder, so bleibt
  Wissen von vor dem Beitritt erhalten. Gespeichert wird beim Kartenabruf höchstens alle 60 s je Partei und bei
  Missionsankünften; der Worker löscht nach 72 h, das Saisonende leert die Tabelle.
- **Kartell-Verbände** haben keinen Ausgangshafen; ihr Kurs wird vom nächsten Nest zum Ziel gerechnet.
- **Planung:** Ein unbekanntes, verlassenes Nest wird nicht mehr als „verlassen“ abgelehnt (Ankunft: Bericht „verlassen“).
  Der Schutzstatus wird beim Auslaufen weiter geprüft (Regel des Schutzes), die Ablehnung verrät ihn also wie bisher.
  Sammelangriffe der Allianz prüfen Nester noch ohne Sicht.
- **Fremde Blockaden** (weder eigene noch gegen die eigene Allianz) erscheinen nur in Sicht.
- **Nebel aus:** Alles wie bis 0.17, also auch keine fremden Verbände auf der Karte (die gab es vorher nicht).
- **Schicht „Sensoren“** ist ein Knopf an der Karte (gestrichelte Reichweiten an/aus); der Nebel bleibt immer an.
- **KI-Spieler** nutzen dieselbe Kartenansicht. Nur der Freibeuter klärt unbekannte Nester und Felder mit der Mission
  „Aufklärung“ auf; Händler und Festung greifen nur an, was sie sehen oder kennen. Im 8-Tage-Testlauf nimmt die Festung
  deshalb kaum noch Nester und Felder (siehe Bericht zur Version).

### Stufe 2: Umsetzung und Abweichungen

Umgesetzt in `packages/game-core/src/intel-ops.ts` (Patrouille, Runde, Sicht, Sonar, Abfangen, Posten, Kampagne,
Desinformation, Bordsicht), `packages/engine/src/intel-patrol.ts`, `intel-campaign.ts`, `intel-post*.ts`,
`intel-mobile.ts` (bewegte Sensoren), `intel-route.ts` (Positionen), `intel-ops.ts` (Befehle, Ereignisse, Eingriff in die
Ankunft), `intel-overview.ts` (Reiter „Lagebild“), neue Tabelle `radar_post` (Migration erzeugt der Integrator).
Oberfläche: Missionsplanung „Patrouille“, „Kampagne“, „Radarposten“, „Posten angreifen“ (Karte antippen), Feld-Blatt
(„Patrouille ab hier“, „Radarposten errichten“, „Posten angreifen“), Meldungen → Lagebild, Truppen → Einsatz
(„Heimholen“), Karte (Posten, Wegpunkte, wandernde Sichtkreise, Sonar grün). Balance-Block `intel` v1.20 mit `patrol`,
`campaign`, `post`, `sonar`, `fleetSight`.

Abweichungen (begründet):
- **Drohnen 6 h:** gilt für die Zeit auf Station; mit Drohnen ist deshalb nur die Dauer 4 h wählbar. Die Reichweite
  800 km gilt bis zum fernsten Wegpunkt; die Runde selbst ist nicht begrenzt.
- **Treibstoff der Patrouille:** Hin- und Rückweg zum ersten Wegpunkt plus Fahrt mit voller Geschwindigkeit über die
  ganze Dauer. Die Heimfahrt beginnt an der Position beim Ende (Rückfahrzeit von dort), Treibstoff wird nicht erstattet.
- **Abfangen:** einmal je Hafen und Patrouille (Prüftakt 30 min, `tickMinutes`), nur durch Häfen, mit denen kein Bündnis
  oder Pakt besteht; Radarreichweite des Hafens wie in 5.2. Sind alle Einheiten abgeschossen, endet die Mission.
- **„Fremde Patrouille gesichtet“:** Bericht (Art „sichtung“) und Push, einmal je Spieler und Patrouille, wenn die
  Patrouille seinen Hafen sieht und selbst im Ausguck oder Radar dieses Hafens liegt. Felder und Posten lösen keine
  Meldung aus. Ebenso „Aufklärer gesichtet“ (5.5): bei Ankunft jeder Aufklärung an einem fremden Hafen mit Radar.
- **Kampagne:** Planung prüft jedes Ziel (Luft: jedes in Reichweite); Treibstoff für die ganze Runde. Die
  Erkennung um die Route gilt für jede Aufklärung auf der Hinfahrt (auch mit einem Ziel). Ein Rückruf auf einem
  späteren Abschnitt rechnet die Heimfahrt ab der ersten Abfahrt (einfach, eher zu lang).
- **Radarposten:** Standort freie Küste (kein Hafen, Nest, Handelshafen, Posten) oder eigenes Rohstofffeld. Kosten beim
  Auslaufen; scheitert die Errichtung bei Ankunft, kommen sie mit zurück. Betrieb stündlich (Ereignis
  `radar_post_tick`); aus nur, wenn der Hafen nach der laufenden Produktion keine 3 Treibstoff hat. Die Anlage
  (20 Lebenspunkte) fällt mit der Besatzung: Der Angreifer gewinnt, wenn er Truppen landet und die Pioniere schlägt.
  Keine Radar-Vorwarnung für Angriffe auf Posten. Abbau: 50 % der Kosten als Ladung der heimkehrenden Besatzung.
  Tarnnetze Stufe 2 (6) folgen mit Stufe 3 (umgesetzt).
- **Sonar** unterwegs gilt auch für Verbände ohne Patrouille (Bordsicht); Sonar erfasst nur U-Boote, keine Objekte.
- **Bordsicht** der Flugzeuge: nur Verbände (Sichtung); Objekte sichtet ein Flug nicht, ihre Positionen sind ohnehin
  bekannt. Stationierte Feldbesatzungen sehen nichts zusätzlich (sie liegen fest).
- **Zwischenspeicher:** Hafensensoren weiter 60 s; bewegte Sensoren (Verbände, Patrouillen, Posten) werden bei jedem
  Abruf neu gelesen (zwei kleine Abfragen), damit Position und neue Missionen sofort stimmen.
- **Spionage-Dossiers** (Erkunden) schreiben ein Lagebild des Hafens; nach jedem Kampf kennt der Verteidiger den
  Ausgangshafen des Angreifers als Lagebild. **Desinformation** (7): Hat der Ausgangshafen eines Verbands eine
  Desinformation gegen die Partei hinterlegt, ist die gemeldete Größenklasse eine Stufe daneben (fest je Verband).
  **Sammelangriffe** lehnen ein leeres Nest nur noch ab, wenn der Spieler es kennt (sonst Bericht „verlassen“).
- **Reiter „Lagebild“:** letzte Sichtungen (live und gespeichert), fremde Patrouillen und Aufklärer (gemeldet und
  gesichtet), eigene Sensoren je Art mit größter Reichweite, eigene Radarposten mit Abbauen. Der nächste
  Satellitenüberflug folgt mit Stufe 3 (umgesetzt, siehe unten).
- **KI-Spieler:** Festung klärt Nester mit Kampagnen auf (alle 6 h, Felder alle 12 h), Händler einmal am Tag Felder,
  Freibeuter laufend Kampagnen und alle 12 h eine Patrouille vor seinen Angriffen (siehe ENTSCHEIDUNGEN-3.md, O).

### Stufe 3: Umsetzung und Abweichungen

Umgesetzt in `packages/game-core/src/intel-sat.ts` (Bahn, Überflug, Streifen, Start-Prüfungen, Kosten der Rampe,
Gegenmittel), `packages/game-core/src/intel.ts` (Streifen-Sensoren und Gegenmittel in `liveLevelAt`),
`packages/engine/src/intel-sat.ts` (Start, Sensoren und Anzeige), `intel-sat-pass.ts` (Ereignisse `satellite_pass`,
`satellite_end`), `intel-counter.ts` (Tarnnetze, Störsender, Tarnanstrich, Funkdisziplin weltweit je cacheSeconds),
`mail-report-sat.ts` (E-Mails). Oberfläche: Startrampe und Störsender als Gebäude (Gruppe „Aufklärung“, bewegte
Zeichnungen), Forschungszweig Raumfahrt, Meldungen → Lagebild „Satelliten“ (Start, nächster Überflug), Karte
(Streifen gestrichelt, nächster Überflug mit Uhrzeit, Blitz am erkannten fremden Störsender), Berichte, Handbuch,
Legende, „Was hilft?“. Balance v1.23: Gebäude `startrampe`, `stoersender`, Techniken `optischer_satellit`,
`radarsatellit` (Zweig `raumfahrt`), `tarnnetze` (Heer), Blöcke `intel.satellite` und `intel.counter`. Keine neue
Tabelle: Satelliten liegen im Zustand des Hafens mit der Startrampe (`state.satellites`). Simulation und Preise:
`packages/game-core/ENTSCHEIDUNGEN-3.md`, Abschnitt Q.

Abweichungen (begründet):
- **Abdeckung:** Mit 600 km Breite, 6 h Takt und 1 400 km Wanderung sind nach einem Tag ~26 % der Karte erfasst, nach
  5 Tagen ~97 % (Kartenbreite 9 190 km). Die Zahlen aus 5.6 bleiben, nur die Schätzung „nach etwa einem Tag“ stimmt
  nicht. Der erste Überflug kommt 6 h nach dem Start über dem Starthafen; 27 Überflüge je Satellit. Der Streifen ist
  ein senkrechter Streifen in Projektions-km (wie Kreise und Karte) und endet am Kartenrand (kein Umlauf um die Erde).
- **Überflug schreibt Wissen:** Zu Beginn jedes Überflugs speichert der Server alles im Streifen als Wissen der Partei
  (Quelle „Optischer Satellit (Überflug k)“), auch wenn niemand die Karte öffnet; 20 min lang ist der Streifen live.
  Wolken zum Beginn des Überflugs (echtes Wettermodell, Bewölkung > 0,6) verdecken ein Feld für die ganze Zeit.
- **Radarsatellit nur Sichtung:** Er schreibt Verbände, Wracks und Radarposten ins Wissen, aber keine Häfen, Nester und
  Felder (deren Position ist ohnehin bekannt; eine Sichtung soll kein älteres Erkennen überschreiben). Auf der Karte
  hebt er den Nebel im Streifen, zeigt aber keine Nest-Stufen oder Schutzstatus. Allgemein: Sichtung (auch durch
  Tarnnetze) zeigt bei Häfen und Nestern nicht mehr als die Position.
- **Höchstzahl:** 1 Satellit je Spieler, mit erforschtem Radarsatelliten („Raumfahrt 2“) 2 – über alle Häfen; der
  Radarsatellit setzt den optischen voraus. Kein vorzeitiger Abbruch; nach 7 Tagen verglüht er mit Abschlussbericht.
  Eine Überflug-Zusammenfassung gibt es nicht als Bericht je Überflug (27 je Woche wären zu viele), sondern im Lagebild
  („Zuletzt: 2 Nester, 0 Häfen, 0 Verbände, 5 unter Wolken“) und im Abschlussbericht.
- **Startrampe:** Stufe 1 genügt für Starts; jede weitere Stufe senkt die Startkosten um 10 % (höchstens 30 %, also ab Stufe 4; bis v1.23 4 % / 20 %). Keine
  Stromaufnahme (im Regelwerk nicht vorgesehen).
- **Störsender:** wirkt auf Punkte im Umkreis von 200 km (nicht auf Sensoren in der Nähe): Fremde Radarstationen und
  Posten erfassen dort nur bis Reichweite × (1 − Minderung); mehrere Störsender zusammen höchstens 50 %. Beim
  Radarsatelliten wird der Streifen im Störbereich um seine Mitte entsprechend schmaler. Bei Strommangel (Radar-Rang
  nicht voll versorgt) ist er aus. Erkennbar ist er für fremdes Radar (Hafen, Posten) in 600 km oder im live
  Radarsatelliten-Streifen: Blitz am Hafen, kein Eintrag ins Wissen. Ab Stufe 2 ist die Wirkung voll; höhere Stufen
  kosten nur Strom.
- **Tarnnetze:** wirken auf Ausguck und optischen Satelliten (und damit auch auf das, was diese ins Wissen schreiben);
  Radar, Patrouillen, Aufklärer, Bordsicht und Aufklärungsmissionen sehen weiter alles. Stufe 2: auch eigene Felder
  und Radarposten (Posten bleiben als Sichtung sichtbar).
- **Tarnanstrich auf Flugzeuge:** gilt für Verbände, die nur aus Flugzeugen bestehen (mit Schiffen sieht man den Verband
  ohnehin); −20 % je Stufe auf alle fremden Sensoren, mindestens 20 % Restweite.
- **Funkdisziplin:** Admiral mit Spezialisierung Aufklärung (erste oder zweite) halbiert fremdes Radar – Häfen, Posten
  und Radarsatellit (Streifen schmaler) – auf seinen Verband, solange er die Mission führt.
- **KI-Spieler:** Freibeuter und Festung bauen die Rampe, forschen Raumfahrt und starten einen Satelliten, wenn
  mindestens 4 Nester in 1 500 km ohne Lagebild sind und danach noch einmal die Startkosten im Lager bleiben; die
  Festung baut den Störsender (bis Stufe 2) und forscht Tarnnetze.

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
