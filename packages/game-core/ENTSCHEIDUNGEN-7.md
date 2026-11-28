# game-core – Entscheidungen, Teil 7

Fortsetzung von `ENTSCHEIDUNGEN-6.md` (voll). Verbindlich bleibt `docs/REGELN.md`. Neue Abschnitte bitte hier anhängen.

## Balance v1.35 – Welle 3 der Abschlussprüfung 0.38 (ein gemeinsamer Simulationslauf)

Grundlage: Nutzerentscheidungen vom 27.11.2026 (`.claude/review-0.22/ENTSCHEIDUNGEN-ABSCHLUSS.md`), Befunde M-01 … M-13,
ST-02 … ST-19, AN-10. Gemessen mit `npm run sim` (messung.ts, nest6.ts, expansion.ts, armada.ts) und dem Saisonlauf
`npm run sim:saison` (42 Tage, echte Worker-Schritte, drei KI-Spieler, vier passive Menschen). Kennzahlen vorher/nachher
stehen am Ende dieses Abschnitts.

1. **Kartell (Entscheid 2, Variante A – ein Zahlenhebel):** `pirates.raidStrengthShareOfDefense` 0,40 → **0,10**.
   Modell (messung.ts, Bot mit ganzem Verband daheim): Kartellkosten je Tag 23–40 % → 0–1 % der Tagesproduktion, das
   Kartell gewinnt weiter nie gegen einen gerüsteten Hafen; früh (bis Tag 3) und gegen schwache Häfen bestimmt
   `raidMinSchnellboote` die Stärke, dort ändert sich nichts. Im Saisonlauf reichten 0,20 (11 %) und 0,15 (10–12 %)
   nicht: Die KI-Häfen verlieren vor allem Küstenbatterien und Flugzeuge daheim, das hat der Modell-Bot nicht. Der Lauf
   schlüsselt den Verlust jetzt nach Berichtsart auf (Hafen-Überfall ≈ 90 %, Feld ≈ 5 %, Weltereignis ≈ 3 %); Kolonien
   ohne Truppen verloren jeden Überfall – dafür behält die KI jetzt 40 Landtruppen je Hafen (REGELN-KI.md). Kein
   zweiter Zahlenhebel (Intervall, Abzug) – sonst Überkorrektur.
   `scoring.npcDefenseFactor` 0,25 → **0,1** (ST-11: die Abwehr ist keine Entscheidung mehr; Punkte für eingesteckte
   Überfälle wären eine Einladung zum Leerlassen). Der Kartellbericht nennt den **bleibenden Verlust in Stunden
   Produktion** des Hafens (`report.lossHours`, `cartel-loss.ts`; Bericht-E-Mail und App), der Saisonlauf zusätzlich als
   „≈ x h Produktion“ je Tag und nach Berichtsart (Hafen, Feld, Konvoi, Weltereignis).
2. **Nestwertung (Entscheid 3A):** `scoring.nestFactor` **0,5** auf Kampf- und Beutepunkte aus Nestüberfällen
   (Bericht mit `nest_id`, auch Sammelangriffe auf Nester). PvP, Schatzschiff, Großflotte und Belagerungsring voll.
3. **Tagesbefehle (Entscheid 4B):** `scoring.ordersMaxShare` **0,05** – gezählt werden min(Befehle, ⌊0,05/0,95 ×
   übrige Punkte⌋) (`cappedOrders`); die Rangliste zeigt den gedeckelten Wert. Folge: Wer nur Befehle abholt und sonst
   nichts hat, bekommt dafür keine Rangpunkte – bewusst, die Rohstoffbelohnung bleibt. Handbuch nennt den Deckel.
