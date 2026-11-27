# Vorlage: Mehr Spieler gegen Spieler (Kopfgeld, Mutfaktor, Paarbremse)

**Status: Vorlage zur Freigabe** (27.11.2026, Balance v1.24). Nichts davon ist umgesetzt. Zahlen sind Startwerte für
den Block `scoring.pvp`; Rechnung: `/tmp/tf-review/vorlagen/pvp.ts` (200 Seeds je Fall).

## 1. Ziel

In der kleinen Runde greifen sich Spieler kaum an: Der Verteidiger daheim ist stark, ein Fehlschlag kostet Punkte,
und die Spitze wird nie herausgefordert. Die Vorlage soll Angriffe **auf Stärkere und auf die Spitze** belohnen,
Angriffe **auf Schwache** unattraktiv halten und **Absprachen zwischen Freunden** (Punkte schieben) wirkungslos machen.
Ressourcenregeln (Beuteanteil 30 %, Bunker, Laderaum) bleiben, es geht um **Punkte**.

## 2. Befund (Rechnung)

Zwei Bot-Häfen: „rüstungsstark“ (45 % Rüstung) und „ausbaustark“ (20 % Rüstung, mehr Gebäude). Punkte (Ausbau +
Militär): Tag 14 ≈ 1 420 / 1 460, Tag 21 ≈ 2 320 / 2 440, Tag 28 ≈ 3 430 / 3 600, Tag 35 ≈ 4 450 / 4 890.

| Überfall (Verteidiger mit allem daheim) | Tag | Sieg | Beute-P. | Kampf-P. Angreifer | Kampf-P. Verteidiger |
|---|---|---|---|---|---|
| rüstungsstark, ganzer Bestand → ausbaustark | 14 / 21 / 28 / 35 | 100 / 100 / 80 / 69 % | 330–470 | 280–760 | 100–480 |
| rüstungsstark, halber Bestand → ausbaustark | 14–35 | 0 % | 0 | 150–250 | 190–550 |
| gleich stark, ganzer Bestand | 14–35 | 0 % | 0 | 310–630 | 450–1 030 |

- **Verteidiger-Vorteil:** Gegen einen gleich starken Hafen mit allem daheim gewinnt der Angreifer nie. Der Fehlschlag
  kostet ihn netto 140–400 Punkte (eigene Verluste als Militär, weniger seine Kampfpunkte), der Verteidiger gewinnt
  dasselbe.
- **Erfolg lohnt stark:** ein gelungener Überfall 600–1 200 Punkte (20–40 % des Stands), vor allem Beute. (Die
  Bot-Lager sind mit 90–390 k Richtwert größer als bei Menschen; die Größenordnung gilt trotzdem.)
- **Bestehende Lücke (auch ohne Neuerung):** Beute zählt als Punkte, der Geplünderte verliert aber nur Rohstoffe, keine
  Punkte. Zwei Freunde können so Punkte „erzeugen“ (Wiederholungsfaktor 1 / 0,5 / 0,25 / 0 je 24 h und Schutz nach
  Niederlage 8 h bremsen nur). Ebenso entsteht bei jedem Kampf zwischen Freunden Kampfwert auf beiden Seiten.

## 3. Regeln

### 3.1 Kopfgeld auf die Spitze
- Ziele mit **Rang 1 / 2 / 3** der Gesamtwertung (Stand 0:00 Uhr des Spieltags) tragen ein Kopfgeld: Kampf- und
  Beutepunkte des Angreifers aus diesem Kampf **+50 % / +35 % / +20 %**, nur wenn der Angreifer selbst schlechter
  platziert ist. **Kopfgeld gilt nur auf Kampfpunkte** aus vernichteten Einheiten und Anlagen des Ziels, nicht auf Beute
  (Frage 2).
- **Verteidigung der Spitze zählt halb:** Kampfpunkte, die ein Kopfgeld-Ziel aus diesem Kampf erhält, × 0,5.
- Rang und Faktor werden **beim Kampf im Bericht festgehalten** (die Wertung rechnet sonst jeden Abruf neu).
- Anzeige: Symbol in Rangliste und Spielerübersicht, Hinweis in der Missionsplanung („Kopfgeld +50 %“), Bericht.

### 3.2 Mutfaktor (alle Spielerkämpfe)
- **m = √(Punkte Ziel / Punkte Angreifer)**, begrenzt auf **0,5 … 1,5**, wirkt auf Kampf- und Beutepunkte des
  Angreifers. Gegen einen doppelt so starken Gegner × 1,41, gegen einen halb so starken × 0,71, unter einem Viertel × 0,5.
- Zusammen mit dem Kopfgeld multiplikativ, höchstens × 2.
- Beutefaktoren bleiben: Wiederholung 1 / 0,5 / 0,25 / 0 (24 h), Schwachziel × 0,1, im Krieg ohne Schwachziel-Kürzung.

### 3.3 Paarbremse gegen Absprachen
- Kämpfe zwischen **denselben zwei Spielern** (beide Richtungen, auch Sammelangriffe mit ihrer Beteiligung) zählen
  innerhalb von **72 h** für die Punkte beider × **1 / 0,5 / 0,25 / 0** (Kampf, Beute, Kopfgeld). Rohstoffe und
  Verluste bleiben voll – nur die Wertung wird gebremst. Aus den Berichten ableitbar, nichts zu speichern.
- **Kein Kopfgeld und kein Mutfaktor über 1** zwischen Spielern, die in den letzten **7 Tagen** gehandelt (Angebot
  angenommen), sich etwas transportiert oder stationiert haben oder in derselben Allianz bzw. im Pakt waren.
