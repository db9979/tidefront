# Vorlage: Weltpolitik (Gezeiten, Gesuche der KI-Spieler, Ruf, Seerat)

**Status: Vorlage zur Freigabe** (27.11.2026, Version 0.38.0, Balance v1). Nichts davon ist umgesetzt. Alle Zahlen
sind Startwerte für neue Blöcke `gezeit`, `gesuche`, `reputation`, `council` in der Balance. Rechnung:
`/tmp/tf-review/politik/vorlage/rechnung.py` und `rechnung.txt` (Gezeit-Plan mit 200 Seeds), ergänzend
`/tmp/tf-review/politik/mathe/ruf.txt` und `gegen.txt`. Grundlage: sieben Rollenbewertungen und eine Gegenprüfung
im Code; wo eine Zahl aus dem Abschlussbericht stammt, steht die Kennung dabei (`ABSCHLUSS-0.38.json`).

## 1. Ziel

Die Abschlussprüfung 0.38 nennt zwei Hauptbefunde: Die Runde hat zu wenig Interaktion (die KI-Spieler handeln nicht,
überfallen einander nie, greifen kein Weltereignis an; ST-03/ST-06/ST-17, AN-05), und Neulinge sind von rund 25
Systemen überfordert (ST-08). Die Weltpolitik soll das Erste beheben, ohne das Zweite zu verschärfen:

- **Kein neuer Reiter, keine neue Ressource, kein neuer Missionstyp, keine neue Push-Art.**
- Jede Wirkung ist ein **vorhandener Regler, der befristet verschoben wird** (`market.fee` 0,04,
  `dailyLimitShareOfStorage` 0,2, `contracts.ki.*`, `pirates.raidIntervalHours` 18, `fields.cartelRaidChance` 0,05,
  `convoys.cartel*`, `weather.stormFrom` 0,8, `worldEvents.kindWeights`).
- Jede Handlung ist ein **vorhandener Befehl** (Liefervertrag, Geleit, Feldbesatzung, Nest, Sammelangriff, Pakt).
- **Deckel:** eine politische Wirkung kostet oder bringt je Spieler höchstens **3 % der Tagesproduktion**
  (Tag 7/14/21/28: 16 728 / 21 096 / 27 408 / 31 560 Stahl-Gegenwert), ein Gesuch höchstens **4 h Produktion**.
- **Finale bleibt frei:** jede Wirkung endet spätestens `finaleSchedule.announceMs − 48 h` (bei 42 Tagen: Tag 33,5).

## 2. Teamurteil

| Baustein | Urteil | Stufe | Aufwand |
|---|---|---|---|
| Weltlage („Gezeit“) | 7 von 7 dafür; kleinster Baustein, füllt das Loch in Woche 5 (ST-12) | 2 | M |
| KI-Fraktionen („Gesuche“ + Ansehen je KI) | 7 von 7 dafür; größter Hebel gegen „KI interagiert kaum“ | 3–4 | M + L |
| Ruf (global) | dafür, aber erst nach Messung; als Zahl ohne Abnehmer wertlos | 6 | M |
| Seerat | nur verkleinert, zuletzt, erst ab 5 aktiven Menschen | 7 | M |

Einstimmig **verworfen** (Begründung in Abschnitt 8):
- **Embargo gegen Platz 1** als Wirtschaftssperre: besteht jede Abstimmung 1 gegen N−1 und stapelt sich mit dem
  Kopfgeld (`bountyByRank` 0,5 / 0,35 / 0,2) und dem Mutfaktor (bis × 1,5). Ersatz: Ächtung nach Verhalten (Frage 9).
- **Gesuche gegen menschliche Häfen** („Plündere X“): Mobbing- und Absprachewerkzeug in einer Runde mit 3–10 Menschen.
- **PvP-Schutzzonen:** mindestens 6 Prüfstellen in den Angriffspfaden (Überfall, Sammelangriff, Blockade, Minen,
  Felder, Weltereignis) und Widerspruch zu VORLAGE-PVP. Erlaubt ist nur Schutz gegen das Kartell.
- **Kartellkrieg als Verschärfung:** die Kartell-Last liegt heute bei 23–38 % der Tagesproduktion (M-01).
- **Ruf-Wirkung auf Börse und Spielerhandel:** 1 Prozentpunkt Gebühr = 42–79 Wert je Tag = 0,25 % der
  Tagesproduktion – unspürbar, aber eine dritte Preisebene und eine Störung der Handelsbilanz-Messung.
- **KI als Allianzmitglied:** verzerrt Allianzwertung (ST-05) und Seerat. Bündnis = vorhandener Nichtangriffspakt.

Korrekturen aus der Gegenprüfung im Code, die mehrere Bewertungen betreffen:
- „Schwächer“ heißt für den Ruf **genau `isWeakTarget()`** (`resolution.ts`: Gebäudestufen des Ziels unter
  `loot.weakTargetBelowShare` 0,5 der eigenen) – nicht „unter 50 % der Punkte“ und nicht „Mutfaktor < 0,8“.
- `worldEvents.maxConcurrent` **gibt es auf main nicht**; der Deckel ist Teil des Hotfixes ST-01, kein Bestand.
- Bots greifen Menschen standardmäßig nicht an (`DEFAULT_SETTINGS.attackHumans = false`, `bots-core.ts:97`).
- `bots.profiles.festung/freibeuter.trade = false`; Festung verkauft in `contracts.ki` nichts, der Freibeuter
  kauft nichts. Der Händler hat heute Vertragsbonus 0 (Festung/Freibeuter 0,02).
- Ein Paktbruch „binnen 24 h nach Kündigung“ ist unmöglich: In der Kündigungsfrist (24 h) werden Überfall und
  Kriegserklärung abgelehnt (REGELN-SOZIAL.md:36–39).
