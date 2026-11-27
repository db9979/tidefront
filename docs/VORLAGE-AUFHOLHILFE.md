# Vorlage: Aufholhilfe für kleine Häfen und Spät-Einsteiger

**Status: Vorlage zur Freigabe** (27.11.2026, Balance v1.24). Nichts davon ist umgesetzt. Zahlen sind Startwerte für
einen neuen Block `catchUp`; Rechnung: `/tmp/tf-review/vorlagen/aufholhilfe.ts` (Spätspiel-Bot, 45 % Rüstung).

## 1. Ziel

In einer kleinen Einladungsrunde kommen Freunde oft erst nach Tagen oder Wochen dazu. Heute startet jeder mit
demselben Startbestand und 7 Tagen Anfängerschutz, egal an welchem Saisontag. Die Hilfe soll:
- Spät-Einsteigern und abgehängten Häfen helfen, **mitspielen** zu können (Nester, Weltereignisse, Finale),
- aber **niemanden an der Spitze vorbeiziehen** lassen (Hilfe endet weit unter dem Median),
- sich **nicht ausnutzen** lassen (Neustart, absichtlich klein bleiben, Rohstoffe an Freunde schieben).

## 2. Befund (Rechnung)

Bezug „Median“ = Referenz-Bot ab Tag 0. Produktion je Stunde (Richtwert): Tag 7 ≈ 700, ab Tag 14 ≈ 790–820, also
fast flach. Ausbauwert (Kosten aller Gebäudestufen): Tag 7 32 k, 14 78 k, 21 134 k, 28 224 k, 35 308 k.

| Start am Saisontag | Produktion / Median nach 3 / 7 / 10 Tagen | Ausbauwert / Median nach 7 / 14 / 21 Tagen |
|---|---|---|
| 14 | 73 % / 86 % / 98 % | 24 % / 35 % / 43 % |
| 21 | 74 % / 86 % / 95 % | 14 % / 25 % / 42 % |
| 28 | 72 % / 86 % / 94 % | 10 % / 24 % / – |

**Die Produktion holt sich in ~10 Tagen von selbst auf; der Rückstand liegt im Ausbau** (und damit in Punkten, KP,
Missionsplätzen). Ein Bonus, der an der Produktion misst, greift nur 2–3 Tage und bringt fast nichts (gerechnet:
Σ 2–3 k Richtwert, Ausbau +1 Prozentpunkt). Deshalb misst die Hilfe am **Ausbau**.

## 3. Regeln

### 3.1 Aufholbonus (alle Spieler)
- **Rückstand r** = eigene Ausbaupunkte (alle Häfen) / Median der Ausbaupunkte aller Spieler, deren erster Hafen
  mindestens 3 Tage alt ist (KI eingeschlossen). Neu berechnet stündlich im Worker.
- **Bonus b** = 100 % × clamp((0,70 − r) / 0,40; 0; 1): ab r < 70 % steigend, voll (+100 %) ab r ≤ 30 %.
  | r | 70 % | 60 % | 50 % | 40 % | ≤ 30 % |
  |---|---|---|---|---|---|
  | b | 0 | +25 % | +50 % | +75 % | +100 % |
- **Form:** b × Gebäudeproduktion (ohne Grundrate) fließt als **Baugutschrift** in ein eigenes Konto des Hafens. Sie
  bezahlt nur **Gebäudestufen** (vor dem Lager), ist nicht plünderbar, nicht handelbar, nicht transportierbar und
  verfällt zum Saisonende. Höchstbestand 24 h Bonus (darüber ruht der Zufluss).
- **Wegfall:** sobald r ≥ 70 %; neu nur, wenn r wieder unter 60 % fällt (Hysterese). Ab Saisontag 40 kein Zufluss mehr.

### 3.2 Startpaket für Spät-Einsteiger
- Wer seinen **ersten Hafen der Saison ab Tag 8** gründet, erhält zusätzlich eine Baugutschrift von **15 % des
  Median-Ausbauwerts** zum Gründungszeitpunkt (Tag 14 ≈ 12 k, Tag 21 ≈ 20 k, Tag 28 ≈ 34 k Richtwert).
- Anfängerschutz bleibt 7 Tage (wer ab Tag 35 einsteigt, ist bis Saisonende geschützt). Auftragsbuch unverändert.

## 4. Balance-Begründung

Ausbauwert / Median nach x Tagen (Σ = gesamte Hilfe in Richtwert):

| Variante | Start Tag 14: +7 / +14 / +21 | Start Tag 21: +7 / +14 / +21 | Start Tag 28: +7 / +14 |
|---|---|---|---|
| ohne Hilfe | 24 / 35 / 43 % | 14 / 25 / 42 % | 10 / 24 % |
| Bonus bis +50 % | 38 / 57 / 56 % (Σ 105 k) | 23 / 42 / 70 % (Σ 144 k) | 17 / 41 % (Σ 119 k) |
| **Bonus bis +100 %** | **49 / 60 / 73 %** (Σ 136 k) | **33 / 54 / 72 %** (Σ 210 k) | **24 / 54 %** (Σ 222 k) |
| Paket 15 % allein | 29 / 39 / 43 % (Σ 12 k) | 19 / 29 / 52 % (Σ 20 k) | 16 / 33 % (Σ 34 k) |
| **Paket 15 % + Bonus +100 %** | **56 / 60 / 73 %** | **39 / 54 / 72 %** | **29 / 54 %** |
| Paket 30 % + Bonus +100 % | 58 / 60 / 73 % | 40 / 56 / 72 % | 34 / 70 % |