- Verwaltung: Liste **„Auffällige Paare“** (≥ 3 gewertete Kämpfe in 7 Tagen oder Siege ohne Verteidigungsverluste) mit
  Knopf „Bericht aus der Wertung nehmen“.

### 3.4 Schutz
- **Anfängerschutz endet vorzeitig**, sobald man selbst einen Spielerhafen überfällt (Nester, Felder, Weltereignisse
  nicht). Heute kann ein Neuling 7 Tage angreifen, ohne angreifbar zu sein (`mission.ts` prüft nur das Ziel).
- Nachtschild (8 h, Wechsel mit 24 h Frist) und Schutz nach Niederlage (8 h) bleiben.

## 4. Balance-Begründung

- **Angriff auf die Spitze, Tag 28, gleich stark, Fehlschlag:** heute Angreifer 563 − 877 = **−314**, Verteidiger
  **+314**. Mit Kopfgeld Rang 1 (× 1,5) und halber Abwehr: Angreifer 845 − 877 = **−32**, Spitze 439 − 563 = **−124**.
  Ein mutiger Fehlschlag kostet kaum noch, die Spitze wächst nicht mehr an ihm.
- **Gelungener Angriff auf die Spitze, Tag 28** (80 % Sieg, Beute 463, Kampf 666): heute ≈ +765 netto, mit Kopfgeld
  (nur Kampf × 1,5) und Mutfaktor 1,0 ≈ +1 100 – lohnt deutlich, ohne die Saison allein zu entscheiden (Stand ≈ 3 500).
- **Angriff auf viel Schwächere** (Punkte unter einem Viertel): Punkte × 0,5, Beute ohnehin × 0,1 → kaum Anreiz.
- **Paarbremse:** Zwei Freunde erzeugen heute mit Beute bis zu ≈ 450 Punkte je Überfall, täglich wiederholbar; mit
  Bremse höchstens 1,75 Überfälle je 72 h für die Wertung ≈ 260 Punkte je Tag statt bis zu 790 (1 + 0,5 + 0,25 Überfälle je Tag), und ohne Kopfgeld.

## 5. Wechselwirkungen

- **Wertung:** Kampf gegen das Kartell (× 0,25) und Weltereignisse unverändert; nur Berichte mit Spieler auf beiden
  Seiten. Allianzwertung (Summe der Mitglieder) erbt alles. Rangliste rechnet weiter bei jedem Abruf.
- **Aufholhilfe:** Mutfaktor und Kopfgeld helfen kleinen Spielern zusätzlich nach oben; Schwachziel-Regel schützt sie.
- **Saisonfinale:** keine Spielerkämpfe, nicht betroffen.
- **KI-Spieler:** KI können Kopfgeld-Ziel sein (Menschen dürfen KI immer angreifen). KI greifen Menschen nur mit
  Erlaubnis der Verwaltung an (Vorgabe aus) und mit 12 h Sperrfrist; der Freibeuter bevorzugt künftig Kopfgeld-Ziele.
- **Diplomatie:** Allianz und Pakt verhindern Angriffe weiter; Krieg hebt nur die Schwachziel-Kürzung der Beute auf.

## 6. Missbrauchsschutz (Zusammenfassung)

Kopfgeld nur auf echte Verluste des Ziels (Kampf), Paarbremse 72 h, Ausschluss nach Handel/Transport/Allianz/Pakt
(7 Tage), Rang zum Tagesbeginn (kein Rangwechsel während der Anfahrt ausnutzbar), Verwaltungsliste und Ausschluss
einzelner Berichte.

## 7. Aufwand: **M**

Bericht um `pvp: { bountyRank, bountyFactor, mut }` erweitern (beim Kampf), `scoring.ts` (Faktoren, Paarbremse aus den
Berichten, halbe Abwehr), tägliche Rang-Momentaufnahme, Anfängerschutz-Ende in `mission.ts`/Sammelangriff, Anzeige
(Rangliste, Planung, Bericht), Verwaltungsliste, Bots (Zielwahl), Tests.

## 8. Offene Entscheidungen

1. **Kopfgeld-Höhe?** a) Rang 1–3: +50 / +35 / +20 %. b) einheitlich +30 %. c) kein Kopfgeld, nur Mutfaktor.
   **Empfehlung: a.**
2. **Worauf wirkt das Kopfgeld?** a) nur Kampfpunkte. b) Kampf- und Beutepunkte. **Empfehlung: a** – Beute lässt sich
   unter Freunden ohne echten Verlust erzeugen.
3. **Verteidigung der Spitze halb werten?** a) ja (× 0,5). b) nein. **Empfehlung: a** – sonst macht jeder
   Fehlschlag die Spitze noch stärker.
4. **Mutfaktor?** a) √-Verhältnis, 0,5–1,5. b) nur Bonus nach oben (1–1,5), nach unten nichts. c) keiner.
   **Empfehlung: a.**
5. **Paarbremse?** a) 72 h, 1 / 0,5 / 0,25 / 0. b) 24 h wie der Beute-Wiederholungsfaktor. c) keine.
   **Empfehlung: a** – schließt auch die heutige Beute-Lücke.
6. **Anfängerschutz endet bei eigenem Spielerüberfall?** a) ja. b) nein. **Empfehlung: a.**
7. **Nachtschild?** a) unverändert 8 h. b) 6 h für Kopfgeld-Ziele. **Empfehlung: a** – in einer kleinen Runde mit
   ähnlichen Zeitzonen liegen die Nächte ohnehin übereinander.
