# Glossar – Begriffe und Benennung

Stand UX-0.43 (Paket C2, Befund N-3) mit den Nutzerentscheidungen E-5 (Marktwetter, Hafenmeisterei, Umstände),
E-6 (Post) und E-8 (Truppen bleibt). Im Spiel: Handbuch → Kapitel **Begriffe** (`apps/web/src/lib/glossary.ts` –
beide zusammen pflegen).

## Benennungsregeln

- **Ein Ding, ein Name.** Neue Texte nehmen den Begriff aus der Tabelle; die Spalte „Nicht“ nennt Namen, die nicht
  (mehr) benutzt werden.
- **Missionsziel** immer „Name · Feld x/y“ (z. B. „Piratennest · Feld 41/17“); ohne Namen nur „Feld x/y“.
- **Orte im Spiel** mit Pfeil: „Meldungen → Saison → Erfolge“, „Basis → Lage“, „Einstellungen → Benachrichtigungen“.
  Hauptreiter: Basis, Karte, Truppen, Meldungen, Börse. Unterreiter von Meldungen: Berichte, Post, Allianz, Saison
  (Wertung, Bilanz, Erfolge, Welt).
- **Lage ≠ Lagebild:** Die Lage ist die Startseite, das Lagebild das Wissen über andere (Sicht, Sensoren, Aufklärung).
- **Auftrag ≠ Tagesbefehl:** Aufträge stehen im Auftragsbuch (einmal je Saison), Tagesbefehle wechseln täglich.
- **Marktwetter ≠ Gezeit:** Das Marktwetter beschreibt die Börse, die Gezeit ist ein Ereignis der Weltpolitik.
- **Truppen** bleibt der Name des dritten Hauptreiters (E-8); „Flotte“ nur für Schiffe.
- **Uhrzeiten** im 24-Stunden-Format („07:00“), Dauern als „3 h 20 min“ bzw. „in 3 h“.

## Begriffe