4. **Nest 6 / Woche 5 (Entscheid 9 A+B+C):** Beute gleicher Wert (73 520 statt 73 580 Richtwert) in **29 000 statt
   37 700 Einheiten** (3 500 Stahl, 3 000 Treibstoff, 21 300 Elektronik, 1 200 Proviant): Der Tag-38-Verband (9
   Landungsschiffe) fasst sie ganz, bei 130 % Wachstum 86 % (vorher 86 % / 66 %); der Tag-28/35-Verband (7) 83 %
   statt 64 % (bei 130 %: 64 statt 49 %). Besatzung × 1,35 → **× 1,40** (36 Schnellboote, 350 Miliz): Sieg Tag 28 52 %, Tag 35 65 %, Tag 38 100 %
   – erster Prüftag ≥ 70 % liegt damit im Fenster 35–38 (vorher Tag 31). × 1,45 hätte das Fenster auch getroffen
   (Tag 35 53 %); 1,40 gewählt, weil der Verband der KI-Spieler auf Felder und Nester verteilt ist. Gewöhnliche
   Weltereignisse bis **Tag 37,5** (`finale.ordinaryEventsUntilDays`, nach dem Planer-Fix aus Welle 0). Der Probekampf
   gegen Nester zeigt den **Laderaum-Anteil** („passt zu x % bzw. y % gewachsen“). KI: Schafft der Verband daheim das
   Nest 6 nicht, wohl aber mit den heimkehrenden Überfallverbänden, wartet sie höchstens 8 h (`waitForTopNest`).
5. **Finale (Entscheid 10A, 1C):** Vorhut für jeden Hafen über **500 km** vom Sammelpunkt (`vanguardSpreadKm` 0,
   `vanguardKm` 400 → 500, Mitte der Spanne 400–600), KI-Spieler zählen mit **0,5 × K** in H (`botKFactor`),
   `lootPerHp` 0,6 → **0,9**. `armadaFactor` geprüft und bei **0,5** belassen: Nester zählen jetzt ebenfalls × 0,5, das
   Finale ist damit relativ doppelt so stark wie in v1.34 (Empfehlung der Abschlussprüfung). **U-Boot-Doktrin**
   (sim/armada.ts, `runFinaleUbootSim`): ein U-Boot-Verband mit den Kommandopunkten des Bot-Verbands besiegt einen
   Armada-Abschnitt an Tag 28/35/38 zu 100 % **ohne Verlust** (Bot-Verband: 2 900–4 600 Verlust) – bestätigt. Daher
   bekommt **nur die Armada** U-Jagd: `finale.squadronUJagd` 10 (Wasserbomben je Schnellboot, nur in Kämpfen gegen die
   Armada über `finaleBattleBalance`; Probekampf, Vorschau und KI rechnen damit). Mit 10 verlieren U-Boote 2 000–2 750
   je Abschnitt bei 2 600–3 400 Schaden – Schaden je Verlust 1,2–1,3 wie der gemischte Verband (1,0–1,2). Kartell, Nester
   und übrige Weltereignisse bleiben ohne U-Jagd (ENTSCHEIDUNGEN-3 L gilt dort weiter).
6. **Optischer Satellit (Entscheid 11B):** Start 5 000/2 000/3 500 → **2 000/700/1 250** (≈ 7 010 Richtwert statt 19 100),
   Lebensdauer **14 Tage** (`types.optisch.lifetimeHours` 336; Radarsatellit bleibt 7 Tage). Ehrlich gerechnet
   (sim/satellite.ts, nur Nestbeute): Mehrwert gegen nur Radar +611 (Tag 28) bzw. +994 (Tag 35) je Woche, über 14 Tage
   also ≈ 1 200–2 000 gegen 7 010 Start – die Nestbeute allein trägt ihn weiter nicht (vorher ≈ 1 200 gegen 19 100);
   der Rest ist Sicht auf Verbände, Häfen und Felder. Die eigene Fähigkeit (Variante A) bleibt laut Entscheid ein
   Vorschlag für REGELN-LAGEBILD.md nach dem Live-Test.
7. **Kolonien (Entscheid 12 B+C):** Gründungsgebühr ab dem 3. Hafen = Kolonieschiff × (2^(n−2) − 1) (`colonyCostGrowth`
   2), beim Auslaufen abgebucht, bei gescheiterter Gründung zurück. Unterhalt je Kolonie **3 000 Stahl + 1 500 Treibstoff
   je Tag** (`colonyUpkeepPerDay`), laufend, je Ressource höchstens die Gebäudeproduktion der Kolonie (keine
   Todesspirale für frische Außenposten). sim/expansion.ts: Amortisation 2. Hafen 4–5 Tage, 3. Hafen 7–8 Tage (vorher
   2–3 Tage für beide). Unterhalt wirkt nur über `state.colony` in `power.ts` (eine Zeile), damit Anzeige, Lager und
   Saisonlauf denselben Wert sehen.
