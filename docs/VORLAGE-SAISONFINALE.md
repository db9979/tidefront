# Vorlage: Saisonfinale „Leviathan“ (Woche 6)

**Status: Vorlage zur Freigabe** (27.11.2026, Balance v1.24). Nichts davon ist umgesetzt. Zahlen sind Startwerte für
einen neuen Block `worldEvents.finale`; Rechnung: `/tmp/tf-review/vorlagen/finale.ts` (200 Seeds je Fall).

## 1. Ziel

Die Saison endet heute leise: Ab Woche 5 ist Nest 5/6 erledigt, Weltereignisse kommen alle 48–96 h und enden
36 h vor Schluss. Das Finale gibt der letzten Woche ein gemeinsames Ziel: eine **Kartell-Armada mit Flaggschiff**, die
alle Spieler (und Allianzen) gemeinsam versenken. Jeder trägt nach seiner Stärke bei, auch kleine Häfen; wer
zusammenarbeitet (Sammelangriff), verliert weniger. Ergebnis und Titel kommen in die Ruhmeshalle.

## 2. Ablauf

| Zeitpunkt (Spielzeit) | Was passiert |
|---|---|
| Tag 36, 12:00 | **Ankündigung**: Systemnachricht an alle, Push, Karte zeigt den Sammelpunkt mit Countdown. Ab jetzt keine neuen gewöhnlichen Weltereignisse. |
| Tag 38, 12:00 | **Erscheinen**: Stärke wird einmal festgelegt (Abschnitt 3). Angriffe möglich. |
| Tag 41, 12:00 | **Abzug** nach 72 h, falls nicht versenkt. Wertung des Finales steht fest. |
| Tag 42, Saisonende | Endstand, Ruhmeshalle wie bisher; das Finale ist schon darin enthalten. |

- **Ort:** ein Seefeld nahe dem Mittelpunkt aller teilnehmenden Häfen (kleinste größte Entfernung), fest. Immer
  sichtbar (wie alle Weltereignisse), Missionsart **Überfall** wie gegen die Großflotte, Wetter und Seewege gelten.
- **Teilnehmer** (für den Bezug): alle Häfen von Spielern, die nicht im Anfängerschutz sind und in den letzten 72 h aktiv
  waren, KI-Spieler eingeschlossen.

## 3. Stärke

- **Bezug K:** Lebenspunkte der Kriegsschiffe und Flugzeuge eines Hafens (ohne Landungs-, Kolonie-, Minenschiffe,
  ohne Bodentruppen und Anlagen), daheim und unterwegs. **H = 4 × Σ K** aller Teilnehmer, mindestens 40 000 LP, mal
  Kartellstärke-Regler der Verwaltung (`cartel_strength`, 25–300 %).
- **Geschwader (90 % von H):** Schnellboote mit je 8 Miliz (240 LP je Boot).
- **Flaggschiff „Leviathan“ (10 % von H):** neue NPC-Einheit aus **Sektionen** zu je 1 000 LP (Angriff See 20,
  Luft 7 je Sektion). Sektionen, damit Teilschaden über mehrere Angriffe erhalten bleibt (eine einzelne Einheit mit
  30 000 LP verliert im Kampfmodell nichts, solange sie nicht ganz sinkt – geprüft: 0 % Schaden bei 1–3 Angreifern).
  Angreifbar erst, wenn die Geschwader versenkt sind.
- **Abschnitt je Angriff:** Die Armada stellt jedem Verband einen Abschnitt von **0,5 × K des Verbands** (in
  Schnellbooten, mindestens 4) aus dem Rest der Geschwader. Beim Sammelangriff zählt K aller Teilnehmer zusammen.

Beispiel kleine Runde: 4 Menschen + 3 KI, K im Mittel 11 000 → H ≈ 308 000 LP, davon 277 000 Geschwader
(≈ 1 150 Boote) und 31 Sektionen Flaggschiff.

## 4. Belohnungen und Wertung

- **Beute für Schaden:** 0,6 Richtwert je vernichtetem Lebenspunkt, Mischung wie der Beutepool der Großflotte
  (Stahl, Treibstoff, Elektronik, Proviant 5 000 / 2 500 / 1 200 / 1 800). Gutschrift bei der Heimkehr im
  Ausgangshafen, **ohne Laderaumgrenze** (Kriegsschiffe haben keinen Laderaum; sonst müssten Landungsschiffe als
  Zielscheibe mit).
