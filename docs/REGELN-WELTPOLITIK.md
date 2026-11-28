# Weltpolitik: Gezeit, Ansehen, Gesuche, Seerat

Teil der Regeln (`docs/REGELN.md`). Grundlage: `docs/VORLAGE-WELTPOLITIK.md` mit den Entscheidungen des Nutzers vom
27.11.2026 (sie gehen vor). Werte im Balance-Block `politik`; Begründungen in `packages/game-core/ENTSCHEIDUNGEN-6.md`,
Abschnitt „Weltpolitik“. Code: `packages/game-core/src/politik-*.ts` (rein), `packages/engine/src/politik-*.ts`
(Server), Router `politik` (`apps/api/src/routers/politik.ts`), Wartung im Worker.

Grundsatz: **kein neuer Reiter, keine neue Ressource, keine neue Push-Art** (Ausnahme seit UX-0.43 B8: Push
„Seerat-Ergebnis“ beim Schluss einer Sitzung, eigener Schalter). Jede Wirkung verschiebt einen vorhandenen
Regler befristet; jede Handlung ist ein vorhandener Befehl (Liefervertrag, Pakt, Abstimmung als Befehl mit
Idempotenzschlüssel). Alles hängt an der Saison (`season_id`) und beginnt mit jeder Saison neu.

## 1. Fundament: wirksame Balance

- `balanceAt(base, plan, ms)` (game-core) liefert die zu einem Zeitpunkt wirksame Balance: ohne wirkendes Fenster
  dieselbe Grundbalance (gleiche Referenz), sonst eine zwischengespeicherte Kopie mit verschobenen Reglern und der
  Aufschlüsselung `politikNow`. Rein und deterministisch.
- **Plan in `meta`:** `meta.balance` ist die wirksame Balance *jetzt*, `meta.baseBalance` die Grundbalance,
  `meta.politik.plan` alle Fenster der Saison, `meta.politik.validUntilMs` der nächste Wechsel. Der Client lädt `meta`
  zu diesem Zeitpunkt neu; Probekampf, Geleitvorschlag, Gebühren und Tageslimit im Client rechnen damit wie der Server.
  Für andere Zeitpunkte (z. B. Ankunft) rechnet der Client `balanceAt(baseBalance, plan, t)`.
- **Server:** `balanceNow(db, ms)` liest die wirkenden Fenster (eine kleine Abfrage) und gilt in Börse (Gebühr,
  Tageslimit, Vorschau, Ansicht), Lieferverträgen (Gebühr, Tageslimit, KI-Bonus), Spielerhandel (Gebühr), Kartell-Überfall
  (Intervall), Feldern (Ertrag, Kartellchance), Konvois (Kartellchance, Stand bei der Abfahrt) und Weltereignissen (Art,
  Beute). Produktion des Rohstoffbooms als Modifikator-Quelle „Gezeit“.
- **Zeitregel:** Es zählt der Stand beim Abschluss bzw. bei der Abfahrt (wie beim Pakt).
- **Klemme** je Regler auf 0,5 × … 1,75 × Grundwert (Überfallintervall bis 2 ×, KI-Bonus ± 4 Punkte); gestapelte
  Wirkungen multiplizieren.
- **Finale bleibt frei:** jede Wirkung endet spätestens 48 h vor der Finale-Ankündigung (bei 42 Tagen: Tag 33,5).
- **Not-Aus** je Baustein über `server_setting` (`politik_gezeit_aus`, `politik_seerat_aus`, `politik_gesuche_aus`,
  Wert `1`), dazu „Fenster absagen“ (Ruhige See, Quelle `admin`, der Seerat überschreibt es nicht) – in der Verwaltung,
  ohne Auslieferung.

## 2. Gezeit

- Beim Saisonstart einmal ausgewürfelt (Wartungslauf, idempotent): **3 Fenster zu je 72 h**, Beginn Tag **10 / 19 / 28
  ± 0,5 Tag**, frühestens Tag 9,5, Abstand Ende → Beginn ≥ 5 Tage, Ende spätestens Tag 31,5. Bei anderer Saisonlänge
  proportional. Fenster, die eine Regel verletzen würden, entfallen.