8. **Allianzen (Entscheid 6B):** Höchstgröße ohne Einstellung **max(3, ⌈Menschen/2⌉)** (`defaultAllianceSize`, Menschen =
   Spieler ohne KI-Profil), in der Verwaltung (neue Karte „Allianzen“) fest setzbar 2–50. Allianzrang = ⌊Summe ÷ max(2,
   Mitglieder)⌋ (+ Feldpunkte am Saisonende, `allianceScore`); die Ansicht der eigenen Allianz zeigt weiter die Summe.
9. **KI-Vergeltung (Entscheid 5B):** Server-Einstellung `bots_vergeltung` (Standard an, Verwaltung → KI-Spieler).
   Überfällt ein Mensch eine KI (Bericht der letzten 24 h), klärt die KI dessen Ausgangshafen auf und schlägt bei
   Probekampf ≥ 75 % zurück – höchstens einmal je 24 h je KI, nur gegen diesen Angreifer, Schutzregeln und Sperrfrist
   gelten; ist der Probekampf zu schwach, wird der Überfall verworfen (`bots-vergeltung.ts`).
10. **Festung:** Heimwache Truppen 50 % → **30 %** (`FESTUNG_MIN_GUARD`, Profil `homeGuardShare`), Schiffe und Flugzeuge
    nur **20 %** daheim (`FESTUNG_SHIP_GUARD`); Doktrin Schützen 12 → 16 %, Küstenbatterie 18 → 16 %, Flak 12 → 10 %
    (Anlagen weiter 38 %, das Profil bleibt). Grund: Im Saisonlauf v1.34 scheiterte die Landung an Nest 4 an der halben
    Truppe (Probekampf: 368 Schützen 0 %, 515 Schützen 100 % gegen den ungünstigen Wurf). Ergebnis: Nest 4 im Saisonlauf.
11. **Übrige Welle-3-Punkte:**
    - **Börsenkonvoi (M-09):** Kartellchance nach dem Warenwert aller eigenen Börsenkonvois der letzten 4 h samt diesem
      (`convoys.marketValueWindowHours`, `recentMarketConvoyValue`); der Kartellverband richtet sich weiter nach der
      eigenen Ladung. 50 000 in zehn Orders: erwarteter Verlust ≈ 920 statt 435 (eine Order 1 200). Order und Kasten
      „Geleitschutz“ rechnen mit demselben Wert (`riskValue`) und nennen die Summe der letzten Stunden. Faktoren
      (`marketChanceFactor` 0,5, `marketMaxChance` 0,08) bleiben; die Empfehlungstabelle in ENTSCHEIDUNGEN-6 gilt je
      Einzelorder unverändert, für Folgekäufe steigt die Chance bis zur Obergrenze 8 %.
    - **Aufholhilfe (M-10, AN-10):** Rückstand nach Ausbau **+ Militär** (`includeMilitary`), **Mindestzufluss** 10 % der
      Median-Gebäudeproduktion je Stunde, solange die Hilfe läuft (`minFlowShare`).
    - **Baumeister (M-12):** ab Stufe **12** (`fromLevel`), Schwellen 1/3/6 (vorher 18, 1/4/10 – unerreichbar).
12. **KI für die Wächter des Saisonlaufs (`--strict`):** Mindestwache von 40 Landtruppen je Hafen (Kolonien ohne Truppen
    verloren jeden Kartell-Überfall), Weltereignisse bis 1 200 km mit freigehaltenem Missionsplatz und Fahrt ohne zu
    langsame Landungsschiffe bzw. Flugzeuge außer Reichweite (Diagnose im Lauf: die Festung scheiterte an belegten
    Plätzen, „out_of_range“ und „intercept_impossible“), Warten auf heimkehrende Verbände vor Nest 6. Alles in
    REGELN-KI.md beschrieben. Wächter „Angriffe auf Weltereignisse“: warnt nur noch, wenn in der Saison mindestens ein
    gewöhnliches Ereignis in Reichweite (1 200 km) eines Hafens der KI entstand (`worldEventsInRange`) – die Lage der
    Ereignisse ist Zufall; ein Lauf zeigte alle Ereignisse 3 500–5 000 km vom Freibeuter entfernt.
