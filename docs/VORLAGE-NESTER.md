# Vorlage: Aufklärung auf Sicht und lebendige Nester

**Status: Vorlage zur Freigabe** (27.11.2026, Version 0.28.3, Balance v1.29). Nichts davon ist umgesetzt. Grundsatz vom
Nutzer freigegeben („Aufklärung auf Sicht“, „Lebendige Nester“); hier stehen die Zahlen. Startwerte für einen neuen
Block `pirates.living` und `intel.sightRecon`. Rechnung: `/tmp/tf-review/nester/nester.ts` (Bot-Verband aus
`sim/bot.ts`, 200–400 Seeds je Fall; Ausgaben `ausgabe-20.txt` für ±20 % und `ausgabe-15.txt` für ±15 %).

## 1. Ziel

Frage des Nutzers: „Wieso sollte man zur Aufklärung komplett anfahren/anfliegen, wenn die Sensorreichweite alles
aufdeckt?“ Heute stimmt beides nicht zusammen:
- Nest-Besatzung und -Beute sind je Stufe fest (`pirates.nestLevels`). Wer die Stufe kennt (Erkennung: Bordsicht 105 km,
  Drohne 200 km, Radar, Satellit), kennt alles. Die Mission „Aufklärung“ bringt bei Nestern nichts Neues.
- Die Mission fährt trotzdem bis ans Ziel, obwohl die Sensoren an Bord schon 105–200 km vorher alles sehen.

Künftig: **Die Erkennung zeigt die Stufe und Spannen, erst das Lagebild zeigt das genaue Nest.** Die Aufklärung holt
das Lagebild **auf Sicht** und kehrt dort um. Damit lohnt sie sich, und sie ist schneller und billiger.

## 2. Regeln: Aufklärung auf Sicht

### 2.1 Wendepunkt
- Die Mission „Aufklärung“ endet am **ersten Punkt der Route, an dem das Ziel in Lagebild-Reichweite liegt**, und
  kehrt dort um. Schiffe fahren dazu den Seeweg (`route-position.ts`), Flugzeuge die Luftlinie; gemessen wird der
  gerade Abstand vom Routenpunkt zum Ziel (Projektions-km wie bei allen Kreisen).
- **Lagebild-Reichweite** = Bordsicht der besten Einheit für Objekte (`intel.fleetSight`):
  Aufklärungsdrohne **200 km**, Kriegsschiff (Korvette, Zerstörer, Minenräumer) **105 km**, Transporter **40 km**.
- **Ohne Objektsicht** (nur Jäger/Bomber, nur U-Boote) fährt der Verband wie heute **bis ans Ziel** (Reichweite 0).
  U-Boote bleiben damit der unauffällige, aber langsame Aufklärer.
- Liegt das Ziel schon beim Auslaufen in Reichweite, gilt eine **Mindestfahrzeit von 10 min** (kein Sofort-Lagebild
  per Klick).
- Am Wendepunkt entsteht das **volle Lagebild** wie heute bei Ankunft (Bericht „Aufklärung“, Eintrag in
  `intel_sighting`, Quelle „Aufklärung“).

### 2.2 Fahrzeit, Treibstoff, Meldung
- Fahrzeit und Treibstoff nach der **verkürzten Strecke** (Hin- und Rückweg bis zum Wendepunkt). Beispiel Ziel 400 km
  Luftlinie:

| Aufklärer | heute hin+zurück | auf Sicht | Ersparnis |
|---|---|---|---|
| Drohne (300 km/h, 200 km) | 2 h 40 min | 1 h 20 min | −50 % Zeit und Treibstoff |
| Korvette (60 km/h, 105 km) | 13 h 20 min | 9 h 50 min | −26 % |
| Zerstörer (55 km/h, 105 km) | 14 h 33 min | 10 h 44 min | −26 % |
| Landungsschiff (40 km/h, 40 km) | 20 h | 18 h | −10 % |

