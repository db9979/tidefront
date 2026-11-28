// Begriffe (UX-0.43 C2, N-3): eine Liste für das Handbuch-Kapitel „Begriffe“ (components/GlossaryChapter.tsx).
// Gleiche Begriffe stehen mit Benennungsregeln in docs/GLOSSAR.md – beide zusammen pflegen.

export interface GlossaryEntry {
  term: string;
  /** Andere Schreibweisen, die nicht mehr benutzt werden (nur zur Suche). */
  not?: string[];
  text: string;
  /** Wo es im Spiel steht. */
  where?: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  { term: "Lage", not: ["Lagezentrum"], text: "Startseite „Was steht an?“: Alarm, „Seit deinem letzten Besuch“, Wartet auf dich, nächster Schritt, Unterwegs, Als Nächstes, Weltpolitik, Aufträge, Zuletzt passiert.", where: "Basis → Lage" },
  { term: "Lagebild", text: "Was du über fremde Häfen, Nester, Felder und Verbände weißt (aus Sicht, Sensoren oder Aufklärung). Nicht zu verwechseln mit der Lage.", where: "Karte → Sichtungen, Berichte" },
  { term: "Seit deinem letzten Besuch", text: "Karte oben auf der Lage nach einer Pause: Kämpfe, fertige Bauten, Rang, Post, Produktion. Verschwindet mit ✕ oder „Alle abholen“.", where: "Basis → Lage" },
  { term: "Nächster lohnender Besuch", text: "Wann sich das Wiederkommen lohnt (Bauhof frei, Verband zurück, Lager voll, Seerat tagt …). „Erinnern“ schickt zur Zeit einen Push oder legt einen Kalendertermin an.", where: "Basis → Lage" },
  { term: "Erste Schritte", text: "Für Neue: der jeweils nächste Auftrag aus dem Auftragsbuch mit „Los“ – bis zum ersten gewonnenen Nestüberfall.", where: "Basis → Lage" },
  { term: "Auftragsbuch", not: ["Leitfaden"], text: "Zwölf Grundaufträge, die durch die ersten Tage führen, je mit einem Ressourcenpaket; nach allen das Abzeichen „Hafenmeister“. Ein einzelner Schritt heißt Auftrag.", where: "Basis → Lage → Aufträge" },
  { term: "Auftrag", text: "Ein Schritt im Auftragsbuch (z. B. „Kraftwerk bauen“). Sein Ziel (etwa das Start-Nest) heißt Auftragsziel.", where: "Aufträge" },
  { term: "Tagesbefehl", not: ["Tagesauftrag", "Daily"], text: "Drei kleine Aufgaben je Spieltag mit Belohnung; Serie für mehrere Tage am Stück. Ein angenommenes Gesuch belegt einen Platz.", where: "Basis → Lage → Aufträge" },
  { term: "Wochenziel", text: "Größere Aufgabe für die laufende Woche mit Belohnung.", where: "Basis → Lage → Aufträge" },
  { term: "Erfolg", text: "Dauerhaftes Abzeichen in drei Stufen (Bronze, Silber, Gold); bleibt über alle Saisons.", where: "Meldungen → Saison → Erfolge" },
  { term: "Hafenmeisterei", not: ["Lagezentrum", "System"], text: "Absender der Systemnachrichten (Seerat-Ergebnis, Paktangebote, Hinweise).", where: "Meldungen → Post" },
  { term: "Post", not: ["Nachrichten"], text: "Nachrichten von Mitspielern und der Hafenmeisterei. Ungelesene Post von Mitspielern steht mit „Antworten“ auch auf der Lage.", where: "Meldungen → Post" },
  { term: "Umstände", not: ["Lage (im Bericht)"], text: "Abschnitt der E-Mails zu Kampfbericht, Radarwarnung und Morgenbericht: die Begleitumstände wie Wetter, Phasen, Landung, Bunkerschutz oder Wrackfeld.", where: "E-Mails" },
  { term: "Saison", text: "Eine Spielrunde (meist 42 Tage) mit Wertung, Finale und Neubeginn des Auftragsbuchs.", where: "Meldungen → Saison" },
  { term: "Marktwetter", not: ["Marktstimmung"], text: "Kurzlage der Börse: wie viel gekämpft wird und was die Kurse bewegt. Hat nichts mit der Gezeit zu tun.", where: "Börse" },
  { term: "Gezeit", text: "Dreimal je Saison verschiebt für 72 Stunden ein Ereignis Regeln (Handelskrise, Rohstoffboom, Kartellfehde).", where: "Lage (Weltpolitik), Saison → Welt" },
  { term: "Seerat", text: "Abstimmung aller Kapitäne über Beschlüsse (vor jeder Gezeit und wöchentlich). Das Ergebnis kommt als Post der Hafenmeisterei und auf Wunsch als Push.", where: "Lage (Weltpolitik), Saison → Welt" },
  { term: "Ansehen", text: "Wie ein KI-Spieler dich sieht (misstraut, bekannt, vertraut): wirkt auf Lieferverträge, Gesuche und den Nichtangriffspakt.", where: "Börse → Verträge" },
  { term: "Gesuch", text: "Lieferbitte eines KI-Spielers an dich (höchstens eine am Tag): annehmen belegt einen Tagesbefehl, erfüllen bringt Lohn und Ansehen.", where: "Aufträge → Tagesbefehle" },
  { term: "Liefervertrag", text: "Vereinbarte Lieferung einer Ware zu einem Termin, mit KI-Spielern oder Mitspielern; mit Nachfrist und Vertragsstrafe.", where: "Börse → Verträge" },
  { term: "Kommandopunkte", text: "Obergrenze für die Größe eines Verbands je Mission; mehr gibt die Kommandozentrale.", where: "Missionsplanung" },
  { term: "Missionsplatz", text: "Wie viele Missionen ein Hafen gleichzeitig unterwegs haben kann; mehr gibt die Hafenkommandantur.", where: "Truppen → Einsatz" },
  { term: "Verband", text: "Die Einheiten einer Mission. Das Missionsziel heißt immer „Name · Feld x/y“.", where: "Missionsplanung, Lage → Unterwegs" },
  { term: "Probekampf", text: "Rechnet einen geplanten Kampf vorher durch (Siegchance, Verluste, Beute). „Planen“ von einem Ziel schlägt den kleinsten Verband mit 9 von 10 Siegen vor.", where: "Missionsplanung" },
  { term: "Bauhof", not: ["Bauschlange (als Ort)"], text: "Wo Ausbauten laufen; ist er leer, schlägt die Lage den nächsten Ausbau vor. Die Reihe wartender Ausbauten heißt Bauschlange.", where: "Basis → Hafen" },
  { term: "Lagergrenze", not: ["Lagerkapazität"], text: "Bis hierhin füllt die Produktion das Lager (Lagerkomplex); Beute und Lieferungen dürfen darüber liegen.", where: "Kopfleiste" },
  { term: "Nachtschild", text: "Täglicher Schutz für einige Stunden in der Nacht, Startzeit selbst gewählt.", where: "Einstellungen → Spiel" },
  { term: "Ruhezeit", text: "Zeitraum ohne Routine-Pushes; sie kommen gesammelt danach. Angriffe kommen immer sofort.", where: "Einstellungen → Benachrichtigungen" },
  { term: "Kartell", text: "Die Freibeuter des Spiels: Nester an den Küsten, Überfälle auf Häfen, Weltereignisse und das Saisonfinale.", where: "Karte" },
  { term: "Taler", text: "Geld der Börse; entsteht durch Verkäufe und Verträge.", where: "Börse" },
];
