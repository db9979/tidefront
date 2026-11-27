// „Was hilft?“ für Seekabel und Ökostrom (v1.21): Kabelstation, Reichweite, Allianz, Preis, Sabotage nur im Krieg.
import { fmtNum } from "../names.ts";
import { build, go } from "./helpers.ts";
import type { RemedyTable } from "./types.ts";

const alliance = go("Allianz", { to: "meldungen", sub: "allianz" });
const supply = go("Versorgung", { to: "base" });

export const POWER: RemedyTable = {
  cable_station_required: () => ({
    hint: "Beide Häfen brauchen das Gebäude Seekabel (Stufe 1 oder höher). Baue es in diesem Hafen; ein Partner baut sein eigenes.",
    actions: [build("seekabel", "Seekabel bauen")],
  }),
  cable_busy: () => ({
    hint: "Jeder Hafen hat höchstens ein Seekabel. Trenne das bestehende Kabel (Versorgung → Seekabel) oder wähle einen anderen Hafen.",
    actions: [supply],
  }),
  cable_too_far: ({ balance }) => ({
    hint: `Ein Seekabel reicht höchstens ${fmtNum(balance?.power?.cable?.maxKm ?? 600)} km; je 100 km gehen ${Math.round((balance?.power?.cable?.lossPer100Km ?? 0.1) * 100)} % unterwegs verloren. Wähle einen näheren Hafen.`,
  }),
  cable_not_ally: () => ({
    hint: "Kabel zu fremden Häfen gibt es nur zwischen Mitgliedern derselben Allianz. Tritt einer Allianz bei oder verbinde zwei eigene Häfen.",
    actions: [alliance],
  }),
  cable_price: ({ balance }) => ({
    hint: `Der Preis liegt zwischen 0 (Allianzhilfe) und ${fmtNum(balance?.power?.cable?.maxPrice ?? 2, 2)} Krediten je Strom-Stunde.`,
  }),
  cable_self: () => ({ hint: "Wähle als Gegenstelle einen anderen Hafen (eigener Hafen oder Hafen eines Allianzmitglieds)." }),
  cable_sabotage_war: () => ({
    hint: "Seekabel sabotierst du nur bei einem Kriegsgegner. Ohne Krieg ein anderes Ziel wählen (z. B. Kraftwerk) – oder die Allianz erklärt den Krieg.",
    actions: [alliance],
  }),
};
