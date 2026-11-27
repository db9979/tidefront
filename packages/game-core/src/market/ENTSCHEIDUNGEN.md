# Börse Stufe 1 – Entscheidungen und offene Punkte

Stand: Börsenkern (`src/market/`). Verbindlich bleibt `docs/REGELN.md`; hier steht nur, was die
Spezifikation offen lässt, und wie der Code es löst. Alle Zahlen kommen aus `balance.json`.

## A. Lücke in der Garantie der Spezifikation (bitte entscheiden)

**Die Garantie „Gesamtwert zum Richtwert bewertet steigt nie“ gilt nur, solange der Markt am Richtwert startet.**

- Die Preisformel selbst hat keine Lücke: Kein Eigenschaftstest fand eine Folge von Geschäften ohne
  vergangene Zeit, die Kredite erzeugt. Kauf und Rückverkauf kosten immer mindestens beide Gebühren (2 × 4 %),
  die Unschärfe aus dem arithmetischen Mittel als Ausführungskurs liegt in der Größenordnung `i²`
  (bei `maxImpactPerTrade` 0,02 also höchstens rund 0,04 %).
- Die Bewertung zum Richtwert ist aber kein Maß für Gewinn, sobald der Kurs vom Richtwert entfernt steht
  (durch andere Spieler oder weil die Rückkehr zum Richtwert noch läuft). Gegenbeispiel, nachgerechnet mit dem Code:
  Stahl, Richtwert 1,00, Kurs 0,80. Spieler hat 1000,00 Kredite, kein Lager, Gesamtwert 1000,00.
  Er kauft 1000 Stahl: Kurswirkung 0,005, Ausführungskurs 0,802, Kosten 834,08 (davon 32,08 Gebühr).
  Danach: 165,92 Kredite plus 1000 Stahl unterwegs, zum Richtwert 1165,92. „Gesamtwert“ plus 165,92 ohne vergangene Zeit.
  Spiegelbildlich „gewinnt“ ein Verkauf, wenn der Kurs mehr als etwa 4,2 % über dem Richtwert steht.
- Das ist kein Kreditgewinn: Sofortiger Rückverkauf bringt weniger als 834,08 zurück. Es ist ein Kauf unter Richtwert,
  also eine Wette auf die Rückkehr zum Richtwert, und die ist als Spielmechanik vermutlich gewollt.
- Was die Tests deshalb prüfen:
  1. Markt startet am Richtwert: Gesamtwert (Kredite + Bestand + Lieferungen unterwegs, zum Richtwert) steigt nach
     keinem Schritt, mit `balance.json` und zusätzlich in einer verschärften Variante (ohne Kursband, fünffache Kurswirkung).
  2. Beliebiger Startkurs: Kauf und sofortiger Rückverkauf (und umgekehrt) verliert immer Kredite.
  3. Beliebiger Startkurs: Jede Folge, nach der der Spieler mindestens seine Anfangsmengen wieder hält, endet mit
     höchstens den Anfangskrediten.
- **Vorschlag zur Korrektur von REGELN.md:** Die Garantie umformulieren zu: „Keine Folge von Käufen und Verkäufen ohne
  vergangene Zeit, nach der der Spieler von jeder Ressource mindestens so viel hält wie vorher (Bestand plus Lieferungen),
  erhöht seine Kredite. Startet der Kurs am Richtwert, steigt außerdem der zum Richtwert bewertete Gesamtwert nicht.“
  Wer die ursprüngliche Formulierung für jeden Startkurs will, müsste Käufe unter und Verkäufe über dem Richtwert
  verbieten oder verteuern; das würde die Börse als Ausgleichsmechanik weitgehend abschaffen.

## B. Entscheidungen bei offenen Punkten

1. **Kredite in Hundertsteln.** Zustand und Journal führen Kredite als Zahl mit zwei Nachkommastellen, gerechnet wird in
   ganzen Hundertsteln. Kauf wird auf-, Verkaufserlös abgerundet. Liegt ein Betrag näher als 1e-7 Hundertstel an einem
   ganzen Hundertstel, gilt dieses (sonst würde `100 * 1,04 = 104,00000000000001` einen Hundertstel extra kosten).
   Kurse bleiben Gleitkommazahlen und werden nicht gerundet.