- Ziel erreicht: Ein Spät-Einsteiger kommt in 2 Wochen auf **etwa 55–60 % des Median-Ausbaus** (ohne Hilfe 25–35 %)
  und **bleibt darunter, nicht darüber**: Der Bonus hört bei 70 % auf, alle Läufe enden bei 70–73 %.
- Die Hilfe kostet niemanden etwas (keine Umverteilung); Σ 136–222 k über 2–3 Wochen entspricht +100 % der eigenen
  Gebäudeproduktion, solange man weit zurückliegt.
- Das Startpaket wirkt vor allem in den ersten Tagen (Tag 28 nach 3 Tagen 18 % statt 11 %); mit 30 % statt 15 % bringt
  es bis Tag 28 + 14 mehr (70 statt 54 %) – zu nah an der Bonusgrenze, deshalb 15 %.
- Vorbehalt: Der Simulations-Bot steckt 45 % in Rüstung; mit Baugutschrift (nur Gebäude) wächst der Ausbau eher
  schneller als gerechnet. Die 70-%-Grenze deckelt das.

## 5. Wechselwirkungen

- **Wertung:** Aufgeholter Ausbau zählt als Ausbaupunkte; Spitzenplätze bleiben unberührt (Hilfe endet bei 70 % des
  Medians). Die Ruhmeshalle vermerkt nichts Besonderes.
- **Kartell:** Überfälle bemessen sich an der eigenen Verteidigung, ein kleiner Hafen wird nicht härter getroffen.
  Weltereignisse nutzen den Median der Verteidigung, das ändert sich kaum.
- **Spielerangriffe:** Schwachziel-Regel (Beute × 0,1 unter 50 % der Gebäudestufen des Angreifers) schützt kleine Häfen
  weiter; die Baugutschrift selbst ist nicht plünderbar.
- **Kolonien:** Die Gutschrift gilt je Hafen nach seiner Gebäudeproduktion, r zählt alle Häfen des Spielers zusammen.
- **Tagesbefehle, Wochenziele, Auftragsbuch:** unverändert.

## 6. Missbrauchsschutz

- **Konto-Neustart:** Einen eigenen Neustart gibt es nicht; ein neues Konto braucht eine Einladung (Verwaltung).
  Startpaket nur für den ersten Hafen eines Kontos je Saison. Die Verwaltung zeigt „Aufholhilfe aktiv“ und die
  Summe je Spieler.
- **Absichtlich klein bleiben:** Die Gutschrift bezahlt nur Gebäude, also hebt sie r von selbst und beendet sich. Wer
  stattdessen nur rüstet, bekommt keinen Vorteil (die Gutschrift lässt sich nicht für Einheiten nutzen).
- **Rohstoffe an Freunde schieben:** unmöglich, die Gutschrift ist nicht handelbar, transportierbar oder plünderbar.
- **Median verbiegen:** Spieler mit Hafen jünger als 3 Tage zählen nicht zum Median.

## 7. Aufwand: **M**

Feld `buildCredit` im Hafenzustand (Upgrade zieht zuerst daraus), stündlicher Worker-Lauf (Median, r, Zufluss),
Startpaket in `chooseBase`, Anzeige im Hafen („Aufholhilfe +50 %, Gutschrift 3 200“), Handbuch, Tests, Simulation.

## 8. Offene Entscheidungen

1. **Woran wird der Rückstand gemessen?** a) Ausbaupunkte. b) Gesamtpunkte. c) Produktion.
   **Empfehlung: a** – Produktion gleicht sich in ~10 Tagen von selbst an (c wirkt kaum); Gesamtpunkte schwanken mit
   Kampf und Verlusten.
2. **Deckel des Bonus?** a) +50 %. b) +100 %. c) +150 %. **Empfehlung: b** (Tag 21 + 14: 54 % statt 42 %; endet
   trotzdem unter 73 %).
3. **Form der Hilfe?** a) Baugutschrift nur für Gebäude. b) normale Rohstoffe. **Empfehlung: a** – schließt
   Plündern, Handel und „klein bleiben und rüsten“ aus.
4. **Startpaket für Spät-Einsteiger?** a) keins. b) 15 % des Median-Ausbauwerts ab Tag 8. c) 30 %.
   **Empfehlung: b.**
5. **Gilt die Hilfe für KI-Spieler?** a) ja, gleiche Regeln. b) nein. **Empfehlung: a** – gleiche Regeln für alle;
   KI kommen ohnehin nur per Verwaltung spät dazu.
6. **Schnellerer Bau für Spät-Einsteiger?** a) nein. b) Bauzeit −30 %, solange der Bonus wirkt.
   **Empfehlung: a** – nicht simuliert (der Bot ist durch Rohstoffe, nicht durch Bauzeit begrenzt); erst nach den ersten
   Messungen der Verwaltungs-Kennzahlen (Meilensteine mit Saisontag) entscheiden.
