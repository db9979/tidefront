# Mehrere Häfen (Welle 3 „Expansion“, Teil 2)

Teil der Regeln (`docs/REGELN.md`). Werte im Balance-Block `expansion`; fehlt er, gibt es keine Außenposten.
Begründung und Simulation: `packages/game-core/ENTSCHEIDUNGEN.md`, Abschnitt K, und `sim/expansion.ts`.

## Häfen je Spieler

- Der erste Hafen (Saisonbeginn, „Hafen wählen“) ist der **Heimathafen**; weitere Häfen sind **Kolonien**.
- Erlaubt sind `1 + Anzahl der Stufen in unlockCommandLevels (5, 9), die die Kommandozentrale des Heimathafens
  erreicht hat`, höchstens `maxBases` (3). Laufende Gründungen zählen mit.
- Spielerweit bleiben Forschung (im Heimathafen geführt; Kolonien nutzen deren Stufen), Kredite, Erfolge, Allianz,
  Rangliste (Summe aller Häfen) und die Nachtschild-Einstellung. Je Hafen: Ressourcen, Gebäude, Bauschlange,
  Ausbildung, Einheiten, Veteranen, Missionsplätze, Schutzzustand.
- Gebäude aus `homeOnlyBuildings` (Forschungsamt) gibt es nur im Heimathafen (Kolonie: Fehler `home_only`).
- Häfen gehen nicht durch Eroberung verloren. Zum Saisonende werden alle Häfen gelöscht; der erste Hafen der neuen
  Saison ist wieder der Heimathafen.

## Kolonieschiff

- Bau in der Werft ab Stufe `requiresLevel` (6) und Hafenkommandantur ab `harborLevelForShip` (6, sonst
  `harbor_level`). Höchstzahl `maxPerLevel` je Werftstufe (0,2: ein Schiff bei Werft 6–9, zwei ab 10).
- Langsam (30 km/h), unbewaffnet, Ladung 3000, Unterhalt 6 Proviant/h. Es wird bei der Gründung **verbraucht**.

## Gründung (Missionsart „gruendung“)

- Ziel: ein **Küstenfeld** ohne Hafen, Piratennest, Handelshafen und Rohstofffeld; mindestens `minDistanceHex` (4)
  Felder von fremden und `minDistanceOwnHex` (3) Felder von eigenen Häfen; höchstens `maxRangeKm` (900 km) vom
  Heimathafen entfernt.
- Verband: **genau ein** Kolonieschiff, beliebiges Geleit erlaubt; Ladung bis zur Ladekapazität des Verbands
  (Startgüter). Treibstoff: Kolonieschiff nur hin, Geleit hin und zurück. Belegt einen Missionsplatz.
- Bei Ankunft wird das Feld erneut geprüft. Gewinnt ein anderer Spieler den Wettlauf um dasselbe Feld (oder ist es
  nicht mehr frei), gibt es den Bericht „Gründung gescheitert: …“ und der ganze Verband kehrt mit Ladung heim.
- Sonst entsteht der neue Hafen mit einem **Ortsnamen aus der Karte** (nächster Küstenort bis 120 km: „<Ort>“, bis
  450 km: „Küste bei <Ort>“, sonst „Posten <Meer/Region>“ nach der nächsten Kartenbeschriftung; trägt schon ein Hafen
  den Namen: „… II“, „… III“; letzter Rückfall „<Spielername> II“): Startbestand `startResources` (1000 Stahl,
  500 Treibstoff, 250 Elektronik, 500 Proviant) plus Ladung, alle Gebäude auf Stufe 0. Das Kolonieschiff ist
  verbraucht, das Geleit kehrt heim. Bericht „Außenposten … gegründet“, Erfolg „Kolonist“.
- **Schutz:** Der Anfängerschutz erbt den Beginn des Heimathafens (keine Verlängerung); dazu **Gründungsschutz** für
  `colonyShieldHours` (24 h). Die Nachtschild-Einstellung wird übernommen. Der erste Kartell-Überfall kommt frühestens
  nach `firstRaidAfterHours` (48 h).