- `weather.systemEveryHours` darf mitten in der Saison **nicht** geändert werden: `weather.ts` erzeugt Systeme je
  `slot = floor(h / systemEveryHours)`; ein Wechsel würfelt alle laufenden Tiefs neu, Karte und Prognose springen.
- Eine Gezeit ist technisch **nicht** „nur ein paar Balance-Werte“: `registerModifierSource` deckt nur Produktion,
  Tempo, Kampfwerte ab. Gebühr, Tageslimit, Kartellchance, Überfallintervall, Feldertrag und Wetter werden direkt aus
  der globalen Balance gelesen (`market.fee` an 11 Stellen, Wetter an 33), und der Client rechnet Probekampf, Geleit
  und Wetterkarte lokal aus `meta` mit `staleTime: Infinity`. Deshalb Stufe 1 (Abschnitt 3.0).

## 3. Regeln

### 3.0 Fundament: wirksame Balance (ohne Spielwirkung)
- Reine Funktion **`balanceAt(base, plan, ms, ort?)`** in game-core; der Saisonplan wird in `meta` ausgeliefert.
  Server, Worker, Bot-Zug, Simulator (`sim/v124.ts`, `season.ts`), Probekampf, `recommendEscort`, Missionsplanung,
  Lohnende Ziele und Wetterkarte rechnen damit nach Zeit. Test: Probekampf im Client = Kampf auf dem Server während
  einer Gezeit.
- **Ein Wirkungs-Platz:** Gezeit und Seerat-Beschluss belegen dasselbe Zeitfenster (3.4); es gilt nie beides zugleich.
  Zusätzlich Klemme je Regler auf 0,5 × … 1,75 × Grundwert. Kurswirkungen bleiben im Deckel `market.news.maxTotal` 0,25.
- **Zeitregel:** Es zählt der Stand **beim Planen bzw. Abschluss** (wie beim Pakt). Die Planung zeigt Grenzen an:
  „Gebühr 6 % gilt bis Mi 14:00 – danach 4 %“.
- **Not-Aus** je Baustein über `server_setting` (wie `bots_enabled`): Gezeit verschieben/absagen, Gesuche pausieren,
  Seerat aussetzen – ohne Auslieferung auf den Pi.
- **Saisonwechsel:** Plan, Ansehen, Ruf, Gesuche und Beschlüsse hängen an `season_id` und beginnen bei 0; offene
  Treuhand geht an den KI-Spieler zurück.

### 3.1 Gezeit (Baustein „Weltlage“)
- **Plan statt Planer:** `weltlagePlan(seasonStartMs, seasonEndMs, seed, balance)` legt beim Saisonstart **3 Fenster zu
  je 72 h** fest: Beginn Tag **10 / 19 / 28, Streuung ± 0,5 Tag**. Der Saisonstart legt 6 `game_event`-Zeilen an
  (`weltlage_start` / `weltlage_end`); niemand plant nach. Damit ist die Fehlerklasse aus ST-01 ausgeschlossen.
- Frühester Beginn Tag 9,5 (nach `beginnerDays` 7), Abstand Ende → Beginn ≥ 5 Tage, letztes Ende spätestens Tag 31,5.
- **Nie zwei zugleich, nie zweimal dieselbe Art, Kartellfehde nie als erste.** Eine Gezeit erzeugt selbst **keine
  Ereignisse**. Während einer Gezeit läuft höchstens **1 Weltereignis** (der neue Deckel `maxConcurrent` minus 1) und
  keines, das dieselbe Ressource bewegt (keine Großflotte mit Treibstoff + 12 % im Treibstoff-Boom).
- **Ankündigung** 24 h vorher als Lage-Zeile; **ein** Push zum Beginn unter der vorhandenen Art „Marktnachricht“;
  keiner zum Ende (steht unter „Zuletzt passiert“). Je Gezeit **eine** `market_news`-Zeile mit festem Schlüssel
  `weltlage:<id>` (upsert, Quelle „gezeit“).

| Art | Was sich 72 h ändert (nur vorhandene Regler) | Ein Satz für den Spieler |
|---|---|---|
| **Handelskrise** | `market.fee` 0,04 → 0,06 · Tageslimit 0,20 → 0,15 · KI-Vertragsbonus aller Profile + 2 Pp | „Börse teurer – Lieferverträge mit den KI-Spielern lohnen jetzt mehr.“ |
| **Rohstoffboom** | ein Gut per Los aus Treibstoff, Proviant, Elektronik (**nie Stahl**): Produktion und Feldertrag + 20 %, Kurs − 10 % | „Treibstoff im Überfluss – jetzt fördern, Felder besetzen, später verkaufen.“ |
| **Kartellfehde** | `pirates.raidIntervalHours` × 2 (18 → 36) · `fields.cartelRaidChance` 0,05 → 0,025 · Nestbeute × 1,0 · Großflotte-Gewicht 1 → 3 | „Das Kartell bekämpft sich selbst – weniger Überfälle, Zeit zum Aufholen.“ |
| **Sturmzeit** (Frage 2) | `weather.stormFrom` 0,8 → 0,7 und ein Stärkefaktor im Fenster · Kartellchance für Konvois × 0,5 · Schatzschiff-Gewicht × 2 | „Schwere See – Vorhersage lesen; das Kartell bleibt im Hafen.“ |

Nicht enthalten: Nestbesatzung 70 % (erst nach der Wertungskorrektur ST-04, sonst mehr Nest-Punkte), pauschale
Fahrzeit-Aufschläge (doppeln das Wetter), höhere Kartellstärke.

### 3.2 Gesuche und Ansehen (Baustein „KI-Fraktionen“)
Eine **Fraktion ist eine Spielweise** (Händler, Festung, Freibeuter), kein fester Name: `BOT_NAMES` vergibt Namen aus
Listen, und `bots_max` erlaubt mehrere KI-Spieler je Spielweise. Ansehen wird **je KI-Spieler** gespeichert, Angebote
werden **je Spielweise** gedeckelt, Texte setzen „{Name} (Händler)“ ein.