- Arten: **Handelskrise, Rohstoffboom, Kartellfehde** – je Saison jede genau einmal, Reihenfolge per Los, Kartellfehde
  nie zuerst. Sturmzeit erst nach einer gemessenen Saison.

| Art | Was sich 72 h ändert | Satz für den Spieler |
|---|---|---|
| Handelskrise | Börsengebühr × 1,5 (4 % → 6 %), Tageslimit × 0,75 (20 % → 15 %), Vertragsbonus aller KI-Spieler + 2 Punkte | „Börse teurer – Lieferverträge mit den KI-Spielern lohnen jetzt mehr.“ |
| Rohstoffboom | ein Gut per Los (Treibstoff, Proviant, Elektronik, nie Stahl): Produktion und Feldertrag + 20 %, Kurs − 10 % (Marktnachricht `weltlage:<id>`) | „Ein Gut im Überfluss – jetzt fördern, Felder besetzen, später verkaufen.“ |
| Kartellfehde | Kartell-Überfälle alle 36 statt 18 h, Kartellangriffe auf Felder × 0,5, Großflotte-Gewicht × 3 | „Das Kartell bekämpft sich selbst – weniger Überfälle, Zeit zum Aufholen.“ |

- Während eines Gezeit-Fensters entsteht höchstens `worldEvents.maxConcurrent − 1` gewöhnliches Weltereignis zugleich.
- **Ankündigung** 24 h vorher als Lage-Zeile („… beginnt“), während des Fensters „… endet“ mit Ende; **ein** Push zum
  Beginn (Art Marktnachricht) an aktive Menschen, keiner zum Ende.

## 3. Ansehen je KI-Spieler

- Je Mensch und KI-Spieler eine Zahl − 100 … + 100, Start 0, je Saison. Gerechnet beim Lesen aus den Zeilen der Saison
  (kein Zähler, kein Job): **R′ = R + G · (1 − R/100) − 0,05 · R** je Tag (G = Pluspunkte; Abzüge wirken voll; der
  Zerfall an der Tagesgrenze wirkt auf den Stand vom Beginn des abgelaufenen Tages).

| Buchung | Wert |
|---|---|
| Liefervertrag mit diesem KI-Spieler erfüllt | + 2 (höchstens + 4 je Tag) |
| Gesuch dieses KI-Spielers erfüllt | + 5 |
| Vertragsstrafe (nicht oder nur teilweise erfüllt, gekündigt) | − 10 |
| Überfall auf diesen KI-Spieler | − 30, dazu 72 h keine Abschlüsse bei Händler und Festung |
| Paktbruch: Überfall ≤ 48 h nach Erlöschen eines selbst gekündigten Pakts mit ihm | einmal zusätzlich − 15 |

| Wirkung | Misstraut (≤ − 30) | Bekannt | Vertraut (≥ + 30) |
|---|---|---|---|
| Vertragsbonus | − 2 Punkte | ± 0 | + 2 Punkte |
| Kontingent-Anteil (`quotaShare`) | 0,15 | 0,25 | 0,35 |
| Gesuche | keine | ja | ja |
| Nichtangriffspakt | – | – | der KI-Spieler nimmt ihn an |

- Das Ansehen wirkt **nur auf KI-Verträge, Gesuche und den Pakt**, nicht auf Börse, Spielerhandel oder Rang.
- **Freibeuter** lehnt nie ab (Bonus und Kontingent folgen trotzdem dem Ansehen).
- **Berüchtigt** (vorläufiger Ersatz für den globalen Ruf): Mittel des Ansehens über alle aktiven KI-Spieler ≤ − 30.
  Händler und Festung schließen dann nichts ab und geben keine Gesuche; wer einen Berüchtigten angreift, bekommt
  Kopfgeld-Zuschlag + 0,1 (nicht bei Absprache). „Ächtung“ im Seerat ist vorbereitet und aus (`seerat.aechtung`).
