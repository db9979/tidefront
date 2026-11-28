# KI-Spieler (Bots)

Teil der Regeln (`docs/REGELN.md`). Werte im Balance-Block `bots`; Begründung: `packages/game-core/ENTSCHEIDUNGEN-3.md`,
Abschnitt M. Code: `packages/engine/src/bots-*.ts`, Takt im Worker (`apps/worker/src/main.ts`).

## Wer sie sind

- Ein Bot ist ein normaler Spieler (Zeile in `player` mit `bot_profile`). Er hat Häfen, Bestände, Taler und Punkte
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
| Angriffe | leichte Nester (bis Stufe 2) | Nester; Spieler selten | Nester, Bots, Menschen (falls erlaubt) |
| Probekampf | 8 Durchläufe, alle gewonnen | 3 Durchläufe, alle gewonnen | 12 Durchläufe, ≥ 75 % Siege |
| Besonderes | Börse, Spielerhandel | Anlagen, Radar, Bunker, Forschung | Aufklärung, Minen, U-Boote, frühe Kolonie |

- **Bauen:** Gewichte je Spielweise gegen die Kosten der nächsten Stufe; Strommangel (unter 99,5 %) zuerst Strom
  (Kraftwerk, Wind/Sonne, Raffinerie; Kraftwerk am Deckel: Kommandozentrale); Lager bei vollem Lager. Fehlen Rohstoffe
  für den besten Ausbau, werden seine Kosten zurückgelegt (Rücklage), die Ausbildung nimmt nur den Rest. Freibeuter
  und Festung ziehen die Voraussetzungen der Startrampe (aus der Balance) zwei Stufen der Kommandozentrale vorher nach. Mittel und stark ziehen zusätzlich den Erzeuger der knappsten Ressource vor und bauen die
  Kommandozentrale, sobald sie andere Gebäude deckelt.
- **Rüstung:** Doktrin (Zielanteile am Rüstungswert) wie im Simulations-Bot; Landungsschiffe nach Truppenbedarf;
  Kommandopunkte und Proviantbilanz werden eingehalten. Der Rüstungsanteil wächst mit der Kommandozentrale (bis
  Stufe 3) auf den Zielwert. Phasen je Hafen: **Rüstung zuerst**, bis der Zielanteil erreicht ist, dann **Ausbau
  zuerst** (mit Rücklage auch bei voller Bauschlange), bis der Anteil unter 75 % des Ziels fällt. In der Rüstungsphase
  wird für die dringendste Einheit gespart; je Auftrag höchstens 45 % des Vorrats jedes Rohstoffs. Truppen nur mit
  Transportraum (fehlt das Landungsschiff, wird dafür gespart statt weiterer Truppen).
- **Forschung:** feste Reihenfolge je Spielweise, höchstens bis zu einem Anteil am Gebäudewert (10/20/8 %).
- **Börse** (seit Welle 2 nach Stunden Produktion, jeder Hafen mit Börse): Bestand über 24 h Produktion (Händler
  12 h) und über dem Bedarf der drei billigsten nächsten Ausbauten wird verkauft (bis zu drei Rohstoffe je Zug, Lose
  unter der Preiswirkungsgrenze); unter 6 h Produktion oder unter dem Bedarf wird bis 12 h zugekauft (Händler bis 60 %,
  sonst 40 % der Taler). So bleiben KI-Lager klein. **Spielerhandel**
  (Händler): fremde Angebote annehmen, die zum Richtwert mindestens gleichwertig sind; bis zu zwei eigene Angebote.
- **Tagesbefehle:** an etwa 60 % der Tage (fest je Bot und Tag, höchstens alle 3 h) vergibt sich die KI ihre
  Tagesbefehle und Wochenziele und holt Erledigtes ab – wie ein Mensch, der nicht jeden Tag hineinsieht.