- **Kampfpunkte** aus Armada-Kämpfen **× 0,5** (neue Art in `scoring.npcWorldEventKinds` mit eigenem Faktor),
  Beutepunkte voll.
- **Flaggschiff versenkt:** Schatz von 5 % von H (Richtwert) an die Teilnehmer des versenkenden Kampfs nach Beitrag.
- **Ruhmeshalle** (neue Tabelle `season_finale_result`): Ausgang (versenkt mit Zeitpunkt / entkommen), Schaden je
  Spieler und je Allianz (Rangliste), Titel **„Bezwinger des Leviathan“** (meister Schaden) und **„Leviathan-Flotte“**
  (Allianz mit dem meisten Schaden). Neuer Erfolg **„Armada-Jäger“**: Bronze/Silber/Gold ab 5 / 15 / 30 % des
  Gesamtschadens.

## 5. Balance-Begründung (Rechnung)

Verband = Kriegsschiffe und Flugzeuge des Spätspiel-Bots (45 % Rüstung) an Tag 38: 40 Korvetten, 8 Zerstörer,
16 Jagdbomber, K = 13 840; schwacher Bot (20 % Rüstung): K = 7 910.

| Abschnitt (× K) | starker Verband | halber Verband | schwacher Verband |
|---|---|---|---|
| 0,4 | 100 % versenkt, Verlust 7 % des Verbandswerts | 100 %, 6 % | 100 %, 6 % |
| **0,5** | **100 %, Schaden 20 900 LP, Verlust 8 200 (12 %)** | **100 %, 10 300 LP, 2 900 (8 %)** | **100 %, 11 800 LP, 3 500 (9 %)** |
| 0,6 | 100 %, 17 % | 100 %, 13 % | 100 %, 15 % |
| 0,8 | 8 %, 30 % | 14 %, 29 % | 9 %, 30 % |

- Ein fester Abschnitt für alle (z. B. 0,3 × Mittel-K × Stärke 2 = 82 Boote) wäre unfair: der starke Verband siegt
  100 % (Verlust 7 800), der halbe oder schwache verliert 0–1 % und büßt 12 800–14 700 ein. Daher **0,5 × eigener K**:
  jeder gewinnt seinen Abschnitt sicher, der Schaden wächst mit der Größe (≈ 1,5 × K je Angriff).
- **Netto je Angriff** mit 0,6 Richtwert/LP: stark +4 300, schwach +3 500 (≈ 4–5 h Produktion an Tag 38 ≈ 810/h).
  Punkte je starker Angriff: Kampf 87 Boote × 570 × 0,5 / 100 ≈ 250, Beute ≈ 125; bei vollem Erfolg ≈ 750 Punkte je
  Spieler ≈ 15–17 % des Stands an Tag 38 (≈ 4 500–4 900). Mit Faktor 1 wären es ≈ 25 % und das Finale entschiede die Saison.
- **Anzahl Angriffe:** 0,9 × 4 / 1,5 ≈ 2,4 Angriffe je Teilnehmer bis zum Flaggschiff – in 72 h mit Anfahrt und
  Reparatur machbar, aber nur, wenn die Mehrheit mitmacht.
- **Flaggschiff (30 Sektionen):** ein starker Verband allein 27 % Schaden (Verlust 9 900), zwei 57 %, drei 88 %, vier
  98 % versenkt (Verlust gesamt 6 000, also 1 500 je Teilnehmer). Zusammenarbeit lohnt sich deutlich.

## 6. Wechselwirkungen

- **Weltereignisse:** ab der Ankündigung keine neuen; laufende enden normal. Kein Konflikt mit `minSeasonHoursLeft` (36 h).
- **Wertung:** Seit dem Entscheid vom 27.11.2026 zählen Angriffe auf Großflotte und Belagerung voll
  (`npcWorldEventKinds` ist leer; REGELN.md und Handbuch sind angeglichen, das Handbuch liest die Werte aus der Balance). Das Finale bekommt den eigenen
  Faktor 0,5, Kartell-Abwehr bleibt × 0,25.
