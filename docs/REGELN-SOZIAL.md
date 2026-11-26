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

- Angebot: gibt Menge X einer Ressource oder Kredite, will Menge Y einer anderen Ressource oder Kredite (ganze Zahlen ≥ 1).
  Sichtbar für alle oder nur für die eigene Allianz (nur mit Allianz). Höchstens 10 offene Angebote je Spieler.
  Einstellen und Annehmen erst ab Hafenkommandantur Stufe `marketFromLevel` (wie die Börse).
- **Treuhand:** Beim Einstellen wird die angebotene Ware sofort aus dem Hafen (bzw. die Kredite vom Konto) abgezogen,
  Börsenkurse, Tages- und Kreditlimits sind nicht beteiligt. Rückzug durch den Anbieter erstattet sofort und vollständig,
  auch über die Lagerkapazität.
- **Annahme:** Nur durch einen anderen Spieler mit Hafen; ein Allianz-Angebot nur durch ein Mitglied derselben Allianz,
  der der Anbieter noch angehört (`not_ally`). Der Annehmende zahlt sofort. Ein Angebot kann genau einmal angenommen werden
  (`offer_gone`). Ressourcen reisen auf beiden Seiten als Lieferung mit Reisezeit `Entfernung der Häfen / convoySpeedKmh`
  (mindestens eine Minute) und werden bei Ankunft gutgeschrieben, auch über die Lagerkapazität. Kredite werden sofort gutgeschrieben.
- **Gebühr:** je empfangener Seite 2 % (Ressourcen ganzzahlig abgerundet, Kredite auf Cent abgerundet); einstellbar über
  `server_setting` `player_trade_fee` (0 bis 0,2). Die Gebühr verlässt das Spiel.
- Saisonende: Offene Angebote verfallen ohne Erstattung (wie Kredite und Lieferungen).
- **Börsenwert:** Spielerhandel verändert die Börsenkurse nicht; angezeigt wird der Börsenwert zur Orientierung.
  Jedes Angebot zeigt den Gegenwert beider Seiten zum aktuellen Börsenkurs (Ressourcen × Kurs, Kredite 1:1, ohne Gebühr)
  und die Differenz in Krediten und Prozent aus Sicht des Lesers. Ab mehr als 20 % Abweichung gibt es einen deutlichen
  Hinweis und vor der Annahme eine Rückfrage.
- **Handelsstatistik:** Die Börse zeigt für die letzten 7 Tage je Paar die angenommenen Angebote (Anzahl, Mengen) und
  das mittlere Tauschverhältnis (Summe gegen Summe) in Krediten je Einheit, die Gegenseite zum aktuellen Börsenkurs,
  neben dem Börsenkurs. Serverseitig bis zu 60 s zwischengespeichert.
