# Was ist neu?

Änderungen an TIDEFRONT, neueste zuerst. Die Version steht im Handbuch unten und auf dem Anmeldebildschirm.

## 0.45.0 – 28.11.2026

- Menü, Handbuch, Einstellungen und Verwaltung sind eigene Ansichten: „Zurück“ (Knopf, Browser, Esc) führt dorthin, wo du herkamst. Jeder Menüeintrag steht nur einmal da.
- Einstellungen in vier Gruppen: Benachrichtigungen (Push, Ruhezeit, Morgenbericht, E-Mail), Spiel (Nachtschild), Konto, Hilfe. Uhrzeiten im 24-Stunden-Format; Schalter ohne Wirkung sind ausgegraut und nennen den Grund.
- Verwaltung mit vier Reitern: Übersicht, Spieler, Welt (Gefahrenzone mit Rückfrage), Statistik.
- Breite Bildschirme: Handbuch, Einstellungen, Verwaltung, Forschung und Saison nutzen die volle Breite; „Karte groß“ holt die Karte zurück. Unten links Saison, Handbuch, Einstellungen, Verwaltung. Rohstoffe oben größer mit Lagerbalken, daneben dein Platz in der Rangliste.
- Tastaturkürzel: 1–5 Reiter, A Alle abholen, M Karte groß, ? Handbuch, Komma Einstellungen, Esc schließt.
- „Was hilft“ in der Missionsvorschau ragt am Handy nicht mehr über den Rand.

## 0.44.0 – 28.11.2026

- Ausbildung: Fertige Einheiten und Verteidigungsanlagen wandern einzeln in den Bestand, nicht erst am Ende des ganzen Auftrags – auch wenn du das Spiel nicht geöffnet hast. Bei einem Angriff verteidigen die schon fertigen mit.
- Anzeige im Auftrag: „3 × Korvette · 1 fertig“, darunter „nächste in … · alle in …“, live. Die Bestandszahl steigt sofort.
- Abbrechen: Fertige Einheiten bleiben, erstattet wird nur der Rest. Die Meldung „Ausbildung fertig“ kommt weiterhin einmal am Ende.

## 0.43.1 – 28.11.2026

- Lage und Konvoi-Blatt: Felderträge nennen jetzt ihr Rohstofffeld als Herkunft („von Rohstofffeld 66/23“) statt „von Handelshafen ?“.

## 0.43.0 – 28.11.2026

Balance v1.35 – Werte gelten sofort, die Wertung wird neu berechnet.
- Kartell: Überfälle auf den Hafen sind deutlich schwächer (Ziel höchstens 10 % der Tagesproduktion). Der Bericht nennt den Verlust zusätzlich in Stunden Produktion.
- Wertung: Kampf- und Beutepunkte aus Nestern zählen zur Hälfte; PvP und Weltereignisse voll. Tagesbefehle zählen höchstens 5 % des Gesamtrangs.
- Nest 6: stärkere Besatzung (×1,40), Beute gleich viel wert, aber in weniger Einheiten – mehr passt in den Laderaum. Die Planung zeigt den Anteil, der in den Laderaum passt. Weltereignisse laufen bis Tag 37,5.
- Saisonfinale: Häfen über 500 km vom Sammelpunkt bekommen eine Vorhut, mehr Beute je Schaden (0,9). Die Armada jagt U-Boote.
- Kolonien: Ab dem dritten Hafen kostet die Gründung eine Zusatzgebühr; jede Kolonie hat täglichen Unterhalt (höchstens so viel, wie sie selbst erzeugt).
- Optischer Satellit: Start rund 7.000, Laufzeit 14 Tage.
- Allianzen: Größe richtet sich nach der Rundengröße (mindestens 3, sonst die Hälfte der Menschen), in der Verwaltung änderbar; Allianzrang ist der Durchschnitt.
- KI-Spieler: Vergeltung gegen menschliche Angreifer (höchstens einmal je Tag, nur bei klarem Probekampf, abschaltbar in der Verwaltung). Die Festung wagt sich bis Nest 4.
- Börsenkonvoi: Die Kartellchance rechnet mit allen eigenen Börsenkonvois der letzten 4 Stunden. Aufholhilfe nach Ausbau und Militär. Erfolg „Baumeister“ ab Stufe 12.

## 0.42.0 – 28.11.2026

- KI-Spieler handeln an der Börse: Sie verkaufen Überschüsse und kaufen Fehlendes nach Stunden Produktion, ihre Lager bleiben dadurch klein.
- KI-Spieler kämpfen vorsichtiger und nach Profil: Ein Überfall startet nur bei klar günstigem Probekampf. Die Festung hält mindestens die Hälfte daheim. Der Freibeuter greift auch Weltereignisse an. Kein zweiter Verband fährt zum selben Ziel.
- Verwaltung: neue Karten „Rohstoffbilanz“, „Zuflüsse“, „Welt & Worker“ (Dauer der Server-Schritte) und „Nutzung je System“; Meilensteine mit Soll und Bezugsgröße.
- Server: fällige Kämpfe und Lieferungen warten nicht mehr auf die ganze Wartungsrunde; langsame Schritte werden erkannt.
- Für die Entwicklung: Saisonlauf über 42 Tage mit Wächtern (Weltereignisse, Nachrichten, Kartell, Punkteanteile).

## 0.41.0 – 27.11.2026

- Neu: Weltpolitik (Handbuch-Kapitel „Weltpolitik“).
- Gezeit: Dreimal je Saison (um Tag 10, 19 und 28) ändern sich für 72 Stunden die Regeln – Handelskrise, Rohstoffboom oder Kartellfehde. Sie wird 24 Stunden vorher in der Lage angekündigt; wo eine Regel gerade anders ist, steht es direkt dabei.
- Seerat: Vor jeder Gezeit und an Tag 7, 14, 21 und 28 stimmt die Runde geheim ab (Basis → Lage). Eine Stimme je Mensch, die KI-Spieler zusammen eine, eine Allianz höchstens 40 %.
- Ansehen bei jedem KI-Spieler (Börse → Verträge): steigt durch erfüllte Verträge und Gesuche, sinkt durch Überfälle und Paktbruch; es bestimmt Vertragsbonus und Kontingent. Nach einem Überfall verweigert der KI-Spieler 72 Stunden lang Verträge. Bei „Vertraut“ bietet er einen Nichtangriffspakt an.
- Gesuche: KI-Spieler bitten um Lieferungen. Ein Gesuch belegt einen Tagesbefehl-Platz; Lohn sind Waren im Wert von 3 Stunden deiner Produktion.

