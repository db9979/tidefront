# Vorlage: Lieferverträge mit den KI-Reedereien (Termingeschäfte)

**Status: Vorlage zur Freigabe** (27.11.2026, Version 0.28.3, Balance v1.29). Nichts davon ist umgesetzt. Zahlen sind
Startwerte für einen neuen Block `market.contracts`. Rechnung: `/tmp/tf-review/termin/sim.ts` (Börsenkern aus
`packages/game-core/src/market`, Rückkehr-Halbwertszeit schon auf 24 h gesetzt).

Berücksichtigt ist, was parallel umgesetzt wird: Rückkehr-Halbwertszeit 24 h, dynamischer Richtwert „Handelsbilanz“
±15 % (72 h, je Spieler höchstens ⅓ der Wirkung), gleitendes 24-h-Tageslimit, Saisonchart.

## 1. Ziel

Die Börse kennt nur den Sofortkauf. Wer plant („in drei Tagen brauche ich 8 000 Stahl für die Werft“), wer selten
online ist oder wer Überschuss gleichmäßig loswerden will, hat heute kein Werkzeug. Lieferverträge sollen

- **Planung belohnen:** Preis heute festmachen, Ware später bekommen; Abos versorgen auch, wenn man nicht eingeloggt ist.
- **Die KI-Spieler zu Handelspartnern machen:** Reederei Albers, Bastion Falkenberg und Kapitän Rotbart bieten Verträge
  mit eigenem Charakter an, aus ihren echten Lagern.
- **Keine Geldmaschine sein:** Ein Vertrag ist nie billiger als der Sofortkauf an der Börse. Er kostet einen kleinen
  Aufpreis für Laufzeit und Sicherheit.

Verträge zwischen Menschen sind **nicht** Teil von Stufe 1 (Abschnitt 9, Frage 9).

## 2. Befund (warum die Preisformel so streng ist)

- Die Börse kehrt **nicht** verlässlich zum Richtwert zurück. In der Börsen-Simulation (`/tmp/tf-review/boerse`,
  dynamischer Richtwert + 24 h) steht Stahl dauerhaft bei **1,52 ×** Richtwert, Proviant bei **0,67 ×**, Treibstoff bei
  **0,73 ×**: Die Nachfrage der Spieler hält den Kurs dort.
- Ein Vertragspreis aus dem **Richtwert** oder aus dem „erwarteten Kurs“ wäre deshalb sofort eine Geldmaschine: Stahl auf
  Termin zu 1,26 (erwarteter Kurs in 3 Tagen 1,20 + Aufschlag) kaufen und bei Lieferung zu 1,52 × 0,96 = 1,46 verkaufen
  ergibt **+16 %** je Durchgang.
- Folge: Der Vertragspreis nimmt für den Käufer **den höheren**, für den Verkäufer **den niedrigeren** von heutigem Kurs
  und erwartetem Kurs bei Lieferung.

## 3. Regeln

### 3.1 Vertragsarten

| Art | Inhalt | Laufzeit | Beispiel |
|---|---|---|---|
| **Kaufvertrag** | Spieler kauft Menge X einer Ressource von einer KI zu festem Preis, Lieferung bei Fälligkeit | 1, 2, 3, 5 oder 7 Tage | 8 000 Stahl in 3 Tagen von Albers |
| **Verkaufsvertrag** | Spieler liefert Menge X an eine KI zu festem Preis, Zahlung bei Fälligkeit | 1, 2, 3, 5 oder 7 Tage | 6 000 Proviant in 2 Tagen an Albers |
| **Abo** | täglich X für 3–7 Tage (Kauf oder Verkauf), erste Tranche nach 24 h | je Tranche eigene Laufzeit | täglich 2 000 Proviant für 7 Tage |

- Mindestmenge je Vertrag bzw. Tranche **500**, Höchstmenge siehe 3.6.
- Höchstens **5 offene Verträge** je Spieler (ein Abo zählt als einer), höchstens **3 Abschlüsse je Stunde**.
- Lieferhafen: der beim Abschluss aktive eigene Hafen (bei mehreren Häfen wählbar).

### 3.2 Preis

Bezeichnungen: K = Kurs jetzt (nach Rückkehr), R = effektiver Richtwert jetzt, R_T = Richtwert bei Fälligkeit (heutiger
Richtwert plus **angekündigte** Marktnachrichten, z. B. Saisonende +8 % Stahl/Elektronik oder Kartell-Armada im Finale),
T = Laufzeit, Halbwertszeit 24 h, Tiefe = `market.depth`.

