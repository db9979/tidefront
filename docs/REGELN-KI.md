# KI-Spieler (Bots)

Teil der Regeln (`docs/REGELN.md`). Werte im Balance-Block `bots`; Begründung: `packages/game-core/ENTSCHEIDUNGEN-3.md`,
Abschnitt M. Code: `packages/engine/src/bots-*.ts`, Takt im Worker (`apps/worker/src/main.ts`).

## Wer sie sind

- Ein Bot ist ein normaler Spieler (Zeile in `player` mit `bot_profile`). Er hat Häfen, Bestände, Kredite und Punkte
  wie jeder andere und erscheint in Rangliste und Spielerübersicht mit dem Kennzeichen **KI**.
- Bots handeln **ausschließlich über die Befehle** (`upgrade`, `train`, `researchStart`, `launchMission`, `trade`,
  `createOffer`/`acceptOffer`, `chooseBase` …). Damit gelten Kosten, Bauzeiten, Kommandopunkte, Missionsplätze,
  Treibstoff, Wetter, Schutzregeln und Diplomatie genau wie für Menschen. Gelesen werden nur der eigene Zustand,
  öffentliche Daten (Karte, Nester, Felder, Börse, Angebote, Schutzstatus) und eigene Berichte (Aufklärung).
- Bots können sich nicht anmelden (kein nutzbares Passwort, `login` lehnt ab, kein Rücksetzcode) und bekommen weder
  Push noch E-Mail.

## Spielweisen

| | Händler (leicht) | Festung (mittel) | Freibeuter (stark) |
|---|---|---|---|
| Takt (aktive Zeit) | alle 60–120 Min. | alle 30–60 Min. | alle 12–25 Min. |
| Aktive Stunden (Ortszeit) | 7–22 Uhr | 6–23 Uhr | 9–2 Uhr |
| Nachtschild ab | 23 Uhr | 0 Uhr | 3 Uhr |
| Bauschlange genutzt | 1 | 2 | 3 |
| Ungenauigkeit | 35 % | 15 % | 5 % |
| Rüstungsanteil | 20 % | 40 % | 45 % |
| Angriffe | keine | Nester; Spieler selten | Nester, Bots, Menschen (falls erlaubt) |
| Probekampf | – | 3 Durchläufe, alle gewonnen | 12 Durchläufe, ≥ 75 % Siege |
| Besonderes | Börse, Spielerhandel | Anlagen, Radar, Bunker, Forschung | Aufklärung, Minen, U-Boote, frühe Kolonie |

- **Bauen:** Gewichte je Spielweise gegen die Kosten der nächsten Stufe; Strommangel zuerst ein Kraftwerk; Lager bei
  vollem Lager. Mittel und stark ziehen zusätzlich den Erzeuger der knappsten Ressource vor und bauen die
  Kommandozentrale, sobald sie andere Gebäude deckelt.
- **Rüstung:** Doktrin (Zielanteile am Rüstungswert) wie im Simulations-Bot; Landungsschiffe nach Truppenbedarf;
  Kommandopunkte und Proviantbilanz werden eingehalten. Der Rüstungsanteil wächst mit der Kommandozentrale (bis
  Stufe 3) auf den Zielwert. Liegt die Rüstung darunter und fehlt Geld für die dringendste Einheit, wird gespart.
- **Forschung:** feste Reihenfolge je Spielweise, höchstens bis zu einem Anteil am Gebäudewert (10/20/8 %).
- **Börse:** Überschuss verkaufen, knappe Ressource zukaufen (alle; Händler früher und mehr). **Spielerhandel**
  (Händler): fremde Angebote annehmen, die zum Richtwert mindestens gleichwertig sind; bis zu zwei eigene Angebote.