**Ansehen je KI-Spieler** (Stufe 3; ersetzt das Ja/Nein von `kiRefuses`): Skala − 100 … + 100, Start 0, Formel und
Zerfall wie 3.3. Liefervertrag mit diesem KI-Spieler erfüllt + 2 (höchstens + 4 je Tag), Gesuch erfüllt + 5,
Vertragsstrafe − 10, Überfall auf ihn − 30 und `attackBlockHours` 24 → 72. Drei Stufen: ≤ − 30 „Misstraut“ · dazwischen
„Bekannt“ · ≥ + 30 „Vertraut“.

| Wirkung bei diesem KI-Spieler | Misstraut | Bekannt | Vertraut |
|---|---|---|---|
| Vertragsbonus (heute 0 / 0,02 / 0,02) | − 2 Pp | ± 0 | + 2 Pp |
| Kontingent `quotaShare` (heute 0,25) | 0,15 | 0,25 | 0,35 |
| Gesuche | keine (Freibeuter: weiter) | ja | ja, auch Geleit und Feld |
| Nichtangriffspakt | – | – | KI bietet ihn an (vorhandene Diplomatie) |

**Gesuch** = Vorlage über einen vorhandenen Befehl mit Absender, Ziel, Frist 24 h und Lohn:

| Spielweise | Gesuch | Erfolg (Prüfung nur per Ereignis zur Frist) | ab |
|---|---|---|---|
| Händler, Festung | „Liefere {Menge} {Gut} bis {Zeit}“ – normaler KI-Liefervertrag | Vertrag erfüllt | Stufe 3 |
| Händler | „Geleite meinen Konvoi nach {Hafen}“ – echter KI-Vertragskonvoi ≥ 300 km, Geleit über den Kasten Geleitschutz | Ankunft ohne Verlust; Geleit ≥ 90 % der empfohlenen Mischung | Stufe 4 |
| Festung | „Halte Feld {Name} 24 h“ – Feldbesatzung ≥ 6 KP im Umkreis 600 km | Feld zum Fristende gehalten und ≥ 20 von 24 Stichproben im `field_tick` | Stufe 4 |
| Freibeuter | „Hebe Nest Stufe k aus“ (k = min(5, 1 + ⌊KZ/3⌋)) oder „Greife {Weltereignis} an“ | Sieg bzw. ≥ 5 % Schadensanteil | Stufe 4 |

- **Je Spieler höchstens 1 Gesuch je Tag, für ihn 24 h reserviert.** Es **belegt einen der 3 Tagesbefehl-Plätze**; die
  Zahl der Tagesaufgaben bleibt gleich. Kein Wettlauf, außer bei Weltereignissen, wo der Kampf ohnehin offen ist.
- **Lohn: 3 h Produktion des Spielers** (Tag 14 ≈ 2 640, Tag 28 ≈ 3 950), als **Waren-Treuhand aus dem Lager des
  KI-Spielers** (beim Anbieten abgezogen wie im Spielerhandel) – keine Taler, solange Händler und Festung 0 Taler haben
  (AN-05). Zusätzlich Ansehen + 5. Beute, Vertragserlös und Beuteanteile bleiben, wie sie sind.
- **Tagesbudget je KI-Spieler: 6 h seiner eigenen Produktion.** Ist es verbraucht oder das Lager unter Reserve, gibt
  es kein Angebot; die Karte sagt das („{Name} hat heute kein Gesuch – Lager leer“). Vergabe reihum: zuerst, wer am
  längsten keines hatte.
- Neulinge (Kommandantur < `marketFromLevel` oder Auftragsbuch offen): nur Liefer-Gesuche, Menge ≤ 50 % Tageslimit.
- Ab Tag 34 keine neuen Gesuche. Wer 3 Tage fehlt, verliert ein angenommenes Gesuch ohne Abzug.
- **Gezeit lenkt Angebote:** Handelskrise → Liefern/Geleit, Kartellfehde → Nest/Weltereignis, Rohstoffboom → Feld.
- Der Geleitvorschlag wird **einmal beim Anbieten** gerechnet und gespeichert (`recommendEscort`: 0,1–0,5 s auf dem Pi).

### 3.3 Ruf (global, Stufe 6)
- **Eine Zahl** − 100 … + 100, Start 0, je Saison. Tagesrechnung beim Lesen aus Tagessummen, kein Job:
  **R′ = R + G · (1 − R/100) − 0,05 · R** (G = positive Punkte des Tages; Abzüge wirken voll).
- **Drei Stufen, drei Wörter, eine Schwelle:** ≤ − 30 **Berüchtigt** · **Unbescholten** · ≥ + 30 **Angesehen**.
- Der Ruf **zählt nicht im Rang** und ändert **keine Preise** an Börse und Spielerhandel. Handbuchsatz: „Ruf öffnet
  Türen, er ändert keine Börsenpreise.“

| Plus (nur vorhandene Auswertungen) | Wert | Deckel |
|---|---|---|
| KI-Liefervertrag erfüllt | + 2 | + 4 je Tag |
| Gesuch erfüllt | + 5 | 1 je Tag |
| Weltereignis: Sieg oder ≥ 5 % Schadensanteil; Finale-Abschnitt | + 4 | je Ereignis |
| Gezahlte Gebühren (Börse, Spielerhandel, Verträge) | + 1 je 1 000 Taler | + 3 je Tag; Partner mit Absprache-Verbindung zählen nicht |
| Als Stationierter einen Kartell-Überfall im **fremden** Hafen abgewehrt | + 2 | je Paar nach `pairFactors` 1 / 0,5 / 0,25 / 0 in 7 Tagen |
| Konvoi oder Feld gegen Kartellgruppe ≥ 6 Boote gehalten | + 1 | + 4 je Woche |
| Kartell-Abwehr im eigenen Hafen | **0** | – |