## 0.40.0 – 27.11.2026

- „Alle abholen“ holt alle Belohnungen in einem Schritt. Passt etwas nicht mehr ins Lager, bleibt es liegen, statt zu verfallen.
- Geleitkosten werden nach der tatsächlich gebuchten Route berechnet. Die Schnellknöpfe der Order gehen nicht mehr über „Max“ hinaus.
- Lieferverträge: Die Vertragsgrenze steht schon vor dem Annehmen da; ein Angebot über der Grenze lässt sich nicht annehmen.
- Lage: Beitrittsanfragen und Allianz-Einladungen erscheinen unter „Wartet auf dich“, ebenso das nahende Ende des Anfängerschutzes. Belohnungen nennen nur die Quellen, aus denen wirklich etwas kommt.
- Pushes kommen gebündelt (höchstens alle 15 Minuten). Neue Einstellung „Ruhezeit“ (Standard 23–7 Uhr, abschaltbar); Angriffe kommen immer sofort.
- Erinnerung nach längerer Abwesenheit und Hinweis zum Saisonwechsel per Mail und Push.
- Erfolg „Kaufmann“ zählt nach bezahlten Handelsgebühren.
- Technik: stabilere Live-Verbindung, Wiederholung bei Datenbank-Konflikten, eine zentrale Spielzeitzone.

## 0.39.0 – 27.11.2026

- Neue Navigation: Die Basis startet mit „Lage“ – was gerade auf dich wartet, mit „Alle abholen“. Gebäude, Versorgung und Schutz liegen im Unterreiter „Hafen“.
- Karte: Das frühere Lagebild heißt „Sichtungen“ und öffnet sich direkt auf der Karte. Die Wetter-Ebene ist standardmäßig aus; die Legende erklärt die „?“-Raute.
- Meldungen mit Unterreitern Berichte, Nachrichten, Allianz und Rangliste (Wertung, Bilanz, Erfolge).
- Eine Zahl je Reiter: Basis zählt Neues aus der Lage und abholbereite Belohnungen (rot bei Angriff), Meldungen ungelesene Berichte und Nachrichten.
- Breite Bildschirme ab 1024 px: Leiste links, Karte immer sichtbar, Inhalte in einer Seitenleiste rechts.
- Nester in der Nähe: Bei unbekannter Stufe oder geringer Siegchance ist „Aufklären“ der Hauptknopf; unter 10 % fragt „Angreifen“ nach. Netto-Beute nennt den Treibstoff.
- Kleinere Korrekturen: Silbentrennung beim Ausbilden, Stromfeld, größerer Hafenwechsler, Startrampen-Hinweis, Banner springt zum Ereignis, Wind überall in Beaufort.

## 0.38.1 – 27.11.2026

- Weltereignisse: keine Flut mehr vor Finale-Ankündigung und Saisonende. Ein neues Ereignis entsteht frühestens 48 h nach dem letzten; höchstens 2 laufen gleichzeitig (das Finale zählt nicht mit, Admin-Ereignisse auch nicht).
- U-Boote halten nichts: Bleiben nach einem Kampf um Konvoi oder Feld nur getauchte Einheiten übrig, ist der Konvoi bzw. das Feld verloren – die U-Boote selbst überleben. Die Geleit-Empfehlung schlägt keine U-Boote mehr vor.
- Börsennachrichten: keine überflüssigen Einträge mehr, die Wartung räumt alte auf (schnellere Börse).
- Handel blockiert keine Nachrichten und Missionen mehr.
- Texte: Wertung im Handbuch mit Zahlen aus den Spielwerten (Großflotte und Belagerung voll, Armada zur Hälfte), Kapitel „Kartell und Schutz“ nennt die Schiffsverluste daheim, KI-Kapitel korrigiert, Begrüßung verweist auf „Menü → Handbuch“.

## 0.38.0 – 27.11.2026
- **Empfohlenes Geleit:** Börsen-Order, Spielerhandel und Lieferverträge zeigen einen Kasten „Geleitschutz“: welche Kartellgruppe die Ladung anlockt, wie wahrscheinlich ein Überfall ist, welches kleinste Geleit aus deinen Schiffen sie zu mindestens 90 % abwehrt – und ob es sich lohnt (erwarteter Verlust ohne Geleit gegen Treibstoff, Unterhalt und Zeit, in der die Schiffe fehlen). „Empfehlung übernehmen“ setzt das Geleit mit einem Tipp. Reichen die Schiffe nicht, steht dort, was fehlt.
- **Probekampf gegen das Kartell** im Konvoi-Blatt für deine eigenen Konvois.
- KI-Spieler schicken bei großen Börsenkäufen jetzt selbst Geleit mit.

## 0.37.0 – 27.11.2026
- **Alle Zeiten und Bestände laufen live:** Countdowns, Ankunftszeiten, „in ca.“-Angaben, Rohstoffstände, rot markierte Kosten und „Was hilft?“-Hinweise rechnen sich ständig neu – ohne erneutes Öffnen. Reichen die Rohstoffe, verschwindet der Hinweis und der Ausbau-Knopf wird von selbst aktiv. Ist ein Bau fertig oder eine Mission angekommen, holt die App die neuen Daten selbst.
- **Lesbare Zeiten überall gleich:** „45 s“, „56 min“, „1 h 05 min“, „2 T 3 h“, „vor 12 min“, „morgen 06:00 Uhr“ – nie mehr „55:59 min“.
- **Lagezentrum:** Lieferungen ohne Konvoi (ältere Börsenkäufe) stehen jetzt unter „Unterwegs“. Neue Einträge seit deinem letzten Blick tragen „neu“. Die Zahl an „Meldungen“ verschwindet nach dem Öffnen der Lage und kommt erst bei neuem Dringendem wieder – laufende Angriffe bleiben immer markiert.