- Erwarteter Kurs bei Fälligkeit: **E = R_T + (K − R) × 0,5^(T / 24 h)**
- Aufschlag: **a = 4 % (wie Börsengebühr) + 0,5 % je Tag Laufzeit + Menge / (2 × Tiefe)** (der letzte Teil entspricht der
  Kurswirkung eines gleich großen Sofortkaufs)
- **Kaufvertrag: Preis = max(K, E) × (1 + a)**
- **Verkaufsvertrag: Preis = min(K, E) × (1 − a)**
- Abo: jede Tranche mit ihrer eigenen Laufzeit gerechnet, angezeigt als Durchschnittspreis.
- Charakterzuschläge der KI siehe 3.5. Der Preis gilt beim Abschluss fest; Angebote werden wie ein Börsenangebot mit
  erwartetem Preis bestätigt (Abweichung > 1 % → neu anbieten).
- **Keine neuen Verträge** in einer Ressource während ihrer Handelspause (Kursband) – sonst ließe sich ein veralteter
  Preis im Schock festmachen. Preis immer innerhalb `floorFactor … ceilFactor` × Grundrichtwert.

Damit kostet ein Kaufvertrag bei Kurs = Richtwert **0,1–0,4 % mehr** als derselbe Sofortkauf je Tag Laufzeit
(Rechnung B), bei Kurs über dem erwarteten Kurs genau den Laufzeitaufschlag mehr, bei Kurs darunter deutlich mehr
(dann kauft man besser sofort – gewollt).

### 3.3 Sicherheit: Anzahlung und Pfand

- **Kaufvertrag:** **25 % Anzahlung** sofort (Treuhand, wird angerechnet), Rest **automatisch bei Fälligkeit** vom Konto.
- **Verkaufsvertrag:** **25 % Pfand** des Vertragswerts in Kredite sofort (Treuhand). Die Ware bleibt bis zur Fälligkeit
  im Hafen und wird dann abgebucht.
- **Reicht es bei Fälligkeit nicht** (Kredite bzw. Ware): **12 h Nachfrist** mit Erinnerung. Danach wird **anteilig**
  erfüllt, so weit Kredite bzw. Ware reichen. **Für den nicht erfüllten Teil verfallen 25 % seines Vertragswerts**
  (Anzahlung bzw. Pfand); der Rest des Pfands geht zurück.
- **Kündigung** vor Fälligkeit jederzeit: gleiche Folge (25 % des gekündigten Teils verfallen).
- Treuhandbeträge sind nicht plünderbar und nicht übertragbar. Die Treuhandware der KI ebenso.

### 3.4 Lieferung

- **Albers und Falkenberg: abstrakt wie die Börsenlieferung**, Ware trifft genau zur Fälligkeit ein, nicht abfangbar.
  Lieferungen dürfen wie Börsenlieferungen über die Lagerkapazität hinausgehen (`REGELN.md`).
- **Rotbart: als Konvoi über die Seewege** ab Rotbarts Hafen (`naval-convoy.ts`), Abfahrt so, dass er zur Fälligkeit
  ankommt. Kartellwürfel gilt, Kriegsgegner des Empfängers können abfangen, **Geleit** wie beim Spielerhandel möglich.
  Verlust trägt der Käufer (dafür der Rabatt in 3.5); keine Erstattung.
- **Belagerung** des Lieferhafens: Kauflieferungen warten bis zum Ende des Belagerungsrings (Restzahlung erst dann).
  **Blockade:** Verkaufslieferungen des Spielers warten bis zum Ende. Höchstens 24 h, danach normal.
- **Erkannter Angriff:** Abschluss neuer Verkaufsverträge gesperrt (wie `under_attack` an der Börse); fällige Lieferungen
  laufen trotzdem (sie waren vorher festgelegt).

### 3.5 Die KI als Gegenpartei

