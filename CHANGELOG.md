# Was ist neu?

Änderungen an TIDEFRONT, neueste zuerst. Die Version steht im Handbuch unten und auf dem Anmeldebildschirm.

## 0.21.0 – 27.11.2026
- **Lagebild Stufe 2 – Patrouille:** Schiffe oder Drohnen fahren 2–4 Wegpunkte auf See ab (4/8/12 h); Schiffe sehen 100 km, Drohnen 200 km. Abfangjäger fremder Häfen schießen Drohnen ab. Wer erfasst wird, erhält „Fremde Patrouille gesichtet“.
- **Aufklärungskampagne:** bis zu 4 Ziele in einer Fahrt, je Ziel ein Lagebild, Erkennung 150 km um die Route; das Ziel erfährt „Aufklärer gesichtet“.
- **Radarposten:** 5 Pioniere und ein Landungsschiff errichten auf einer Küste oder einem eigenen Feld einen Posten (250 km Sicht, 3 Treibstoff je Stunde); er ist angreifbar, Abbau gibt 50 % zurück.
- **Bordsicht:** Jeder eigene Verband auf See sieht unterwegs (Kriegsschiffe 80 km, Transporter 40, Drohnen 200, Flugzeuge 120 nur Sichtung); der Sichtkreis wandert auf der Karte mit.
- **U-Boote** sind nur mit Sonar sichtbar (U-Jagd im Hafen und unterwegs, 60 km plus 40 km je Sonar-Stufe).
- **Neuer Reiter Meldungen → Lagebild:** letzte Sichtungen, fremde Patrouillen, eigene Sensoren und Radarposten.
- Spionage-Dossiers und Kampfberichte (auch für den Verteidiger) zählen als Lagebild; Desinformation verfälscht Größenklassen; Sammelangriffe verraten leere Nester nicht mehr. KI-Spieler klären auf – die Festung findet und überfällt wieder Nester.
- **E-Mails ausführlich:** Kampfberichte mit Ergebnis-Banner, Kurzfazit, Kennzahlen, beiden Verbänden (Start, Verlust, Übrig), Beute, Wetter, Admiralen und Veteranenrängen; Aufklärung und Spionage mit Lagebild bzw. Dossier; Angriffswarnung mit Ankunft, Größe, Lage und empfohlenen Schritten. Aussagekräftige Betreffzeilen, gebündelte Meldungen und Morgenbericht mit Kacheln und Tabellen, Dunkelmodus, „Im Spiel öffnen“ führt direkt zum Bericht.
- Balance v1.22.

## 0.20.1 – 27.11.2026
- **Versorgung bewegt sich:** Die Quellen Kraftwerk, Wind, Sonne, Speicher (und Seekabel) zeigen die bewegten Gebäudebilder – Dampf, Windräder nach echtem Wind, Glanz bei Sonne, Füllstand.
- **Wetter-Symbole** in der Vorhersage und im Wetterkärtchen der Karte bewegen sich leise: Sonne dreht, Wolken und Nebel ziehen, Mond glimmt, Wind weht, Sturm rüttelt. Bei „Bewegung reduzieren“ bleibt alles still.

## 0.20.0 – 27.11.2026
- **Elektrolyse** (neues Gebäude): wandelt Überschuss aus Wind und Sonne in Treibstoff (10 Strom-Stunden → 1 Treibstoff); Kraftwerksstrom nie. Gasblasen steigen, solange sie arbeitet.
- **Seekabel** (neues Gebäude): Ökostrom-Überschuss an einen eigenen Hafen oder ein Allianzmitglied abgeben – bis 600 km, 10 % Verlust je 100 km, Preis frei oder als Allianzhilfe, Abrechnung alle 10 Minuten. Kriegsgegner können die Station sabotieren. Verwaltung in der Versorgung: anbieten, annehmen, Preis ändern, trennen.
- **Grüner Hafen:** ab 60 % Ökostrom in 24 Stunden +3 % Produktion (Quelle „Ökostrom“ im Info-Blatt). Neuer Erfolg „Grüner Hafen“, Wochenziel „Ökostrom“, Saisonauszeichnung „Grünster Hafen“ in der Ruhmeshalle.
- **Stromkurve** zeigt, wohin der Überschuss geht (→ Treibstoff, → Partner, verfällt), dazu den Ökostrom-Anteil.
- KI-Händler bauen Wind, Sonne und Elektrolyse.
- **Behoben:** Außenposten verloren bei jeder Abrechnung ihre Kolonie-Markierung; Gebäude, die nur im Heimathafen erlaubt sind, waren dort deshalb nicht gesperrt.
- Handbuch „Wetter und Strom“ erweitert, Regeln in docs/REGELN-STROM.md. Balance v1.21.

## 0.19.2 – 27.11.2026
- **Bewegte Gebäude**, dezent und nach Spielzustand: Windräder drehen mit dem Wind am Hafen (Flaute oder Sturmabschaltung: still), Rauch steigt und die Fackel flackert nur bei laufender Produktion (bei Strommangel stockend), die Radarschüssel dreht sich, der Leuchtturm blinkt nachts, Chipfabrik-LEDs blinken, das Solarfeld glänzt bei Sonne, das Speicherwerk zeigt seinen Füllstand. Werft, Kaserne und Flugfeld bewegen sich, solange ausgebildet wird; bei laufendem Ausbau steht ein kleiner Baukran am Gebäude.
- Animationen pausieren außerhalb des Bildschirms und im Hintergrund; bei „Bewegung reduzieren“ (iPhone-Einstellung) bleibt alles still.
- **Stromfeld in der Kopfleiste:** Strombilanz (grün/rot), Speicherstand und Warnpunkt bei drohendem Mangel; Antippen öffnet die Versorgung.