- **Heimwache:** der Anteil `homeGuardShare` jeder Kampfeinheit bleibt daheim – auch Truppen (Landungsschiffe fahren
  ganz mit, Laderaum); die Festung hält mindestens 30 % ihrer Truppen daheim (v1.35, vorher die Hälfte), von Schiffen und
  Flugzeugen nur 20 % – sie verteidigt mit Anlagen und Truppen; Kriegsschiffe daheim heben nur die Kartellstärke.
  Doktrin der Festung v1.35: Schützen 16 %, Küstenbatterie 16 %, Flak 10 % (Anlagen zusammen 38 %).
- **Mindestwache (v1.35):** in jedem Hafen bleiben mindestens 40 Landtruppen (`MIN_HOME_TROOPS`, Schützen zuletzt
  verschickt) – vorher verloren Kolonien ohne Truppen jeden Kartell-Überfall.
- **Inselfestung (v1.35):** schafft der Verband daheim das bekannte Nest 6 nicht, wohl aber mit den heimkehrenden
  Überfallverbänden dieses Hafens, wartet die KI höchstens 8 h (danach 16 h nicht) statt Stufe 5 anzufahren
  (`waitForTopNest`).
- **Verband und Plätze (v1.36):** Der Angriffsverband hat höchstens die Kommandopunkte des Hafens (sonst lehnte die
  Planung jeden Überfall mit `command_points` ab), Flugzeuge außer Reichweite bleiben daheim, und scheitert die Planung
  mit Admiral, fährt der Verband ohne ihn. Nestfahrten und ihre Aufklärung bis 1 200 km (Spielerziele 900 km); schafft
  der Verband keines der Nester ab der Mindeststufe, nimmt er eine Stufe darunter. Der Freibeuter hält zwei Plätze für
  Nestfahrten frei (neue Felder erst mit drei freien Plätzen), die Patrouille startet erst mit drei freien Plätzen.
  Ein Platz wird für ein Weltereignis nur freigehalten, wenn der Probekampf dagegen reicht.
- **Rüstungsplan Nest 6 (v1.37):** Ab Saisontag 30 hält der Freibeuter im Heimathafen ein Paket für die Inselfestung
  zurück (720 Schützen, 40 Pioniere, 20 Kampfpanzer, 45 Korvetten, 12 Zerstörer, 10 Landungsschiffe ≈ 427 KP, ohne Flugzeuge – sie reichen nicht bis zu den Inseln; bei weniger Kommandopunkten anteilig kleiner –
  `NEST6_PACKAGE`): Nestfahrten, Weltereignisse, Finale und Vergeltung aus diesem Hafen nehmen nur den Überschuss; die
  Ausbildung füllt die Lücken zuerst (auch über dem Rüstungsanteil). Reichen die Kommandopunkte nicht, verlegt er
  überzählige Schiffe in die Kolonie mit den meisten freien Kommandopunkten (höchstens alle 12 h).
- **Inselfestung bündeln (v1.36):** Ab Saisontag 35 prüft der Freibeuter im Heimathafen, ob sein gebündelter Verband
  (daheim, laufende Überfälle und Feldbesatzungen dieses Hafens) ein bekanntes Nest 6 in 900 km im Probekampf über die
  Würfe schafft (im Mittel ≥ 90 %, ungünstig ≥ 50 %). Dann ruft er die Feldbesatzungen zurück, startet aus dem Hafen
  nichts anderes und greift an, sobald der Verband daheim den Probekampf besteht; danach besetzt er Felder wieder.
  Höchstens 24 h Bündeln, danach 12 h Pause (`bots-nest6.ts`).
- **Weltereignisse:** Freibeuter und Festung greifen Schatzschiff, Großflotte und Belagerungsring in bis zu 1 200 km an (v1.35, vorher 900; kommt der Verband mit Landungsschiffen zu spät, fährt er ohne sie),
  wenn der Probekampf (Ereignis vernichtet, ohne Truppen) zu ≥ 90 % gewinnt und der erwartete Verlust höchstens 35 %
  des Verbands ist; v1.35 darf dafür auch der letzte freie Missionsplatz genutzt werden (vorher blieb einer frei), und
  solange ein solches Ereignis in Reichweite läuft, halten Nestfahrten, Aufklärung und Feldfahrten einen Platz frei
  (`keepSlotForEvent`). Lehnt die Planung ab (Flugzeuge außer Reichweite, Abfangpunkt mit Landungsschiffen nicht
  erreichbar), fährt der Verband ohne diese, wenn der Probekampf weiter reicht. Der Händler nicht.