| KI | bietet an | Laufzeit | Besonderheit |
|---|---|---|---|
| **Reederei Albers** (Händler) | Kauf- und Verkaufsverträge, alle vier Ressourcen, Abos | 1–7 Tage | Grundpreis |
| **Bastion Falkenberg** (Festung) | kauft Stahl und Elektronik (Spieler liefert), auch Abos | 2–7 Tage | „Rüstungsbedarf“: Abschlag **2 Prozentpunkte kleiner** |
| **Kapitän Rotbart** (Freibeuter) | verkauft Treibstoff und Elektronik „aus Prisen“ | 1–2 Tage | Aufschlag **2 Prozentpunkte kleiner**, Konvoi-Lieferung (3.4), höchstens 2 000 je Vertrag |

**Aus echten Lagern (Empfehlung, Frage 3):**
- Eine KI **verkauft** eine Ressource nur, wenn ihr Lager davon zu mindestens **40 %** gefüllt ist; Kontingent höchstens
  **25 % ihres Bestands** abzüglich schon zugesagter Mengen. Beim Abschluss geht die Ware der KI in Treuhand.
- Eine KI **kauft** nur, wenn ihr Lager höchstens zu **60 %** gefüllt ist; Kontingent höchstens **25 % ihres freien
  Lagerplatzes**, und die KI legt den Kaufpreis beim Abschluss in Treuhand (sie kann nicht zahlungsunfähig werden).
- **Je Mensch höchstens ⅓** des Kontingents einer KI je Ressource (in einer Runde mit 3–10 Menschen bleibt für alle etwas).
- Kontingente werden bei jedem Abruf aus dem KI-Lager berechnet (nichts zu speichern, leicht für den Pi).
- Albers und Falkenberg schließen **24 h lang** nichts mit einem Spieler ab, der sie angegriffen hat; Rotbart ist das egal.
- Ohne KI-Spieler in der Runde (oder alle KI ohne Kontingent) gibt es keine Verträge; der Reiter sagt das.

**Geldfluss:** Der Grundaufschlag von 4 % geht in den Gebührentopf (Senke wie an der Börse), Laufzeit- und
Mengenaufschlag sowie verfallene Anzahlungen gehen an die KI (Frage 4).

### 3.6 Grenzen (Tageslimit, Kreditlimit)

- **Tageslimit:** Jede Vertragslieferung (Kauf wie Verkauf, jede Abo-Tranche) wird **bei Lieferung** ins gleitende
  24-h-Tageslimit der Ressource gebucht; sie scheitert nie am Limit. Beim **Abschluss** gilt: Vertragslieferungen einer
  Ressource in jedem 24-h-Fenster ≤ **50 % des Tageslimits**. Für die Börse gilt ab sofort:
  **freier Rahmen = Tageslimit − Umsatz der letzten 24 h − Vertragslieferungen der nächsten 24 h.**
  So bleibt jedes 24-h-Fenster unter dem Limit, und ein Abo verdrängt nur den Teil, den es wirklich nutzt.
- **Kreditlimit:** Offene Restzahlungen aller Kaufverträge ≤ Kreditlimit (`creditLimitPerLevel` × Stufe). Verkaufsverträge:
  beim Abschluss Kredite + offene Verkaufserlöse ≤ Kreditlimit; bei Lieferung wird voll gutgeschrieben (auch über das
  Limit, dann sind Börsenverkäufe gesperrt wie heute).
- **Handelsbilanz** (dynamischer Richtwert): Vertragslieferungen zählen bei Lieferung wie Börsenumsatz mit, sonst
  ließe sich die Bilanz am Markt vorbei verschieben. Die ⅓-Grenze je Spieler gilt unverändert.

### 3.7 Saisonende

- Fälligkeit (auch jeder Abo-Tranche) spätestens **24 h vor Saisonende**; der Reiter bietet nur passende Laufzeiten an.
- Angekündigte Saisonend-Nachrichten (+8 % Stahl/Elektronik in den letzten 7 Tagen, Kartell-Armada im Finale) stecken
  schon in R_T – ein Kauf vor Tag 35 auf Lieferung danach bringt keinen „Saisonend-Gewinn“.
- Endet die Saison außerplanmäßig: alle offenen Verträge rückabgewickelt (Anzahlungen, Pfänder, Treuhandware zurück).

### 3.8 Oberfläche