## 0.36.0 – 27.11.2026
- **Lagezentrum (Meldungen → „Lage“):** Alles, was gerade läuft, auf einer Seite und nach Zeit sortiert – „Gleich / heute“ (Angriffe rot ganz oben, Ankünfte, Konvois und Lieferungen, Bau, Ausbildung, Forschung, fällige Verträge, Nachtschild, Satelliten, Weltereignisse), „Unterwegs“ mit Fortschrittsbalken, „Wartet auf dich“ (abholbare Belohnungen, leere Bauschlange, freie Plätze, volles Lager, veraltende Lagebilder) und „Zuletzt passiert“. Jede Zeile führt per Tippen direkt dorthin; die Zahl an „Meldungen“ zeigt nur Dringendes.
- **Börsenlieferung in 4 Stunden – für alle gleich (Balance v1.34):** Jeder Börsenkauf kommt nach genau 4 Stunden an, egal wie weit dein Hafen vom Handelshafen liegt; das Kartell-Risiko ist für alle gleich (im Schnitt rund 1 % Warenverlust ohne Geleit).

## 0.35.0 – 27.11.2026
- **Taler statt Kredite:** Die Währung heißt jetzt Taler (kurz „T“, Münzsymbol) – an der Börse, bei Verträgen, Admiralen, Belohnungen, im Handbuch, in E-Mails und Benachrichtigungen. Die Obergrenze, wie viele Taler ein Hafen halten kann, heißt „Kasse“. Beträge und Kontostände bleiben unverändert.
- **Hilfe bei 0 Talern:** Statt „Zu wenig Kredite“ heißt es „Du hast 0 Taler. Verkaufe zuerst Rohstoffe – z. B. Proviant (Überschuss).“ – ein Knopf schaltet die Order auf Verkaufen und wählt Rohstoff und Menge vor. „Was hilft?“ bietet keine Sprünge mehr zu dem Bildschirm an, auf dem du schon bist.
- **Gegnerischer Admiral geheim:** In Kampfberichten zwischen Spielern siehst du vom gegnerischen Admiral nur Rang und Namen, nicht seine Wirkung.

## 0.34.0 – 27.11.2026
- **„Was fehlt zum Sieg?“** im Probekampf, im Kampfsimulator und an verlorenen Kampfberichten („Was hätte gefehlt?“): sucht die günstigste Verbandsmischung für 70, 90 oder 99 % Siegchance – mit Kommandopunkten, Truppenplätzen und Ausbildungszeit. „Ausbilden“ springt mit vorgewählten Mengen zur Kaserne bzw. Werft, „Mit diesem Verband planen“ direkt in die Missionsplanung.
- **Kampfsimulator korrigiert:** See-, Feld-, Konvoi-, Weltereignis- und Finale-Kämpfe zählen „Gegner vernichtet“ als Sieg (wie auf dem Server). Siegchance, Verluste und Restkampfkraft erscheinen aus deiner Sicht – auch bei einer Abwehr. Beute aus Berichten wird nicht mehr doppelt verstärkt; bei einem verlorenen Kampf heißt sie „unbekannt“ statt 0. Neue Phasentabelle.
- **Probekampf mit Wetter:** Probekampf, „Lohnende Ziele“ und Einschätzung rechnen mit dem vorhergesagten Wetter am Ziel zur Ankunft – Wolken schwächen den Luftschlag, die Siegchance wird ehrlicher. Vorschläge werden gegen zusätzliche Würfe geprüft; die Rechnung läuft im Hintergrund, ohne die Oberfläche zu bremsen.
- Kartell- und Hafen-Vorlagen im Simulator mit Hafenkommandant, Verbündeten, Hafen-Boni und Kartellstärke-Regler.
- **Boni bleiben geheim:** Kampfberichte zwischen Spielern verraten keiner Seite mehr Forschung, Admiral oder Veteranen des Gegners.

## 0.33.0 – 27.11.2026
- **Konvois auf ihrem Seeweg:** Konvois fahren auf der Karte jetzt entlang ihrer echten Route statt auf einer Geraden über Land.
- **Börsenkäufe und Lieferverträge kommen per Konvoi (Balance v1.33):** Ware vom Handelshafen bzw. von Reederei Albers und Bastion Falkenberg fährt sichtbar über See. Das Kartell kann ungeschützte Konvois überfallen – das Risiko ist klein (typisch 4 % Chance, im Schnitt etwa 1 % Warenverlust); in der Order kannst du Geleitschutz mitschicken, der Hinweis nennt Chance und erwarteten Verlust. Laufende Lieferungen kommen wie bisher an.
- **Konvoi antippen:** Ein Blatt zeigt Art, Absender und Empfänger, Ladung, Geleit, Ankunft und Route; gegen Kriegsgegner mit „Abfangen“.
- **Fremde Konvois im Lagebild:** Fahren sie durch deine Sensorreichweite (oder die deiner Allianz), siehst du sie auch ohne Krieg – Größe und Kurs, mit Erkennung Absender, Empfänger und Geleit. Die Ladung verrät erst ein Lagebild.

## 0.32.0 – 27.11.2026
- **Lieferverträge (Börse → Verträge, Balance v1.32):** Rohstoffe heute zu festem Preis kaufen oder verkaufen, geliefert in 1–7 Tagen oder als Abo („täglich X für 3–7 Tage“). 25 % Anzahlung bzw. Pfand, Rest bei Fälligkeit; wer nicht zahlen oder liefern kann, hat 12 Stunden Nachfrist.
- **KI-Spieler als Vertragspartner:** Reederei Albers handelt alles und bietet Abos, Bastion Falkenberg kauft Stahl und Elektronik, Kapitän Rotbart verkauft Treibstoff und Elektronik günstig – liefert aber per Konvoi über See, der abgefangen werden kann (Geleit möglich).
- **Verträge zwischen Spielern:** Angebot an alle oder an einen Mitspieler, Preis höchstens ±20 % vom Kurs, Lieferung per Konvoi. Zwischen eng verbundenen Spielern (Allianz, Handel in den letzten 7 Tagen) erlaubt, aber ohne Erfolgs- und Tagesbefehl-Wertung.
- Vertragslieferungen zählen ins Handelslimit; die Order zeigt, wie viel für Verträge vorgemerkt ist. Erinnerungen 6 Stunden vor Fälligkeit.

