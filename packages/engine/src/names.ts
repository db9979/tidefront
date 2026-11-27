// Deutsche Namen für Benachrichtigungen (Server-Seite; die Oberfläche hat eigene in apps/web/src/lib/names.ts).

const NAMES: Record<string, string> = {
  kommandozentrale: "Kommandozentrale", stahlwerk: "Stahlwerk", raffinerie: "Raffinerie", chipfabrik: "Chipfabrik",
  versorgungshof: "Versorgungshof", kraftwerk: "Kraftwerk", lagerkomplex: "Lagerkomplex", tiefbunker: "Tiefbunker",
  werft: "Werft", kaserne: "Kaserne", flugfeld: "Flugfeld", radarstation: "Radarstation", hafenkommandantur: "Hafenkommandantur",
  korvette: "Korvette", zerstoerer: "Zerstörer", landungsschiff: "Landungsschiff", uboot: "U-Boot", schuetzen: "Schützen", pioniere: "Pioniere",
  kampfpanzer: "Kampfpanzer", abfangjaeger: "Abfangjäger", jagdbomber: "Jagdbomber", aufklaerungsdrohne: "Aufklärungsdrohne",
  schnellboot: "Schnellboot", piratenmiliz: "Piratenmiliz", flaggschiff: "Leviathan-Sektion", kuestenbatterie: "Küstenbatterie", flakstellung: "Flakstellung",
  bunkerlinie: "Bunkerlinie", minensperre: "Minensperre",
  stahl: "Stahl", treibstoff: "Treibstoff", elektronik: "Elektronik", proviant: "Proviant", credits: "Kredite",
  // Für ausführliche E-Mails (wie apps/web/src/lib/names.ts)
  windpark: "Windpark", solarfeld: "Solarfeld", speicherwerk: "Speicherwerk", forschungsamt: "Forschungsamt",
  minenleger: "Minenleger", minenraeumer: "Minenräumer", kolonieschiff: "Kolonieschiff", spion: "Spion", anlagen: "Anlagen",
  luftkampf: "Luftkampf", luftschlag: "Luftschlag", ubootangriff: "U-Boot-Angriff", seegefecht: "Seegefecht", landung: "Landung",
  nachtschild: "Nachtschild", anfaengerschutz: "Anfängerschutz", niederlage: "Schutz nach Niederlage", gruendungsschutz: "Gründungsschutz",
  startrampe: "Startrampe", stoersender: "Störsender", // Lagebild Stufe 3
  bauschlange: "Bauschlange", oelfeld: "Ölfeld", erzbucht: "Erzbucht", fischgrund: "Fischgrund", elektronikwrack: "Elektronik-Wrack",
  nachrichtendienst: "Nachrichtendienst", elektrolyse: "Elektrolyse", seekabel: "Seekabel",
  schatzschiff: "Schatzschiff", grossflotte: "Großflotte", belagerung: "Belagerung", finale: "Kartell-Armada", // Weltereignisse
  ueberfall: "Überfall", aufklaerung: "Aufklärung", transport: "Transport", minen: "Minen legen", raeumen: "Minen räumen",
  blockade: "Blockade", abfangen: "Konvoi abfangen", geleit: "Geleitschutz", besetzen: "Besetzen", gruendung: "Gründung",
  verlegung: "Verlegung", patrouille: "Patrouille", radarposten: "Radarposten", // Missionsarten
};

