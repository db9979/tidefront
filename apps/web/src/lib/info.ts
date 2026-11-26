// Spielwissen für die Oberfläche: Beschreibungen, Wirkung je Stufe, Rolle der Einheiten.
import type { Balance } from "./trpc.ts";
import { fmtNum } from "./names.ts";

export const BUILDING_TEXT: Record<string, { kurz: string; lang: string }> = {
  kommandozentrale: {
    kurz: "Herz des Stützpunkts",
    lang: "Gibt Kommandopunkte – sie begrenzen, wie groß ein Verband sein darf. Kein anderes Gebäude darf mehr als 3 Stufen über der Kommandozentrale liegen.",
  },
  stahlwerk: { kurz: "Produziert Stahl", lang: "Stahl braucht fast alles: Gebäude, Schiffe, Panzer. Verbraucht Strom." },
  raffinerie: { kurz: "Produziert Treibstoff", lang: "Treibstoff kosten vor allem Missionen (Hin- und Rückweg werden beim Auslaufen bezahlt). Verbraucht Strom." },
  chipfabrik: { kurz: "Produziert Elektronik", lang: "Elektronik brauchen Flugzeuge, Radar und Anlagen. Verbraucht viel Strom." },
  versorgungshof: { kurz: "Produziert Proviant", lang: "Jede Einheit isst Proviant. Fällt der Bestand auf 0, herrscht Versorgungsmangel: keine Ausbildung, Angriff −20 %." },
  kraftwerk: { kurz: "Liefert Strom", lang: "Produktionsgebäude brauchen Strom. Reicht er nicht, sinkt die gesamte Gebäudeproduktion im selben Verhältnis." },
  lagerkomplex: { kurz: "Mehr Lagerplatz", lang: "Produktion füllt das Lager nur bis zur Kapazität. Beute, Lieferungen und Transporte dürfen darüber hinausgehen." },
  tiefbunker: { kurz: "Schützt vor Plünderung", lang: "Diese Menge je Ressource kann bei einem verlorenen Kampf nicht geplündert werden." },
  werft: { kurz: "Baut Schiffe", lang: "Korvetten, Zerstörer und Landungsschiffe, ab Stufe 3 auch U-Boote. Jede Stufe beschleunigt den Bau um 10 %." },
  kaserne: { kurz: "Bildet Bodentruppen aus", lang: "Schützen, Pioniere und Kampfpanzer. Nur Bodentruppen können erobern und Beute holen." },
  flugfeld: { kurz: "Flugzeuge und Stellplätze", lang: "Jede Stufe gibt 6 Stellplätze. Flugzeuge kämpfen nur innerhalb ihrer Reichweite." },
  radarstation: { kurz: "Vorwarnung bei Angriffen", lang: "Zeigt anrückende Angriffe früher an. Ohne Radar siehst du einen Angriff erst bei Ankunft." },
  hafenkommandantur: { kurz: "Missionsplätze und Börse", lang: "Jede zweite Stufe gibt einen weiteren Missionsplatz. Ab Stufe 3 öffnet die Börse, das Kreditlimit wächst mit jeder Stufe." },
};

export const UNIT_TEXT: Record<string, string> = {
  korvette: "Schnelles, günstiges Kriegsschiff. Stark gegen Schnellboote der Piraten, jagt mit Wasserbomben U-Boote.",
  zerstoerer: "Schweres Kriegsschiff mit starker Flugabwehr und U-Jagd. Bonus gegen Korvetten.",
  landungsschiff: "Trägt 100 Mann Truppen und 4.000 Beute. Ohne Landungsschiff keine Landung, kein Sieg.",
  uboot: "Getaucht und schwer zu fassen: eröffnet das Seegefecht mit Torpedos aus dem Verborgenen, stark gegen Landungsschiffe. Nur Schiffe mit U-Jagd (Korvette, Zerstörer) können es treffen. Trifft keine Küstenbatterien, wenig gegen Schnellboote.",
  schuetzen: "Günstige Infanterie. Erobert, verteidigt und hält den Stützpunkt gegen Kartell-Überfälle.",
  pioniere: "Halbieren den Schaden von Minensperren und knacken Bunkerlinien (Bonus ×4).",
  kampfpanzer: "Teuer, aber stark im Bodenkampf. Bonus gegen Schützen und Piratenmiliz. Braucht 10 Plätze.",
  abfangjaeger: "Kämpft um die Luftüberlegenheit. Wer sie hat, dessen Bomber treffen härter.",
  jagdbomber: "Greift im Luftschlag Schiffe und Anlagen an, bevor das Seegefecht beginnt.",
  aufklaerungsdrohne: "Kämpft nicht. Schnell und mit großer Reichweite – ideal für Aufklärung.",
  kuestenbatterie: "Feuert im Seegefecht schwer auf Schiffe und im Bodenkampf auf gelandete Truppen.",
  flakstellung: "Schießt im Luftschlag auf angreifende Bomber.",
  bunkerlinie: "Muss im Bodenkampf fallen, bevor ein Angreifer siegen kann.",
  minensperre: "Trifft einmal jede Landung mit 300 Schaden. Wird dabei nicht verbraucht.",
  schnellboot: "Boot des Freibeuter-Kartells.",
  piratenmiliz: "Fußvolk des Freibeuter-Kartells.",
};