| Minus | Wert |
|---|---|
| Überfall auf ein Schwachziel (`isWeakTarget`), ohne Krieg | − 8 |
| Vertragsstrafe fällig (`penaltyShare` 0,25 verfallen oder Kündigung) | − 10 |
| **Paktbruch:** Überfall auf den Ex-Partner oder Kriegserklärung an ihn ≤ 48 h **nach Erlöschen** des selbst gekündigten Pakts | − 15 (einmal) |
| Blockade oder Minen vor einem Spielerhafen, ohne Krieg | − 3 je Tag |
| Angriff auf Gleich- oder Stärkere, im erklärten Krieg, auf Kopfgeld-Ziele, auf Nester/Kartell | **0** |

- **Wirkung:** Der Ruf geht als Grundwert in das Ansehen bei jedem KI-Spieler ein (Ansehen = Ruf + eigener Anteil,
  dieser auf ± 20 begrenzt; ein Überfall auf einen KI-Spieler wirkt nur bei ihm). Berüchtigte: Händler und Festung
  schließen keine Verträge und geben keine Gesuche, Kopfgeld-Zuschlag + 0,1 für Angreifer (Frage 8), im Seerat
  ächtbar (Frage 9). Angesehene: Tabelle 3.2 Spalte „Vertraut“ bei allen KI-Spielern.
- **Schutz:** In den 7 Tagen Anfängerschutz kein Abzug außer Vertragsstrafe. KI-Spieler haben keinen Ruf.
- **Erklärbarkeit:** Vor dem Abschicken steht die Folge in Missionsplanung, Vertrags- und Paktkündigung
  („Schwachziel: Beute × 0,1, Ruf − 8“), im Bericht dieselbe Zeile. Verlauf der letzten 10 Buchungen mit Grund und
  Sprung zum Beleg; der Zerfall ist eine eigene Zeile. `reason` ist ein Textschlüssel, kein Freitext.

### 3.4 Seerat (Stufe 7)
- **Der Seerat beschließt, was im nächsten Gezeit-Fenster gilt** – kein zweiter Kalender, kein zweiter Katalog von
  Wirkzeiten. Sitzung 36 h bis 12 h vor jedem Fenster (also um Tag 9 / 18 / 27), **3 Sitzungen je Saison**, 24 h
  Abstimmung, Wirkung = das Fenster (72 h). Die Finale-Sperre gilt damit automatisch.
- **Drei Knöpfe je Sitzung:** die Gezeit aus dem Plan · ein Beschluss aus dem festen Katalog · **„Ruhige See“**
  (nichts ändert sich). Kein Freitext, keine Moderation.

| Beschluss (72 h) | Regler | Wert je Spieler |
|---|---|---|
| **Handelsfrieden** | `market.fee` 0,04 → 0,03, `player_trade_fee` 0,02 → 0,01 | ≈ 0,25 % der Tagesproduktion |
| **Geleitschutz** | Kartellchance für Konvois × 0,5 | 500 km / 10 000 Wert: 11 % → 5,5 %, Verlust ohne Geleit 330 → 165 |
| **Gemeinsame Aktion** | das nächste Weltereignis wird 12 h früher angekündigt; Beuteanteile der Teilnehmer + 20 % | über die vorhandene Beitragsregel |

- **Nur ab 5 aktiven Menschen** (in 72 h gesehen). Darunter gilt der Plan, und die Karte sagt: „Der Seerat tagt ab
  5 aktiven Kapitänen (jetzt 3).“
- **Stimmen:** 1 je aktivem Menschen; alle KI-Spieler **zusammen 1 Stimme**, nach Spielweise verteilt und offen
  begründet („{Name} (Händler) stimmt für den Handelsfrieden“). Menschen stimmen **geheim**; gezeigt werden Ergebnis
  und Stimmenzahl, keine Namen.
- **Quorum ⌈N/2⌉ Menschen**, sonst gilt der Plan. **Eine Allianz zählt höchstens 40 %** der abgegebenen Gewichte
  (Überschuss anteilig gekürzt). Die Option mit den meisten Gewichten gewinnt; bei Gleichstand „Ruhige See“.
- **Kein Beschluss hat einen Rang als Kriterium.** Ächtung nach Ruf: Frage 9.
- Abstimmen ist ein Befehl über `runCommand` mit Idempotenzschlüssel. 1 Push zur Öffnung nur an Nichtwähler, Ergebnis
  im Morgenbericht und als Systemnachricht.

## 4. Balance-Rechnung

**Gezeit** (`rechnung.txt`, Abschnitte 1–2)
- Plan mit 200 Seeds, Streuung ± 0,5 Tag: **0 Verstöße**, kleinster Abstand 5,05 Tage, spätestes Ende Tag 31,5
  (Grenze 33,5). Mit der in den Bewertungen genannten Streuung ± 1 Tag verletzen **54 von 200** Plänen den
  Mindestabstand von 5 Tagen (kleinster 4,09) – deshalb ± 0,5.
- Sonderregeln gelten 9 von 42 Tagen (21 %; 35 % des Fensters Tag 8–33,5). Vier bis sechs Gezeiten wären 43–94 %.
- Handelskrise: bei 25 % Börsenumsatz − 84 … − 158 Wert je Tag = **0,5 %** der Tagesproduktion.
- Rohstoffboom: ein Gut ≈ ¼ des Werts, + 20 % Menge, − 10 % Kurs → **+ 2,5 %** (418 … 789 je Tag), unter dem Deckel.
- Kartellfehde: halbiert die Kartell-Last. Heute 23–38 % → 11,5–19 %; das sprengt den 3-%-Deckel als *Entlastung*
  deutlich und ist ohne M-01 nicht kalibrierbar. Nach M-01 (≤ 10 %) sind es 5 Punkte je Tag, 15 % einer
  Tagesproduktion in 72 h. Die Fehde ist bewusst die großzügigste Gezeit (Aufholwoche) und die einzige Ausnahme vom Deckel.