/** Forschung: Namen der Techniken (wie apps/web/src/lib/research.ts), z. B. für das KI-Protokoll. */
export const TECH_NAMES: Record<string, string> = {
  dampfturbinen: "Dampfturbinen", schiffspanzerung: "Schiffspanzerung", sonar: "Sonar", prisenrecht: "Prisenrecht",
  torpedoleitsysteme: "Torpedoleitsysteme", infanteriewaffen: "Infanteriewaffen", drillausbildung: "Drillausbildung",
  verbundpanzerung: "Verbundpanzerung", pioniertechnik: "Pioniertechnik", festungsbau: "Festungsbau", tarnnetze: "Tarnnetze",
  funkmesstechnik: "Funkmesstechnik", strahltriebwerke: "Strahltriebwerke", luftkampftaktik: "Luftkampftaktik",
  tarnanstrich: "Tarnanstrich", praezisionsbomben: "Präzisionsbomben", hochofen: "Hochofen", logistik: "Logistik",
  lagertechnik: "Lagertechnik", fertigbau: "Fertigbau", stahlbetonbunker: "Stahlbetonbunker", verschluesselung: "Verschlüsselung",
  agentenschulung: "Agentenschulung", optischer_satellit: "Optischer Satellit", radarsatellit: "Radarsatellit",
};

/** Mehrzahl der Einheiten und Anlagen (wie apps/web/src/lib/names.ts PLURAL). */
const PLURAL: Record<string, string> = {
  korvette: "Korvetten", zerstoerer: "Zerstörer", landungsschiff: "Landungsschiffe", uboot: "U-Boote", schuetzen: "Schützen", pioniere: "Pioniere",
  kampfpanzer: "Kampfpanzer", abfangjaeger: "Abfangjäger", jagdbomber: "Jagdbomber", aufklaerungsdrohne: "Aufklärungsdrohnen",
  schnellboot: "Schnellboote", piratenmiliz: "Piratenmilizionäre", flaggschiff: "Leviathan-Sektionen", kuestenbatterie: "Küstenbatterien", flakstellung: "Flakstellungen",
  bunkerlinie: "Bunkerlinien", minensperre: "Minensperren", spion: "Spione", minenleger: "Minenleger", minenraeumer: "Minenräumer",
  kolonieschiff: "Kolonieschiffe",
};

/** Deutscher Name einer ID; unbekannte IDs werden lesbar gemacht (ae → ä usw., wie label() im Web). */
export function nameOf(id: string): string {
  if (NAMES[id]) return NAMES[id];
  if (TECH_NAMES[id]) return TECH_NAMES[id];
  const s = id.replace(/ae/g, "ä").replace(/oe/g, "ö").replace(/ue/g, "ü").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Gibt es einen eigenen deutschen Namen (nicht nur den Rückfall)? Für Tests. */
export function hasName(id: string): boolean {
  return id in NAMES || id in TECH_NAMES;
}

/** Zahl mit passendem Wort (gemeinsame Mehrzahl-Hilfe), z. B. nOf(1, "Sichtung", "Sichtungen") → „1 Sichtung“. */
export function nOf(n: number, one: string, many: string): string {
  return `${fmtInt(Number.isFinite(n) ? n : 0)} ${n === 1 ? one : many}`;
}

/** Name mit passender Zahlform, z. B. „1 Korvette“ → „Korvette“, „12“ → „Korvetten“. */
export function countName(id: string, n: number): string {
  return n === 1 ? nameOf(id) : PLURAL[id] ?? nameOf(id);
}

/** Menge mit Name in passender Zahlform, z. B. „12 Korvetten, 3 Landungsschiffe“. */
export function countsText(c: Record<string, number> | null | undefined): string {
  return Object.entries(c ?? {}).filter(([, n]) => n > 0).map(([id, n]) => `${fmtInt(n)} ${countName(id, n)}`).join(", ");
}

export function fmtInt(n: number): string {
  return Math.floor(n).toLocaleString("de-DE");
}

/** "120 Stahl, 40 Treibstoff" oder "–". */
export function amounts(m: Record<string, number> | null | undefined): string {
  const parts = Object.entries(m ?? {}).filter(([, v]) => v >= 1).map(([k, v]) => `${fmtInt(v)} ${countName(k, Math.floor(v))}`);
  return parts.length ? parts.join(", ") : "–";
}

/** Uhrzeit in der Zeitzone des Servers (TZ), z. B. "14:05". */
export function clock(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: process.env.TZ || "Europe/Berlin" });
  } catch {
    return new Date(ms).toISOString().slice(11, 16);
  }
}

export function minutesText(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}