## 0.19.1 – 27.11.2026
- **Hinweis-Karten statt Textzeile:** Sperrgründe erscheinen als Karte mit Kurzfassung im Kopf (z. B. „Fehlt 48 Elektronik · ca. 9 h 36 min“ oder „1 von 1 belegt“). Aufgeklappt zeigt sie fehlende Mengen als Fortschrittszeile (Bestand / Bedarf mit Wartezeit), eine kurze Erklärung und die Sprungziele als Kacheln mit Symbol. Gilt überall, wo es „Was hilft“ gibt.
- Ist die Börse noch gesperrt, führt der Hinweis zur Hafenkommandantur statt zur Börse.

## 0.19.0 – 27.11.2026
- **Lagebild (Stufe 1):** Fremde Nest-Stufen, Schutzstatus, Wracks, Feldbesitzer und Verbände auf See sieht man nur noch mit Sicht. Hafen- und Nestpositionen bleiben immer sichtbar.
- **Sensoren:** Ausguck an jedem Hafen (120 km). Die Radarstation sieht 150 km plus 40 km je Stufe; Strommangel halbiert die Reichweite, Nebel kürzt sie bis 30 %, Sabotage schaltet sie ab. U-Boote bleiben unsichtbar. Die Allianz teilt Sicht und Wissen.
- **Wissen hat ein Alter:** bekannt (unter 24 h, blasser, „Stand: vor X h (Quelle)“), veraltet (bis 72 h, in Klammern), danach vergessen. Aufklärung und Kampfberichte liefern ein Lagebild.
- **Karte:** Kartennebel als graublaue Überlagerung, gestrichelte Sensorgrenzen (neuer Knopf „Sensoren“), unbekannte Nester als „?“, fremde Verbände als Pfeil mit Größenklasse und Kurs.
- **Planung:** Ohne Erkennung „Lage unbekannt“ und kein Probekampf; unbekannte Nester dürfen trotzdem angegriffen werden.
- **Verwaltung → Lagebild:** Kartennebel an oder aus (Vorgabe an). KI-Spieler sehen genau so viel wie Menschen; der Freibeuter klärt vor Angriffen auf.
- **Truppen → Einsatz neu gestaltet:** Kopf „Flotte daheim“ (See/Land/Luft, Kommandopunkte als Balken, Missionsplätze als Punkte), **„Lohnende Ziele“** mit den nächsten Nestern samt Stufe, Entfernung, Fahrzeit und Siegchance – „Angreifen“ öffnet die Planung mit Ziel und vorgeschlagenem Verband, „Aufklären“ mit Drohne oder schnellem Schiff. Laufende Missionen als Karten mit Phase, Fortschritt und Restzeit; ohne Mission eine Zeichnung des ruhigen Hafens. Admirale, Rohstofffelder, Vorlagen und Kampfsimulator als Kacheln.
- Neues Handbuch-Kapitel „Lagebild“, Legende ergänzt. Balance v1.19.

## 0.18.1 – 27.11.2026
- **„Zurück“** ist überall ein schmaler Knopf mit Pfeil („‹ Zurück“), der nicht mehr mitten im Wort umbricht (Forschung, Einstellungen, Verwaltung, Handbuch, Berichte).
- **Silbentrennung:** Lange Wörter werden deutsch getrennt statt ohne Trennstrich mitten in der Silbe umbrochen; Technik-, Gebäude- und Einheitennamen trennen an der Wortfuge („Schiffs-panzerung“, „Torpedoleit-systeme“).

## 0.18.0 – 27.11.2026
- **„Was hilft?“** unter Sperr- und Fehlermeldungen in allen Bereichen: Ein Tipp zeigt, was fehlt und wie viel – mit Zahlen aus deinem Hafen (welches Gebäude auf welche Stufe muss, Fehlmengen mit Wartezeit, Treibstoff, Kommandopunkte, Reichweite, nächste Rückkehr einer Mission).
- **Sprungknöpfe** führen direkt dorthin: zum Gebäude-Blatt, zur Börse mit vorgewählter Ressource, zur Forschung, zu Truppen → Einsatz/Ausbilden, zur Karte oder zur Allianz.
- **Graue Knöpfe** wie „Auslaufen“, „Ausbau“, „Forschen“, „Bauen“ oder die Börsen-Order zeigen beim Antippen, was sie freigibt, statt nichts zu tun.
- Truppen → Einsatz weist darauf hin, wenn alle Missionsplätze belegt sind; auch die Admiralsplätze haben „Was hilft?“.
- Handbuch: neuer Absatz „Was hilft?“ im Kapitel „Planen ohne Rätselraten“. Kleinigkeit: „1 Missionsplatz“ statt „1 Missionsplätze“.

## 0.17.4 – 27.11.2026
- **Wettervorhersage mit Unsicherheit:** Je weiter eine Vorhersage vorausschaut, desto ungenauer ist sie – Wind bis ±5 % je 3 Stunden (höchstens ±30 %), Bewölkung und Nebel entsprechend, Wettersysteme bis zu 3 Stunden früher oder später. Alle 3 Stunden wird die Vorhersage neu ausgegeben. Das tatsächliche Wetter ändert sich nicht und gilt für Reise, Kampf und Strom.
- Die **Stromkurve** zeigt ein Band als Spannbreite („reicht voraussichtlich“), die Wettervorhersage am Hafen Wind von–bis, Sturm „ab etwa … (±x h)“ und neu „Sturm möglich“. Die **Missionsplanung** zeigt die Vorhersage am Ziel mit Spannbreite.
- **Funkmesstechnik** macht die Vorhersage um 15 % je Stufe genauer, eine **Radarstation** um weitere 10 % (Balance v1.18).
- **Basis:** Unter dem Bauhof steht jetzt, was die grüne Raute an Gebäuden bedeutet: Ausbau jetzt möglich.