- **„Aufklärer gesichtet“** (heute bei Ankunft an einem fremden Hafen mit Radar) gilt künftig, wenn der Wendepunkt im
  Ausguck (120 km) oder in der Radarreichweite (150 km + 40 km je Stufe) des Zielhafens liegt. Ein Schiff (105 km)
  wird also immer gesehen; eine Drohne (200 km) erst ab Radarstation 2 (230 km). Tarnanstrich und Funkdisziplin wirken
  wie bisher.
- Rückruf unverändert (Heimfahrt ab aktueller Position).

### 2.3 Kampagne
- Jeder Abschnitt endet am Wendepunkt des nächsten Ziels; der nächste Abschnitt beginnt dort. Liegt das nächste Ziel
  schon in Reichweite, ist es im selben Augenblick aufgeklärt. Heimfahrt ab dem letzten Wendepunkt.
- Erkennung entlang der Route (`campaign.revealKm` 150 km) bleibt.
- Bordsicht, Patrouille, Radar und Satellit liefern weiter nur **Erkennung**, kein Lagebild.

## 3. Regeln: Lebendige Nester

### 3.1 Wurf bei jeder Besetzung
- Bei Saisonbeginn und bei jeder **Wiederbesetzung** würfelt der Server für jedes Nest neu (Stufen 2–6):
  - **Besatzungsfaktor** gleichverteilt in 5-%-Schritten **80 … 120 %** (9 Werte), ein Faktor für Schnellboote und
    Miliz (gerundet, mindestens 1). Stufe 4 also 18–26 Schnellboote und 172–258 Miliz.
  - **Anlagen:** jede Anlagenart, die die Stufe hat (Stufenwert ≥ 1), bekommt **−1 / 0 / +1** mit 25 / 50 / 25 %.
    Stufe 3 also je 0–2 Flak, Küstenbatterie, Bunkerlinie.
- **Stufe 1 schwankt nicht** (4 Schnellboote, 18 Miliz, keine Anlagen): Sie ist die Einstiegsstufe (Abschnitt 4.2).
- Der Wurf wird **gespeichert** (Spalte `nest.roll`), nicht aus einem Seed abgeleitet: Der Code ist im Browser
  sichtbar, ein ableitbarer Wurf ließe sich ohne Lagebild ausrechnen.

### 3.2 Schwächung und Erholung
- Gewinnt das Nest einen Kampf, behält es seine Überlebenden. Sofort danach füllt es seine Einheiten auf **mindestens
  70 % des Wurfs** auf („Verstärkung“), dann **+5 % des Wurfs je Stunde** bis zum vollen Wurf (spätestens nach 6 h).
- **Zerstörte Anlagen** kommen **12 h** nach dem Kampf vollständig zurück.
- Gewinnt der Angreifer, ist das Nest wie heute leer (12 h, Stufe 6: 24 h); die Wiederbesetzung bringt einen neuen
  Wurf in voller Stärke.
- Gerechnet wird beim Abruf aus Zeitstempeln (`nest.garrison`, `nest.garrison_at`), **ohne Takt-Ereignis**.

### 3.3 Beute wächst
- Bei Besetzung **100 %** der Stufenbeute, danach **+1 % je Stunde**, solange das Nest nicht erobert wird, **Deckel
  130 %** (nach 30 h). Ein abgewehrter Überfall setzt nichts zurück (es wurde nichts geholt).
- Der Laderaum begrenzt wie heute; der Beutemeister (+10 % Nestbeute) wirkt darauf (höchstens 143 %).

### 3.4 Was man sieht
| Kenntnis | Nest zeigt |
|---|---|
| Sichtung (Radarsatellit, Tarnnetz-Fall) | nur Position (wie heute) |
| **Erkennung** (Bordsicht, Ausguck, Radar, Patrouille, Kampagne unterwegs, optischer Satellit) | Stufe, besetzt/leer, Wiederkehr; **Besatzung als Spanne** („18–26 Schnellboote, 172–258 Miliz“), **Anlagen „unbekannt“** (mögliche Spanne im Tipp), **Beute 100–130 %** |
| **Lagebild** (Aufklärung, Kampfbericht) | Wurf, aktuelle Besatzung, Anlagen, Beute in % und Rohstoffen, jeweils mit Stand |