2. **Aufteilung von Betrag und Gebühr.** Marktanteil = `q * Ausführungskurs`, kaufmännisch auf Hundertstel gerundet;
   das Gebührenkonto erhält den Rest zum Spielerbetrag (enthält also die Rundungsdifferenz, nie negativ).
3. **`expectedPrice` ist der erwartete Ausführungskurs** (wie ihn `quote()` liefert), nicht der Kurs vor dem Handel.
   Abweichung relativ zum erwarteten Kurs. Fehlender, nicht endlicher oder nicht positiver `expectedPrice`: `slippage`.
4. **Kreditlimit** = Obergrenze des Kreditbestands: Ein Verkauf wird abgelehnt, wenn Kredite nach dem Verkauf über
   `creditLimitPerLevel * Stufe` lägen. Genau das Limit zu erreichen ist erlaubt. Käufe prüft das Limit nicht.
   Folge: Mit Hafenkommandantur 3 kann niemand über 15000 Kredite hinaus verkaufen.
5. **Tageslimit** zählt Käufe und Verkäufe zusammen, je Ressource, je Spielerzustand (`TraderState`); genau das Limit
   ist erlaubt. Abgelehnte Geschäfte zählen nicht. Seit v1.30 gleitendes 24-h-Fenster mit Fächern je voller Stunde
   (`window.ts`, `TraderState.tradeHours`; vorher Tageswechsel um Mitternacht, zuerst UTC, ab 0.24.2 Spielzeit).
6. **Minutenlimit:** Ein Handel wird abgelehnt, wenn in den letzten 60 Sekunden (`t > nowMs - 60000`) schon
   `tradesPerMinute` erfolgreiche Geschäfte liegen, über alle Ressourcen. Abgelehnte Geschäfte zählen nicht.
7. **Kursband, Vergleichskurs.** Der Verlauf speichert den Kurs nach jedem Handel. „Kurs vor einer Stunde“ ist der letzte
   Punkt bei oder vor `nowMs - 1h`, mit der Rückkehr zum Richtwert bis dorthin fortgeschrieben (ebenso 24 h).
   Ist der Markt jünger, gilt der älteste Punkt; bei leerem Verlauf der aktuelle Kurs vor dem Handel.
   Abweichung relativ zum Vergleichskurs. Der Verlauf wird auf das für 24 h Nötige gekürzt.
8. **Handelspause** gilt je Ressource, nicht für die ganze Börse. `halted` solange `nowMs < haltedUntilMs`;
   genau zum Ablauf darf wieder gehandelt werden. Bei `band` ändert sich am Markt nur `haltedUntilMs`
   (Kurs, Verlauf, `lastUpdateMs` bleiben), der Spielerzustand gar nicht.
9. **Reihenfolge `halted` vor `bad_qty`:** wie in REGELN.md. Unbekannte Ressource oder unbekannte Seite gibt es dort nicht
   als Code; beides wird als `bad_qty` abgelehnt (an dieser Stelle der Reihenfolge), um keinen neuen Code zu erfinden.
   Menge über `Number.MAX_SAFE_INTEGER` ebenfalls `bad_qty`.
10. **`band` wird zuletzt geprüft** (nach `price_bounds`), weil REGELN.md es getrennt nach der Liste nennt.
    Ein Handel, der Kursgrenze und Band zugleich verletzt, ergibt `price_bounds` und löst keine Pause aus.
11. **Lieferung:** `arriveMs = nowMs + ceil(Entfernung / convoySpeedKmh * 3600000)`; Entfernung ≤ 0 oder ungültig zählt als 0.
    Die Lieferungs-ID ist `context.tradeId` (der Aufrufer vergibt sie; der Kern hat weder Zufall noch Zähler).
    Der Kern verwaltet keine Liste offener Lieferungen und prüft beim Kauf keine Lagerkapazität
    (REGELN.md: Lieferungen dürfen über die Kapazität hinausgehen).
12. **Rückgabe bei Ablehnung:** `{ ok: false, code, market, trader }`. `market` ist außer bei `band` das unveränderte
    Eingabeobjekt, `trader` immer.