## 0.31.0 – 27.11.2026
- **Aufklärung auf Sicht:** Eine Aufklärung dreht um, sobald das Ziel in Bordsicht liegt (Drohne 200 km, Kriegsschiff 105 km, Transporter 40 km) – mit vollem Lagebild, aber kürzerer Fahrt und weniger Treibstoff. Die Karte zeigt den Wendepunkt.
- **Lebendige Piratennester (Balance v1.31):** Jede Neubesetzung würfelt die Besatzung (80–120 % der Stufe) und die Anlagen neu – Stufe 1 bleibt fest. Nach einer abgewehrten Attacke erholt sich ein Nest (sofort auf 70 %, dann +5 % je Stunde); die Beute wächst, solange niemand angreift (+1 % je Stunde bis 130 %).
- **Aufklärung lohnt sich:** Ohne Lagebild zeigen Karte und Probekampf nur Spannen („Siegchance 22–100 %, im Mittel 90 %“), Anlagen bleiben unbekannt. Ein Lagebild ist 24 Stunden genau und wird hochgerechnet.
- **„Lohnende Ziele“** zeigen bei aufgeklärten Nestern Besatzung, Anlagen, Beute, Alter des Lagebilds und eine Netto-Einschätzung (Beute minus Treibstoff und erwartete Verluste); lohnende Ziele stehen oben.
- Kampfsimulator: Nest-Vorlagen „Mitte“, „ungünstig“ und „aus Lagebild“.

## 0.30.0 – 27.11.2026
- **Berichte neu aufbereitet – wie die E-Mails:** Ergebnis-Kopf, Kurzfazit, Kennzahlen und Tabellen mit Einheiten-, Anlagen- und Ressourcensymbolen; Kampfberichte mit Gefechtsverlauf. Alle Einzelheiten aufklappbar.
- **„Im Kampfsimulator öffnen“** an jedem Kampfbericht: Der Simulator startet mit beiden Verbänden vor dem Kampf, Anlagen, Wetter und Boni (Forschung des Gegners bleibt geheim). Zum Vergleich steht das Kriegsglück des echten Kampfs daneben; danach frei änderbar („Was, wenn ich 5 Korvetten mehr gehabt hätte?“).
- Aufklärungsberichte: „Angreifen planen“, Entfernung, Probekampf und Simulator mit deinem Bestand gegen das aufgeklärte Ziel.
- **E-Mails** zu Kämpfen haben den Link „Im Kampfsimulator öffnen“.
- **Behoben:** Der Bericht-Link aus E-Mails öffnete den Bericht nicht immer.

## 0.29.0 – 27.11.2026
- **Börse mit Gedächtnis (Balance v1.30):** Kurse halten Knappheit länger – ohne Handel halbiert sich die Abweichung vom Richtwert erst nach 24 statt 12 Stunden.
- **Handelsbilanz:** Kaufen alle Spieler über drei Tage mehr, als sie verkaufen, steigt der Richtwert (bis +15 %), im umgekehrten Fall fällt er. Ein einzelner Spieler bewegt höchstens ein Drittel davon; gilt ab drei aktiven Häfen. Die Wertung rechnet weiter mit dem festen Grundrichtwert.
- **Gleitendes Tageslimit:** Statt um Mitternacht wird das Handelsvolumen 24 Stunden nach jedem Geschäft wieder frei; die Order zeigt „wieder frei ab …“.
- **Kursverlauf über die ganze Saison:** stündliche Kurse mit Grund- und aktuellem Richtwert, umschaltbar 1 h / 24 h / 7 Tage / Saison.
- **Behoben:** Die Grenzen im Orderblatt rechneten mit dem aktuellen statt dem Grundrichtwert; „neu ab 01:00“ zeigte UTC-Mitternacht.

## 0.28.3 – 27.11.2026
- **Admirale mit Bildern:** Jede Spezialisierung zeigt beim Ernennen und Umschulen ihr Symbol (Angriff, Verteidigung, Landungstrupp, Logistik, Aufklärung, Beutemeister, U-Boot-Taktik); auch in der Admiralsliste steht das Symbol neben der Spezialisierung.

## 0.28.2 – 27.11.2026
- **Flugzeuge statt Schiffe:** Reine Flugzeug- und Drohnenverbände erscheinen auf der Karte mit einem Flugzeug-Symbol statt eines Schiffs. Missionsleiste und Einsatz-Karten sagen „Hinflug“ und „Rückflug“.
- „Zurückrufen“ bricht auf schmalen Bildschirmen sauber um.

## 0.28.1 – 27.11.2026
- **Passende Wortwahl in der Missionsplanung:** Reine Flugzeug- und Drohnenverbände „starten“ statt „auslaufen“, die Kurzzeile nennt den „Flug“, und das Wetterkästchen zeigt das Startwetter am Hafen statt eines Zeitzuschlags für Schiffe. Spione werden „losgeschickt“. Verbände mit Schiffen laufen weiter aus.

## 0.28.0 – 27.11.2026
- **Ausgewogenere Baukosten (Balance v1.29):** Gebäude kosten mit jeder Stufe etwas weniger Stahl und dafür mehr Elektronik und Proviant – ab Stufe 12 ist gut ein Drittel des bisherigen Stahlanteils verlagert, bei gleichem Gesamtwert. Kaserne und Versorgungshof verlagern je zur Hälfte auf Proviant und Elektronik. So werden alle Rohstoffe gebraucht, statt dass Elektronik und Proviant ungenutzt im Lager liegen; der Ausbau kommt dadurch insgesamt etwas schneller voran.
- Bereits laufende Bauaufträge behalten ihre Kosten.