- **Börse, neuer Reiter „Verträge“** mit zwei Bereichen:
  - **Angebote:** je KI eine Karte (Ressource, Richtung, Kontingent, Laufzeit-Auswahl, Mengenregler). Anzeige: Preis je
    Einheit, **„an der Börse jetzt: x“** zum Vergleich, Anzahlung, Gesamtpreis, Fälligkeit, bei Rotbart Seeweg und
    Abfangrisiko wie beim Spielerhandel.
  - **Meine Verträge:** Liste mit Restzeit, Status (offen / fällig / Nachfrist / erfüllt / teilweise erfüllt / gekündigt),
    Knopf „Kündigen“ mit genauer Strafe.
- Tageslimit-Anzeige der Börse: „davon für Verträge vorgemerkt: y“.
- **Erinnerungen** (Systemnachricht, Push wenn eingeschaltet): 6 h vor Fälligkeit, wenn Kredite bzw. Ware nicht reichen;
  bei Beginn der Nachfrist; bei Lieferung. Saisonchart: Vertragslieferungen als kleine Marken (optional).
- Hilfe-Text: „Ein Vertrag ist nie billiger als die Börse. Du zahlst für den festen Preis und für die Lieferung später.“

## 4. Balance-Begründung (Rechnung)

**A) Kauf auf Termin, bei Lieferung sofort an der Börse verkaufen** (Kurse aus der Börsen-Simulation, Menge 10 000,
Richtwert am Anschlag der Handelsbilanz). Nötiger Kursanstieg über max(K, E), damit es sich lohnt:

| Ressource (Kurs / erwarteter Kurs) | 1 Tag | 3 Tage | 7 Tage | Leerverkauf: nötiger Fall unter min(K, E), 1 / 7 Tage |
|---|---|---|---|---|
| Stahl (1,52 / 1,34–1,15) | +14,3 % | +15,4 % | +17,5 % | −12,8 % / −15,6 % |
| Treibstoff (1,31 / 1,42–1,53) | +18,1 % | +19,2 % | +21,4 % | −15,7 % / −18,5 % |
| Elektronik (3,00 / 3,00) | +28,2 % | +29,4 % | +31,6 % | −22,6 % / −25,3 % |
| Proviant (0,40 / 0,46–0,51) | +16,2 % | +17,3 % | +19,4 % | −14,2 % / −15,2 % |

Ohne Überraschung verliert jeder Durchgang 14–35 %. Nur ein **unvorhersehbarer** Schock von dieser Größe macht ihn
lohnend – das ist die gewollte Absicherung, keine Maschine.

**B) Großmenge sofort vs. Termin 1 Tag** (Kurs = Richtwert): Termin teurer um 0,1–0,4 % (z. B. Stahl 20 000: sofort
1,092, Termin 1,095 je Einheit). Der Mengenaufschlag nimmt den Vorteil „Großmenge ohne Kurssprung“ weg.

**C) Planbare Manipulation nach Abschluss.** Ein Spieler kann den Richtwert selbst höchstens um rund 5 % schieben
(Handelsbilanz, ⅓ der ±15 %), bei Treibstoff mit Kriegserklärungen theoretisch +13 % (alle vier Kriege auf einmal). Der
Kurs folgt mit Halbwertszeit 24 h. Ergebnis eines Kaufs auf Termin + Verkauf bei Lieferung (Menge 5 000):
Stahl / Proviant −7 bis −9 %, Elektronik −12 bis −14 %, Treibstoff selbst im Extrem (+13 %) −2,7 bis −6,1 %.
Rotbart (2 Punkte billiger, nur 1–2 Tage) im Extrem bei 2 Tagen: −1,8 % plus Konvoirisiko.

**D) Kurs pumpen** (echter Börsenkern, Bänder aktiv, Tages- und Kreditlimit ausgeschaltet): 10 000 Stahl auf Termin zu
10 700 gekauft, dann X Stahl zusätzlich gekauft und alles verkauft. Netto: X = 0 → **−1 333**, 10 000 → −2 154,
20 000 → −3 075, 40 000 → −5 170. Pumpen kostet mehr Gebühren, als es bringt. Das Tageslimit (20 % Lager,
Verträge ≤ die Hälfte davon) verhindert die großen Mengen ohnehin.

**E) Anzahlung als Ausstiegsrecht.** Wer bei fallendem Kurs nicht zahlt, verliert 25 %. Wert dieses „Ausstiegs“ bei
starker Kursbewegung (5 % / 10 % je Tag): 3 Tage 0,05 % / 1,1 %, 7 Tage 0,6 % / 3,5 % – stets unter dem Aufschlag
(≥ 4,5 %) plus Börsengebühr beim Weiterverkauf (4 %). Erwartung des Spekulanten −8 bis −11 %. Mit nur **10 %**
Anzahlung wäre der Ausstieg bis 10 % wert und Spekulation fast kostenlos – daher 25 %.

