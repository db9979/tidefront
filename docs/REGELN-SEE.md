# TIDEFRONT – Minen, Blockade und Konvois

Teil von `docs/REGELN.md` (dort aus Platzgründen ausgelagert). Verbindlich für Kern, Server und Oberfläche;
Regeln in `packages/game-core/src/naval.ts`, Server in `packages/engine/src/naval*.ts`, Tabellen in
`packages/db/src/schema/naval.ts`. Alle Zahlen stehen in `packages/balance/v1/balance.json` in den Blöcken `mines`,
`blockade` und `convoys` sowie bei den Einheiten `minenleger` und `minenraeumer`. Fehlt ein Block, ist das System aus.
Simulation: `npm run sim` (Abschnitt „See“), Ergebnisse in `packages/game-core/ENTSCHEIDUNGEN-2.md`, Abschnitt I.

## Einheiten

| Einheit | Werft ab | Besonderheit |
|---|---|---|
| Minenleger | Stufe 4 | `mineLayer` 25: legt je Schiff so viel Minenstärke; schwach bewaffnet |
| Minenräumer | Stufe 2 | `mineSweeper` 30: räumt je Schiff so viel Stärke; U-Jagd 20; schützt Verbände vor Minen |

Beide sind gewöhnliche Schiffe (Kommandopunkte, Unterhalt, Treibstoff, Kampf) und fahren in jedem Verband mit.

## Minenfelder

- **Legen:** Mission `minen` (Planung: „Minen legen“) mit mindestens einem Minenleger auf ein Feld **offener See**
  (`terrain = sea`), höchstens `mines.layRadiusKm` vom eigenen Hafen. Beim Auslaufen kostet jeder Stärkepunkt
  `mines.costPerStrength`. Bei Ankunft entsteht ein Feld mit Stärke = Σ `mineLayer` (der Minenleger, die ankommen),
  höchstens `mines.maxStrength`. Liegt dort schon ein eigenes Feld, wird es verstärkt (bis zur Höchststärke) und seine
  Laufzeit beginnt neu. Ein Feld verfällt nach `mines.lifetimeHours`. Höchstens `mines.maxFieldsPerPlayer` eigene Felder.
- **Wirkung:** Ein Feld wirkt im Umkreis `mines.fieldRadiusKm` um die Feldmitte. Kreuzt die **Hinfahrt** oder die
  **Rückfahrt** eines Verbands (gerade Linie Start → Ziel bzw. Ziel → Hafen wie auf der Karte) das Feld und ist der
  Besitzer **feindlich** (nicht derselbe Spieler, nicht dieselbe Allianz, kein Pakt), sinken Schiffe – Felder in der
  Reihenfolge der Entfernung vom Start der Fahrt:
  - Verlustanteil je Schiffstyp = min(`maxLossShare`, Stärke × `lossPerStrength`) × `typeFactor[Typ]` (fehlt: 1)
    × (1 − Räumschutz). Erwartete Verluste n × Anteil; der Bruchteil wird mit einem Seed aus Missions- und Feld-ID
    gewürfelt (deterministisch; die Rückfahrt mit eigenem Strom, `mineReturnSeed`).
  - **Räumschutz** = min(`maxShield`, `shieldPerSweeperShare` × Anteil der Minenräumer an den Schiffen des Verbands).
  - Reicht der Truppenraum der überlebenden Schiffe nicht mehr, gehen die überzähligen Truppen anteilig je Typ unter.
    Flugzeuge sind nie betroffen.
  - Jedes versenkte Schiff verbraucht `strengthPerHit` Stärke; ein Feld mit Stärke 0 verschwindet.
  - Ein Minenbericht geht an den Verband (Verluste je Feld) und an den Feldbesitzer. Ist nichts mehr übrig, kehrt die
    Mission leer um (Ladung eines Transports ist verloren).
  - **Rückfahrt** (beim Heimkehren, `mission_return`): Strecke Ziel → Hafen; nach einem Rückruf auf der Hinfahrt vom
    Wendepunkt (die Hinfahrt bis dorthin zählt dann nicht extra). Verluste fehlen bei der Rückkehr; Ladung (Beute,
    Bergegut), die der verbliebene Laderaum nicht mehr fasst, sinkt mit. Bericht „Minenfeld auf der Rückfahrt“.
    Ausgenommen ist das Geleit des Annehmenden im Spielerhandel: seine Rückfahrt ist der Konvoiweg (siehe unten).
  - **Handelskonvois** (Spielerhandel) fahren beim Einlaufen durch die Felder auf ihrer Route, deren Besitzer gegen
    Absender **und** Empfänger feindlich ist. Die Ladung verliert je Feld deterministisch
    min(`maxLossShare`, Stärke × `lossPerStrength`) × `cargoLossFactor` (0,5) × (1 − Räumschutz des Geleits), je Ressource
    abgerundet (Journal `delivery:<id>` → `versenkt`); das Feld verliert dafür `strengthPerHit`. Geleitschiffe sinken wie
    ein Verband. Bericht „Konvoi im Minenfeld“ an den Empfänger; die Felder werden beiden Handelspartnern bekannt.
  - Kartell, Weltereignisse, Ertragskonvois der Rohstofffelder und **Börsenlieferungen** (keine Konvois) bleiben
    bewusst ausgenommen.