## 0.27.0 – 27.11.2026
- **Saisonfinale „Leviathan“:** Am 36. Saisontag wird eine Kartell-Armada angekündigt; am 38. Tag um 12:00 Uhr erscheint sie für 72 Stunden an einem zentralen Seefeld (bei weit verstreuten Häfen mit Vorhuten). Ihre Stärke richtet sich nach den Flotten aller Teilnehmer.
- Jeder Angriff trifft einen Abschnitt passend zur eigenen Kampfkraft – so gewinnt auch ein kleiner Verband und bringt Beute heim, ohne Laderaumgrenze. Das Flaggschiff fällt erst nach den Geschwadern, am besten im Sammelangriff; wer es versenkt, bekommt einen Schatz.
- Kampfpunkte aus Armada-Kämpfen zählen zur Hälfte, Beute voll. Titel „Bezwinger des Leviathan“ und „Leviathan-Flotte“, Eintrag in der Ruhmeshalle und neuer Erfolg „Armada-Jäger“. Wird sie nicht versenkt, zieht sie ab.
- Auf Basis, Karte und Missionsplanung: Ankündigung mit Countdown, Lebensbalken, Vorschau mit Abschnitt, Siegchance und Beute. KI-Spieler kämpfen mit, Titel gibt es nur für Menschen.

## 0.26.0 – 27.11.2026
- **Kopfgeld auf die Spitze:** Wer die Plätze 1, 2 oder 3 der Rangliste angreift, bekommt +50 / +35 / +20 % Kampfpunkte (wenn er selbst schlechter platziert ist). Die Abwehr der Spitze zählt dabei halb. In der Rangliste steht das Kopfgeld neben dem Namen.
- **Mutfaktor:** Angriffe auf stärkere Spieler bringen bis zu 50 % mehr Kampf- und Beutepunkte, auf schwächere bis zu 50 % weniger.
- **Paarbremse:** Mehrere Kämpfe zwischen denselben zwei Spielern innerhalb von 72 Stunden zählen immer weniger (voll, halb, ein Viertel, nichts). Nach Handel, Transporten, Stationierung oder gemeinsamer Allianz bzw. Pakt gibt es 7 Tage lang kein Kopfgeld – das verhindert Punkteschieben unter Freunden.
- **Anfängerschutz** endet, sobald du selbst einen Spielerhafen überfällst; die Missionsplanung weist vorher darauf hin.
- **Aufholhilfe:** Häfen, deren Ausbau deutlich unter dem Mittel aller Spieler liegt, bekommen eine Baugutschrift bis +50 % ihrer Gebäudeproduktion – nur für Gebäude, nicht plünder- oder handelbar. Wer ab dem 8. Saisontag einsteigt, bekommt ein Startpaket. Die Gutschrift steht unter der Ressourcenleiste und im Bauhof.

## 0.25.0 – 27.11.2026
- **Admirale aufgewertet – neue Spezialisierung „Landungstrupp“:** Landtruppen greifen 10 % stärker an und haben 8 % mehr Lebenspunkte, Minensperren richten 30 % weniger Schaden an. Als Hafenkommandant stärkt er die eigenen Landtruppen um 6 %. In knappen Nest-Kämpfen hebt das die Siegchance deutlich.
- **Beutemeister** bringt jetzt auch 10 % mehr feste Nestbeute (im Rahmen des Laderaums).
- **Umschulung:** Jeder bestehende Admiral darf seine Spezialisierung einmal kostenlos wechseln.
- Der Probekampf in der Missionsplanung rechnet den gewählten Admiral jetzt mit ein.
- **Behoben:** Die Kachel „Admirale“ meldete „ernennen möglich“, obwohl Kredite oder Elektronik fehlten. Jetzt steht dort, was fehlt, und der Ernennen-Knopf erklärt die Sperre mit „Was hilft?“.
- KI-Spieler Freibeuter und Festung ernennen nun ebenfalls Admirale.

## 0.24.5 – 27.11.2026
- **Behoben:** Die Kachel „Rohstofffelder“ meldete „besetzen möglich“ auch ohne Kriegsschiffe im Hafen; jetzt steht dort „erst Kriegsschiffe bauen“.
- Stromanzeige oben: bei gedecktem Bedarf ein ✓ statt des abgeschnittenen „gedec…“.
- „Kampfsimulator“ wird in der Kachel sauber getrennt.

## 0.24.4 – 27.11.2026
- **Warnung vor vollem Lager:** Tagesbefehle, Wochenziele und Erfolge zeigen vor dem Abholen, wie viel bei vollem Lager verfallen würde – mit „Lagerkomplex ausbauen“ oder „Trotzdem abholen“. Die Bestätigung nennt, was verfallen ist.
- **Balance v1.25 (Wirtschaft):** Belohnungen der Wochenziele halbiert – sie waren fast so groß wie die halbe Wochenproduktion. Belohnungspakete enthalten mehr vom knappen Stahl und weniger Proviant.
- Erfolg „Kaufmann“ und Wochenziel „Geschäfte“ zählen nur noch Börsengeschäfte ab 500 Kredite.

## 0.24.3 – 27.11.2026
- **Behoben:** Das Info-Blatt des Kolonieschiffs hatte keine Beschreibung. Jetzt erklärt es Reichweite, Startvorrat und ab welcher Kommandozentrale weitere Häfen möglich sind.

## 0.24.2 – 27.11.2026
- **Börse:** Das Tageslimit je Ressource wird jetzt um Mitternacht deiner Uhrzeit zurückgesetzt – wie die Tagesbefehle (bisher 01:00 bzw. im Sommer 02:00 Uhr).