| Begriff | Bedeutung | Steht unter | Nicht |
|---|---|---|---|
| **Lage** | Startseite „Was steht an?“: Alarm, „Seit deinem letzten Besuch“, Wartet auf dich, nächster Schritt, Unterwegs, Als Nächstes, Weltpolitik, Aufträge, Zuletzt passiert. | Basis → Lage | Lagezentrum |
| **Lagebild** | Was du über fremde Häfen, Nester, Felder und Verbände weißt (aus Sicht, Sensoren oder Aufklärung). Nicht zu verwechseln mit der Lage. | Karte → Sichtungen, Berichte | – |
| **Seit deinem letzten Besuch** | Karte oben auf der Lage nach einer Pause: Kämpfe, fertige Bauten, Rang, Post, Produktion. Verschwindet mit ✕ oder „Alle abholen“. | Basis → Lage | – |
| **Nächster lohnender Besuch** | Wann sich das Wiederkommen lohnt (Bauhof frei, Verband zurück, Lager voll, Seerat tagt …). „Erinnern“ schickt zur Zeit einen Push oder legt einen Kalendertermin an. | Basis → Lage | – |
| **Erste Schritte** | Für Neue: der jeweils nächste Auftrag aus dem Auftragsbuch mit „Los“ – bis zum ersten gewonnenen Nestüberfall. | Basis → Lage | – |
| **Auftragsbuch** | Zwölf Grundaufträge, die durch die ersten Tage führen, je mit einem Ressourcenpaket; nach allen das Abzeichen „Hafenmeister“. Ein einzelner Schritt heißt Auftrag. | Basis → Lage → Aufträge | Leitfaden |
| **Auftrag** | Ein Schritt im Auftragsbuch (z. B. „Kraftwerk bauen“). Sein Ziel (etwa das Start-Nest) heißt Auftragsziel. | Aufträge | – |
| **Tagesbefehl** | Drei kleine Aufgaben je Spieltag mit Belohnung; Serie für mehrere Tage am Stück. Ein angenommenes Gesuch belegt einen Platz. | Basis → Lage → Aufträge | Tagesauftrag, Daily |
| **Wochenziel** | Größere Aufgabe für die laufende Woche mit Belohnung. | Basis → Lage → Aufträge | – |
| **Erfolg** | Dauerhaftes Abzeichen in drei Stufen (Bronze, Silber, Gold); bleibt über alle Saisons. | Meldungen → Saison → Erfolge | – |
| **Hafenmeisterei** | Absender der Systemnachrichten (Seerat-Ergebnis, Paktangebote, Hinweise). | Meldungen → Post | Lagezentrum, System |
| **Post** | Nachrichten von Mitspielern und der Hafenmeisterei. Ungelesene Post von Mitspielern steht mit „Antworten“ auch auf der Lage. | Meldungen → Post | Nachrichten |
| **Umstände** | Abschnitt der E-Mails zu Kampfbericht, Radarwarnung und Morgenbericht: die Begleitumstände wie Wetter, Phasen, Landung, Bunkerschutz oder Wrackfeld. | E-Mails | Lage (im Bericht) |
| **Saison** | Eine Spielrunde (meist 42 Tage) mit Wertung, Finale und Neubeginn des Auftragsbuchs. | Meldungen → Saison | – |
| **Marktwetter** | Kurzlage der Börse: wie viel gekämpft wird und was die Kurse bewegt. Hat nichts mit der Gezeit zu tun. | Börse | Marktstimmung |
| **Gezeit** | Dreimal je Saison verschiebt für 72 Stunden ein Ereignis Regeln (Handelskrise, Rohstoffboom, Kartellfehde). | Lage (Weltpolitik), Saison → Welt | – |
| **Seerat** | Abstimmung aller Kapitäne über Beschlüsse (vor jeder Gezeit und wöchentlich). Das Ergebnis kommt als Post der Hafenmeisterei und auf Wunsch als Push. | Lage (Weltpolitik), Saison → Welt | – |
| **Ansehen** | Wie ein KI-Spieler dich sieht (misstraut, bekannt, vertraut): wirkt auf Lieferverträge, Gesuche und den Nichtangriffspakt. | Börse → Verträge | – |
| **Gesuch** | Lieferbitte eines KI-Spielers an dich (höchstens eine am Tag): annehmen belegt einen Tagesbefehl, erfüllen bringt Lohn und Ansehen. | Aufträge → Tagesbefehle | – |
| **Liefervertrag** | Vereinbarte Lieferung einer Ware zu einem Termin, mit KI-Spielern oder Mitspielern; mit Nachfrist und Vertragsstrafe. | Börse → Verträge | – |
| **Kommandopunkte** | Obergrenze für die Größe eines Verbands je Mission; mehr gibt die Kommandozentrale. | Missionsplanung | – |
| **Missionsplatz** | Wie viele Missionen ein Hafen gleichzeitig unterwegs haben kann; mehr gibt die Hafenkommandantur. | Truppen → Einsatz | – |
| **Verband** | Die Einheiten einer Mission. Das Missionsziel heißt immer „Name · Feld x/y“. | Missionsplanung, Lage → Unterwegs | – |
| **Probekampf** | Rechnet einen geplanten Kampf vorher durch (Siegchance, Verluste, Beute). „Planen“ von einem Ziel schlägt den kleinsten Verband mit 9 von 10 Siegen vor. | Missionsplanung | – |
| **Bauhof** | Wo Ausbauten laufen; ist er leer, schlägt die Lage den nächsten Ausbau vor. Die Reihe wartender Ausbauten heißt Bauschlange. | Basis → Hafen | Bauschlange (als Ort) |
| **Lagergrenze** | Bis hierhin füllt die Produktion das Lager (Lagerkomplex); Beute und Lieferungen dürfen darüber liegen. | Kopfleiste | Lagerkapazität |
| **Nachtschild** | Täglicher Schutz für einige Stunden in der Nacht, Startzeit selbst gewählt. | Einstellungen → Spiel | – |
| **Ruhezeit** | Zeitraum ohne Routine-Pushes; sie kommen gesammelt danach. Angriffe kommen immer sofort. | Einstellungen → Benachrichtigungen | – |
| **Kartell** | Die Freibeuter des Spiels: Nester an den Küsten, Überfälle auf Häfen, Weltereignisse und das Saisonfinale. | Karte | – |
| **Taler** | Geld der Börse; entsteht durch Verkäufe und Verträge. | Börse | – |