- Das Lagebild speichert in `intel_sighting.data` zusätzlich `roll`, `garrison`, `garrisonAt`, `lootFactor`, `lootAt`.
  Die Karte **rechnet hoch** (Erholung und Beutewachstum sind feste Formeln): „Stand vor 5 h · jetzt voraussichtlich
  24 Boote (voll), Beute 121 %“.
- Auch ein **verlorener Überfall** liefert über den Kampfbericht das Lagebild der Überlebenden.

### 3.5 Probekampf und Vorschlag
- **Mit Lagebild** (jünger als 24 h = `staleHours`, und keine Wiederbesetzung seither): Probekampf **genau** gegen die
  hochgerechnete Besatzung. Vorschlag wie heute: kleinster Verband mit ≥ 90 % Sieg.
- **Ohne Lagebild** (nur Erkennung oder Lagebild älter): Probekampf über die Spanne (100 Würfe aus der Verteilung, je
  ein Seed). Anzeige **„Siegchance 22–100 %, im Mittel 90 %“** (unterer Wert: ungünstigster Wurf). Vorschlag:
  kleinster Verband, der **im Mittel ≥ 90 %** siegt, mit dem Hinweis „Mit Lagebild genauer – Aufklärung schicken“.
- Kampfsimulator: Vorlagen „Nest Stufe X (Mitte)“, „… ungünstig“ und „… aus Lagebild“.

## 4. Balance-Begründung

### 4.1 Zielfenster bleiben (Bot-Verband, ganzer Bestand, erster Prüftag mit ≥ 70 % Sieg)
| Nest | fest (heute) | Zufallsnest (Wurf unbekannt, 400 Würfe) | immer ungünstigster Wurf | Ziel |
|---|---|---|---|---|
| Stufe 1 | Tag 1 | Tag 1 | Tag 1 | 1–2 |
| Stufe 2 | Tag 3 (79 %) | Tag 3 (72 %) | Tag 5 | 3–5 |
| Stufe 3 | Tag 7 (98 %) | Tag 7 (84 %) | Tag 10 | 7–10 |
| Stufe 4 | Tag 14 (98 %) | Tag 14 (89 %) | Tag 21 | 14–18 |
| Stufe 5 | Tag 21 (100 %) | Tag 21 (93 %) | Tag 28 | 21–28 |

Im Mittel trifft jedes Nest sein Fenster unverändert. Wer gezielt schwache Würfe sucht (Aufklärung), nimmt Nester
früher: Der günstigste Wurf fällt schon 1–2 Prüftage vorher (Stufe 4 Tag 7: 97 %, Stufe 5 Tag 10: 76 %). Das ist der
gewollte Lohn des Lagebilds. Ohne Anlagen-Schwankung rutscht Stufe 2 knapp aus dem Fenster (Tag 3: 69 %), mit ihr
nicht. Bei ±15 % gleiches Bild, der ungünstige Rand nur etwas milder (Stufe 4 Tag 18).

### 4.2 Einstieg
Auftrags-Verband (2 Korvetten, 1 Landungsschiff, 30 Schützen) und Vorschlag aus dem Probekampf (1 Landungsschiff,
28 Schützen, Probe 95 %) gegen Stufe 1 mit Faktor:

| Faktor | 0,90 | 1,00 | 1,05 | 1,10 | 1,20 |
|---|---|---|---|---|---|
| Auftrags-Verband | 100 % | 100 % | 95 % | 89 % | 64 % |
| Vorschlag | 100 % | 94 % | 83 % | 72 % | 32 % |

Schon +10 % drückt den Vorschlag unter 85 %. Deshalb **Stufe 1 fest**. Das Start-Nest ist ohnehin per „Hafenamt“
als Lagebild bekannt; Beutewachstum und Schwächung gelten auch für Stufe 1 (nur zum Vorteil des Neulings; die
130 % = 4 940 Rohstoffe werden vom einen Landungsschiff auf 4 000 gedeckelt, heute 3 800).