## 0.24.1 – 27.11.2026
- **Sprache überarbeitet:** Überall stehen jetzt Namen statt interner Kennungen – etwa bei Blockaden, Großflotte und Schatzschiff, Sabotage am Seekabel und den wirksamen Forschungseffekten. Push-Meldungen und Morgenbericht sagen „12 Korvetten“ statt „12 Korvette“, überall gilt richtige Einzahl („1 Einheit“).
- Zahlen durchgehend deutsch (Dezimalkomma, Tausenderpunkt), einheitliche Begriffe (Hafen, KI-Spieler, Piratennest, Kredite), Zeiten in deiner Uhrzeit statt UTC.
- Das Handbuch nennt die sechs Forschungszweige und die Stufen des Forschungsamts nach den aktuellen Regeln.
- Fehlermeldungen, die bisher nur einen Code zeigten, haben jetzt einen verständlichen Text.

## 0.24.0 – 27.11.2026
- **Echte Seewege:** Schiffe fahren über Wasser statt quer über Land – um Küsten herum und durch Gibraltar, Ärmelkanal, Öresund, Messina, Bosporus, Kertsch und Suez. Fahrzeit und Treibstoff richten sich nach der echten Weglänge; die Karte zeigt den Kurs, und ein Rückruf wendet mitten auf der Route. Auch Kartell-Überfälle und Börsenlieferungen folgen dem Seeweg. Flugzeuge und Drohnen fliegen weiter direkt.
- **Bordsicht:** Kriegsschiffe und Patrouillen sehen 105 km weit – das eigene Feld und alle sechs Nachbarfelder. Die Aufhellung im Kartennebel wandert flüssig mit dem Schiff.
- **Fairere Wertung (gilt rückwirkend für die ganze Saison):** Abgewehrte Kartell-Überfälle zählen nur noch ein Viertel der Kampfpunkte; Rohstoffe zählen nach Börsen-Richtpreis (Elektronik mehr als Stahl). Angriffe auf Großflotte, Belagerung, Nester und Spieler zählen voll.
- **Balance v1.24:** Das Kartell schlägt sanfter zu (Verlust je Überfall etwa halbiert). Startrampe schon ab Kommandozentrale 7, Rampenrabatt 10 % je Stufe (bis 30 %), Radarsatellit günstiger. Mehr Beute aus Nestern der Stufen 4 und 6. Elektrolyse ergiebiger, Chipfabrik produziert mehr, Zerstörer stärker gegen Korvetten, Kampfpanzer günstiger. Ab Kommandozentrale 9 mehr Kommandopunkte je Stufe.
- **KI-Spieler** bauen zuverlässig weiter aus, gründen einen zweiten Hafen und überfallen Nester – auch die Reederei.
- **Bedienung:** „Menü“ statt „?“ (Handbuch, Einstellungen, Verwaltung, Abmelden). Die Allianz liegt jetzt unter Truppen. Größere Tippflächen und besser lesbare graue Schrift. Die Karte in der Missionsplanung blockiert das Rollen nicht mehr („Karte bedienen“). Neue Kapitäne sehen zuerst nur Überfall und Aufklärung.
- **Börse:** Kurse als „1,00 Kr“, Kopfbereich einklappbar, „Marktlage“ statt „Nachrichten“. **Lagebild:** eigene Sensoren und Sichtungen zuerst, Satelliten darunter.
- **Benachrichtigungen:** neu für bereitliegende Tagesbefehle, leere Bauschlange und wieder besetzte Nester – jede einzeln abschaltbar. Neue Kapitäne bekommen den Morgenbericht automatisch.
- Belohnungen aus Tagesbefehlen, Wochenzielen und Erfolgen füllen das Lager bis zur Grenze.
- Mehr Zuverlässigkeit im Hintergrund: Missionen und wiederkehrende Abläufe können nicht mehr hängen bleiben, die Anmeldung ist besser geschützt.
- **Behoben:** Im Lagebild stand „fischgrund“ statt „Fischgrund“.

## 0.23.0 – 27.11.2026
- **Besserer Start:** Jeder neue Hafen hat ein Piratennest der Stufe 1 in höchstens 300 km – du kennst seine Stufe, und es steht in „Lohnende Ziele“ als Auftragsziel.
- **Gewinnbarer erster Überfall:** Der Vorschlag in „Lohnende Ziele“ kommt jetzt aus einem Probekampf (mindestens 90 % Sieg) und nennt, wie viele Schützen noch fehlen. Der Auftrag verlangt 30 statt 20 Schützen.
- **Auftragsbuch sofort aktuell:** Nach Bau-, Ausbildungs- und Missionsende springt der nächste Auftrag ohne Neuladen weiter. „Los“ führt bei Schützen und Schiffen direkt zu „Ausbilden“.
- Belohnungen des Auftragsbuchs füllen das Lager bis zur Grenze; vorher warnt das Buch und bietet „Lagerkomplex ausbauen“ an.
- **Behoben:** Hafenwahl zeigte „nächstes St. ,“ ohne Stufe; der Zähler „abholbereit“ zählte die Abschlussbelohnung doppelt.

## 0.22.2 – 27.11.2026
- **Behoben:** Ein offenes Blatt auf der Karte (Feld, Nest, Hafen oder Missionsleiste) blieb stehen, wenn man die App aus dem Hintergrund wieder öffnete. Nach mehr als 30 Sekunden im Hintergrund schließt es sich jetzt; außerdem schließt erneutes Antippen von „Karte“ das Blatt und zeigt die Karte frisch.

## 0.22.1 – 27.11.2026
- **Sensor-Reichweiten deutlich erkennbar:** Bordsicht, Ausguck, Radar, Posten und Sonar zeigen ihre Reichweite jetzt als zart getönte Fläche mit Papier-Saum und kräftiger gestrichelter Linie. Strichstärke und Strichlänge bleiben in jeder Zoomstufe gleich, sodass sich die Kreise klar von Windstrichen und Gelände abheben. Eigene Sensoren durchgehend kräftig, die der Allianz feiner gestrichelt.