- Sturmzeit: Konvoi 300 km / 5 000 Wert 7,0 % → 3,5 % Kartellchance.

**Gesuche** (Abschnitt 3)
- 3 h = 2 091 / 2 637 / 3 426 / 3 945 Wert (Tag 7/14/21/28) = 12,5 % der Tagesproduktion; 4 h wären 17 %, die
  vorgeschlagenen 6–12 h aus dem KI-Lager 25–50 % – bei einer Belohnungsquote von schon 73–76 % der Produktion in
  Woche 1–2 (AN-08) zu viel. Ein 3-h-Gesuch ist rund ein Fünftel eines Nest-5-Überfalls (19 208 netto, Tag 28).
- Weil das Gesuch einen Tagesbefehl-Platz belegt und aus dem KI-Lager bezahlt wird, entsteht **nichts aus dem Nichts**;
  es ist eine Senke für 85–113 h gehortete KI-Produktion.
- Tagesbudget 6 h je KI-Spieler ÷ 3 h Lohn = 2 Gesuche je KI-Spieler und Tag, **6 je Tag für die Runde**
  (Annahme: KI-Produktion ≈ Referenzspieler). 3–6 Menschen: jeder täglich eines. 10 Menschen: 4,2 je Mensch und
  Woche. „Je Spieler 1 am Tag“ ohne Budget hieße bei 10 Menschen 70 je Woche = rund die Hälfte der KI-Produktion.
- Zielkorridor: ≥ 1 angenommenes Gesuch je aktivem Menschen und Woche, Erfüllung 60–85 %, ≥ 60 % der Neulinge mit
  mindestens einem Gesuch in Woche 1–2.

**Ruf** (Abschnitt 4)
- Gleichgewicht G / (G/100 + 0,05): G = 1 / 2,1 / 3 / 6 / 10 je Tag → 17 / 30 / 38 / 55 / 67. Über 70 kommt
  praktisch niemand; „Angesehen“ (+ 30) braucht dauerhaft 2,1 Punkte am Tag, also etwa einen KI-Vertrag täglich.
  Eine Schwelle + 40 bräuchte 3,3, + 50 bräuchte 5 – nur für Vielspieler.
- Verlauf bei G = 3: Tag 7 / 14 / 28 = 17 / 26 / 34. Ohne Sättigung stünden Vielspieler an Tag 28 bei 91–100.
- „Berüchtigt“ (− 30) entspricht dauerhaft **1,3 Schwachziel-Überfällen je Woche**; einer je Woche ergibt − 23.
- Rückweg: von − 40 ohne Zutun nach 7 / 14 Tagen − 28 / − 20. Bei 10 % Zerfall wären es nach 7 Tagen − 19; eine
  Ächtung liefe ins Leere. Paktbruch − 15 ist nach 14 Tagen − 7.
- Farmkosten: + 1 kostet 1 000 Taler Gebühr (25 000 Umsatz), höchstens + 3 je Tag. Zehn Kleinkonvois statt eines
  (0,42 statt 0,08 Kartellkontakte) bringen nichts, weil nur Gruppen ≥ 6 Boote (Wert ≥ 7 500) zählen.
- Zielkorridor: ≤ 20 % der Aktiven Berüchtigt, 20–40 % Angesehen, keine Quelle über 40 % des positiven Rufs.

**Seerat** (Abschnitt 5)
- KI zusammen 1 Stimme = 25 % bei 3 Menschen, 17 % bei 5, 9 % bei 10 (je 0,5 wären 33 / 23 / 13 %).
- Allianzgröße max(2, ⌈N/3⌉): größte Allianz 33–36 % bei voller Beteiligung, aber **67–80 %, wenn nur das Quorum
  abstimmt** – deshalb der 40-%-Deckel zusätzlich zur kleineren Allianz. Mit Allianzgröße 8 und Ruf-Gewicht 2,0
  wären es 82 %.
- Wert einer Stimme ist klein (Handelsfrieden ≈ 79 Wert je Tag an Tag 28); Stimmenkauf lohnt nicht und ist bei
  geheimer Abstimmung nicht prüfbar.

## 5. Verzahnung mit bestehenden Systemen

| Bestehendes System | Anschluss |
|---|---|
| Marktnachrichten | Quelle „gezeit“, eine Zeile je Fenster per `upsertNews`/`closeNews`, im Deckel 0,25 |
| Weltereignisse | Gezeit verschiebt nur `kindWeights` und senkt `maxConcurrent`; Gesuche und „Gemeinsame Aktion“ führen hin |
| Lieferverträge (KI) | Liefer-Gesuch **ist** ein KI-Vertrag; Ansehen ersetzt `kiRefuses`; Bonus und Kontingent hängen am Ansehen |
| Konvois und Empfohlenes Geleit (0.38) | Geleit-Gesuch nutzt Kasten und Probekampf; beide lesen `balanceAt` |
| Rohstofffelder | Feld-Gesuch = Feldbesatzung; Rohstoffboom wirkt über `fieldYield` in `balanceAt` |
| Tagesbefehle, Auftragsbuch | Gesuch belegt einen Tagesbefehl-Platz; „Nimm ein Gesuch an“ wird Schritt im Auftragsbuch Teil 2 |
| Diplomatie | KI-Bündnis = Nichtangriffspakt; KI-Spieler brauchen dafür den Diplomatie-Befehl im Bot-Zug |
| PvP (Kopfgeld, Mutfaktor, Paarbremse) | Ruf nutzt `isWeakTarget`, `colluded()`, `pairFactors`; im Krieg kein Abzug – wie die Schwachziel-Kürzung |
| Aufholhilfe (`catchUp`) | keine Schutzzone nach Rang; höchstens eine Ausgleichswirkung je Spieler |
| Wetter | Sturmzeit nur über `stormFrom` und Stärke; Prognose bleibt gültig |
| Saisonfinale | eine Ungleichung für Plan, Beschlüsse und Gesuche; Handbuch: „In der Finalwoche keine Gezeit, kein Seerat“ |