## 0.17.3 – 27.11.2026
- **Einheitliche Knöpfe:** Nebenaktionen wie „Kampfsimulator öffnen“, „Alle zeigen“, „Ändern“, „Mehr“, „Einteilen“ und „Räumen“ sind jetzt umrandete Knöpfe im Stil der übrigen statt unterstrichener Textlinks. Unterstrichen bleiben nur Verweise im Text (z. B. ein Feld auf der Karte zeigen).

## 0.17.2 – 27.11.2026
- **Karte:** Suezkanal sowie Bosporus, Marmarameer und Dardanellen sind eingezeichnet; das Rote Meer läuft nach Süden über den Kartenrand weiter. Schwarzes und Rotes Meer wirken damit nicht mehr wie Binnenseen. (Fahrten rechnen wie bisher mit der direkten Entfernung – alle Nester waren und sind erreichbar.)

## 0.17.1 – 27.11.2026
- **Karte:** Sauberer Kartenrand mit Rahmen wie auf einer Seekarte. Wetter (Fronten, Tiefs, Wolken), Gradnetz und Gelände enden am Rand, statt beim Schieben über den Rand ins Leere weiterzulaufen; Breiten- und Längenangaben erscheinen nur noch innerhalb der Karte.

## 0.17.0 – 27.11.2026
- **KI-Spieler:** Drei Mitspieler mit eigener Spielweise – **Händler** (leicht: Wirtschaft, Börse, Spielerhandel), **Festung** (mittel: Verteidigung, Forschung, Nester) und **Freibeuter** (stark: Überfälle mit Aufklärung und Probekampf, Minen, frühe Kolonien). Sie spielen nach denselben Regeln wie alle, haben Ruhezeiten mit Nachtschild und besetzen auch Rohstofffelder. In Rangliste und Spielerübersicht tragen sie das Zeichen **KI**. Ob ein KI-Spieler Menschen angreifen darf, stellt die Verwaltung je Bot ein (zu Beginn: nein); dann gelten alle Schutzregeln und 12 Stunden Pause je Spieler.
- **Saison 6 statt 4 Wochen.** Die laufende Saison endet am 7. Januar.
- **Inselfestungen (Nest Stufe VI)** auf Bermuda, den Azoren, Jan Mayen, Mallorca und Rhodos: das Ziel für die letzten Saisonwochen, etwa ab Woche 5 mit einem vollen Verband zu schlagen. Größte Beute im Spiel mit viel Elektronik – genug Landungsschiffe mitnehmen. Nach einem Sieg 24 Stunden verlassen.
- **Dritter Hafen** schon ab Kommandozentrale 8 (bisher 9).
- **Kartell:** Eine Flotte daheim lockt keine stärkeren Überfälle mehr an – Kriegsschiffe zählen nur halb, Landungs-, Kolonieschiffe und Minenleger gar nicht. Die Miliz greift die Bunkerlinie so hart an wie Truppen: Sie bleibt starker Schutz, hält aber nicht mehr jeden Überfall auf. Dasselbe gilt für die Großflotte.
- **Rohstofffelder:** Die Geleitabteilung verteidigt das Feld gegen angekündigte Kartellangriffe mit. Fahren mehrere Ertragskonvois zugleich, teilt sich das Geleit nach Warenwert auf.
- **Admirale** führen jetzt auch Feldmissionen und Verbände gegen Weltereignisse. Nach einer Einnahme bleibt der Admiral bei der Besatzung; **„Admiral abziehen“** schickt ihn allein heim, die Besatzung hält das Feld.
- **Minen** wirken auch auf der Rückfahrt. Handelskonvois verlieren in feindlichen Minenfeldern Ladung – Minenräumer im Geleit schützen sie (Börsenlieferungen bleiben ausgenommen).
- **Spielerhandel:** Wer ein Angebot einstellt, kann Geleit für seine Ware eintragen.
- **Karte:** Die Knöpfe sitzen als schmale Leiste am rechten Rand, das Wetter am Hafen ist ein kleines Kärtchen (antippen für Details), die Legende ein „i“ unten links. Die Karte lässt sich ein Stück über den Rand schieben, damit auch Randfelder frei antippbar sind. Wetterkarte mit Kalt-, Warmfronten und Okklusionen.
- **Basis:** „Hafen verwalten“ ist ein Zahnrad oben rechts neben dem Hafennamen.
- **Tagesbefehle:** neu „Windpark oder Solarfeld ausbauen“ und „Strom aus Wind und Sonne“. Befehle wie Vorrat, Produktion oder Ökostrom zählen jetzt auch, wenn man nicht nachsieht.
- **Behoben:** Ein Heimathafen ließ sich direkt auf einen Handelshafen legen (Börsenlieferungen kamen dann sofort an).
- **Verwaltung:** KI-Spieler anlegen, pausieren und entfernen; Regler **Kartell-Stärke** (25–300 %); Statistik mit Veteranen.

