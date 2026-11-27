# Vorlage: Admirale aufwerten – Spezialisierung „Landungstrupp“

**Status: Vorlage zur Freigabe** (27.11.2026, Balance v1.24). Nichts davon ist umgesetzt. Zahlen sind Startwerte für
`admirals.specs`; Rechnung: `/tmp/tf-review/vorlagen/admirale.ts` (Methode wie `sim/admirals.ts`, 200–400 Seeds).

## 1. Ziel

Admirale kosten 2 000 Kredite und 400 Elektronik, einen von höchstens 3 Plätzen und brauchen 700 Erfahrung bis zum
vollen Rang. Ihre Spezialisierungen wirken fast nur im Seegefecht (Angriff `attack.see`, Verteidigung `hp` +6 %).
Die meisten Kämpfe der Saison sind aber **Landungen** (Nester, Felder, Spielerhäfen). Ziel: eine Spezialisierung, die
dort so viel bringt wie „Angriff“ zur See – spürbar, aber nicht mehr als ein Forschungszweig.

## 2. Befund (Rechnung)

Kampfwert-Bonus = Mehr-Feuerkraft, die derselbe Verband ohne Admiral für 50 % Sieg bräuchte (voller Rang):

| Admiral | Seegefecht 10 K / 4 Z | Landung gegen 150 Schützen + Bunker | Nest 3 | Nest 5 | Nest 6 |
|---|---|---|---|---|---|
| Angriff | +8,0 % | 0,0 % | +0,9 % | 0,0 % | +0,4 % |
| Verteidigung | +4,7 % | +0,8 % | +7,2 % | +0,9 % | +3,1 % |
| Angriff + Verteidigung | +13,1 % | +0,8 % | +8,1 % | +0,9 % | +3,1 % |

- Bei Landungen entscheidet die Bodenphase; „Angriff“ stärkt nur Schiffe, deren Teil vorher schon überlegen ist.
- Ausnahme: Ein knapper, schiffslastiger Verband (Bot-Doktrin: 22 % Korvetten) profitiert vom Seeteil – Angriff +
  Verteidigung hebt dort Nest 4 von 50 auf 61 %, Nest 5 von 51 auf 70 %, Nest 6 von 61 auf 66 % Sieg. Für die üblichen
  Landungsverbände bleibt der Admiral fast wirkungslos.
- Keine KI nutzt Admirale (Bots ernennen keine).

## 3. Regeln

### 3.1 Neue Spezialisierung „Landungstrupp“
- **Mission** (Verband, den er führt): Angriff Landtruppen **+10 %** (`attack.land`), Lebenspunkte Landtruppen
  **+8 %** (`hp.land`), Minenschaden an den eigenen Landungstruppen **−30 %** (`mineDamage`).
- **Hafen** (als Hafenkommandant gegen Landungen, auch Kartell): Lebenspunkte Landtruppen **+6 %** (Frage 3).
- Rangfaktor wie alle: Kapitän 50 %, Konteradmiral 70 %, Vizeadmiral 85 %, Admiral 100 %.
- Wählbar beim Ernennen und als zweite Spezialisierung ab Vizeadmiral. Erfahrung, Risiko (Wurf erst ab 70 % Verlust)
  und Kosten unverändert.
- **Umschulung:** Bestehende Admirale dürfen ihre erste Spezialisierung nach dem Update **einmal kostenlos** wechseln.

### 3.2 Beutemeister bei Nestern (Frage 4)
- Heute wirkt „Beute +10 %“ nicht auf die feste Nestbeute, nur „Laderaum +15 %“. Vorschlag: +10 % feste Nestbeute
  (neuer Pfad `nestLoot`), weiter durch den Laderaum begrenzt.

### 3.3 Admirale für KI-Spieler
- Festung und Freibeuter ernennen ab Hafenkommandantur 1 einen Admiral (Freibeuter „Landungstrupp“ auf Mission,
  Festung „Verteidigung“ als Hafenkommandant) – gleiche Regeln, gleiche Kosten.

## 4. Balance-Begründung

| Admiral (neu) | Seegefecht | Landung | Nest 3 | Nest 5 | Nest 6 |
|---|---|---|---|---|---|
| Kapitän zur See, Landungstrupp | 0 | +5,5 % | +4,7 % | +4,9 % | +6,6 % |
| Konteradmiral, Landungstrupp | 0 | +7,8 % | +6,8 % | +7,2 % | +8,7 % |
| **Admiral, Landungstrupp** | 0 | **+10,9 %** | **+9,9 %** | **+10,6 %** | **+11,9 %** |
| Admiral, Landungstrupp + Verteidigung | +4,7 % | +11,5 % | +16,7 % | +13,0 % | +14,4 % |
| Admiral, Landungstrupp + Angriff | +8,0 % | +10,9 % | +10,1 % | +11,1 % | +11,9 % |
| Gegenprobe: „Angriff“ auch für Flugzeuge | +8,0 % | 0 | +0,9 % | 0 | +0,7 % |

**Zielgröße +10 % je Spezialisierung, +15 % mit zweien:**
- gleich groß wie „Angriff“ zur See (+8 %) und Angriff + Verteidigung (+13 %), also **ein Admiral = eine Rolle**,
  egal ob See oder Land;
