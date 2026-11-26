# TIDEFRONT – Nachrichtendienst und Spionage

Teil der Regeln (siehe `docs/REGELN.md`).

- Gebäude **Nachrichtendienst** (`espionage.building`, Werte unter `buildings.nachrichtendienst`). Er bildet die Einheit
  **Spion** aus (`units.spion`, `covert`): je Stufe höchstens `maxPerLevel` Spione (daheim, unterwegs und in
  Ausbildung zusammen; sonst `unit_cap`), Bautempo wie Werft/Kaserne (`buildSpeedPerLevel`), Unterhalt wie jede Einheit.
- Spione **kämpfen nicht**: Sie gehören nicht zur Verteidigung eines Hafens und werden von Kämpfen nicht berührt; in
  Verbänden normaler Missionen sind sie nicht erlaubt (`covert_unit`). Ihr Kostenwert zählt in der Wertung (Militär).
- **Spionageaufträge** (Missionsart `spionage`, Befehl `espionage.launch`, Ereignis `spy_arrive`): Sie belegen einen
  Missionsplatz, reisen ohne Treibstoff mit `espionage.speedKmh` (Hin- und Rückweg gleich lang) und sind für Radar und
  Vorwarnung unsichtbar. Je Art Mindeststufe des Nachrichtendiensts, Zahl der Spione und Zuschlag (`espionage.kinds`):
  - **Erkunden** (Stufe 1, 1 Spion, +2): Lagebild wie Aufklärung, dazu laufende Forschung, Bauschlange,
    Ausbildung und Veteranenränge; ab Stufe `missionsFromLevel` (4) des Absenders auch die laufenden Missionen des Ziels.
  - **Desinformation** (Stufe 2, 1 Spion, ±0): Beim Absender wird hinterlegt, dass das Ziel bis `disinfo.hours` (24 h)
    im **nächsten** Lagebild (Aufklärung oder Erkunden) über den Absender verfälschte Zahlen sieht: Einheiten und
    Anlagen mal `forceFactor` (gerundet), Bestände und Bunkerschutz mal `resourceFactor` (abgerundet). Einmalig.
  - **Sabotage** (Stufe 3, 2 Spione, −3): wählbares Ziel aus `sabotage.targets`, nicht zerstörerisch:
    Kraftwerk → Gebäudeproduktion mal `productionFactor`; Radarstation → Vorwarnzeit 0; Werft, Kaserne, Flugfeld →
    der laufende Auftrag dort verschiebt sich um `sabotage.hours`, neue Aufträge dort dauern mal `trainingFactor`;
    Forschungsamt → die laufende Forschung verschiebt sich um `sabotage.hours`, neue dauert mal `researchFactor`;
    Bauschlange → alle Bauaufträge verschieben sich um `delayHours`. Die Wirkung (Zustand `BaseState.intel.sabotage`
    mit Ziel, Beginn, Ende) gilt `sabotage.hours` (6 h) als Modifikator-Quelle „Sabotage“; das Ereignis
    `spy_sabotage_end` schreibt bis zum Ende fort und hebt sie auf. Höchstens **eine** gelungene Sabotage je Hafen in
    `cooldownHours` (24 h, `sabotage_cooldown`).
  - **Kartell-Aufklärung** (Stufe 2, 1 Spion, ±0, kein Ziel, feste Dauer `kinds.kartell.hours` je Richtung, Abwehr
    `kinds.kartell.defense`): nächstes Weltereignis (Art und Zeitpunkt), laufende Ereignisse mit Position, Kurs mit
    Uhrzeiten (Schatzschiff), Zielhäfen mit erwarteter Angriffszeit (Großflotte), Belagerung.
- **Ziele:** fremde Spielerhäfen (`spy_target`, `own_base`), nicht unter **Anfängerschutz** (`target_beginner`).
  Nachtschild und Schutz nach Niederlage halten Spione nicht auf. **Sabotage** ist gegen Verbündete und Paktpartner
  verboten (`ally`, `pact`); **Erkunden und Desinformation sind auch bei Verbündeten erlaubt** (Entscheidung: Spionage
  unter Freunden ist ein Vertrauensbruch, aber kein Angriff). Bei Ankunft wird erneut geprüft (Anfängerschutz,
  Bündnis, Sperrfrist); dann bricht der Spion ohne Wurf ab und kehrt heim.
- **Probe (offener W20, `espionage.die`):** Erfolgswert E = `base` (9) + Stufe Nachrichtendienst × `attackPerLevel`
  + Forschung (Agentenschulung) + Erfahrung (je `xpPerPoint` gelungene Aufträge +1, höchstens `maxXpPoints`) +
  Zuschlag der Art. Abwehr A = Stufe Nachrichtendienst des Ziels × `defensePerLevel` + Forschung (Verschlüsselung);
  beim Kartell der feste Wert. Zielzahl Z = E − A, begrenzt auf 1 … die − 1. **Erfolg bei Wurf ≤ Z**, sonst enttarnt;
  eine 1 gelingt immer, eine 20 scheitert immer. Erfolgschance Z / 20, Enttarnungs-Chance 1 − Z / 20; beide stehen vor
  dem Auslaufen in der Vorschau. Gewürfelt wird bei Ankunft mit den dann gültigen Werten, deterministisch aus dem
  beim Auslaufen gespeicherten Seed (eigener Würfelstrom); Wurf, Zielzahl und beide Werte stehen im Bericht.
- **Enttarnt:** Die Spione sind verloren. Das Ziel erhält eine Systemnachricht „Fremder Spion enttarnt – Absender …“,
  eine Benachrichtigung und denselben Bericht (Art `spionage`). Der Bericht trägt die Verluste wie ein Kampf: Sieg der
  Abwehr in der Kampfbilanz (Kategorie Spionage), Kampfpunkte für das Ziel in der Wertung.
- **Unentdeckt:** Erfolg, das Ziel merkt nichts. Bei einer Sabotage sieht es nur die Folgen (Bericht `sabotage` ohne
  Absender, Hinweis „sabotiert bis …“ im Hafen). Die Spione kehren heim (`mission_return`); der Absender erhält den
  Spionagebericht. Bei der Heimkehr meldet sich „Spione zurück“ mit Art, Ziel und Ergebnis (gelungen oder
  abgebrochen), nicht das allgemeine „Verband zurück“. Gelungenes Erkunden und Kartell-Aufklärung zählen für den
  Tagesbefehl „Erfolgreiche Erkundung“.