## 0.16.0 – 27.11.2026
- **Hafen verwalten** (Link oben auf der Basis): Häfen **umbenennen** und eine Kolonie **aufgeben**. Aufgeben geht nur, wenn dort nichts mehr unterwegs ist; was im Hafen liegt, verfällt. Wertvolles also vorher verlegen.
- Neue Kolonien heißen nach dem **nächstgelegenen Küstenort** („Küste bei Bergen“) statt „<Name> II“.
- **Belagerung brechen:** Den Ring um einen eigenen Außenposten kannst du jetzt aus einem anderen eigenen Hafen heraus angreifen.
- **Eingehend:** Eigene Verlegungen und Transporte zu einem Hafen erscheinen dort unter Truppen → Einsatz und in der Zeitleiste – nicht mehr als Angriffswarnung.
- **Spielerhandel** ist freigeschaltet, sobald irgendeiner deiner Häfen Hafenkommandantur 3 hat (wie die Börse).
- **Rohstofffelder:** **Geleitschutz** – Schiffe der Besatzung begleiten die Ertragskonvois und kämpfen bei Abfangversuchen mit. **Verstärken** – weitere Schiffe zu einem eigenen Feld schicken, ohne die Besatzung zurückzurufen. **Radar-Vorwarnung**, wenn ein anderer Spieler dein Feld angreift.
- **Neue Wochenziele:** Erträge von Feldern einfahren und einen neuen Hafen gründen.
- **Karte:** Windfahnen in der Übersicht stehen nur noch über See.
- **Schneller laden:** Der Startcode ist weniger als halb so groß; Anmeldung, Hafenwahl und „Was ist neu?“ werden erst bei Bedarf geladen.

## 0.15.2 – 27.11.2026
- **Schiebeleisten** (Reiter in Meldungen, Truppen, Allianz, Rangliste, Berichtfilter, Handbuch-Kapitel): Ein Pfeil links oder rechts zeigt, dass es weitere Einträge gibt – antippen schiebt weiter. Die Leisten wackeln nicht mehr nach oben und unten.
- Verwaltung: **Sicherungen lassen sich löschen** (mit Rückfrage; der Sicherungsdienst löscht die Datei innerhalb einer Minute). Die Knöpfe bei den E-Mail-Einstellungen bleiben auf dem iPhone einzeilig.

## 0.15.1 – 27.11.2026
- **Weitere Häfen früher:** Den zweiten Hafen gibt es jetzt ab Kommandozentrale 5 (bisher 8), den dritten ab Stufe 9 (bisher 14). Für das Kolonieschiff braucht es weiterhin Werft 6 und Hafenkommandantur 6.

## 0.15.0 – 27.11.2026
- **Mehrere Häfen** (Welle 3, Teil 2): Gründe bis zu zwei Außenposten zusätzlich zu deinem Heimathafen – den zweiten ab Kommandozentrale 8, den dritten ab 14.
- **Kolonieschiff** aus der Werft (ab Stufe 6, Hafenkommandantur 6): Es fährt zu einem freien Küstenfeld (höchstens 900 km vom Heimathafen, mit Abstand zu anderen Häfen) und wird dort zum neuen Hafen – mit Grundbeständen und der mitgebrachten Ladung. Wer zuerst ankommt, bekommt das Feld.
- Neue Häfen übernehmen den Anfängerschutz des Heimathafens und haben 24 Stunden Gründungsschutz; das Kartell greift frühestens nach 48 Stunden an.
- **Hafenwahl** oben in der Kopfleiste: Alle Seiten zeigen den gewählten Hafen – Gebäude, Truppen, Börse, Missionen. Auf der Karte hat der aktive Hafen einen Doppelring; freie Küstenfelder bieten „Außenposten gründen“, eigene Häfen „Hierhin wechseln“, „Transport“ und „Verlegen“.
- **Verlegen**: Truppen, Ladung und Admirale dauerhaft in einen anderen eigenen Hafen bringen. Transporte und Stationierung in eigene Häfen sind erlaubt.
- Spielerweit: Kredite, Forschung (läuft im Heimathafen, wirkt überall), Erfolge, Tages- und Wochenziele, Rangliste (Summe aller Häfen), Nachtschild. Je Hafen: Ressourcen, Gebäude, Truppen, Strom, Blockade, Belagerung, Kartell-Angriffe, Hafenkommandant.
- Neuer Erfolg „Kolonist“, Handbuch-Kapitel „Mehrere Häfen“.

## 0.14.1 – 27.11.2026
- Vorbereitung für mehrere Häfen je Spieler (Heimathafen, Besitzprüfung je Hafen). Für dich ändert sich noch nichts.

## 0.14.0 – 27.11.2026
- **Rohstofffelder einnehmen** (Welle 3, Teil 1): Auf See liegen Ölfelder (Treibstoff), Erzbuchten (Stahl), Fischgründe (Proviant) und Elektronik-Wracks – in drei Größen, bevorzugt zwischen den Häfen. Neutrale Felder bewacht das Kartell.
- **Besetzen**: Aufklären, mit bewaffneten Schiffen besetzen, die Wache schlagen. Eine Besatzung bleibt vor Ort (belegt einen Missionsplatz, kostet Proviant) und verteidigt das Feld. Alle 4 Stunden fährt der Ertrag als Konvoi zum Hafen – Kriegsgegner und Kartell können ihn abfangen, eine Blockade hält ihn zurück.
- **Umkämpft**: Das Kartell greift besetzte Felder gelegentlich an (mit Vorwarnung), andere Spieler können sie erobern (gleiche Schutzregeln wie beim Überfall). Eine Mindestbesatzung hält auf großen Feldern nicht lange – stärkere Besatzungen schon.
- **Grenzen**: 1 Feld je 4 Stufen Hafenkommandantur (höchstens 5), jedes weitere bringt weniger (100/85/70/55/45 %).
- **Allianz-Einflusszone**: Ab drei benachbarten Feldern einer Allianz +10 % Ertrag; Felder bringen Punkte in der Allianzwertung.
- Neue Liste „Meine Felder“ (Truppen → Einsatz), Kartensymbole und Legende, Handbuch-Kapitel und der Erfolg „Landnahme“.