- **Felder:** alle drei Spielweisen nehmen Rohstofffelder in bis zu 700 km (nahe und niedrige Stufen zuerst). Bewachte
  Felder nur nach Probekampf gegen die Kartell-Wache (bekanntes Lagebild, sonst Wache der Stufe aus dem Handbuch;
  Sieg = Wache vernichtet wie im Feldkampf). Der kleinste Teil der Schiffe, der die Wache schlägt **und** als ganze
  Besatzung einen Kartellangriff der Stufe hält, läuft aus und bleibt (stayAll). Dafür sinkt die Heimwache nur um
  diesen Verband (die Hälfte der Heimwache bleibt; Händler: die Hälfte der Schiffe). Wer Nester angreift, lässt
  einen Missionsplatz frei. Fehlen Schiffe, merkt sich der Bot das Feld 36 h: Überfälle lassen den Feldverband
  daheim, die Rüstung baut zusätzlich Korvetten und Zerstörer. Hält eine Besatzung nach Verlusten den nächsten
  Kartellangriff nicht mehr, schickt er eine Verstärkung. Händler nehmen Felder nur mit ganz sicherem Probekampf
  (alle Durchläufe gewonnen) – zusätzlicher Ertrag passt zur Handelsspielweise.
- **Gründung:** ab Kommandozentrale 5 (alle Spielweisen, `expandFromCommandLevel`), sobald ein Platz frei ist. Eine
  Stufe vorher bekommen Werft, Hafenkommandantur und ggf. Lager Vorrang (Stufen des Kolonieschiffs aus der Balance).
  Fehlen Rohstoffe, werden die Kosten des Kolonieschiffs zurückgelegt und die Werft bleibt frei.
- **Patrouille** (Freibeuter): höchstens alle 24 h, nur wenn in diesem Zug kein Angriff möglich war und mindestens
  zwei Auftragsplätze frei sind.
- **Admirale** (`bots-admiral.ts`): Freibeuter und Festung ernennen ab Hafenkommandantur 1 im Heimathafen einen Admiral
  über denselben Befehl wie Menschen (gleiche Kosten, Plätze, Namen). Bis er bezahlbar ist, hält die Börse 2 000 Taler
  zurück. Freibeuter: „Landungstrupp“, führt den nächsten Überfall aus dem Heimathafen (Probekampf mit seinen
  Modifikatoren); Festung: „Verteidigung“, bleibt Hafenkommandant. Der Händler ernennt keinen. Gefangene Admirale
  werden nicht freigekauft.

## Angriffe und Schutz

- Angriffe auf **Menschen** sind je Bot in der Verwaltung schaltbar, **Vorgabe aus**. Dann ist kein menschlicher
  Hafen Ziel (auch keine Aufklärung, keine Minen davor).
- Mit Erlaubnis gelten alle Schutzregeln der Befehle (Anfängerschutz, Nachtschild, Schutz nach Niederlage,
  Gründungsschutz, Diplomatie). Zusätzlich: **Sperrfrist** `bots.humanAttackCooldownHours` (12 h) – derselbe Bot
  greift denselben Menschen erst wieder an, wenn sein letzter Überfall auf ihn (Bericht) länger her ist und kein
  Überfall auf ihn unterwegs ist.
