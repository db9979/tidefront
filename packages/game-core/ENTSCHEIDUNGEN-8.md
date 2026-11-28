# game-core – Entscheidungen, Teil 8

Fortsetzung von `ENTSCHEIDUNGEN-7.md`. Verbindlich bleibt `docs/REGELN.md`. Neue Abschnitte bitte hier anhängen (je Thema
ein eigener Abschnitt).

## Balance v1.38 – Welle 5 der Abschlussprüfung 0.38 („nach Live-Daten“, w5)

Grundlage: `.claude/review-0.22/ABSCHLUSS-0.38.json` (Plan Welle 5: AN-04, M-05, AN-08, M-04, ST-09, M-06, ST-14, ST-15,
M-08, ST-16, M-14, M-17), die Rollenberichte von Analyst, Mathematiker und Stratege, `ENTSCHEIDUNGEN-7.md` (v1.35–v1.37).
Ein Hebel je Problem. Gemessen mit `npm run sim` und `npm run sim:saison -- --strict` (Seed 4242, 42 Tage, 3 KI + 4 passive
Menschen). Der Saisonlauf ist trotz Seed nicht vollständig reproduzierbar (zwei Läufe desselben Stands weichen bei Kampf +
Beute um 2 Punkte und bei den Weltereignis-Wächtern ab); daher je Stand mindestens zwei Läufe.

### Neue Messung im Saisonlauf (`sim/saison-wirtschaft.ts`)

Je KI und Woche: Füllgrad (Bestand ÷ Lager), Lager in Stunden Produktion und ungenutzter Anteil (Bestand ÷ bisherige
Netto-Produktion) je Rohstoff; abgeholte Belohnungen (Tagesbefehle, Wochenziele, Erfolge) ÷ Wochenproduktion und dasselbe
für einen **aktiven Menschen** (alle Tagesbefehle 3/3, Serienbonus, drei Wochenziele und Wochenbonus bei der KZ des
Heimathafens – die KI holt nur einen Teil ab); Elektrolyse (Stufen, Treibstoff daraus in % der Treibstoffproduktion,
verfallener Strom); Forschungswert ÷ Gebäudewert; PvP-Siege. Im JSON-Bericht (`SIM_OUT`) unter `wirtschaft`.

### Befunde vorher (v1.37, Stand 0.48.3) und Hebel

1. **Rohstoffmix (AN-04).** Das Lager begrenzt nie (Füllgrad 1–29 %). Stahl bleibt der Engpass (13–32 h Lager),
   **Proviant läuft am stärksten über** (40–92 h, ungenutzt bis 28 %), Treibstoff nicht mehr (26–35 h, ungenutzt 7–22 % –
   seit 0.38 haben Börsenhandel der KI, Kolonie-Unterhalt und die Nest-6-Rücklage den Überlauf aufgezehrt). Ein erster
   Versuch mit dem Vorschlag aus 0.38 (`costShift.to` Elektronik 0,55, Proviant 0,25, **Treibstoff 0,20**) brachte
   Treibstoff nichts (Woche 1 sogar 54 h) und ließ Elektronik überlaufen (30–49 h). **Hebel:** `building.costShift.to`
   Elektronik 0,75 → **0,65**, Proviant 0,25 → **0,35** (wertgleich, Stufe 0 unverändert). Treibstoff bewusst nicht.
2. **Chipfabrik-Kosten (M-05).** Amortisation 1,88 × Stahlwerk (Raffinerie 1,38 ×). **Hebel:** Kosten 200/60/20 →
   **150/40/10** (Richtwert 368 → 252) – Amortisation ≈ 1,29 × Stahlwerk, also wie die Raffinerie. Versorgungshof bleibt,
   solange Proviant überläuft.
3. **Belohnungshöhe (AN-08).** Ein aktiver Mensch bekommt aus Befehlen, Serie und Wochenzielen **119 % / 89 % / 63 % / 49 %
   / 39 %** der Wochenproduktion einer KI (Woche 1–5; in 0.38 waren es 73–76 % in Woche 1–2). Die KI holt 14–29 % ab.
   **Hebel:** Tagesbefehle 400/1000/2500 → **200/500/1250** (Wachstum 0,3 je KZ bleibt), jetzt in der Balance
   (`achievements.daily.tierValue`, `stageGrowth`; challenge-pool.ts liest sie). Wochenziele unverändert. Punkte unverändert.