## 0.22.0 – 27.11.2026
- **Lagebild Stufe 3 – Satelliten:** Neue Gebäude **Startrampe** (ab Kommandozentrale 8, Forschungsamt 5, Radarstation 6) und **Störsender**, neuer Forschungszweig **Raumfahrt**. Ein optischer oder ein Radarsatellit überfliegt alle 6 Stunden einen 600 km breiten Streifen, zeigt ihn 20 Minuten live und hält 7 Tage. Der optische sieht nicht durch Wolken, der Radarsatellit sieht nur Verbände, Wracks und Posten. Unter Meldungen → Lagebild steht der nächste Überflug mit Ort; die Karte zeigt die Streifen und den nächsten Überflug mit Uhrzeit.
- **Gegenmittel:** Tarnnetze (Zweig Heer), Störsender (fremdes Radar bis −50 %), Tarnanstrich gegen Sicht auf reine Flugzeugverbände; ein Admiral mit Aufklärung halbiert fremdes Radar.
- Berichte und E-Mails zu Start und Ende eines Satelliten, Handbuch, Legende und „Was hilft?“ für alle neuen Sperren.
- **KI-Spieler** starten im Spätspiel Satelliten. **Behoben:** Bei viel Wissen fanden KI-Spieler kein passendes Nest mehr für Überfälle.
- **Balance v1.23.**

## 0.21.3 – 27.11.2026
- **Kraftwerk regelt nach:** Es liefert nur noch, was Wind, Sonne, Seekabel und Speicher offen lassen, und verbrennt entsprechend weniger Treibstoff (ein reiner Kraftwerkshafen spart rund ein Sechstel, ein gemischter deutlich mehr). Die Versorgung zeigt die aktuelle Auslastung; der rote Hinweis erscheint nur noch bei echtem Treibstoffmangel. Das Kraftwerk lädt den Speicher nicht mehr – der lädt aus Ökostrom.
- **Bewegte Symbole:** Schiffe schaukeln, das U-Boot taucht leicht, Flugzeuge und Drohne schweben, Waffen und Werkzeuge der Truppen bewegen sich. Auch die Forschungsbilder leben: Turbine und Zahnrad drehen, Sonar pulsiert, Radar schwenkt, Kran-Last pendelt. Kleine Symbole bleiben ruhig; „Bewegung reduzieren“ des Geräts wird beachtet.

## 0.21.2 – 27.11.2026
- **Behoben:** Nach „Auf der Karte zeigen“ (aus Truppen oder Meldungen) öffnete sich die Missionsleiste unten bei jeder Rückkehr zur Karte erneut. Jetzt springt die Karte nur einmal zum Ziel; danach bleibt sie frei.

## 0.21.1 – 27.11.2026
- **Mehr Bewegung:** Im Hafenbild ziehen die Wellen, tagsüber fliegt eine Möwe vorbei, nachts funkeln Sterne; Boote schaukeln, Rauch und Flagge bewegen sich (je nach Ausbau), der Lichtkegel des Leuchtturms pulsiert. Die Uhr bei Tagesbefehlen und Bauhof dreht ihren Zeiger, die Medaille des Auftragsbuchs pendelt leise.

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
- **Seekabel** (neues Gebäude): Ökostrom-Überschuss an einen eigenen Hafen oder ein Allianzmitglied abgeben – bis 600 km, 10 % Verlust je 100 km, Preis frei oder als Allianzhilfe, Abrechnung alle 10 Minuten. Kriegsgegner können das Seekabel sabotieren. Verwaltung in der Versorgung: anbieten, annehmen, Preis ändern, trennen.
- **Grüner Hafen:** ab 60 % Ökostrom in 24 Stunden +3 % Produktion (Quelle „Ökostrom“ im Info-Blatt). Neuer Erfolg „Grüner Hafen“, Wochenziel „Ökostrom“, Saisonauszeichnung „Grünster Hafen“ in der Ruhmeshalle.
- **Stromkurve** zeigt, wohin der Überschuss geht (→ Treibstoff, → Partner, verfällt), dazu den Ökostrom-Anteil.
- KI-Händler bauen Wind, Sonne und Elektrolyse.
- **Behoben:** Außenposten verloren bei jeder Abrechnung ihre Kolonie-Markierung; Gebäude, die nur im Heimathafen erlaubt sind, waren dort deshalb nicht gesperrt.
- Handbuch „Wetter und Strom“ erweitert. Balance v1.21.

## 0.19.2 – 27.11.2026
- **Bewegte Gebäude**, dezent und nach Spielzustand: Windräder drehen mit dem Wind am Hafen (Flaute oder Sturmabschaltung: still), Rauch steigt und die Fackel flackert nur bei laufender Produktion (bei Strommangel stockend), die Radarschüssel dreht sich, der Leuchtturm blinkt nachts, Chipfabrik-LEDs blinken, das Solarfeld glänzt bei Sonne, das Speicherwerk zeigt seinen Füllstand. Werft, Kaserne und Flugfeld bewegen sich, solange ausgebildet wird; bei laufendem Ausbau steht ein kleiner Baukran am Gebäude.
- Animationen pausieren außerhalb des Bildschirms und im Hintergrund; bei „Bewegung reduzieren“ (iPhone-Einstellung) bleibt alles still.
- **Stromfeld in der Kopfleiste:** Strombilanz (grün/rot), Speicherstand und Warnpunkt bei drohendem Mangel; Antippen öffnet die Versorgung.