### 4.3 Was das Lagebild wert ist
Kleinster Verband (≥ 90 % Sieg) aus dem Bot-Bestand, Wert in Stahl-Gegenwert (Börsen-Richtwert):

| Tag / Nest | schwacher Wurf | Mitte | starker Wurf | ohne Lagebild (Mittel über Spanne) | der siegt gegen starken Wurf |
|---|---|---|---|---|---|
| 7 / Stufe 2 | 5 328 | 6 084 | 15 879 | 7 488 | 0 % |
| 10 / Stufe 3 | 10 068 | 19 619 | 33 787 | 23 053 | 23 % |
| 14 / Stufe 3 | 10 068 | 20 480 | 34 470 | 26 766 | 22 % |
| 21 / Stufe 4 | 17 664 | 30 136 | 49 589 | 38 048 | 4 % |
| 28 / Stufe 4 | 17 664 | 29 056 | 43 971 | 34 650 | 28 % |
| 28 / Stufe 5 | 27 324 | 44 160 | (reicht nicht) | 49 110 | 24 % |

- Ohne Lagebild schickt man **15–45 % mehr** Verband als mit genauer Kenntnis eines mittleren Nests und verliert trotzdem
  bei einem starken Wurf fast sicher. Mit Lagebild sieht man schwache Nester (halber Verband) und meidet starke.
- Der heutige Vorschlag (Mitte) siegt gegen ein unbekanntes Nest nur noch zu **61–78 %**. Eine Drohne (≈ 480
  Stahl-Gegenwert, kommt zurück) kostet weniger als jeder verlorene Überfall ab Stufe 2.

### 4.4 Schwächung: warum 70 % Mindeststärke
Verliert der Bot-Verband knapp, bleiben dem Nest Ø 38–44 % (Stufe 4/5); gegen einen schwachen Angreifer 65–83 %. Eine
sofortige zweite Welle aus den Resten des Angreifers siegt dann:

| Mindeststärke nach Abwehr | Tag 10 / Stufe 4 | Tag 14 / Stufe 5 | Tag 18 / Stufe 5 |
|---|---|---|---|
| keine | 99 % | 100 % | 99 % |
| 60 % | 98 % | 81 % | 80 % |
| **70 %** | 93 % | 48 % | 41 % |
| 80 % | 88 % | 24 % | 11 % |

Ohne Mindeststärke würde „zweimal knapp verlieren“ jedes Nest nehmen (Doppelwelle aus zwei Häfen oder als
Allianz). Mit 70 % bleibt die zweite Welle eine Chance, kein Trick. Bei normaler Heimfahrt (400 km, 16 h) ist das
Nest ohnehin wieder voll.

### 4.5 Beutewachstum und Wertung
- Beutepunkte = Rohstoffwert der Beute. Die Mehrbeute (bis +30 %) deckelt meist der **Laderaum**: Bot-Verband
  Stufe 3 an Tag 14 (Laderaum 20 000) +30 % (15 600 statt 12 000), Stufe 4 an Tag 21 (24 000) +21 %, Stufe 5 an
  Tag 28 (28 000) +8 %, an Tag 7 bei Stufe 3 (12 000) gar nichts. Wer mehr will, nimmt Landungsschiffe mit.
- In der kleinen Runde (≈ 70 Nester, 3 KI + wenige Menschen) stehen die meisten Nester beim ersten Überfall am Deckel.
  Grob geschätzt **+5–15 % Beutepunkte** über die Saison, keine Verschiebung der Kategorien.
- Fleißiges Abräumen bleibt besser als Warten: alle 12 h = 100 % je 12 h (8,3 %/h), 30 h warten = 130 % je 42 h (3,1 %/h).

## 5. Wechselwirkungen

- **Bots:** Nester nur angreifen, wenn der Probekampf hält – mit Lagebild (≤ 24 h) genau, sonst gegen den
  **ungünstigsten Wurf** (KI soll nicht „Glück haben“). Freibeuter und Festung klären bekannte Nester ohne Lagebild auf
  (bestehende Kampagnen; die Ziel-Liste nimmt „erkannt, aber ohne Lagebild“ dazu). Der Händler (nur Stufe ≤ 2,
  Siegquote 100 %) klärt nicht auf und greift nur, was er auch gegen den starken Wurf schafft; Stufe 1 ist fest, sein
  Hauptziel bleibt also. Probekampf je Nest statt je Stufe, höchstens 6 Nester je Zug (heute 6 Versuche).