**F) Abo** 7 × 2 000 Proviant (Kurs 0,40, Richtwert 0,51): 7 385 Kredite, Ø 0,528; täglich an der Börse erwartet
7 199 → **+2,6 %** für die Bequemlichkeit. Wer jetzt Lagerplatz hat, kauft bei diesem Kurs besser sofort (0,416).

**Kreisläufe:** Sofort kaufen + an Falkenberg auf Termin verkaufen verliert ≥ 4 % Gebühr + (a − 2 Punkte) ≥ 6,5 %.
Bei Albers auf Termin kaufen + an Falkenberg auf Termin verkaufen verliert ≥ 2a − 2 Punkte ≥ 7 %.

## 5. Wechselwirkungen

- **Wertung:** Rohstoffe und Kredite zählen nicht als Punkte (`scoring.ts`: Ausbau, Militär, Kampf, Beute, Befehle).
  Verträge erzeugen keinen Wert (Abschnitt 4), also keine Punkte. Treuhand ist keine Beute.
- **Erfolge / Tagesbefehle „Handel“:** zählen bei Lieferung, einmal je Vertrag bzw. Tranche, erst ab 500 Kredite
  (schließt die bekannte Mini-Handel-Lücke für Verträge von vornherein; Frage 8).
- **KI-Spieler:** Ihr Wirtschaftszug (`bots-econ.ts`) sieht die Treuhandware nicht mehr im Lager und plant automatisch
  ohne sie. Die KI wird durch den Aufschlag etwas reicher (Schätzung: 10 Spieler × 5 000 Kredite Vertragsvolumen am Tag →
  rund 1 250 Kredite Laufzeit- und Mengenaufschlag am Tag, gut 400 je KI, bei KI-Lagern im Wert von 90 000–390 000 unerheblich).
- **Kartell und Weltereignisse:** Großflotte, Belagerung, Kartell-Armada usw. wirken nur über den Preis beim Abschluss;
  wer vorher gekauft hat, ist abgesichert (der eigentliche Reiz). Rotbart-Konvois erleben den Kartellwürfel wie
  Spielerhandel.
- **PvP:** Verträge mit KI erzeugen kein Spielerpaar, also keine Absprache-Sperre. (Bei Spielerverträgen: siehe Frage 9.)
- **Aufholhilfe:** Die Aufbau-Gutschrift ist nicht handelbar und kann nicht als Anzahlung dienen.
- **Lagebild:** Kontingente der KI sind im Reiter sichtbar, verraten aber nur grob den Lagerstand (in Stufen von 500).

## 6. Missbrauchsschutz (Zusammenfassung)

Preis nie unter Sofortkauf (max/min von Kurs und erwartetem Kurs, angekündigte Nachrichten eingerechnet), Mengenaufschlag
statt Kurswirkung, 25 % Anzahlung/Pfand, keine Abschlüsse in der Handelspause, Vertragsvolumen ≤ 50 % des Tageslimits
und im Limit vorgemerkt, Restzahlungen ≤ Kreditlimit, Kontingente aus echten KI-Lagern mit ⅓ je Mensch, Handelsbilanz
zählt Verträge mit, keine Fälligkeit nach Saisonende − 24 h, 5 offene Verträge / 3 Abschlüsse je Stunde.

## 7. Aufwand: **L** (ohne Spielerverträge; mit abstrakter Rotbart-Lieferung **M+**)

- game-core `market/contracts.ts`: Preis (E, a, Charakter), Prüfungen, Teil-Erfüllung; Eigenschaftstests
  „kein Kreislauf bringt Kredite“ wie in `ENTSCHEIDUNGEN.md` (S–M).
- DB: Tabelle `market_contract` (+ Tranchen), Treuhand-Buchungen im `trade_ledger`, Ereignis `contract_due` und
  `contract_grace` über `scheduleEvent` (M).