13. **`quote()`** rechnet nur den Preis (Kurs vorher/nachher, Ausführungskurs, Beträge) und lehnt nur `bad_qty` ab.
    Die spielerbezogenen Prüfungen macht erst `executeTrade`.
14. **`MarketState`** ist ein Objekt mit einem Eintrag je Ressource; ein Handel ersetzt nur den Eintrag seiner Ressource.
    Hilfsfunktionen `createMarketState` (alle Kurse am Richtwert) und `createTraderState` liegen in `trade.ts`.
15. **Zeit läuft rückwärts** (`nowMs` kleiner als `lastUpdateMs`): Die Rückkehr zum Richtwert rechnet dann mit Δt = 0.

## C. Hinweise zu den Tests

- Die Eigenschaftstests spielen alle Geschäfte einer Folge zum selben Zeitpunkt. Dafür heben sie in einer Kopie des
  Balance-Objekts nur `tradesPerMinute` an (sonst endet jede Folge nach 10 Geschäften). Die verschärfte Variante setzt
  zusätzlich die Kursbänder außer Kraft und verfünffacht `maxImpactPerTrade`, damit die Kurse bis an
  `floorFactor`/`ceilFactor` laufen. `balance.json` selbst bleibt unverändert.
- Mit den Originalwerten endet eine Folge praktisch, sobald das Stundenband auslöst (Handelspause bei fester Zeit);
  der Kurs bleibt dort also innerhalb von ±10 % um den Richtwert.

## E. Marktnachrichten (Balance v1.5)

1. **Richtwert, nicht Kurs.** `quote`, `currentPrice` und `executeTrade` nehmen optional `refPrices` (effektiver Richtwert
   je Ressource). Fehlt er oder ist ein Wert nicht endlich bzw. nicht positiv, gilt `refPrice` aus `balance.json`.
   Ohne Nachrichten übergibt der Server `undefined`; Ergebnisse sind dann bit-gleich (Test „ohne Nachrichten bit-gleich“).
2. **Kursgrenzen am Grundrichtwert.** `price_bounds` prüft gegen `floorFactor/ceilFactor × refPrice` (Grundrichtwert).
   Begründung: Manipulationssicherheit. Einzelne Anlässe (Kriegserklärungen, Lagerbestände) kann ein Spieler mit
   beeinflussen; der harte Korridor soll davon unabhängig fest bleiben. Bei ±25 % Höchstversatz und 0,4/2,5 als Grenzen
   ist der Korridor auch um den effektiven Richtwert noch weit (mindestens 0,32 … 2,0 davon).
3. **Kursband mit tatsächlichen Kursen.** Das Band vergleicht wie bisher mit dem Kurs vor 1 h bzw. 24 h; fortgeschrieben
   (Rückkehr) wird dabei mit dem effektiven Richtwert zum Handelszeitpunkt. Eine reine Richtwertänderung kann das Band
   nicht auslösen, da der Richtwert sich höchstens 5 % je Stunde bewegt und der Kurs ihm nur mit der Halbwertszeit folgt.
4. **Sanfte Änderung mit gespeichertem Stand.** Der effektive Versatz wird im Worker alle 10 Minuten fortgeschrieben und
   gespeichert (`server_setting` „market_ref_offsets“); Börse, Angebot und Handel schreiben ihn lazy vom gespeicherten
   Stand bis zur Anfrage fort (höchstens 5 %/h Richtung Ziel). Damit ist der Richtwert zu jedem Zeitpunkt eindeutig
   und nicht durch den Zeitpunkt einer Anfrage beeinflussbar. Ohne gespeicherten Stand beginnt er bei 0.
5. **Garantie.** Die Eigenschaftstests (`market-news.property.test.ts`) prüfen mit zufälligen Versätzen im ganzen Bereich
   ±25 %: Gesamtwert zum effektiven Richtwert steigt nicht (Markt am effektiven Richtwert), Kauf und Rückverkauf verliert
   immer, keine Folge mit wiederhergestellten Mengen bringt Kredite; die Kurse bleiben in den Grenzen des Grundrichtwerts.
6. **Rundung gegen Nachrichtenflut.** Wirkungen werden auf 0,1 Prozentpunkte gerundet, Kriegslage und Knappheit auf ganze
   Prozent; nur eine geänderte Wirkung erzeugt eine neue Nachricht.