13. **Bewusst nicht:** Kartell-Mechanik B (Abzug nach verlorenem Seegefecht) und C (Stärke aus Lagerbestand) – laut
    Entscheid später. Kein „naher Auftragsnest“ (TST-06), keine U-Jagd für Kartell/Nester. Keine Schemaänderung,
    keine Migration (neue Felder liegen in JSON: `report.lossHours`, `plan.foundingFee`, `state.colony` vorhanden,
    `bot_state.revengeAtMs/revengeReportId/topNestWait`, `server_setting bots_vergeltung`).

### Kennzahlen des Saisonlaufs vorher (v1.34, Stand 0.42.0) und nachher (v1.35)

`npm run sim:saison` (Seed 4242, 42 Tage, 3 KI + 4 passive Menschen; nachher mit `--strict`, Exit 0):

| Wächter / Kennzahl | vorher | nachher | Ziel |
|---|---|---|---|
| Kartellverlust je Tag (Median der KI ab Tag 7) | 23 % | 10 % (≈ 2,3 h Produktion; Zwischenläufe 7–8 %) | ≤ 10 % |
| Kampf + Beute am Gesamtrang (Median der KI) | 61 % | 28 % | ≤ 50 % |
| Tagesbefehle am Gesamtrang | 1 % | 1 % | ≤ 5 % |
| Freibeuter: erster Sieg Nest 4 | Tag 12 | Tag 15 | ≤ Tag 18 |
| Festung: höchstes Nest | 2 | 4 (erster Sieg Tag 25) | ≥ 4 |
| Angriffe auf Weltereignisse (Festung/Freibeuter) | 0 / 0 (Warnungen) | 1 / 2 | ≥ 1, wenn eins in Reichweite |
| Sieg über Nest 6 (KI) | keiner | keiner (siehe unten) | – |
| Punkte Freibeuter / Festung / Händler am Ende | 116 738 / 32 216 / 52 334 | 37 677 / 31 528 / 35 759 | – |
| Warnungen insgesamt | 4 | 0 | 0 |

Nest 6: Die KI besiegt es auch nachher nicht. Ihr Verband ist auf Felder (Besatzungen bleiben draußen) und laufende
Nestfahrten verteilt; der ganze Verband des Freibeuters schlüge Nest 6 sicher (Probe: 100 % gegen den ungünstigen Wurf),
der jeweils daheim liegende Teil nicht, und die heimkehrenden Überfallverbände allein reichen meist auch nicht
(`waitForTopNest` greift daher selten). Das Zielfenster ist am Modell-Verband geprüft (sim/nest6.ts: Tag 35 65 %,
Tag 38 100 %); der Wächter zur Nest-6-Beute nach Laderaum warnt erst bei einem Sieg und meldet ohne Sieg „ok“.

## UX-0.43: App-Hülle, Menü, Einstellungen, Verwaltung, Desktop (uxs)

Grundlage: `.claude/review-0.22/UX-0.43.md` (B2, A6, B3, B4, B7) und die Nutzerentscheidungen E-1 und E-7.

- **Gleichrangige Ansichten (B2).** Handbuch, Einstellungen und Verwaltung sind eigene Ansichten der App-Hülle
  (`lib/app-views.ts`), nicht mehr ineinander geschachtelt. Aus dem Menü, per Kürzel oder per Benachrichtigung geöffnet,
  ersetzt eine Ansicht die offene, „Zurück“ (Knopf, Browser, Esc) führt zum Reiter darunter. Nur ein Querverweis
  (Textlink, z. B. Handbuch → Einstellungen) legt eine zweite Ebene an; „Zurück“ führt dann zur verweisenden Ansicht.
  Mehr als zwei Ebenen gibt es nicht. Neues Sprungziel `{ to: "view", view, focus? }` (focus "push" springt zur
  Push-Karte – die zentrale Stelle für die Push-Frage im Spielablauf).
- **Jede Funktion ein Ort.** Menü: Handbuch (mit „Was ist neu?“), Einstellungen, Freunde einladen (Blatt), Fehler
  melden, Verwaltung (Admin), Abmelden. Handbuch und Einstellungen verweisen nur per Textlink. Aus den Einstellungen
  entfallen die Karten „Freunde einladen“, „Fehler melden“ und „Verwaltung“; aus dem Handbuch Schnellkacheln,
  „Angemeldet als“ und die Fehler-Karte.