- etwa so viel wie der Heer-Forschungszweig (Infanteriewaffen 2 = +10 % Angriff, Verbundpanzerung 3 = +15 % LP) oder
  der Veteranenrang „Veteran“ (+10 %) – mehr wäre neben Forschung und Veteranen (multiplikativ) zu viel;
- der Kampf verstärkt kleine Vorteile stark: **im knappen Kampf** (Bot-Verband Tag 28 so verkleinert, dass er 50–60 %
  siegt, 400 Seeds) wirkt +10 % wie folgt:

| Ziel | ohne | heute Angr.+Vert. | Kapitän Landungstrupp | Admiral Landungstrupp | Admiral Landung + Vert. |
|---|---|---|---|---|---|
| Nest 4 | 50 %, Netto −1 700 | 61 %, +1 700 | 66 %, +1 700 | **79 %, +4 700** | 88 %, +7 600 |
| Nest 5 | 51 %, −7 000 | 70 %, +1 100 | 62 %, −4 200 | **74 %, −1 200** | 81 %, +2 500 |
| Nest 6 | 61 %, +7 000 | 66 %, +11 200 | 74 %, +13 800 | **87 %, +20 300** | 90 %, +23 600 |

- **Mit üppigem Verband** (ganzer Bestand, 100 % Sieg) spart der Landungstrupp 3–7 % Verluste (Nest 5 Tag 21:
  8 200 → 7 700, mit Verteidigung 7 300). Er macht also knappe Angriffe möglich, nicht überlegene noch billiger.
- **Lazarett-Variante** (Rückkehr verwundeter Truppen 20 → 35 %, zusätzlich zum Landungstrupp) gerechnet: weitere
  3–5 % weniger Verluste, keine höhere Siegchance – als eigene Spezialisierung zu schwach, nicht vorgeschlagen.

## 5. Wechselwirkungen

- **Modifikatoren** multiplizieren sich mit Forschung, Veteranen und Wetter wie bisher; keine neuen Pfade außer
  `nestLoot` (nur bei Frage 4).
- **Felder:** Der Admiral bleibt nach einer Feldeinnahme bei der Besatzung; „Landungstrupp“ wirkt bei Feldkämpfen mit
  Landung, bei der Verteidigung der Besatzung nur mit der Hafenrolle (Frage 3).
- **Sammelangriff:** Modifikatoren werden wie heute je Teilnehmer gemittelt (Angriff nach Anzahl, LP nach LP).
- **Kartell:** Kartell und Nester haben keine Modifikatoren, also keine Gegenwirkung. Als Hafenkommandant erhöht +6 %
  LP die Abwehr gegen Kartell-Landungen leicht; die Kartellstärke misst Forschung zur Hälfte mit, Admirale nicht.
- **Saisonfinale:** Armada-Kämpfe sind Seegefechte – dort bleiben Angriff und Verteidigung die richtige Wahl.
- **Wertung, Spielerkämpfe:** Landungstrupp hilft auch bei Überfällen auf Spieler; der Verteidiger hat mit einem
  Hafenkommandanten (Verteidigung +6 % LP, Angriff +7 % auf See und Anlagen) ein Gegenmittel.

## 6. Missbrauchsschutz

Keine neue Quelle für Rohstoffe oder Punkte; Plätze (höchstens 3), Kosten und Risiko bleiben. Die Umschulung gibt es
einmal je Admiral und nur für die erste Spezialisierung.

## 7. Aufwand: **S**

Eintrag in `balance.json` (`admirals.specs.landung`), Texte (Name, Beschreibung, Hilfe), Umschulung (ein Befehl, eine
Markierung je Admiral), Anzeige in Ernennen/Missionsplanung/Bericht (läuft über `admiralModLines` schon generisch),
`sim/admirals.ts` um Nest 6 und knappe Verbände erweitern. Mit Frage 4 (`nestLoot`) und 3.3 (KI): **M**.

## 8. Offene Entscheidungen

1. **Stärke des Landungstrupps (voller Rang)?** a) +10 % Angriff / +8 % LP (≈ +11 % Kampfwert). b) +6 % / +5 %
   (≈ +7 %). c) +15 % / +12 % (≈ +16 %). **Empfehlung: a** – entspricht „Angriff“ zur See und einem Forschungszweig.
2. **Minenschaden −30 % dazu?** a) ja. b) nein. **Empfehlung: a** – nur gegen Spielerhäfen mit Minensperre spürbar,
   passt zum Bild der Sturmlandung.
3. **Hafenrolle des Landungstrupps?** a) LP Landtruppen +6 % als Hafenkommandant. b) keine Hafenrolle (nur Mission).
   **Empfehlung: a** – sonst ist der Admiral daheim nutzlos; +6 % entspricht „Verteidigung“.
4. **Beutemeister auch für feste Nestbeute (+10 %)?** a) ja. b) nein. **Empfehlung: a** – heute wirkt er bei Nestern
   nur über den Laderaum.
5. **Umschulung bestehender Admirale?** a) einmal kostenlos. b) gegen 1 000 Kredite. c) keine. **Empfehlung: a.**
6. **Admirale für KI-Spieler?** a) ja (Freibeuter Landungstrupp, Festung Verteidigung daheim). b) nein.
   **Empfehlung: a** – gleiche Regeln für alle; ohne KI-Admirale fehlt der Vergleich in den Testläufen.