4. **Satellit (M-04, ST-09)** – erledigt in v1.35 (Entscheid 11B); nicht angefasst (paralleler Entwickler Lagebild/Satellit).
5. **Elektrolyse (M-06).** Bestätigt als Falle: Der Händler baute bis Tag 35 **26 Stufen** für **2 %** seines Treibstoffs;
   `npm run sim`: „KW 3 + Wind 4 + Sonne 2 + Speicher 2 + Elektrolyse 3“ bringt 3 Treibstoff-Wert je Tag. **Hebel (Information
   statt Zahl):** Das Gebäudeblatt der Elektrolyse rechnet aus der Stromvorhersage der Basis (Überschuss je Stunde in der
   Elektrolyse plus verfallender Ökostrom, ohne den Kabelstrom), was die nächste Stufe an Treibstoff je Tag brächte und in
   wie vielen Tagen die Baukosten zum Richtpreis zurück sind; über 14 Tage rät es ab („erst mehr Wind und Sonne“)
   (`electrolysisAdvice`, `ElectrolysisAdvice.tsx`). Die KI (Händler) baut die nächste Stufe nur noch, wenn derselbe Rat
   „lohnt“ sagt (`bots-plan.ts greenWeights`). Keine Zahl der Elektrolyse geändert.
6. **Kolonie (ST-14)** – erledigt in v1.35 (Entscheid 12 B+C).
7. **Forschung in der Wertung (ST-15).** Forschungswert = 4–24 % des Gebäudewerts der KI; ohne Wertung rechnet sich
   Forschung in 42 Tagen kaum. **Hebel:** `scoring.researchFactor` **0,5** – die Kosten aller erforschten Stufen zählen zur
   Hälfte zum **Ausbau** (`researchScoreValue`). → bitte bestätigen.
8. **Verträge (M-08, „verdichten“).** KI-Verträge waren fast immer teurer als die Börse (Bezugskurs max/min plus 4 %
   Grundaufschlag; 1-Tages-Vertrag bei ruhigem Kurs 1,045 gegen Sofortkauf 1,04). **Hebel:** `market.contracts.baseFee`
   0,04 → **0,025**: Ein kurzer Vertrag liegt bei ruhigem Kurs etwa auf Höhe des Sofortkaufs (1-Tages-Vertrag 1,03 + Mengenteil
   gegen 1,04), längere etwas darüber. Den Vorschlag „Bezugskurs E statt max/min“ verworfen: Er öffnet eine Geldmaschine
   (Sofortkauf bei gedrücktem Kurs + Terminverkauf an die KI zum erwarteten Kurs, +4–13 %) und bräche die geprüfte Garantie
   in REGELN.md. Mit 0,025 bleibt der Aufschlag a ≥ 0,025 + 0,005 − 0,02 (Charakterbonus) > 0, alle Garantie-Tests laufen.
   **Oberfläche verdichtet, keine Funktion gestrichen:** ein Satz statt Regelblock (Regeln aufklappbar), laufende eigene
   Verträge zuerst, KI-Angebote je Richtung als eine Zeile mit Ressourcen-Knöpfen statt einer Zeile je Angebot (Kontingent im
   Formular), Spielerangebote nur bei Bedarf als Liste, „Selbst einen Vertrag anbieten“ samt Regeln aufklappbar.
   **Vertragsnutzung lässt sich im Saisonlauf nicht messen** (passive Menschen schließen nichts ab, die KI schlägt nur
   Angebote vor) – Live-Daten: Verwaltung → Statistik → Nutzung je System („vertraege“).
9. **PvP-Anreiz (ST-16).** Im Saisonlauf 0 Spielerkämpfe (passive Menschen unter Schutz bzw. Schwachziel), also nicht
   messbar. **Hebel:** `scoring.pvpFactor` **1,5** auf die Kampfpunkte **beider Seiten** eines Spielerkampfs (vor Kopfgeld,
   Mutfaktor, Paarbremse; Beute unverändert) – Angriff lohnt mehr, und wer seine Flotte daheim hat, punktet bei der Abwehr.
   → bitte bestätigen.