- Tageslimit-Vormerkung im gleitenden Fenster, Kreditlimit, Handelsbilanz (S–M, setzt die parallelen Arbeiten voraus).
- KI-Kontingente aus Lager und Charakter, Angriffssperre (S); Rotbart-Konvoi über `createConvoy` (M).
- Oberfläche: Reiter, Liste, Erinnerungen, Limit-Anzeige (M). Tests, Regeltext in `REGELN.md` (S).

## 8. Abgrenzung

Keine Optionen, kein Weiterverkauf von Verträgen, keine Verträge über Einheiten oder Kredite gegen Kredite, keine
Verträge zwischen KI-Spielern.

## 9. Offene Entscheidungen

1. **Preisbasis für Kaufverträge?** a) max(Kurs, erwarteter Kurs) × (1 + a). b) erwarteter Kurs × (1 + a).
   c) Kurs × (1 + a). **Empfehlung: a** – b ist bei dauerhaft hohem Stahlkurs eine Geldmaschine (+16 %), c bei Kurs
   unter dem Richtwert ein Geschenk an den Käufer, falls der Kurs zurückkehrt.
2. **Aufschlag?** a) 4 % + 0,5 %/Tag + Mengenteil. b) 4 % + 1 %/Tag + Mengenteil (seltener genutzt). c) 3 % + 0,5 %/Tag
   ohne Mengenteil (Großmengen billiger als an der Börse). **Empfehlung: a.**
3. **Woher kommt die Ware der KI?** a) aus ihren echten Lagern (Kontingent 25 %, ⅓ je Mensch). b) aus einem
   unbegrenzten Kontor (Börsentiefe als Kontingent), KI nur als Name. c) echte Lager, aber Kontor springt ein, wenn eine
   KI leer ist. **Empfehlung: a** – KI wird spürbarer Handelspartner, Angriffe auf KI-Häfen bekommen eine
   Handelsfolge; Nachteil: ohne KI keine Verträge.
4. **Wohin fließen Aufschlag und verfallene Anzahlungen?** a) 4 % in den Gebührentopf, Rest und Strafen an die KI.
   b) alles an die KI. c) alles in den Gebührentopf. **Empfehlung: a.**
5. **Anzahlung / Pfand?** a) 25 %, Rest bei Fälligkeit, 12 h Nachfrist, anteilige Erfüllung. b) volle Vorkasse
   (Kauf) bzw. Ware sofort in Treuhand (Verkauf). c) 10 %. **Empfehlung: a** – b nimmt den Liquiditätsvorteil und
   macht Verkaufsverträge für künftige Produktion unmöglich; c macht Spekulation fast kostenlos (Rechnung E).
6. **Lieferung?** a) Albers/Falkenberg abstrakt, Rotbart als Konvoi über Seewege (abfangbar, Käufer trägt Risiko).
   b) alle abstrakt wie die Börse. c) alle als Konvoi. **Empfehlung: a** – b spart Aufwand (M+ statt L).
7. **Tageslimit?** a) Lieferung zählt bei Lieferung, Abschluss ≤ 50 % je 24-h-Fenster, Börse sieht die Vormerkung.
   b) ganze Menge zählt beim Abschluss (einfach, aber Abos nur winzig). c) eigenes Vertragslimit zusätzlich zum
   Tageslimit (verdoppelt den Umsatz). **Empfehlung: a.**
8. **Zählen Vertragslieferungen für Erfolge und Tagesbefehle „Handel“?** a) ja, bei Lieferung, ab 500 Kredite.
   b) nein. **Empfehlung: a.**
9. **Verträge zwischen Spielern?** a) später (Stufe 2), erst Erfahrung mit KI-Verträgen sammeln. b) jetzt mit
   Preisband ±20 % um max/min(K, E), Strafen in den Gebührentopf (nie an den Partner), Lieferung als Konvoi wie
   Spielerhandel, zählt als „gehandelt“ für die PvP-Absprache-Sperre (7 Tage ab Lieferung). c) nie – Spielerhandel mit
   Angeboten genügt. **Empfehlung: a** – b bringt kaum Neues gegenüber dem Angebotshandel (der Schenkungen ohnehin
   zulässt), aber Aufwand +M und neue Absprache-Wege.
10. **Charakter der KI?** a) wie 3.5 (Albers Vollsortiment, Falkenberg kauft Rüstungsgüter, Rotbart verkauft Prisen
    per Konvoi). b) alle drei gleich, nur Albers mit Abos. c) nur Albers bietet Verträge an. **Empfehlung: a.**