- **Räumen:** Mission `raeumen` mit mindestens einem Minenräumer auf ein Seefeld. Die Räumleistung Σ `mineSweeper`
  senkt die Stärke eigener und feindlicher Felder auf dem Feld (verbündete bleiben). Die Hinfahrt zum Feld ist eine
  gewöhnliche Durchfahrt (mit dem Räumschutz des Verbands).
- **Sichtbarkeit:** Eigene Felder und Felder der eigenen Allianz sieht man immer. Fremde Felder sind sichtbar, wenn man
  sie **kennt** (Treffer, Räumfahrt, Aufklärung: Felder bis `scoutRevealKm` von Ziel und Route) oder sie im **Radar**
  liegen (`radarKmPerLevel` × Stufe der Radarstation um den eigenen Hafen). Die Missionsplanung warnt, wenn die Route
  ein bekanntes feindliches Feld kreuzt.

## Seeblockade

- Mission `blockade` gegen einen fremden **Spielerhafen**. Schutzregeln wie beim Überfall: abgelehnt bei Anfängerschutz,
  Nachtschild, Schutz nach Niederlage (`target_protected`) sowie gegen Verbündete (`ally`) und Paktpartner (`pact`);
  der eigene Nachtschild wird wie beim Überfall ausgesetzt.
- Verband: nur Schiffe (`blockade_ships_only`), mindestens eines mit Angriff gegen See und zusammen mindestens
  `blockade.minCommandPoints` Kommandopunkte (`blockade_too_weak`). Haltezeit `holdHours` ganzzahlig in
  [`minHours`, `maxHours`]. Höchstens eine eigene laufende Blockade je Ziel (`already_blockading`).
- Bei Ankunft beginnt die Blockade (Mission im Status `holding`, belegt weiter den Missionsplatz). Das Ziel erhält
  eine Systemnachricht, eine Push-Meldung und einen Bericht. Während sie läuft:
  - Modifikator-Quelle **„Blockade“**: Gebäudeproduktion des Ziels × `productionFactor`.
  - **Lieferungen** an das Ziel (Börsenkäufe und Spielerhandel) werden bei Ankunft zurückgehalten und je
    `deliveryHoldMinutes` (höchstens bis zum Ende der Blockade) erneut versucht.
  - **Börsenverkäufe** des Ziels sind gesperrt (Code `blockade`). Käufe bleiben möglich, die Ware wartet.
- **Angriff auf die Blockade:** Jeder, der den Blockierer angreifen dürfte (nicht er selbst, nicht seine Allianz, kein
  Pakt) – also das Ziel, seine Verbündeten und Dritte – schickt einen `ueberfall` mit `blockadeId`. Kampf auf See auf
  dem Hafenfeld gegen den Blockadeverband (ohne Anlagen; Modifikatoren beider Seiten, Wetter). Verluste bleiben;
  sinken alle Schiffe, ist die Blockade **gebrochen**.
- **Ende:** Ablauf der Haltezeit, Aufheben durch den Blockierer („Blockade aufheben“) oder Niederlage. Der Verband
  (was übrig ist) fährt heim und ist nach der Fahrzeit der Hinfahrt zurück. Beide Seiten erhalten eine Nachricht.