- **Pakt mit einem KI-Spieler:** Ist ein Mensch ohne Allianz bei ihm „Vertraut“, **bietet der KI-Spieler den Pakt von
  sich aus an** (Wartungslauf): Systemnachricht, Lage-Eintrag „… bietet dir einen Nichtangriffspakt an“, Annehmen mit
  einem Tippen oder Ablehnen auf der Lage (Weltpolitik) bzw. unter Meldungen → Saison → Welt (auch unter Meldungen → Allianz → Diplomatie). Ein neues
  Angebot desselben KI-Spielers frühestens nach `pactOfferEveryDays` (7) Tagen, auch nach einer Ablehnung. Umgekehrt
  kann der Mensch vorschlagen; bei „Vertraut“ gilt der Pakt sofort, sonst Ablehnung (`ki_not_trusted`). Kündigung mit der üblichen Frist; Überfall bis 48 h nach dem Erlöschen
  ist Paktbruch.
- Der globale Ruf (VORLAGE 3.3) folgt nach einer gemessenen Saison.

## 4. Gesuche

- **Je Mensch höchstens 1 Gesuch je Spieltag**, für ihn reserviert, 24 h gültig. Vergabe reihum (zuerst, wer am längsten
  keines hatte) durch den Wartungslauf. Nur Händler und Festung geben Gesuche, nur bei Ansehen ≥ „Bekannt“, ohne Sperre.
- Art zunächst **Liefern**: „Liefere {Menge} {Gut}“ = normaler KI-Liefervertrag (Verkauf an den KI-Spieler, kürzeste
  Laufzeit). Menge 2 h Produktion des Spielers in dem Gut, das der KI-Spieler kauft und das beim Spieler den meisten Produktionswert hat (Schritte wie das
  Kontingent, mindestens `minQty`, höchstens der Vertragsanteil am Tageslimit; Neulinge mit offenem Anfängerschutz
  höchstens 50 %). Das Kontingent wird für Gesuche nicht geprüft. Geleit und Feld sind vorbereitet und aus
  (`gesuche.kinds`).
- **Lohn: 3 h Produktion des Spielers als Waren aus dem Lager des KI-Spielers** (höchstens 4 h, nichts unter 20 %
  Lagerfüllung; kommt weniger als die Hälfte zusammen, gibt es kein Gesuch). Der Lohn wird beim Anbieten als Treuhand
  abgezogen und geht bei Ablehnen, Verfall oder Scheitern zurück. **Tagesbudget je KI-Spieler: 6 h seiner Produktion.**
- **Annahme** schließt den Vertrag und belegt einen der 3 Tagesbefehl-Plätze (bevorzugt den schweren, Art `gesuch`,
  nicht neu würfelbar). **Erfüllt** (Vertrag erfüllt): Lohn in den Heimathafen (bis zur Lagergrenze), Tagesbefehl
  erledigt, Ansehen + 5 (plus + 2 für den Vertrag). Gescheitert: Vertragsstrafe wie üblich (Ansehen − 10).
- Ab Tag 34 und nach der Finale-Sperre keine neuen Gesuche.

## 5. Seerat

- **Tagt immer**, unabhängig von der Rundengröße.
- **Sitzung je Gezeit-Fenster:** 36 h bis 12 h vor dem Fenster; drei Knöpfe: die Gezeit aus dem Plan · ein Beschluss
  (reihum aus Handelsfrieden, Geleitschutz, Gemeinsame Aktion) · Ruhige See. Die Wahl ersetzt, was im Fenster gilt
  (ein Wirkungs-Platz).
- **Wochensitzungen** zusätzlich an Tag 7 / 14 / 21 / 28: 24 h Abstimmung, Wirkzeit 48 h ab Schluss aus eigenem
  Katalog (Geleitschutz, Gebührensenkung, Gemeinsame Aktion, Ruhige See). Die Wirkzeit überlappt nie ein Gezeit-Fenster:
  läuft eine Gezeit, beginnt der Beschluss an ihrem Ende; beginnt eine mittendrin, endet er davor (mindestens 12 h,
  sonst entfällt die Wirkzeit).