## 0.13.0 – 27.11.2026
- **Weniger Scrollen** (nach Messung durch einen Game-Designer): Die Seiten sind deutlich kürzer – Basis von 6 auf unter 3 Bildschirmhöhen, Truppen je Bereich etwa 1–2 statt bis zu 5,5, Börse von 3,6 auf unter 2.
- Jeder Reiter merkt sich, wie weit du gescrollt hast; Missionsplanung, Handbuch und Forschung öffnen oben.
- **Basis „Hafen zuerst“**: Bauhof und Gebäude stehen oben. Auftragsbuch, Tagesbefehle und Wochenziele sind eine kompakte Leiste „Aufträge“ mit Zähler, was abholbereit ist – antippen öffnet die Details. Versorgung und Schutz sind einklappbar.
- **Truppen** mit Umschalter „Einsatz · Ausbilden · Abwehr“; jede Einheit ist eine Zeile, Werte und Kosten im Infoblatt (ⓘ). Forschung als Knopf oben.
- **Feste Aktionsleiste** über der Navigation: „Auslaufen“, Kaufen/Verkaufen und „Angebot einstellen“ sind immer erreichbar.
- **Börse** mit Unterreitern „Handel · Spieler · Nachrichten“; Tipp auf eine Ware holt die Order ins Bild, der Kursverlauf ist einklappbar.
- Karte: Das Infofeld nimmt höchstens 45 % der Höhe ein. Erfolge, Rangliste (Top 10 + eigener Platz), Berichte (Filter, „Weitere laden“), Handbuch (Kapitelleiste), Forschung (Zweige als Umschalter) und Einstellungen sind gestrafft.

## 0.12.2 – 27.11.2026
- **Wetter fachlich überarbeitet** (geprüft von einem Entwickler und einem Meteorologen): Tiefs ziehen nach Nordosten, der stärkste Wind liegt am Rand des Tiefs statt im Kern, Hochs halten länger. Der Norden ist nicht mehr dauernd stürmisch (Bergen im Winter ~8 % Sturm, im Sommer kaum), dafür gibt es Mistral, Meltemi, Bora und Wind in der Straße von Gibraltar. Nebel gibt es jetzt auch an Nordsee, Ärmelkanal und vor Portugal, am meisten bei Neufundland im Sommer.
- **Wetterkarte**: Isobaren folgen dem Luftdruck, Windfahnen mit Fiedern nach Stärke, Sturmwimpel statt Blitz, Mond bei klarer Nacht.
- **Wirkungen genau angezeigt**: Ein angetipptes Feld zeigt „Flugzeuge −X %“, „Schiffe langsamer (bis +X %)“, „Aufklärung ungenau“ und „Luftschlag −X %“ nach den echten Regeln; Startverbot und Radar-Verkürzung nur am eigenen Hafen. Die Missionsplanung zeigt das Wetter am Ziel zur Ankunft.
- Windstärke in Beaufort mit richtigen Bezeichnungen (Sturm ab 9 Bft). Die Strom-Vorhersage beginnt zur vollen Stunde, die Sturmwarnung ist minutengenau.
- Strom (Balance v1.9): Windpark 90 und Solarfeld 180 Strom je Stufe, damit die Erträge zum neuen Wetter passen.
- Die Uhr im Spiel springt beim Nachladen nicht mehr kurz zurück.

## 0.12.1 – 27.11.2026
- **Ressourcen antippen**: Ein Tipp auf Stahl, Treibstoff, Elektronik oder Proviant in der Kopfleiste öffnet ein Infoblatt – Art und Verwendung, Bestand und Lager mit Füllstand, „voll in …“ bzw. „leer in …“, Produktion nach Quellen (Gebäude, Grundproduktion, Verbrauch durch Truppen oder Kraftwerk), Strommangel und Wirkungen wie Blockade oder Sabotage, Bunkerschutz, Börsenkurs und Wert des Bestands.

## 0.12.0 – 27.11.2026
- **Admirale**: Ernenne bis zu drei Admirale (Truppen → Admirale). Sie führen einen Verband auf Mission oder als Hafenkommandant daheim die Verteidigung. Sechs Spezialisierungen (Angriff, Verteidigung, Logistik, Aufklärung, Beutemeister, U-Boot-Taktik), Erfahrung aus gewonnenen Kämpfen, Beförderung bis zum Admiral. Nach schweren Niederlagen entscheidet ein W20 über Verwundung, Gefangenschaft oder Tod.
- **Sammelangriff**: Allianzmitglieder greifen gemeinsam an – alle Verbände kommen gleichzeitig an und kämpfen als eine Streitmacht. Die Beute wird nach Kampfbeitrag geteilt, höchstens so viel, wie der eigene Laderaum fasst. Eröffnen über die Missionsplanung, beitreten unter Allianz → Angriffe.
- **Stationieren**: Truppen verteidigen den Hafen eines Verbündeten mit, bis du sie zurückrufst.
- **Minen**: Minenleger legen Minenfelder auf See nahe dem eigenen Hafen; feindliche Verbände auf der Hinfahrt verlieren Schiffe. Minenräumer räumen Felder und schützen den Verband.
- **Seeblockade**: Bewaffnete Schiffe blockieren einen fremden Hafen – Produktion −25 %, Lieferungen werden zurückgehalten, Börsenverkäufe gesperrt. Der Verteidiger und seine Verbündeten können die Blockade angreifen.
- **Konvois**: Handelslieferungen und Transporte fahren als Konvoi. Das Kartell und Kriegsgegner können sie abfangen; Geleitschutz senkt die Verluste.
- **Erfolge**: Zwölf Abzeichen in Bronze, Silber und Gold, die über alle Saisons bleiben – mit Belohnung je Stufe. Die besten drei stehen in der Rangliste neben deinem Namen (Meldungen → Erfolge).
- **Wochenziele**: Jede Woche drei passende Ziele mit Belohnung und einem Wochenbonus für alle drei (Basis).
- Neue Handbuch-Kapitel zu allen Neuerungen.