10. **Jagdbomber gegen Zerstörer (M-14).** Verlusttausch 10 Jagdbomber gegen 10 Zerstörer 17,7 : 1 (50 Kämpfe). **Hebel:**
    Zerstörer `attack.luft` 60 → **45**: 6,4 : 1 – der Zerstörer bleibt der Konter, Bomber sind kein reiner Verlust mehr
    (35 gäbe 3,3 : 1, zu weich). Kartell, Nester und Armada haben keine Flugzeuge – keine Wirkung auf die Wächter.
11. **Kommandopunkte (M-17).** KZ 8 war die teuerste Stufe je KP (501 gegen 334/376). **Hebel:**
    `commandPointsLateFromLevel` 9 → **8** (KZ 8: 330 statt 300 KP, jede Stufe ab 8 +30 gegenüber v1.37).

### KI-Fehler, im Saisonlauf gefunden

- **Weltereignis außer Flugreichweite:** Die Festung scheiterte an einem gewinnbaren Belagerungsring in 1 190 km mit
  `out_of_range`, weil der Verband Jagdbomber und Abfangjäger enthielt; die Ausweichverbände ließen zugleich die
  Landungsschiffe weg und bestanden den Probekampf nicht. Jetzt zuerst nur die Flugzeuge außer Reichweite weglassen
  (`bots-world-events.ts`). Häufigster Grund bleibt ein voller Missionsplatz im Heimathafen (Felder, Nestfahrten).
- **Wächter „Angriffe auf Weltereignisse“ war schon vorher rot:** Beide Vorher-Läufe (0.48.3) endeten mit `--strict` auf
  Exit 1 (Festung 0 Angriffe bei 2 bzw. 4 Ereignissen in Reichweite; einmal auch der Freibeuter).

### Kennzahlen vorher (v1.37, 0.48.3) und nachher (v1.38)

`npm run sim:saison -- --strict`, je zwei Läufe (Spanne). `npm run sim` läuft fehlerfrei durch.

| Kennzahl | vorher (2 Läufe) | nachher (2 Läufe) | Ziel |
|---|---|---|---|
| Exit-Code `--strict` | 1 / 1 (Wächter Weltereignisse) | **0 / 0** | 0 |
| Kartellverlust je Tag (Median KI) | 4–5 % | 3–4 % | ≤ 10 % |
| Kampf + Beute am Gesamtrang (Median KI) | 25–27 % | 23–25 % | ≤ 50 % |
| Tagesbefehle am Gesamtrang | 1 % | 1 % | ≤ 5 % |
| KI-Sieg Nest 6 | Tag 40 | Tag 37–40 | Tag 35–41 |
| Weltereignis-Angriffe Festung / Freibeuter | 0 / 0–2 | 1–2 / 2 | ≥ 1, wenn in Reichweite |
| Belohnung aktiver Mensch ÷ KI-Produktion, Woche 1/2/3/4/5 | 119/89/63/49/39 % | 69/57/41/31/24 % | – |
| Lager in h, Stahl/Treibstoff/Elektronik/Proviant (Mittel KI, Tag 21) | 20/35/48/92 | 13–15/29–31/38–44/59–80 | – |
| Elektrolyse-Stufen Händler Tag 35 (Anteil am Treibstoff) | 26 (2,4 %) | 7–8 (1,3–1,7 %) | – |
| Forschungswert ÷ Gebäudewert (KI) | 6–13 % | 7–12 % (zählt jetzt zur Hälfte zum Ausbau) | – |
| Punkte Freibeuter / Festung / Händler am Ende | 46 649–49 219 / 32 577–33 105 / 33 788–34 168 | 41 131–47 484 / 29 824–35 048 / 35 053–35 254 | – |

Rohstoffmix: Die Verschiebung zu Proviant ist im Saisonlauf kleiner als das Rauschen zwischen zwei Läufen (die KI verkauft
Überschuss ohnehin an der Börse); sie wirkt vor allem für Menschen, die nicht handeln. Treibstoff liegt in Woche 1 höher
(50 h statt 29 h), weil die Chipfabrik weniger Treibstoff kostet; ab Woche 2 wie vorher.

### Bewusst nicht

- Kein zweiter Hebel je Punkt (Raffinerie-Produktion, Wachstum der Belohnungen, Bomber-Bonus gegen Landungsschiffe).
- Satellit und Kolonie (erledigt), Weltpolitik und Lagebild (paralleler Entwickler).
- Keine Schemaänderung, keine Migration. Neue Balance-Felder: `scoring.researchFactor`, `scoring.pvpFactor`,
  `achievements.daily` (Typen in game-core).