- **Einstellungen in vier Gruppen (A6).** Benachrichtigungen (Push, Ruhezeit, Morgenbericht mit Kanälen,
  E-Mail-Arten) · Spiel (Nachtschild-Startzeit – dieselbe Komponente wie Basis → Schutz –, Kurszeile) · Konto (Name,
  E-Mail-Adresse, Passwort eingeklappt, Abmelden als Textlink) · Hilfe (Handbuch, Neuigkeiten, Fehler melden,
  Tastaturkürzel, Version). E-Mail-Arten und der E-Mail-Kanal des Morgenberichts sind ohne Mailversand bzw. ohne
  bestätigte Adresse deaktiviert und nennen den Grund. Alle Uhrzeiten als 24-h-Auswahl (Morgenbericht: Stunde +
  Viertelstunde statt Browser-Zeitfeld mit AM/PM). Wetter-/Animationsschalter gibt es (noch) nicht – keine neuen
  Einstellungen erfunden.
- **Verwaltung in vier Reitern (B3).** Übersicht (Ampel nur mit Handlungsbedarf, jede Zeile springt; Fehlermeldungen,
  fehlgeschlagene Ereignisse; „Einrichtung“ eingeklappt mit Systemwerten, Sicherungen, E-Mail-Versand und dem dortigen
  Server-Jargon) · Spieler (Suche, Rücksetzcode, Einladungscodes, Freunde einladen, Auffällige Paare) · Welt
  (KI-Spieler, Allianzgröße; rot umrandete Gefahrenzone mit Weltpolitik-Not-Aus/Fenster absagen, Kartennebel als echter
  Schalter, Kartell-Stärke, Saisonfinale – jede Aktion mit Bestätigung) · Statistik (Zeitraum, Kennzahlen, Balance
  live, Weltpolitik-Übersicht nur lesend; Technik-Karten eingeklappt). Duplikate entfernt: „Fehlgeschlagene Ereignisse“
  nur noch in der Übersicht. Gewählter Reiter wird geräteweit gemerkt.
- **Desktop (B4, E-7, E-1).** Handbuch, Einstellungen, Verwaltung, Forschung und Saison (Rangliste/Bilanz/Erfolge)
  sind Textansichten: Karte ausgeblendet (bleibt geladen), Inhalt in voller Breite (Handbuch Lesebreite, Einstellungen
  und Verwaltung zweispaltig). Der Leisten-Eintrag „Karte“ ist am Desktop der Umschalter „Karte groß“: er legt die Karte
  über die aktuelle Ansicht und kehrt beim zweiten Druck genau dorthin zurück (aus dem Reiter Karte: zum vorigen
  Reiter). Leiste unten: Saison, Handbuch, Einstellungen, Verwaltung (Admin). Kopfleiste: Rohstoffe gruppiert, größer,
  mit Namen und kräftigem Lagerbalken (Warnfarbe ab 85 %), rechts Fortschritts-Chip „Platz 3 von 8 · 420 bis Platz 2 ·
  Tag 5/42“ aus `social.ranking` (unter 1280 px Kurzform) – Antippen öffnet die Saison.
- **Tastaturkürzel.** 1–5 Hauptreiter, A „Alle abholen“ (falls sichtbar), M Karte groß, ? Handbuch, „,“
  Einstellungen, Esc schließt erst Blätter, dann Ansichten bzw. „Karte groß“. Nie beim Tippen, nie mit
  Strg/Alt/Cmd, nicht bei offenem Dialog. Reiter tragen `aria-keyshortcuts`; Liste unter Einstellungen → Hilfe.
- **Zwei Umschalter-Bauformen (B7).** Ebene 1 `Segments` (Unterstrich-Reiter, neu optional `dot` statt Zahlenpille),
  Ebene 2 `FilterChips` (umbrechend, alle sichtbar, kein Scrollpfeil, radiogroup mit Pfeiltasten). In den eigenen
  Dateien umgestellt: Handbuch-Kapitel, Einstellungsgruppen, Kurszeile, Zeitraum der Statistik, Filter der
  Fehlermeldungen. Meldungen/Rangliste/Allianz/Berichte stellt der Lage-Entwickler um.