## 0.19.1 – 27.11.2026
- **Hinweis-Karten statt Textzeile:** Sperrgründe erscheinen als Karte mit Kurzfassung im Kopf (z. B. „Fehlt: 48 Elektronik · ca. 9 h 36 min“ oder „1 von 1 belegt“). Aufgeklappt zeigt sie fehlende Mengen als Fortschrittszeile (Bestand / Bedarf mit Wartezeit), eine kurze Erklärung und die Sprungziele als Kacheln mit Symbol. Gilt überall, wo es „Was hilft“ gibt.
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
- **KI-Spieler:** Drei Mitspieler mit eigener Spielweise – **Händler** (leicht: Wirtschaft, Börse, Spielerhandel), **Festung** (mittel: Verteidigung, Forschung, Nester) und **Freibeuter** (stark: Überfälle mit Aufklärung und Probekampf, Minen, frühe Kolonien). Sie spielen nach denselben Regeln wie alle, haben Ruhezeiten mit Nachtschild und besetzen auch Rohstofffelder. In Rangliste und Spielerübersicht tragen sie das Zeichen **KI**. Ob ein KI-Spieler Menschen angreifen darf, stellt die Verwaltung je KI-Spieler ein (zu Beginn: nein); dann gelten alle Schutzregeln und 12 Stunden Pause je Spieler.
- **Saisons dauern 6 statt 4 Wochen.** Die laufende Saison endet am 7. Januar.
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
- **Mehrere Häfen:** Gründe bis zu zwei Außenposten zusätzlich zu deinem Heimathafen – den zweiten ab Kommandozentrale 8, den dritten ab 14.
- **Kolonieschiff** aus der Werft (ab Stufe 6, Hafenkommandantur 6): Es fährt zu einem freien Küstenfeld (höchstens 900 km vom Heimathafen, mit Abstand zu anderen Häfen) und wird dort zum neuen Hafen – mit Grundbeständen und der mitgebrachten Ladung. Wer zuerst ankommt, bekommt das Feld.
- Neue Häfen übernehmen den Anfängerschutz des Heimathafens und haben 24 Stunden Gründungsschutz; das Kartell greift frühestens nach 48 Stunden an.
- **Hafenwahl** oben in der Kopfleiste: Alle Seiten zeigen den gewählten Hafen – Gebäude, Truppen, Börse, Missionen. Auf der Karte hat der aktive Hafen einen Doppelring; freie Küstenfelder bieten „Außenposten gründen“, eigene Häfen „Hierhin wechseln“, „Transport“ und „Verlegen“.
- **Verlegen**: Truppen, Ladung und Admirale dauerhaft in einen anderen eigenen Hafen bringen. Transporte und Stationierung in eigene Häfen sind erlaubt.
- Spielerweit: Kredite, Forschung (läuft im Heimathafen, wirkt überall), Erfolge, Tages- und Wochenziele, Rangliste (Summe aller Häfen), Nachtschild. Je Hafen: Ressourcen, Gebäude, Truppen, Strom, Blockade, Belagerung, Kartell-Angriffe, Hafenkommandant.
- Neuer Erfolg „Kolonist“, Handbuch-Kapitel „Mehrere Häfen“.

## 0.14.1 – 27.11.2026
- Vorbereitung für mehrere Häfen je Spieler (Heimathafen, Besitzprüfung je Hafen). Für dich ändert sich noch nichts.

## 0.14.0 – 27.11.2026
- **Rohstofffelder einnehmen:** Auf See liegen Ölfelder (Treibstoff), Erzbuchten (Stahl), Fischgründe (Proviant) und Elektronik-Wracks – in drei Größen, bevorzugt zwischen den Häfen. Neutrale Felder bewacht das Kartell.
- **Besetzen**: Aufklären, mit bewaffneten Schiffen besetzen, die Wache schlagen. Eine Besatzung bleibt vor Ort (belegt einen Missionsplatz, kostet Proviant) und verteidigt das Feld. Alle 4 Stunden fährt der Ertrag als Konvoi zum Hafen – Kriegsgegner und Kartell können ihn abfangen, eine Blockade hält ihn zurück.
- **Umkämpft**: Das Kartell greift besetzte Felder gelegentlich an (mit Vorwarnung), andere Spieler können sie erobern (gleiche Schutzregeln wie beim Überfall). Eine Mindestbesatzung hält auf großen Feldern nicht lange – stärkere Besatzungen schon.
- **Grenzen**: 1 Feld je 4 Stufen Hafenkommandantur (höchstens 5), jedes weitere bringt weniger (100/85/70/55/45 %).
- **Allianz-Einflusszone**: Ab drei benachbarten Feldern einer Allianz +10 % Ertrag; Felder bringen Punkte in der Allianzwertung.
- Neue Liste „Meine Felder“ (Truppen → Einsatz), Kartensymbole und Legende, Handbuch-Kapitel und der Erfolg „Landnahme“.

## 0.13.0 – 27.11.2026
- **Weniger Scrollen** (nach Messung durch einen Game-Designer): Die Seiten sind deutlich kürzer – Basis von 6 auf unter 3 Bildschirmhöhen, Truppen je Bereich etwa 1–2 statt bis zu 5,5, Börse von 3,6 auf unter 2.
- Jeder Reiter merkt sich, wie weit du gescrollt hast; Missionsplanung, Handbuch und Forschung öffnen oben.
- **Basis „Hafen zuerst“**: Bauhof und Gebäude stehen oben. Auftragsbuch, Tagesbefehle und Wochenziele sind eine kompakte Leiste „Aufträge“ mit Zähler, was abholbereit ist – antippen öffnet die Details. Versorgung und Schutz sind einklappbar.
- **Truppen** mit Umschalter „Einsatz · Ausbilden · Abwehr“; jede Einheit ist eine Zeile, Werte und Kosten im Info-Blatt (ⓘ). Forschung als Knopf oben.
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
- **Ressourcen antippen**: Ein Tipp auf Stahl, Treibstoff, Elektronik oder Proviant in der Kopfleiste öffnet ein Info-Blatt – Art und Verwendung, Bestand und Lager mit Füllstand, „voll in …“ bzw. „leer in …“, Produktion nach Quellen (Gebäude, Grundproduktion, Verbrauch durch Truppen oder Kraftwerk), Strommangel und Wirkungen wie Blockade oder Sabotage, Bunkerschutz, Börsenkurs und Wert des Bestands.

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
- **Fehler melden**: Im Handbuch und in den Einstellungen. Ein Screenshot der aktuellen Ansicht und das Fehlerprotokoll werden automatisch angehängt; du ergänzt nur noch, was passiert ist. Die Verwaltung bekommt eine E-Mail und sieht alle Meldungen unter Einstellungen → Verwaltung.
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