## 6. Missbrauchsschutz

- **Freunde schieben Ruf:** Handel zählt nur über gezahlte Gebühren (nicht Anzahl, vgl. M-07) und nicht bei
  Absprache-Verbindung (`pvp.collusionDays` 7); Stationierungshilfe läuft über die Paarbremse.
- **Gratisruf:** Kartell-Abwehr daheim 0 (0,83 Überfälle je Tag bei rund 100 % Sieg, M-01).
- **Gesuch und Überfall abgesprochen:** kein Lohn, wenn ein Spieler mit Absprache-Verbindung den Konvoi überfällt;
  Lohn nur bei Ankunft; der Bericht nennt den Grund.
- **Ein U-Boot erfüllt alles:** Geleit- und Feld-Gesuche erst nach TST-01 (`escortCapable` ohne `!submerged`).
- **Pranger:** fremder Ruf erscheint nur als Zeichen für die beiden äußeren Stufen; Abstimmungen ohne Namen; kein
  Ziel mit Namen in einem Gesuch.
- **Blockherrschaft:** Allianzgröße nach Rundengröße (ST-05; sofort über `alliance_max_size` setzbar) plus
  40-%-Deckel; die KI entscheidet nie allein (Quorum zählt nur Menschen).
- **Doppelbuchung und Sperren:** `reputation_log` mit `unique(player_id, reason, ref_kind, ref_id)`, Ruf-Zeilen beim
  Saisonbeitritt angelegt, Log ohne Fremdschlüssel auf `player` oder erst nach TE-01.
- **Stiller Deckelbruch:** Assertions im Saisonlauf (≤ 3 % je Wirkung außer Kartellfehde, ≤ 4 h je Gesuch,
  ≤ 1 Gezeit zugleich, ≤ 3 je Saison, nichts nach `announceMs − 48 h`, ≤ 2 Weltereignisse zugleich).

## 7. Oberfläche

- **Ein Streifen** (44 px) oben im Lage-Reiter und auf der Basis **an der Stelle des `WorldEventBanner`**
  (`Base.tsx:97`, keine Mehrhöhe): „Gezeit: Handelskrise · noch 2 T 14 h · Gebühr 6 %“. Feste Rangfolge in diesem
  einen Platz: Angriff > Blockade > Finale > Weltereignis > Gezeit/Beschluss; Weiteres als „+ 1“. Farbe nie allein
  (Messing + Symbol + Wort).
- Antippen öffnet ein **Blatt „Gezeit & Seerat“**: Saisonkalender (nächstes Fenster, Sitzung, Finale-Ankündigung),
  eigener Ruf mit Verlauf, Abstimmung mit drei Knöpfen.
- **Wirkung am Entscheidungsort** als Aufschlüsselungs-Zeile: Order-Ticket, Missionsplanung, Felder-Liste,
  Geleit-Kasten, Vertragskarte („Ansehen Vertraut: + 2 %“).
- **Gesuche:** Angebot und Ansehen-Leiste auf einer Karte je KI-Spieler in Börse → Verträge (`ContractsKi.tsx`);
  das angenommene Gesuch steht im Siegel Tagesbefehle und in Lage → „Unterwegs“ mit Fortschritt. Kein eigener
  Bildschirm, kein Push.
- **Neulinge** sehen bis `marketFromLevel` nur die Gezeit-Zeile.
- **Begriffe (höchstens 5 neue):** Gezeit, Gesuch, Ruf/Ansehen, Seerat, Beschluss – ins Glossar, bevor Code entsteht.
  „Kartellfehde“ statt „Kartellkrieg“ (kollidiert mit Krieg und der Nachrichtenquelle „kriegslage“), „Sturmzeit“
  statt „Sturmsaison“. Nicht eingeführt: Kaperbrief, Schutzbrief, Vertrauter, Seegebiet.
- **Handbuch:** ein Kapitel „Weltpolitik“, höchstens 600 Wörter, Zahlen live aus der Balance; Block „Diese Saison neu“.
- **Verwaltung:** Karte mit Plan, Not-Aus und Zählern (Blatt geöffnet, Gesuche angeboten/angenommen/erfüllt,
  Ruf-Verteilung, Beteiligung).

## 8. Aufwand: **XL insgesamt, in Stufen M / M / M / L / M / M**

Die Last auf dem Pi ist vernachlässigbar: je Saison rund 2 000 Ruf-Buchungen, etwa 130–250 Gesuche, 3 Gezeiten mit
6 Ereignissen, unter 40 Stimmen – weniger als ein Tag `field_tick`. Teuer sind Regelbreite und Tests.

- **Stufe 1 (M):** `balanceAt`, Plan in `meta`, Umstellung der direkten Balance-Zugriffe, Not-Aus, Test Client = Server.
- **Stufe 2 (M):** `weltlagePlan`, Tabelle `world_situation`, 2 Ereignistypen, Marktnachricht, Streifen, Aufschlüsselung.
- **Stufe 3 (M):** Tabelle `faction_task`, Ansehen, Liefer-Gesuch, Treuhand, Karte je KI-Spieler, Tagesbefehl-Platz.
- **Stufe 4 (L):** drei weitere Gesuch-Arten mit Randfällen (Feld verloren und zurückerobert, Konvoi umgeleitet,
  Saisonende), Pakt-Befehl für KI-Spieler.
- **Stufe 6 (M):** `reputation`, `reputation_log`, `reputation_day`, Einhängen an Bericht, Vertragslauf, Diplomatie,
  Blockade; Verlauf und Vorab-Hinweise.
- **Stufe 7 (M):** `council_motion`, `council_vote`, Auswertung `tallyMotion`, Blatt.
- Neue Befehle in eigene Dateien (`politik-*.ts`): `commands.ts` hat 493, `handlers.ts` 487 Zeilen (T-16).

