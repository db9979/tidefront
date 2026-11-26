// Deutsche Namen für Benachrichtigungen (Server-Seite; die Oberfläche hat eigene in apps/web/src/lib/names.ts).

const NAMES: Record<string, string> = {
  kommandozentrale: "Kommandozentrale", stahlwerk: "Stahlwerk", raffinerie: "Raffinerie", chipfabrik: "Chipfabrik",
  versorgungshof: "Versorgungshof", kraftwerk: "Kraftwerk", lagerkomplex: "Lagerkomplex", tiefbunker: "Tiefbunker",
  werft: "Werft", kaserne: "Kaserne", flugfeld: "Flugfeld", radarstation: "Radarstation", hafenkommandantur: "Hafenkommandantur",
  korvette: "Korvette", zerstoerer: "Zerstörer", landungsschiff: "Landungsschiff", uboot: "U-Boot", schuetzen: "Schützen", pioniere: "Pioniere",
  kampfpanzer: "Kampfpanzer", abfangjaeger: "Abfangjäger", jagdbomber: "Jagdbomber", aufklaerungsdrohne: "Aufklärungsdrohne",
  schnellboot: "Schnellboot", piratenmiliz: "Piratenmiliz", kuestenbatterie: "Küstenbatterie", flakstellung: "Flakstellung",
  bunkerlinie: "Bunkerlinie", minensperre: "Minensperre",
  stahl: "Stahl", treibstoff: "Treibstoff", elektronik: "Elektronik", proviant: "Proviant", credits: "Kredite",
};

export function nameOf(id: string): string {
  return NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export function fmtInt(n: number): string {
  return Math.floor(n).toLocaleString("de-DE");
}

/** "120 Stahl, 40 Treibstoff" oder "–". */
export function amounts(m: Record<string, number> | null | undefined): string {
  const parts = Object.entries(m ?? {}).filter(([, v]) => v >= 1).map(([k, v]) => `${fmtInt(v)} ${nameOf(k)}`);
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
  if (min < 60) return `${min} Min.`;
  return `${Math.floor(min / 60)} Std. ${min % 60} Min.`;
}