## 0.11.6 – 27.11.2026
- Mission auf der Karte: Statt eines abdunkelnden Blatts erscheint unten eine kompakte Leiste – die Karte bleibt sichtbar, der Verband steht mittig und ist mit einem pulsierenden Ring markiert. Die Leiste zeigt, wo der Verband gerade ist („Jetzt bei Feld …“), Fortschritt, Truppen, auf Wunsch die Zeiten, und Knöpfe „Ziel zeigen“ und „Zurückrufen“.

## 0.11.5 – 27.11.2026
- Börse: Die Kurszeile steht jetzt fest oben unter den Ressourcen (bei der Einstellung „Immer unten“ unten) statt mitten in der Seite.

## 0.11.4 – 27.11.2026
- **Mission auf der Karte zeigen**: In der Missionsliste (Truppen) springt „auf der Karte zeigen“ zur aktuellen Position des Verbands und öffnet das Missionsblatt.
- **Wetter je Feld**: Beim Hineinzoomen bekommt jedes Seefeld sein eigenes Wetterzeichen – Windpfeil mit Stärke-Fiedern, Wolkentönung, Regen, Nebel, Sturmfelder rot umrandet mit Blitz. Weit draußen bleibt die Wetterkarte mit Tiefs und Hochs.
- **Feld antippen zeigt das Wetter**: Himmel, Windstärke, Nebel und die Wirkung (Schiffe langsamer, Flugzeuge am Boden, Aufklärung ungenau, Luftschlag schwächer).
- iPhone/Safari: Texte vergrößern sich nicht mehr eigenmächtig und brechen sauber um; Silbentrennung im Fließtext.

## 0.11.3 – 27.11.2026
- **Verband antippen**: Ein Tipp auf ein eigenes Schiff auf der Karte öffnet die Mission im Detail – Auftrag, Ziel, Fortschritt, Abfahrt, Ankunft, Rückkehr, Truppen, Verluste und Ladung; auf der Hinfahrt mit „Zurückrufen“.
- **Wetter wie auf einer Wetterkarte**: Tiefs (T) und Hochs (H) mit Isobaren, Windpfeile mit Fiedern je nach Stärke, Wolkenfelder mit Regen, Sturmzellen mit Blitz und Nebelschleier. Neu: ein Wetterkärtchen „Am Hafen“ mit Himmel und Windstärke in Beaufort.
- **Börsen-Kurszeile überall**: In den Einstellungen wählbar – nur in der Börse, immer oben oder immer unten. Antippen öffnet die Börse.

## 0.11.2 – 27.11.2026
- **Freund und Feind auf der Karte**: Häfen sind nach Beziehung gefärbt – eigener Hafen, Allianz (grün, Doppelring), Paktpartner (ocker), Kriegsgegner (rot), neutral (blau); auch in der weit herausgezoomten Übersicht. Die Legende ist neu gegliedert und erklärt die Übersichtspunkte.
- **Proviant verständlich**: Die Versorgung zeigt Erzeugung, Unterhalt der Truppen und den Saldo; bei negativem Saldo steht, wie lange der Vorrat reicht.
- **Allianzwertung** zum Saisonende in der Ruhmeshalle.
- Wetter wirkt jetzt auch bei Kämpfen der Weltereignisse; bei Sturm wird der Abfangpunkt des Schatzschiffs richtig berechnet.
- Radar: Ein einmal erkannter Angriff bleibt sichtbar, auch wenn das Radar danach ausfällt.
- Spionage abgestimmt: Erkunden gelingt öfter, Sabotage braucht nur noch einen Spion, Desinformation ist schwächer. Eigene Meldung „Spione zurück“; der Chancenbalken zeigt jetzt richtig an.
- Das Kartell berücksichtigt die Forschung der Verteidiger zur Hälfte – gut erforschte Häfen bleiben nicht völlig unangreifbar.
- Neue Tagesbefehle zu Strom, Wetter und Spionage.
- Kleinere Korrekturen an der Darstellung auf dem Handy.

## 0.11.1 – 27.11.2026
- **Fehler melden ist leichter zu finden**: Ganz oben im Handbuch gibt es jetzt drei Schnellknöpfe – Fehler melden, Einstellungen und Was ist neu? Unten im Handbuch steht ein deutlicher Knopf statt eines kleinen Links.