## 9. Reihenfolge und Voraussetzungen

**Stufe 0 – Voraussetzungen aus der Abschlussprüfung 0.38** (nichts aus dieser Vorlage gehört in Hotfix oder Welle 1):

| Kennung | Was | Blockiert |
|---|---|---|
| ST-01 / AN-01 | Weltereignis-Planer an den letzten Spawn, `maxConcurrent` neu, Saisonlauf mit Worker-Schritten im Repo | alles |
| AN-02 / AN-11 | `market_news` ohne tote Zeilen, Aufräumen, Index | Gezeit, Seerat |
| TST-01 | U-Boot-Lücke (Konvoi, Feld, KI-Geleit) | Geleit- und Feld-Gesuche, Ruf aus Kartell-Abwehr |
| M-01 / ST-02 | Kartell-Last ≤ 10 % der Tagesproduktion | Kartellfehde |
| ST-04 / M-03 | Wertung Nester und Beute | Nest-Gesuche, Lohn-Vergleich |
| AN-05, ST-03 / 06 / 17 | KI handelt nach Stunden Produktion (auch Festung/Freibeuter), Heimwache, greift Weltereignisse an | Gesuche, KI-Stimmen |
| ST-05 | Allianzgröße max(2, ⌈N/3⌉) – sofort per `alliance_max_size` | Seerat |
| TE-01, T-08, T-05 | `FOR NO KEY UPDATE`, Wiederholung bei 40P01, Worker-Schleifen trennen | Ruf, Gesuche, Stimmen |
| T-02, T-07 | steuerbare Zufallsquelle, eine Spielzeitzone | Plan-Test, Sitzungszeiten |
| TST-09, TST-15, UI-02 / 03 | „Alle abholen“, „Wartet auf dich“ als Sammelort, eine Zahl je Reiter | Gesuche |
| TX-07, T-04, T-09, T-10 | Auftragsbuch Teil 2, Lagezentrum/Lagebild, Glossar und Suche, PvP-Kapitel | Texte aller Bausteine |
| AN-03 | Nutzungszähler und Verwaltungskarten | Tore vor Stufe 6 und 7 |

Danach: **Live-Saison mit 0.39 ohne Weltpolitik** (Empfehlung der Abschlussprüfung), dann

1. **Fundament** (3.0) – ohne Spielwirkung auslieferbar.
2. **Gezeit** mit drei Arten (Handelskrise, Rohstoffboom, Kartellfehde).
3. **Ansehen je KI-Spieler + Liefer-Gesuch.**
4. **Weitere Gesuche** (Geleit, Feld, Nest, Weltereignis) und Pakt mit KI-Spielern.
5. **Live-Saison messen.** Tor für Stufe 6: Korridore aus Abschnitt 4 erreicht, KI-Handel ≥ 1 Geschäft je KI-Spieler
   und Tag. Tor für Stufe 7: an ≥ 4 Tagen je Woche ≥ 5 Menschen aktiv – sonst entfällt der Seerat.
6. **Globaler Ruf.**
7. **Seerat.**

Strittig war, ob Ruf oder Gezeit zuerst kommt (3 gegen 4 Rollen). Entschieden für die Gezeit: Sie hängt an keiner
KI-Reparatur, ist ein fester, testbarer Plan, und ein globaler Ruf ohne Gesuche und Seerat hätte keinen Abnehmer.

## 10. Offene Entscheidungen

1. **Name des Bausteins „Weltlage“?** (a) „Gezeit“ – im Spiel unbenutzt, passt zu TIDEFRONT; (b) „Weltlage“ –
   kollidiert mit Lage, Lagebild, Lagezentrum; (c) „Seelage“. **Empfehlung: (a)**, intern bleibt die Kennung `weltlage`.
2. **Sturmzeit in der ersten Fassung?** (a) ja, nur über Sturmschwelle und Stärke; (b) erst nach einer gemessenen
   Saison – dann laufen je Saison genau die drei anderen Arten, nur die Reihenfolge wechselt; (c) gar nicht, das
   Wetter deckt es ab. **Empfehlung: (b).**
3. **Wie werden Gesuche vergeben?** (a) je Spieler reserviert, höchstens 1 am Tag; (b) wenige offene Gesuche für die
   ganze Runde, „wer zuerst erfüllt“ (rund 9 je Woche); (c) gemischt. **Empfehlung: (a)** – bei (b) sehen Neulinge
   und Spieler außerhalb der Hauptzeit nie eines.
4. **Wo steht das Gesuch?** (a) es belegt einen der 3 Tagesbefehl-Plätze; (b) zusätzlicher vierter Platz;
   (c) nur in Börse → Verträge. **Empfehlung: (a)**, keine weitere Stelle für „Was steht an?“.
5. **Lohn eines Gesuchs?** (a) 3 h Produktion des Spielers als Waren aus dem KI-Lager; (b) 4 h; (c) 6–12 h der
   KI-Produktion (leert das Hortlager schneller, 25–50 % einer Tagesproduktion). **Empfehlung: (a).**
6. **Ruf sofort global oder zuerst nur Ansehen je KI-Spieler?** (a) zuerst Ansehen (Stufe 3), globaler Ruf nach
   Messung; (b) beides zusammen; (c) nur Ansehen, nie global. **Empfehlung: (a)** – vermeidet den Streit um eine
   zusätzliche PvP-Strafe, solange PvP kaum lohnt (ST-16).
7. **Soll der Ruf auf Preise wirken (wie gewünscht)?** (a) nur auf KI-Verträge (Bonus ± 2 Pp, Kontingent 0,15 / 0,25 /
   0,35); (b) zusätzlich Börsengebühr 3 % / 4 % / 6 %; (c) gar nicht. **Empfehlung: (a)** – (b) bewegt 0,25 % der
   Tagesproduktion und verfälscht die Handelsbilanz.