- **Satelliten:** Der optische Satellit liefert für Nester nur noch Stufe + Spanne. Er bleibt nützlich (Ziele finden),
  das genaue Bild holt die Drohne. Die Bot-Regel „Satellit, wenn ≥ 4 Nester ohne Lagebild“ bleibt.
- **Sammelangriff der Allianz** (`alliance-ops-raid/battle`): kämpft gegen die aktuelle Besatzung und schreibt
  Schwächung bzw. Eroberung wie ein Einzelüberfall. Allianz teilt das Lagebild wie bisher.
- **Weltereignisse:** starten auf Routen ab Nestern; die Besatzung des Nests spielt dabei keine Rolle – unverändert.
- **Saisonfinale / Saisonwechsel:** Finale ohne Nest-Sonderregeln; zum Ende stehen viele Nester am Deckel
  („Endspurt-Beute“), gedeckelt durch Laderaum. Der Saisonwechsel setzt Wurf, Besatzung und Beute zurück
  (`season.ts` neben `defeatedAt = null`).
- **Felder:** nicht betroffen (Frage 7). Ihre Wache ist klein (4/8/14 Schnellboote), Ertrag statt Beute.
- **Kartell-Überfälle, Wracks, Kampfpunkte:** Kartell unverändert. Kampfpunkte aus Nestkämpfen (× 0,25) schwanken mit
  dem Wurf (±20 %), im Mittel gleich.
- **Admirale:** Beutemeister wie in 3.3; Spezialisierung Aufklärung halbiert weiter fremdes Radar auf den Aufklärer
  (der Wendepunkt bei 200 km bleibt dann meist unbemerkt).
- **Auftragsbuch / Einstieg:** unverändert, weil Stufe 1 fest bleibt und das Start-Nest per Hafenamt bekannt ist.

## 6. Missbrauchsschutz

- **Wurf geheim:** gespeichert, nie ohne Lagebild an den Browser; nicht aus Nest-ID oder Zeit ableitbar.
- **Kein Neu-Würfeln** durch absichtlich verlorene Überfälle: neuer Wurf nur bei Wiederbesetzung nach Eroberung.
- **Doppelwelle:** Mindeststärke 70 % nach jeder gewonnenen Abwehr (4.4).
- **Billiger Probeangriff statt Aufklärung** (1 Korvette opfern für den Kampfbericht): kostet ≈ 730 Stahl-Gegenwert und
  geht verloren; die Drohne ist billiger und kommt zurück – kein Anreiz.
- **Beute horten:** Deckel nach 30 h.
- **Aufklärung per Klick:** Mindestfahrzeit 10 min auch bei Zielen in Reichweite.

## 7. Aufwand und Pi-Last

**Aufwand: L** (zwei Teile, getrennt lieferbar).
- **Aufklärung auf Sicht: M.** Wendepunkt in `game-core` (Route abschneiden, rein, testbar), `mission.ts`/
  `intel-campaign.ts` (Ankunftszeit, Treibstoff, Abschnitte), `intel-route.ts`/`intel-mobile.ts` (Position auf der
  kürzeren Strecke), „Aufklärer gesichtet“, Planung und Karte (Wendepunkt zeigen), Tests.
- **Lebendige Nester: L.** Migration `nest.roll`, `garrison`, `garrison_at`, `loot_at`; reine Funktionen in
  `pirates.ts` (Wurf, Erholung, Beute zum Zeitpunkt); `handlers.ts` (Überfall, Aufklärung), Sammelangriff,
  `intel-store.ts`/`intel-map.ts` (Erkennung mit Spannen, Lagebild mit Daten), `raid-plan.ts` (Probekampf über Spanne),
  `MapScreen.tsx`, `MissionPlan.tsx`, `BattleSim.tsx`, Handbuch, Bots, Saisonwechsel, Simulation, Tests (auch E2E).