## Verlegung (Missionsart „verlegung“) und Transport

- Einheiten (mit Ladung und einem Admiral) fahren **dauerhaft** in einen anderen eigenen Hafen: nur Hinfahrt,
  Treibstoff einfach. Flugzeuge brauchen freie Stellplätze im Ziel (`no_aircraft_slots`).
- Bei Ankunft wechseln die Einheiten den Hafen; ihre Erfahrung wird mit dem Bestand des Ziels gewichtet gemischt. Ein
  mitfahrender Admiral gehört danach zum Zielhafen. Rückruf auf der Hinfahrt wie bei jeder Mission.
- **Transport** in einen eigenen Hafen ist erlaubt (wie an fremde Häfen, als Konvoi; nicht in den Ausgangshafen).
- Im **Zielhafen** erscheinen eigene Verlegungen und eigene Transporte unter „Eingehend“ (Truppen → Einsatz, Zeitleiste)
  mit Herkunftshafen, Einheiten und Ladung, gekennzeichnet als eigen – ohne Angriffswarnung.

## Hafen umbenennen

- Jeder eigene Hafen (auch der Heimathafen) lässt sich umbenennen: 2–32 Zeichen aus Buchstaben, Ziffern, Leerzeichen
  und `_ . ' ’ -` (Leerraum wird gekürzt); zwei eigene Häfen dürfen nicht gleich heißen (Groß-/Kleinschreibung egal).
  Eine laufende Belagerung zeigt den neuen Namen.

## Kolonie aufgeben

- Eine **Kolonie** (nie der Heimathafen) kann aufgegeben werden; der Client fragt nach (Hafenname eintippen).
- **Gesperrt**, solange: von dort Verbände unterwegs, gebunden (Sammelangriff), stationiert oder auf Blockade sind;
  eigene Verlegungen/Transporte dorthin unterwegs sind; ein vom Radar erfasster Angriff anläuft; verbündete Verbände
  dort stationiert oder auf dem Weg sind; eine Blockade oder Belagerung läuft; Lieferungen (Börse, Spielerhandel,
  Feldertrag) unterwegs sind; Handelsangebote aus diesem Hafen offen sind; ein Rohstofffeld an ihn liefert.
- **Folgen:** Bestände, Gebäude, Bau- und Ausbildungsschlange, Einheiten im Hafen und Verteidigung **verfallen** (wer sie
  behalten will, verlegt/transportiert sie vorher). Admirale des Hafens wechseln in den Heimathafen; eigene Minenfelder
  bleiben ohne Hafen liegen. Noch nicht erkannte feindliche Verbände finden kein Ziel und kehren um, ein anlaufender
  Kartell-Überfall entfällt. Systemnachricht mit dem Verlust. Danach zählt der Hafen nicht mehr gegen die Höchstzahl.

## Belagerung eines eigenen Hafens

- Den Belagerungsring vor einem eigenen Hafen kann man aus einem **anderen eigenen Hafen** brechen (Überfall gegen das
  Ereignis oder Sammelangriff); aus dem belagerten Hafen selbst nicht (`own_siege`).

## Spielerhandel

- Freischaltung **spielerweit** wie die Börse: höchste Hafenkommandantur aller Häfen ab `marketFromLevel` (3).
  Angebot, Treuhand, Bezahlung und Lieferung laufen über den gewählten (aktiven) Hafen.

## Fehlercodes

`expansion_off`, `command_level` (Kommandozentrale des Heimathafens zu niedrig), `base_limit`, `colony_ship`,
`not_coast`, `field_taken`, `trade_port`, `resource_field`, `too_close_own`, `too_close`, `too_far`,
`transfer_needs_own_base`, `same_base`, `no_aircraft_slots`, `admiral_elsewhere`, `home_only`, `harbor_level`.
Umbenennen: `bad_base_name`, `base_name_taken`. Aufgeben: `home_base`, `missions_out`, `incoming_own`, `attack_incoming`,
`guests_stationed`, `blockaded`, `under_siege`, `deliveries_underway`, `offers_open`, `field_held`.