8. **Was passiert mit Berüchtigten?** (a) nur Zugang (keine Verträge und Gesuche bei Händler und Festung);
   (b) zusätzlich Kopfgeld + 0,1 für jeden, der sie angreift; (c) zusätzlich greift der Freibeuter sie an (heute per
   Voreinstellung aus). **Empfehlung: (b).**
9. **Embargo gegen Platz 1?** (a) nicht bauen; stattdessen Seerat-Beschluss „Ächtung“ nur gegen Berüchtigte (72 h
   keine KI-Verträge und Gesuche, Kopfgeld wie Rang 3 = + 0,2), erst mit Stufe 6; (b) „Kopfgeld auf Platz 1“
   0,5 → 0,75 für 72 h, nur wenn Platz 1 mindestens das 1,5-Fache von Platz 2 hat; (c) Embargo wie gewünscht
   (Börsengebühr + 2 Pp für Platz 1, 72 h). **Empfehlung: (a).**
10. **Umfang des Seerats?** (a) er wählt, was im nächsten Gezeit-Fenster gilt (3 Sitzungen, 3 Knöpfe);
    (b) zusätzlich wöchentliche Sitzungen an Tag 7 / 14 / 21 / 28 mit eigenem Katalog und eigener Wirkzeit;
    (c) kein Seerat. **Empfehlung: (a)**; (b) erst, wenn die Beteiligung in (a) über 50 % liegt.
11. **Ab welcher Rundengröße tagt der Seerat?** (a) ab 5 aktiven Menschen; (b) ab 3, mit KI-Stimmen; (c) immer.
    **Empfehlung: (a)** – bei 3 Menschen ist jede Abstimmung 2 gegen 1, und die KI hätte 25 %.
12. **Stimmgewicht nach Ruf?** (a) 1 je Mensch, KI zusammen 1; (b) Angesehen 1,5, Berüchtigt 0,5;
    (c) Angesehen 2, Berüchtigt 0. **Empfehlung: (a)** für die erste Fassung, (b) nach einer gemessenen Saison.
13. **Schutzzonen?** (a) nicht als Zone, sondern „Geleitschutz“ für alle (Konvoi-Kartellchance × 0,5);
    (b) Kartell-Schutzzone im Umkreis 400 km um einen gewählten Hafen (2 Prüfstellen); (c) Zone ohne
    Spieler-Überfälle (mindestens 6 Prüfstellen, gegen VORLAGE-PVP). **Empfehlung: (a)**, (b) als Ausbau.
14. **Bündnis mit KI-Spielern?** (a) nur Nichtangriffspakt ab „Vertraut“; (b) zusätzlich stationiert die Festung
    20 % ihrer Heimwache für 48 h (Ausnahme von `station_not_ally`); (c) kein Bündnis. **Empfehlung: (a).**
15. **Paktbruch – Frist und Höhe?** (a) ≤ 48 h nach Erlöschen des selbst gekündigten Pakts, − 15; (b) ≤ 24 h, − 10;
    (c) keine Regel, die Kündigungsfrist genügt. **Empfehlung: (a).**
16. **Wann beginnen?** (a) nach Hotfix, Welle 1, Balance v1.35 und einer Live-Saison ohne Weltpolitik;
    (b) Fundament und Gezeit schon mit Welle 1; (c) alles in einem Zug. **Empfehlung: (a)** – das Fundament (Stufe 1)
    kann ohne Spielwirkung früher mitlaufen.

## Entscheidungen des Nutzers (27.11.2026)

1. Name: „Gezeit“ (intern weltlage).
2. Sturmzeit: erst nach einer gemessenen Saison; bis dahin Handelskrise, Rohstoffboom, Kartellfehde.
3. Gesuche: je Spieler reserviert, höchstens 1 am Tag, Budget 6 h je KI-Spieler.
4. Gesuch belegt einen der 3 Tagesbefehl-Plätze.
5. Lohn: 3 h Produktion des Spielers als Waren aus dem KI-Lager.
6. Ruf: zuerst Ansehen je KI-Spieler, global nach einer gemessenen Saison.
7. Ruf wirkt nur auf KI-Verträge (Bonus ±2 Pp, Kontingent 0,15/0,25/0,35).
8. Berüchtigte: kein Zugang zu Verträgen/Gesuchen bei Händler und Festung + Kopfgeld +0,1.
9. Kein Embargo; „Ächtung“ gegen Berüchtigte (kommt mit globalem Ruf).
10. Seerat: wählt das nächste Gezeit-Fenster UND zusätzlich wöchentliche Sitzungen (Tag 7/14/21/28) mit eigenem Katalog und eigener Wirkzeit (abweichend von der Empfehlung).
11. Seerat tagt IMMER, unabhängig von der Rundengröße (abweichend von der Empfehlung; KI zusammen 1 Stimme, Allianz höchstens 40 %).
12. Stimmgewicht: 1 je Mensch, KI zusammen 1.
13. Schutzzonen: „Geleitschutz“ für alle (Konvoi-Kartellchance ×0,5); Zone später.
14. KI-Bündnis: nur Nichtangriffspakt ab Ansehen „Vertraut“.
15. Paktbruch: ≤ 48 h nach Erlöschen des selbst gekündigten Pakts, Ruf −15.
16. Start: SOFORT (das Spiel ist gerade gestartet) – nicht erst nach einer Live-Saison.

**Nachtrag 28.11.2026:** Auf Wunsch des Nutzers sind die zunächst „nach einer gemessenen Saison“ verschobenen Punkte
jetzt umgesetzt (abweichend von 2 und 6): Sturmzeit als vierte Gezeit-Art, globaler Ruf zusätzlich zum Ansehen,
Ächtung gegen Berüchtigte im Seerat (zu 9). Stimmgewicht bleibt 1 je Mensch (12). Regeln: `docs/REGELN-WELTPOLITIK.md`
Abschnitte 2, 3a, 5; Begründungen: `packages/game-core/ENTSCHEIDUNGEN-8.md`.