- **Pi-Last:** gering. Kein Takt-Ereignis, Erholung und Beute werden beim Abruf aus Zeitstempeln gerechnet; ein
  Schreibzugriff je Kampf bzw. Wiederbesetzung (lazy beim nächsten Zugriff). Bots: höchstens 6 Nester × 3–12
  Probekämpfe je Zug (Schätzung: Mac ≈ 30 µs je Kampf, Pi etwa zehnmal langsamer, also < 30 ms). Probekampf über die Spanne läuft im Browser.

## 8. Offene Entscheidungen

1. **Lagebild-Reichweite der Aufklärung?** a) Bordsicht der besten Einheit (Drohne 200, Kriegsschiff 105,
   Transporter 40 km). b) einheitlich 150 km (`campaign.revealKm`) für alle mit Objektsicht. c) Bordsicht, aber
   höchstens 150 km. **Empfehlung: a** – passt zur Bordsicht, Drohnen werden der Aufklärer der Wahl.
2. **Stärke der Schwankung?** a) ±20 % in 5-%-Schritten. b) ±15 %. c) ±10 %. **Empfehlung: a** – Zielfenster
   halten im Mittel, das Lagebild spart 15–45 % Verband.
3. **Schwanken auch die Anlagen?** a) ja, −1/0/+1 je vorhandener Art (25/50/25 %). b) nein, Anlagen fest (dann sind
   sie aus dem Handbuch bekannt). **Empfehlung: a** – sonst wäre „Anlagen nur im Lagebild“ ohne Wirkung, und ohne sie
   rutscht Stufe 2 knapp aus dem Fenster.
4. **Einstieg?** a) Stufe 1 schwankt nicht. b) nur das Start-Nest fest, andere Stufe-1-Nester schwanken. c) alle
   schwanken, Vorschlag mit Sicherheitsaufschlag (Ziel 90 % gegen +20 %). **Empfehlung: a** – einfach, Auftragsbuch und
   Vorschlag bleiben sicher.
5. **Erholung nach gewonnener Abwehr?** a) sofort mindestens 70 %, dann +5 %/h (voll nach ≤ 6 h), Anlagen nach 12 h.
   b) ohne Mindeststärke, +5 %/h. c) mindestens 70 %, dann +2,5 %/h (≤ 12 h). **Empfehlung: a** – keine Doppelwelle,
   Schwächung trotzdem spürbar.
6. **Beutewachstum?** a) +1 %/h, Deckel 130 %. b) +1 %/h, Deckel 120 %. c) Grundwert 90 %, +1 %/h, Deckel 130 %
   (Abräumen gleich nach Wiederbesetzung bringt weniger). **Empfehlung: a** – der Laderaum deckelt ohnehin, +5–15 %
   Beutepunkte.
7. **Felder analog?** a) nein, Felder unverändert. b) wilde Wache schwankt ±20 % (Erkennung zeigt Spanne).
   **Empfehlung: a** – kleine Wachen, wenig Nutzen; später nachziehbar.
8. **Wie lange ist ein Lagebild genau?** a) 24 h (`staleHours`), solange keine Wiederbesetzung dazwischen liegt.
   b) 12 h. c) bis zur nächsten Wiederbesetzung, ohne Zeitgrenze. **Empfehlung: a** – keine neue Zahl, passt zu
   „bekannt/veraltet“.
9. **Vorschlag ohne Lagebild?** a) kleinster Verband mit im Mittel ≥ 90 % über die Spanne, dazu Bereich und Hinweis
   „Aufklärung schicken“. b) Verband für den ungünstigsten Wurf (sicher, oft 1,5–2,6-mal so groß oder unerreichbar).
   c) kein Vorschlag ohne Lagebild. **Empfehlung: a.**
10. **Bots ohne Lagebild?** a) Probekampf gegen den ungünstigsten Wurf. b) wie Menschen (Mittel über Spanne).
    **Empfehlung: a** – KI soll verlässlich sein und Aufklärung vorleben.
