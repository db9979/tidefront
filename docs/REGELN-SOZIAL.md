# TIDEFRONT – Allianzen, Diplomatie und Handel zwischen Spielern

Teil von `docs/REGELN.md` (dort aus Platzgründen ausgelagert). Verbindlich für Server und Oberfläche;
Umsetzung in `packages/engine` (Allianzen, Diplomatie, Spielerhandel), Tabellen in `packages/db/src/schema/social.ts`.

## Allianzen

- Eine Allianz hat einen Namen (3–32 Zeichen) und ein Kürzel (2–4 Buchstaben oder Ziffern), beide eindeutig ohne
  Groß-/Kleinschreibung, dazu eine Beschreibung (höchstens 500 Zeichen). Ein Spieler gehört höchstens einer Allianz an.
- Höchstgröße: Vorgabe 8 Mitglieder, von Admins einstellbar (2–50, `server_setting` `alliance_max_size`).
  Eine verkleinerte Höchstgröße entfernt niemanden, verhindert aber weitere Aufnahmen.
- Rollen: **Führung** (genau eine), **Offizier**, **Mitglied**. Der Gründer ist Führung.
  - Beitritt nur auf Gegenseitigkeit: Führung oder Offizier lädt ein und der Spieler nimmt an, oder der Spieler fragt an
    und Führung oder Offizier nimmt an. Liegt die Gegenrichtung schon vor, wirkt die zweite Handlung sofort als Beitritt.
  - Ausschließen: die Führung jeden außer sich, Offiziere nur Mitglieder. Rollen vergibt nur die Führung; „Führung
    übergeben“ macht die bisherige Führung zum Offizier. Auflösen darf nur die Führung.
  - Austritt jederzeit. Tritt die Führung aus, übernimmt der dienstälteste Offizier, sonst das dienstälteste Mitglied.
    Tritt das letzte Mitglied aus, ist die Allianz aufgelöst.
- **Verbündete** (dieselbe Allianz) können einander nicht überfallen: `ueberfall` auf einen verbündeten Hafen wird beim
  Planen mit `ally` abgelehnt. Aufklärung und Transport bleiben erlaubt. Wie beim Schutz zählt der Stand beim Planen;
  ein Verband, der vor dem Beitritt ausgelaufen ist, kämpft noch.
- Allianz-Chat: höchstens 500 Zeichen je Zeile, 20 Zeilen je Minute und Spieler, sichtbar sind die letzten 100 Zeilen.
- Saisonende: Allianzen, Mitgliedschaften, Chat und Verträge bleiben bestehen. Die Allianzwertung zum Saisonende wird
  in `season_alliance_result` festgehalten (Ruhmeshalle).
- Wertung: Allianzpunkte = Summe der Gesamtpunkte der aktuellen Mitglieder; Rang nach Allianzpunkten, Gleichstand teilt den Rang.
  Das Kürzel steht in Rangliste und Spielerübersicht vor dem Namen.
- Saisonende: Allianzen, Mitgliedschaften, Chat und Verträge bleiben bestehen. Allianzpunkte werden nicht in
  `season_result` festgehalten.

## Diplomatie

- Parteien sind Allianzen und Spieler ohne Allianz. Für eine Allianz handeln Führung und Offiziere. Tritt ein Spieler
  einer Allianz bei (oder gründet eine), erlöschen seine eigenen Verträge; es gelten die der Allianz. Beim Auflösen einer
  Allianz erlöschen ihre Verträge. Die Gegenseite erhält jeweils eine Systemnachricht.
- **Nichtangriffspakt:** Eine Seite bietet an, die andere nimmt an (bietet sie ihrerseits an, gilt er sofort). Solange er
  gilt, wird `ueberfall` zwischen den Parteien beim Planen mit `pact` abgelehnt. Kündigen kann jede Seite; der Pakt gilt
  dann noch 24 Stunden (Kündigungsfrist) und erlischt danach. Ein offenes Angebot kann zurückgezogen oder abgelehnt werden.
- **Krieg:** Eine Seite erklärt ihn einseitig. Er beginnt nach 12 Stunden Vorlauf. Bei bestehendem Pakt (auch während der
  Kündigungsfrist) ist keine Kriegserklärung möglich (`pact_active`), im Krieg kein Paktangebot (`at_war`).
  Im Krieg entfällt bei gegenseitigen Überfällen die **Schwachziel-Kürzung** der Beute: Maßgeblich ist, ob bei der
  Ankunft des Verbands (Kampfzeitpunkt) Krieg herrscht. Alle übrigen Regeln (Schutz, Wiederholungsfaktor, Ladung) gelten weiter.
- **Frieden:** Die erklärende Seite kann die Kriegserklärung während des Vorlaufs zurückziehen. Sonst bietet eine Seite
  Frieden an; bietet die andere ebenfalls an, endet der Krieg sofort.
- Jede Änderung (Angebot, Pakt, Kündigung, Kriegserklärung, Frieden) erzeugt Systemnachrichten an die Betroffenen.