- **Vergeltung** (v1.35, Nutzerentscheid 5B; Server-Einstellung `bots_vergeltung`, Verwaltung → KI-Spieler, **Vorgabe an**):
  Überfällt ein Mensch einen KI-Spieler (Überfall oder Sammelangriff, Bericht der letzten 24 h), schlägt die KI auch ohne
  „Darf Menschen angreifen“ zurück – nur gegen den Ausgangshafen dieses Angreifers, höchstens einmal je 24 h je KI, erst
  nach Aufklärung und nur bei Probekampf ≥ 75 % (sonst wird der Überfall verworfen). Alle Schutzregeln und die Sperrfrist
  gelten (bots-vergeltung.ts).
- Andere **KI-Spieler** überfällt nur der Freibeuter, höchstens alle 48–72 h (zuerst Menschen, falls erlaubt, sonst die
  KI mit dem vollsten Lager laut Aufklärung). Piratennester ohne Sperrfrist (normale Regeln); kein zweiter eigener
  Verband zum selben Nest oder Weltereignis.
- **Nestwahl:** alle 6 h bestimmt die KI je Hafen die höchste Neststufe, die ihr ganzer Verband (daheim und unterwegs,
  ohne Heimwache) schafft; überfallen werden Nester ab dieser Stufe − 1 (bzw. ab dem höchsten erreichbaren bekannten
  Nest − 1). Probekampf ohne genaues Lagebild: im Mittel über die Würfe ≥ 90 % **und** gegen den ungünstigsten Wurf
  ≥ 50 %; mit genauem Lagebild gegen die hochgerechnete Besatzung mit der Siegquote der Spielweise.
- Vor einem Angriff auf einen Hafen schickt der Bot eine **Aufklärung** (Drohne oder Korvette) und rechnet mit dem
  Lagebild (höchstens `reconMaxAgeHours`, 6 h alt) einen **Probekampf** (`resolveBattle`, feste Seeds). Bei Nestern
  dient die öffentliche Besatzungstabelle als Lagebild.

## Takt und Last

- Der Worker ruft jede Minute `runBotsDue` auf: Entfernen fortsetzen, dann höchstens `turnsPerMinute` (2) fällige
  Bots, ältester Termin zuerst, innerhalb von `turnBudgetMs` (8 s). Mehr Bots verteilen sich so von selbst.
- Ein Zug dauert im Saisonlauf (`npm run sim:saison`, Entwicklungsrechner, PostgreSQL lokal, Welle 2) im Mittel etwa 50 ms je Aufruf von `runBotsDue`, Höchstwert rund 1 s; auf dem Raspberry Pi ist ein Mehrfaches zu erwarten, die Grenze `turnBudgetMs` hält den Takt trotzdem kurz. Die Dauer steht je Tag in der Verwaltung („Welt & Worker“, Schritt „bot turns“).
- Fehler eines Bots: Eintrag in seinem Protokoll und im Worker-Log, nächster Versuch nach 10–60 Minuten.
- Abschalten: Server-Einstellung `bots_enabled` (Verwaltung) oder Umgebungsvariable `BOTS_DISABLED=1` im Worker.

## Verwaltung

- Liste mit Spielweise, Hafen, letztem/nächstem Zug, Dauer, Fehlern und den letzten Aktionen.
- Je Bot: **Aktiv** und **Darf Menschen angreifen**; für alle: **Vergeltung** (v1.35, Vorgabe an).
- **Bot hinzufügen** mit Spielweise; Name aus einer Namensliste je Spielweise (eindeutig, sonst mit „II“ …).
  **Startbesetzung** legt je Spielweise einen an. Obergrenze: Server-Einstellung `bots_max` (Vorgabe 8).
- **Entfernen** (mit Rückfrage): Angebote zurückziehen, Felder und Verbände zurückrufen, Außenposten aufgeben – über
  die normalen Befehle. Sobald nichts mehr unterwegs ist (Hinderungsgründe wie beim Aufgeben einer Kolonie), werden
  Heimathafen und Spieler gelöscht; bis dahin setzt der Worker das Entfernen jede Minute fort.
- Saisonwechsel: Ein Bot ohne Hafen wählt im nächsten Zug ein freies Küstenfeld (größtmöglicher Abstand zu allen
  Häfen, Nestern und Feldern) und gründet dort.