export type Tone = "see" | "land" | "luft" | "anlage" | "feind" | "gebaeude";

export function unitTone(balance: Balance, id: string): Tone {
  if (balance.defenses[id]) return "anlage";
  if (balance.npcUnits[id]) return "feind";
  const b = balance.units[id]?.branch;
  return b === "see" ? "see" : b === "luft" ? "luft" : "land";
}

/** Wirkung eines Gebäudes auf Stufe L als kurzer Text (null, wenn es nichts Messbares gibt). */
export function buildingEffect(balance: Balance, id: string, level: number): string | null {
  const def = balance.buildings[id];
  if (!def) return null;
  const g = balance.building.productionGrowth;
  if (def.produces) {
    if (level < 1) return `+0 ${label(def.produces)}/h`;
    return `+${fmtNum((def.perHour ?? 0) * g ** (level - 1))} ${label(def.produces)}/h, braucht ${fmtNum((def.powerPerLevel ?? 0) * level)} Strom`;
  }
  if (def.powerSupplyPerLevel) return `${fmtNum(def.powerSupplyPerLevel * level)} Strom`;
  if (def.capacityBase) return `${fmtNum(def.capacityBase * (def.capacityGrowth ?? 1) ** level)} je Ressource`;
  if (def.protectedBase) return `${fmtNum(def.protectedBase * (def.protectedGrowth ?? 1) ** level)} je Ressource geschützt`;
  if (def.commandPointsBase !== undefined) return `${fmtNum(def.commandPointsBase + (def.commandPointsPerLevel ?? 0) * level)} Kommandopunkte`;
  if (def.slotsPerLevel) return `${def.slotsPerLevel * level} Stellplätze, Bau ${level < 1 ? "–" : `+${Math.round((def.buildSpeedPerLevel ?? 0) * (level - 1) * 100)} %`}`;
  if (def.buildSpeedPerLevel) return level < 1 ? "noch nicht gebaut" : `Bautempo +${Math.round(def.buildSpeedPerLevel * (level - 1) * 100)} %`;
  if (def.warningMinutesBase !== undefined) return level < 1 ? "keine Vorwarnung" : `${def.warningMinutesBase + (def.warningMinutesPerLevel ?? 0) * level} min Vorwarnung`;
  if (def.missionSlotsBase !== undefined) {
    const slots = def.missionSlotsBase + Math.floor(level / 2) * (def.missionSlotsPerTwoLevels ?? 0);
    const market = level >= (def.marketFromLevel ?? 99) ? `, Kreditlimit ${fmtNum((def.creditLimitPerLevel ?? 0) * level)}` : "";
    return `${slots} Missionsplätze${market}`;
  }
  return null;
}

function label(r: string): string {
  return { stahl: "Stahl", treibstoff: "Treibstoff", elektronik: "Elektronik", proviant: "Proviant", werft: "Werft", kaserne: "Kaserne", flugfeld: "Flugfeld" }[r] ?? r;
}

/** Kennzahlen einer Einheit oder Anlage für Info-Blätter. */
export function unitStats(balance: Balance, id: string): [string, string][] {
  const u = balance.units[id] ?? balance.npcUnits[id];
  const d = balance.defenses[id];
  const a = u?.attack ?? d?.attack;
  const rows: [string, string][] = [["Lebenspunkte", fmtNum(u?.hp ?? d?.hp ?? 0)]];
  if (a) {
    rows.push(["Angriff See", String(a.see)], ["Angriff Luft", String(a.luft)], ["Angriff Land", String(a.land)]);
    if ("anlage" in a && a.anlage) rows.push(["Angriff Anlagen", String(a.anlage)]);
    if ("uboot" in a && a.uboot) rows.push(["U-Jagd", String(a.uboot)]);
  }
  if (u?.submerged) rows.push(["Getaucht", "nur durch U-Jagd zu treffen"]);
  if (u?.requiresLevel && u.requiresLevel > 1) rows.push(["Bau ab", `${label(u.builtIn ?? "")} Stufe ${u.requiresLevel}`]);
  if (d?.oneShotDamageToLanding) rows.push(["Schaden je Landung", String(d.oneShotDamageToLanding)]);
  if (u?.bonus) for (const [t, f] of Object.entries(u.bonus)) rows.push([`Bonus gegen ${t}`, `×${f}`]);
  if (u?.speedKmh) rows.push(["Tempo", `${u.speedKmh} km/h`]);
  if (u?.rangeKm) rows.push(["Reichweite", `${fmtNum(u.rangeKm)} km`]);
  if (u?.fuelPer100Km) rows.push(["Treibstoff", `${u.fuelPer100Km} je 100 km`]);
  if (u?.cargo) rows.push(["Ladung", fmtNum(u.cargo)]);
  if (u?.troopSpace) rows.push(["Truppenraum", fmtNum(u.troopSpace)]);
  if (u?.size) rows.push(["Platzbedarf", String(u.size)]);
  if (u?.commandPoints !== undefined) rows.push(["Kommandopunkte", String(u.commandPoints)]);
  if (u?.upkeepPerHour) rows.push(["Unterhalt", `${u.upkeepPerHour} Proviant/h`]);
  return rows;
}