- **Felder:** alle drei Spielweisen nehmen Rohstofffelder in bis zu 700 km (nahe und niedrige Stufen zuerst). Bewachte
  Felder nur nach Probekampf gegen die Kartell-Wache (bekanntes Lagebild, sonst Wache der Stufe aus dem Handbuch;
  Sieg = Wache vernichtet wie im Feldkampf). Der kleinste Teil der Schiffe, der die Wache schlägt **und** als ganze
  Besatzung einen Kartellangriff der Stufe hält, läuft aus und bleibt (stayAll). Dafür sinkt die Heimwache nur um
  diesen Verband (die Hälfte der Heimwache bleibt; Händler: die Hälfte der Schiffe). Wer Nester angreift, lässt
  einen Missionsplatz frei. Fehlen Schiffe, merkt sich der Bot das Feld 36 h: Überfälle lassen den Feldverband
  daheim, die Rüstung baut zusätzlich Korvetten und Zerstörer. Hält eine Besatzung nach Verlusten den nächsten
  Kartellangriff nicht mehr, schickt er eine Verstärkung. Händler nehmen Felder nur mit ganz sicherem Probekampf
  (alle Durchläufe gewonnen) – zusätzlicher Ertrag passt zur Handelsspielweise.
- **Gründung:** ab Kommandozentrale 7 (Händler) / 9 (Festung) / 5 (Freibeuter), sobald ein Platz frei ist.

## Angriffe und Schutz

- Angriffe auf **Menschen** sind je Bot in der Verwaltung schaltbar, **Vorgabe aus**. Dann ist kein menschlicher
  Hafen Ziel (auch keine Aufklärung, keine Minen davor).
- Mit Erlaubnis gelten alle Schutzregeln der Befehle (Anfängerschutz, Nachtschild, Schutz nach Niederlage,
  Gründungsschutz, Diplomatie). Zusätzlich: **Sperrfrist** `bots.humanAttackCooldownHours` (12 h) – derselbe Bot
  greift denselben Menschen erst wieder an, wenn sein letzter Überfall auf ihn (Bericht) länger her ist und kein
  Überfall auf ihn unterwegs ist.
- Bots greifen sich untereinander und Piratennester ohne Sperrfrist an (normale Regeln).
- Vor einem Angriff auf einen Hafen schickt der Bot eine **Aufklärung** (Drohne oder Korvette) und rechnet mit dem
  Lagebild (höchstens `reconMaxAgeHours`, 6 h alt) einen **Probekampf** (`resolveBattle`, feste Seeds). Bei Nestern
  dient die öffentliche Besatzungstabelle als Lagebild.

## Takt und Last

- Der Worker ruft jede Minute `runBotsDue` auf: Entfernen fortsetzen, dann höchstens `turnsPerMinute` (2) fällige
  Bots, ältester Termin zuerst, innerhalb von `turnBudgetMs` (8 s). Mehr Bots verteilen sich so von selbst.
- Ein Zug dauert im Test (Entwicklungsrechner, PostgreSQL lokal) 10–17 ms im Median, 95 % unter 45 ms, Höchstwert unter 250 ms; auf dem Raspberry Pi ist ein Mehrfaches zu erwarten, die Grenze `turnBudgetMs` hält den Takt trotzdem kurz.
- Fehler eines Bots: Eintrag in seinem Protokoll und im Worker-Log, nächster Versuch nach 10–60 Minuten.
- Abschalten: Server-Einstellung `bots_enabled` (Verwaltung) oder Umgebungsvariable `BOTS_DISABLED=1` im Worker.

## Verwaltung

- Liste mit Spielweise, Hafen, letztem/nächstem Zug, Dauer, Fehlern und den letzten Aktionen.
- Je Bot: **Aktiv** und **Darf Menschen angreifen**.
- **Bot hinzufügen** mit Spielweise; Name aus einer Namensliste je Spielweise (eindeutig, sonst mit „II“ …).
  **Startbesetzung** legt je Spielweise einen an. Obergrenze: Server-Einstellung `bots_max` (Vorgabe 8).
- **Entfernen** (mit Rückfrage): Angebote zurückziehen, Felder und Verbände zurückrufen, Außenposten aufgeben – über
  die normalen Befehle. Sobald nichts mehr unterwegs ist (Hinderungsgründe wie beim Aufgeben einer Kolonie), werden
  Heimathafen und Spieler gelöscht; bis dahin setzt der Worker das Entfernen jede Minute fort.
- Saisonwechsel: Ein Bot ohne Hafen wählt im nächsten Zug ein freies Küstenfeld (größtmöglicher Abstand zu allen
  Häfen, Nestern und Feldern) und gründet dort.