## 0.11.0 – 27.11.2026
- **Wetter**: Tiefs und Hochs ziehen von West nach Ost über die Karte, dazu Nebelküsten, Tag und Nacht. Die Karte zeigt Wolken, Sturm und Nebel (Knopf „Wetter an/aus“). Sturm verlängert Seefahrten, hält Flugzeuge am Boden und schwächt sie im Kampf; Nebel verkürzt die Radar-Vorwarnung und macht Aufklärung ungenau.
- **Strom**: Neue Gebäude **Windpark**, **Solarfeld** und **Speicherwerk**. Das Kraftwerk verbraucht jetzt Treibstoff. Fehlt Strom, wird nach Rang versorgt: Radar, Produktion, Ausbildung, Forschung. Die Basis zeigt Angebot, Bedarf, Speicher, eine 24-Stunden-Kurve und die Wettervorhersage.
- **Nachrichtendienst**: Spione ausbilden und losschicken – Erkunden, Desinformation, Sabotage (ein Gebäude fällt 6 Stunden aus) und Kartell-Aufklärung. Jeder Auftrag wird mit dem W20 gewürfelt; wer enttarnt wird, verliert seine Spione. Neue Forschung Verschlüsselung und Agentenschulung.
- **Fehler melden**: Im Handbuch und in den Einstellungen. Ein Screenshot der aktuellen Ansicht und das Fehlerprotokoll werden automatisch angehängt; du ergänzt nur noch, was passiert ist. Die Verwaltung bekommt eine E-Mail und sieht alle Meldungen im Admin-Menü.
- Neue Gebäude haben eigene Bilder je Ausbaustufe.

## 0.10.2 – 27.11.2026
- Ausbildung: Bei Menge 0 steht nicht mehr „kostenlos“ und „Nicht genug Ressourcen“, sondern die Kosten je Stück und wie viele du dir leisten kannst.

## 0.10.1 – 27.11.2026
- **Gebäude wachsen sichtbar mit**: Jedes Gebäude hat eigene Bilder je Ausbaustufe – vom Bauplan über klein, mittel und groß bis zum Prachtbau mit Licht, Laternen und Fahnen.
- Das Info-Blatt zeigt das Gebäude jetzt und nach dem nächsten Ausbau nebeneinander; der Bauhof zeigt das Bild der Zielstufe.
- Die Hafen-Ansicht oben auf der Basis wächst mit deinem Gesamtausbau (Häuser, Kran, Schiffe, Licht, Flagge).
- Voll ausgebaute Gebäude zeigen „Höchststufe“ statt eines Ausbau-Knopfs.

## 0.10.0 – 27.11.2026
- **Forschung**: neues Gebäude Forschungsamt mit 20 Techniken in vier Zweigen (Seefahrt, Heer, Luftfahrt, Wirtschaft). Jede abgeschlossene Forschung hat eine sichtbare **Durchbruch-Chance** – Würfelwurf mit Extra-Stufe oder halber Dauer für die nächste Forschung.
- **Kriegsglück**: Jede Seite würfelt je Kampfphase einen W20 (−20 % bis +20 %), die Würfe stehen im Kampfbericht.
- **Veteranen**: Einheiten werden durch überstandene Kämpfe stärker – bis zur Elite (+15 %).
- **Wertaufschlüsselung** in den Info-Blättern (z. B. „40 → 46 · Forschung +10 % · Veteranen +5 %“) und ausgeteilter Schaden je Einheit im Kampfbericht.
- **Bilanz** unter Meldungen: deine persönliche Kampfbilanz mit versenkter Tonnage, bester Einheit und Würfelglück.
- **Probekampf** mit Verteilungsdiagramm.
- **Auftragsbuch mit Belohnungen**: Ressourcenpaket je Auftrag, nach allen elf das Abzeichen **Hafenmeister** und eine Stunde weniger Bauzeit.
- **Börse neu gestaltet**: Kurstafel, Tickerband, Kursdiagramm mit Richtwert und Kursband, Ordermaske mit Kurszettel und Sperrgründen vorab.
- **Marktnachrichten**: Weltereignisse, Kriegslage, Knappheit und Saisonende verschieben die Richtwerte (höchstens ±25 %, sanft) – sichtbar im Tickerband und als Liste, auf Wunsch als Push.
- **Spielerhandel** zeigt den Börsenwert jedes Angebots und eine Statistik der letzten 7 Tage.
- **Karte** ganz herausgezoomt füllt den Bildschirm, ruhige Übersicht mit Punkten statt Rauten, Beschriftungen ohne Überlappung.
- Die App startet schneller: selten genutzte Bildschirme werden erst bei Bedarf geladen.
- Viele Korrekturen: Warnung vor Überfällen auf Verbündete schon in der Vorschau, Zurück-Taste überall, Blatt am Griff wegziehen, Meldungen-Reiter auf schmalen Handys, Nachricht bei Ende eines Pakts.

## 0.9.0 – 27.11.2026
- **Weltereignisse des Kartells** – etwa alle 2–4 Tage, stärker mit dem Saisonfortschritt:
  - **Schatzschiff**: fährt 12–24 Stunden zu einem Piratennest. Wer es zuerst abfängt, erhält die große Beute.
  - **Großflotte**: 12 Stunden vorher angekündigt, greift danach nacheinander bis zu drei Häfen einer Region an. Schwäche sie vorher auf See – Beute gibt es anteilig zum Schaden.
  - **Belagerung**: 24 Stunden keine Börsenkäufe und weniger Produktion. Andere Spieler können den Ring brechen.
- Ereignisse erscheinen auf der Karte mit Route und Countdown, ein Banner auf der Basis warnt vor Ereignissen in der Nähe. Neues Handbuch-Kapitel.