## Handel zwischen Spielern

- Angebot: gibt Menge X einer Ressource oder Taler, will Menge Y einer anderen Ressource oder Taler (ganze Zahlen ≥ 1).
  Sichtbar für alle oder nur für die eigene Allianz (nur mit Allianz). Höchstens 10 offene Angebote je Spieler.
  Einstellen und Annehmen erst ab Hafenkommandantur Stufe `marketFromLevel` (wie die Börse).
- **Treuhand:** Beim Einstellen wird die angebotene Ware sofort aus dem Hafen (bzw. die Taler vom Konto) abgezogen,
  Börsenkurse, Tageslimits und Kasse sind nicht beteiligt. Rückzug durch den Anbieter erstattet sofort und vollständig,
  auch über die Lagerkapazität.
- **Annahme:** Nur durch einen anderen Spieler mit Hafen; ein Allianz-Angebot nur durch ein Mitglied derselben Allianz,
  der der Anbieter noch angehört (`not_ally`). Der Annehmende zahlt sofort. Ein Angebot kann genau einmal angenommen werden
  (`offer_gone`). Ressourcen reisen auf beiden Seiten als Lieferung mit Reisezeit `Entfernung der Häfen / convoySpeedKmh`
  (mindestens eine Minute) und werden bei Ankunft gutgeschrieben, auch über die Lagerkapazität. Taler werden sofort gutgeschrieben.
- **Gebühr:** je empfangener Seite 2 % (Ressourcen ganzzahlig abgerundet, Taler auf Cent abgerundet); einstellbar über
  `server_setting` `player_trade_fee` (0 bis 0,2). Die Gebühr verlässt das Spiel.
- Saisonende: Offene Angebote verfallen ohne Erstattung (wie Taler und Lieferungen).
- **Börsenwert:** Spielerhandel verändert die Börsenkurse nicht; angezeigt wird der Börsenwert zur Orientierung.
  Jedes Angebot zeigt den Gegenwert beider Seiten zum aktuellen Börsenkurs (Ressourcen × Kurs, Taler 1:1, ohne Gebühr)
  und die Differenz in Talern und Prozent aus Sicht des Lesers. Ab mehr als 20 % Abweichung gibt es einen deutlichen
  Hinweis und vor der Annahme eine Rückfrage.
- **Handelsstatistik:** Die Börse zeigt für die letzten 7 Tage je Paar die angenommenen Angebote (Anzahl, Mengen) und
  das mittlere Tauschverhältnis (Summe gegen Summe) in Talern je Einheit, die Gegenseite zum aktuellen Börsenkurs,
  neben dem Börsenkurs. Serverseitig bis zu 60 s zwischengespeichert.

## Sammelangriff und Stationierung (Allianz-Ops)

Umsetzung: Regeln rein in `packages/game-core/src/alliance-ops.ts`, Server in `packages/engine/src/alliance-ops-*.ts`,
Tabellen `alliance_raid` und `alliance_raid_member` in `packages/db/src/schema/alliance-ops.ts`. Werte in
`balance.allianceOps` (`raid`, `station`).

### Sammelangriff

- **Eröffnen:** jedes Allianzmitglied, gleich mit dem eigenen Verband (Missionsplanung → Überfall → „als Sammelangriff
  eröffnen“). Ziel: ein feindlicher Spielerhafen (Überfall-Schutzregeln: nicht Verbündete `ally`, nicht Paktpartner
  `pact`, kein geschützter Hafen `target_protected`), ein Piratennest oder ein Weltereignis mit festem Ort (Großflotte,
  Belagerungsring; nicht das fahrende Schatzschiff, `raid_bad_target`). Beitrittsfrist `raid.minJoinMinutes` bis
  `raid.maxJoinHours` nach dem Eröffnen; gewünschte Ankunft frühestens zur Frist, spätestens `raid.maxArriveHours`.
  Höchstens `raid.maxOpenPerAlliance` offene Sammelangriffe je Allianz.
- **Beitreten:** Mitglieder derselben Allianz bis zur Frist, je Spieler ein Verband, höchstens `raid.maxParticipants`
  Verbände. Geplant wie ein Überfall vom eigenen Hafen (Verband, Kommandopunkte, Missionsplatz, Treibstoff hin und
  zurück); Einheiten und Treibstoff sind ab dem Beitritt gebunden (Mission „staged“), der Missionsplatz ist belegt.
  Die Schutzregeln gelten je Teilnehmer (z. B. `own_siege` für den Belagerten).
- **Rückzug vor dem Auslaufen:** Verband und Treibstoff kommen sofort zurück. **Abbrechen** (alle zurück) dürfen
  Eröffner, Führung und Offiziere. Austritt, Ausschluss oder Auflösung beenden die Teilnahme; ohne Allianz bricht der
  Angriff ab.