| Beschluss | Wirkung |
|---|---|
| Handelsfrieden | Börsengebühr × 0,75, Gebühr im Spielerhandel × 0,5 |
| Geleitschutz | Kartellchance der Konvois × 0,5 (für alle) |
| Gebührensenkung | Börsengebühr × 0,75, Vertragsgebühr der KI-Verträge × 0,75 |
| Gemeinsame Aktion | neu entstehende Weltereignisse tragen + 20 % Beute |

- **Stimmen:** 1 je Mensch mit Hafen (geheim, bis zum Schluss änderbar); alle KI-Spieler **zusammen 1 Stimme**, nach
  Spielweise verteilt und offen begründet (Händler: Handelsfrieden/Gebührensenkung, Festung: Geleitschutz, Freibeuter:
  Gemeinsame Aktion; sonst Plan bzw. Ruhige See). **Eine Allianz zählt höchstens 40 %** der abgegebenen Gewichte
  (Überschuss anteilig gekürzt).
- **Quorum** ⌈N/2⌉ der aktiven Menschen (in 72 h gesehen, mit Hafen), sonst gilt die Vorgabe (Plan bzw. Ruhige See).
  Die Option mit den meisten Gewichten gewinnt; bei Gleichstand Ruhige See.
- Öffnung: 1 Push an alle aktiven Menschen, die noch nicht gestimmt haben, und Lage-Zeile „Der Seerat tagt“ bis zur
  eigenen Stimme. Schluss: Ergebnis als Systemnachricht an alle mit Hafen (Stimmenzahlen, KI-Stimmen mit Namen,
  keine Menschennamen) und Push „Seerat-Ergebnis“ (Art `council`, abschaltbar, Ruhezeit gilt). Beginnt der Beschluss, gilt die Gezeit-Meldung (Push, Lage).

## 6. Oberfläche

- **Basis → Lage → Weltpolitik:** laufende und (24 h vorher) angekündigte Gezeit bzw. Beschlüsse mit Restzeit und den
  wirkenden Reglern, offene Seerat-Sitzung mit einem Knopf je Option (eigene Stimme markiert, änderbar), Ergebnis der
  letzten 48 h mit Auszählung (Stimmen, Gewichte, KI-Stimmen), Paktangebote, Kalender der Saison zum Aufklappen.
- **Tagesbefehle:** offenes Gesuch über den drei Befehlen (Annehmen/Ablehnen); im belegten Platz Lieferung,
  Fälligkeit und Lohn.
- **Börse → Verträge:** je KI-Spieler Ansehen (Stufe, Wert, Bonus, Kontingent, Sperre mit Restzeit, Verlauf).
- **Wo es wirkt:** Hinweis mit Restzeit und Wert danach in Order (Gebühr, Tageslimit), KI-Verträgen (Bonus,
  Vertragsgebühr), Börsenkonvoi und Konvoi-Probekampf (Kartellchance), Spielerhandel (Gebühr).
- **Verwaltung → Weltpolitik:** Not-Aus je Baustein, Fenster absagen, Sitzungen, Zähler der Gesuche.
- Handbuch-Kapitel „Weltpolitik“ (Zahlen aus der Grundbalance).

## 7. Schnittstelle

Router `politik`: `overview` (Kalender, wirkende Regler als Zeilen mit Schlüssel/Ende/Wert danach, Sitzungen mit
eigener Stimme und nach dem Schluss das Ergebnis, Paktangebote), `ki` (Ansehen je KI-Spieler, Verlauf, Sperre, eigene
Gesuche mit Fälligkeit), `vote`, `acceptGesuch`, `declineGesuch`, `acceptPakt`, `declinePakt`, Verwaltung `admin`,
`adminOff`, `adminCancel`.