- Anzeige: Kettenring um den Hafen auf der Karte (für alle sichtbar), Zusammensetzung nur für Beteiligte und die
  Allianz des Ziels; im Hafen des Ziels „Hafen blockiert bis …“.

## Konvois

- **Spielerhandel-Lieferungen** (je Ware und Richtung) und **Transporte** reisen als Konvoi auf der geraden Route
  zwischen den Häfen (Zeit wie bisher). Börsenlieferungen vom Handelshafen sind keine Konvois.
- **Kartell:** Beim Auslaufen wird einmal gewürfelt. Chance = min(`cartelMaxChance`, `cartelBaseChance`
  + `cartelChancePer100Km` × Strecke/100 + `cartelChancePer1000Value` × Warenwert/1000) zum Börsenrichtwert, unter
  `cartelMinDistanceKm` 0. Trifft es, greift ein Kartellverband (Schnellboote: `cartelBoatsPer1000Value` je 1000
  Warenwert, `cartelMinBoats`–`cartelMaxBoats`) zwischen 25 % und 75 % der Fahrt an.
- **Kriegsgegner:** Konvois, deren Absender oder Empfänger mit dem Betrachter im Krieg ist (nach der Vorlaufzeit),
  erscheinen auf seiner Karte. Mission `abfangen` mit `convoyId`: Abfangpunkt wie beim Schatzschiff
  (`interceptPoint`), nur mit Schiffen; die Ankunft muss vor dem Einlaufen des Konvois liegen.
- **Kampf:** Hat der Konvoi Geleitschutz mit Schiffen, kämpft der Angreifer auf See dagegen (Verluste bleiben). Ladung:
  - Kartell: ohne Geleit verliert der Konvoi `lossShareUnescorted`, unterliegt das Geleit `lossShareEscortBeaten`,
    hält es, nichts.
  - Kriegsgegner: hält das Geleit, nichts. Sonst verliert der Konvoi `plunderShare` der Ladung; davon erbeutet der
    Angreifer, was sein Laderaum fasst (Rückkehrer), der Rest sinkt.
  - Verluste werden je Ressource abgerundet, im Journal (`delivery:<id>` → `kartell` / `beute:<Spieler>` / `versenkt`)
    gebucht; die Lieferung kommt mit dem Rest an. Bericht und Push an den Empfänger (Handel) bzw. Absender (Transport).
- **Geleitschutz:** Beim Transport sind es die Schiffe des Verbands. Beim Spielerhandel wählt, wer ein Angebot
  annimmt, optional eigene Schiffe für die eingehende Ware: Sie fahren ihr entgegen (Treibstoff Hin- und Rückweg, ein
  Missionsplatz, Mission `geleit`) und sind mit ihr wieder daheim. Wird die Geleitmission zurückgerufen, fährt der
  Konvoi ohne Geleit weiter.
- **Geleit des Anbieters:** Wer ein Angebot über Ressourcen einstellt, kann Schiffe als Geleit für seine ausgehende Ware
  eintragen (`player_offer.escort`; nur Schiffe, die er beim Einstellen im Hafen hat). Die Schiffe bleiben bis zur
  Annahme im Hafen (nicht gebunden). Bei Annahme laufen sie aus dem Angebotshafen mit der Ware aus (Mission `geleit`,
  Treibstoff hin und zurück, ein Missionsplatz), begleiten sie bis zum Hafen des Käufers und fahren von dort heim (die
  Rückfahrt läuft durch Minen). Fehlen Schiffe, Treibstoff oder ein Missionsplatz, fährt die Ware ohne Geleit; der
  Anbieter erhält einen Hinweis. Für dieselbe Ware gibt es nur ein Geleit: Hat der Anbieter eines eingetragen, kann der
  Annehmende kein eigenes stellen (`offer_escorted`). Das Geleit kämpft mit den Modifikatoren seines Hafens.
- Anzeige: Konvois unterwegs in der Börse und auf der Karte (Route, Position, Geleit, Angriffe).

## Saisonende

Minenfelder, Blockaden und Konvois verfallen mit der Saison.