- **Auslaufen zur Frist:** Ziel und Teilnehmer werden erneut geprüft (Schutz, Diplomatie); wer nicht mehr darf, bleibt im
  Hafen. Reisezeit je Verband mit Forschung und Sturm auf der Route zum Zeitpunkt der Frist. Ankunft =
  max(gewünschte Ankunft, Frist + längste Reisezeit) – der langsamste bestimmt, ggf. später als gewünscht. Jeder läuft
  zu Ankunft − eigene Reisezeit aus. Danach gilt der normale Rückruf; ein zurückgerufener Verband kommt nicht mehr an.
  Ohne Teilnehmer verfällt der Angriff.
- **Radar:** Alle Verbände tragen dieselbe Ankunft und den schwächsten Tarnfaktor der Teilnehmer; die Vorwarnung
  (Push) des Ziels kommt einmal für den ganzen Angriff.
- **Kampf:** Alle angekommenen Verbände bilden eine Streitmacht in einem einzigen `resolveBattle`. Modifikatoren je
  Teilnehmer werden gemittelt: Angriff (Gattung × Einheit × Versorgungsmangel) je Einheitentyp nach Anzahl,
  Lebenspunkte je Gattung nach Lebenspunkten, Angriff gegen Zielarten und Beutefaktor nach Kampfwert, Minenschaden nach
  Truppen. Überlebende je Typ werden anteilig zum Einsatz auf die Besitzer verteilt, Rückkehrer (Lazarett, beschädigte
  Flugzeuge) anteilig zu den Verlusten (größte Reste, bei Gleichstand der frühere Teilnehmer). Verluste trägt jeder für
  seine Einheiten. Wiederholungsfaktor: frühere Überfälle aller Teilnehmer auf diesen Hafen im Zeitfenster;
  Schwachziel-Kürzung, wenn das Ziel für einen Teilnehmer (ohne Krieg) ein Schwachziel ist.
- **Beute nach Kampfbeitrag:** Beitrag = Kampfwert der eingesetzten Einheiten vor dem Kampf (je Einheit Lebenspunkte ×
  Summe der Angriffswerte, mit den Modifikatoren des Besitzers). Anteil = Beitrag / Summe. Jeder lädt höchstens seinen
  Laderaum (überlebende Einheiten, mit eigener Ladungsforschung); der Rest geht nach demselben Schlüssel an die anderen.
  Insgesamt höchstens die Summe der Laderäume. Ganzzahlig je Ressource: abgerundet, verbleibende Einheiten nach
  größtem Rest (Gleichstand: früherer Teilnehmer). Danach birgt jeder Wrackgut mit seinem freien Laderaum.
- **Weltereignis:** Der Sammelangriff zählt als ein Sieger (Ende des Ereignisses mit dem ersten Teilnehmer als
  Sieger). Beute aus dem Beutepool nach vernichteten Lebenspunkten, geteilt nach demselben Schlüssel; der Schaden wird
  den Teilnehmern nach Beitrag gutgeschrieben.
- **Bericht:** ein gemeinsamer Kampfbericht (Art `sammelangriff`) für alle Teilnehmer und das Ziel, mit Tabelle
  Teilnehmer / Beitrag % / Verluste / Beute. Systemnachrichten an die Teilnehmer bei Eröffnung (an die ganze Allianz),
  Beitritt, Rückzug, Auslaufen und Ergebnis; Push bei Eröffnung, Beitritt, Auslaufen und Ergebnis. Veteranen sammeln
  Erfahrung mit ihrem Anteil der Streitmacht.

### Stationierung

- Missionsart **Stationieren**: Schiffe, Landtruppen und Flugzeuge (keine Spione) in den Hafen eines Verbündeten
  (dieselbe Allianz, sonst `station_not_ally`). Geplant wie ein Transport ohne Ladung (Treibstoff hin und zurück).
  Höchstens `station.maxPerBase` stationierte oder anfahrende verbündete Verbände je Hafen (`station_full`).
- Am Ziel bleibt der Verband stationiert (Mission „stationed“), belegt weiter den Missionsplatz beim Besitzer und zählt
  in dessen Unterhalt (die Einheiten bleiben „unterwegs“). Ist der Gastgeber bei Ankunft kein Verbündeter mehr oder kein
  Liegeplatz frei, kehrt er um.
- **Verteidigung:** Bei jedem Kampf im Hafen (Spielerüberfall, Kartell, Sammelangriff) kämpfen die stationierten
  Einheiten als zusätzliche Verteidiger, unter den Modifikatoren des Gastgebers. Das Ergebnis wird wie beim
  Sammelangriff nach Besitzer getrennt; Verluste trägt der Besitzer. Ganz vernichtete Verbände sind erledigt.
- **Ende:** Rückruf durch den Besitzer oder Heimschicken durch den Gastgeber – Heimfahrt mit einer Reisezeit; auf der
  Anfahrt gilt der normale Rückruf. Austritt, Ausschluss oder Auflösung der Allianz schicken die Truppen automatisch heim
  (in beide Richtungen).
- Anzeige: Der Gastgeber sieht die stationierten Verbände unter Truppen („Verbündete im Hafen“), der Besitzer unter den
  Missionen als „stationiert“.