## 0.8.2 – 27.11.2026
- Verständliche Meldungen bei ungültigen Eingaben (z. B. „Menge zu klein“) statt „Keine Verbindung“.
- **Nachtschild**: Änderungen wirken erst nach 24 Stunden – kein Ausweichen mehr vor einem bereits gemeldeten Angriff.
- Kampfbericht aus deiner Sicht: „Erbeutet“ in Grün, „Geplündert“ in Rot, dazu der Schutz durch deinen Tiefbunker.
- Transporte erscheinen beim Empfänger als „Lieferung von …“.
- Begrüßung und Gelesen-Zähler gelten je Spieler; nach Abmelden beginnt alles frisch.
- Handbuch und Auftragsbuch auf dem aktuellen Stand (Bauschlange, Rückruf, Beuteregeln, Kartell); das Kraftwerk kommt jetzt vor dem Stahlwerk.
- Rückfrage vor jedem Abbruch, „Bauen“ nur wenn bezahlbar, Börse warnt vor zu großer Kurswirkung.
- Die Zurück-Taste am Handy schließt Blätter und Ansichten; der aktuelle Reiter bleibt beim Neuladen erhalten.
- Push meldet blockierte Berechtigungen, Fehlermeldungen erscheinen dort, wo sie entstehen, Einladungscodes ohne Groß-/Kleinschreibung.
- Der Morgenbericht enthält deine Tagesbefehle.

## 0.8.1 – 27.11.2026
- Das Handbuch lässt sich nicht mehr seitlich verschieben; kein Bildschirm scrollt mehr nach links oder rechts.

## 0.8.0 – 27.11.2026
- **Allianzen**: gründen, einladen oder anfragen, Rollen (Führung, Offizier, Mitglied), eigener Chat und Allianzwertung in der Rangliste. Verbündete können sich nicht überfallen. Zu finden unter Meldungen → Allianz.
- **Diplomatie**: Nichtangriffspakt (beide stimmen zu, 24 Stunden Kündigungsfrist) und Kriegserklärung mit 12 Stunden Vorlauf. Im Krieg entfällt die Beute-Kürzung für schwache Ziele.
- **Handel zwischen Spielern** in der Börse: Ressourcen oder Kredite tauschen, öffentlich oder nur für die eigene Allianz. Die Ware wird beim Einstellen einbehalten und reist nach dem Tausch per Konvoi.

## 0.7.0 – 27.11.2026
- Neue Einheit **U-Boot** (Werft ab Stufe 3): Torpedosalve vor dem Seegefecht, nur von Korvetten und Zerstörern zu treffen. Neue Kampfphase „U-Boot-Angriff“ im Kampfbericht.
- **Freunde einladen** per E-Mail mit persönlicher Nachricht oder als teilbarer Link (Einstellungen oder Rangliste). Du erfährst, wenn dein Freund beitritt.
- **Versionsnummer und „Was ist neu?“**: Nach jedem Update erscheint ein kurzer Hinweis; ist eine neuere Version online, bietet die App das Neuladen an.
- **Tagesbefehle**: jeden Tag drei Aufgaben (leicht, mittel, schwer) mit Ressourcen und Saisonpunkten, Serienbonus und einmal täglich neu würfeln.
- **Probekampf** in der Missionsplanung und ein freier Kampfsimulator unter Truppen.
- **Verbandsvorlagen** und „Wiederholen“ an Berichten und heimgekehrten Verbänden.
- **Zeitleiste** auf der Basis mit allen anstehenden Ereignissen.
- **Morgenbericht** per E-Mail (Einstellungen): was über Nacht geschah.
- Verwaltung: **Sicherungen herunterladen** und „Jetzt sichern“, dazu eine **Statistikseite**.
- Info-Blätter lassen sich am Griff nach unten wegziehen.
- Sicherungen laufen auch nach Updates zuverlässig weiter.

## 0.6.0 – 26.11.2026
- Neues Erscheinungsbild **Seekarte**: Papier, Tinte und Siegelrot, eigene Schriften, alle Einheiten und Gebäude als Kupferstiche.
- Karte als Admiralitätskarte mit Tiefenlinien, Lotungen, Gradnetz und Windrose; Routen als Tintenlinien.
- Kampfbericht als Logbuch, neue Benachrichtigungs-Mails und ein neues App-Symbol.

## 0.5.0 – 26.11.2026
- **Push- und E-Mail-Benachrichtigungen**: erkannter Angriff, Kampfbericht, fertiger Ausbau und Ausbildung, heimgekehrter Verband, Lieferung – je Art einzeln schaltbar.
- **Saison mit Wertung** (28 Tage): Rangliste mit Ausbau, Militär, Kampf und Beute, Auszeichnungen, Ruhmeshalle. Am Saisonende startet die Welt neu.
- **Nachrichten** zwischen Spielern und eine Spielerübersicht unter „Meldungen“.
- **Bauschlange** mit drei Plätzen und **Rückruf** von Verbänden auf der Hinfahrt.
- Neue Balance: Das Kartell wächst mit deiner Verteidigung, Piratennester sind über die Saison verteilt erreichbar.
- Passwort ändern, „Passwort vergessen?“ und eine Verwaltung für Admins.

## 0.4.0 – 26.11.2026
- Die Karte wird erst beim Öffnen geladen: Die App startet deutlich schneller.

## 0.3.0 – 26.11.2026
- **Auftragsbuch** führt Schritt für Schritt durch die ersten Tage, dazu eine Begrüßung und ein **Handbuch** über „?“.
- Info-Blätter zu jedem Gebäude und jeder Einheit, Kräfte-Einschätzung vor einem Überfall.
- Hafenwahl mit Schnellwahl nach Regionen.

## 0.2.0 – 26.11.2026
- Erste spielbare Fassung: Hafen gründen, Wirtschaft ausbauen, Flotte und Truppen aufstellen, Piratennester überfallen, Kartell-Angriffe abwehren, Börse.