- **Sammelangriff:** vorhanden; Abschnitt aus dem gemeinsamen K, Beute und Schaden nach Beitrag wie bei der Großflotte.
- **Admirale und Veteranen:** Erfahrung wie bei jedem Kampf; Schicksalswurf nur bei über 70 % Verlust (bei 0,5 × K
  praktisch nie).
- **Lagebild:** Die Armada ist immer sichtbar; anrückende Verbände wie gewohnt nur mit Sicht.
- **Börse:** Marktnachricht „Kartell-Armada“ (Treibstoff +, wie Kriegslage) für die 72 h.
- **Wetter:** Sturm verzögert Anfahrten; die 72 h sind lang genug, um ein Sturmfenster abzuwarten.

## 7. KI-Spieler

- Freibeuter und Festung greifen Abschnitte an, sobald der Probekampf gegen den eigenen Abschnitt (deterministisch
  berechenbar) mit allen Läufen gewinnt; höchstens alle 12 h, ein Missionsplatz bleibt frei. Händler nehmen nicht teil.
- KI zählen im Bezug H und in der Rangliste mit; Titel der Ruhmeshalle siehe Frage 4.

## 8. Missbrauchsschutz

- Bezug einmal beim Erscheinen; wer vorher abrüstet, macht nur seinen eigenen Schaden kleiner.
- Viele Kleinstangriffe bringen nichts extra: Abschnitt proportional, mindestens 4 Boote, Treibstoff und
  Missionsplätze begrenzen. (Halbe Verbände verlieren anteilig etwas weniger, 8 % statt 12 % – vertretbar.)
- Belohnung nur für vernichtete LP, nicht für Teilnahme; Allianz-Schaden nur von Mitgliedern zum Kampfzeitpunkt.
- Kartellstärke-Regler wirkt, damit der Admin eine zu schwere oder zu leichte Runde nachjustieren kann.

## 9. Aufwand: **L**

Neue Ereignisart `finale` (Kern: Stärke, Abschnitt, Sektionen; Engine: Ankündigung, Erscheinen, Abzug, Kampf,
Gutschrift), NPC-Einheit `flaggschiff`, Wertungsfaktor je Art, Ruhmeshalle-Tabelle mit Migration, Erfolg, Karte und
Banner, KI-Logik (Bots greifen Weltereignisse heute gar nicht an), Texte, Tests, Simulation.

## 10. Offene Entscheidungen

1. **Was passiert, wenn die Armada nicht versenkt wird?**
   a) Sie zieht ab, Restbeute verfällt, Ruhmeshalle „entkommen“. b) Strafschlag: Zum Abzug greift sie jeden
   Teilnehmer-Hafen einmal wie ein Kartell-Überfall an. c) Sie greift schon während der 72 h alle 12 h den Hafen mit dem
   geringsten Beitrag an. **Empfehlung: a** – Ende der Saison, Druck entsteht über Titel und Beute, nicht über Verluste.
2. **Punkte aus Armada-Kämpfen?** a) × 0,25 wie Kartell-Abwehr. b) × 0,5. c) voll.
   **Empfehlung: b** (≈ 15 % des Stands bei vollem Erfolg; voll entschiede das Finale die Saison).
3. **Ort:** a) ein zentraler Punkt. b) je Teilnehmer eine Vorhut in höchstens 400 km (Flaggschiff zentral).
   **Empfehlung: a** in kleiner Runde; b, falls Häfen über 1 500 km auseinanderliegen (Anfahrt > 24 h).
4. **KI-Spieler und Titel:** a) gleich wie Menschen. b) KI tragen bei, Titel nur für Menschen. c) KI nehmen nicht teil.
   **Empfehlung: b** – ohne KI wäre die kleine Runde zu dünn, Titel sollen Menschen gehören.
5. **Zeitpunkt:** a) Tag 38–41 (72 h). b) Tag 39–41 (48 h). c) Tag 36–41 (5 Tage).
   **Empfehlung: a** – genug Zeit für 2–3 Angriffe je Spieler und einen Sammelangriff aufs Flaggschiff.
6. **Beute ohne Laderaumgrenze?** a) ja, Gutschrift bei Heimkehr. b) nein, wie Großflotte (Laderaum).
   **Empfehlung: a** – sonst lohnt das Finale nur mit Landungsschiffen als Zielscheibe.
