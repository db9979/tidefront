// Fronten der Tiefs: Warmfront, Kaltfront und Okklusion als Linienzüge um den Kern, dazu der passende
// Wolkenschirm. Rein geometrisch in km um den Kern (x nach Osten, y nach Norden); weather.ts setzt Lage und Zug.
// Modell (Nordhalbkugel, Tief zieht nach Ost bis Ostnordost): Die Warmfront läuft vom Kern nach Ost bis Südost, die
// Kaltfront nach Süd bis Südwest, dazwischen der Warmsektor. In der zweiten Lebenshälfte holt die Kaltfront die Warmfront ein:
// Vom Kern bis zum Okklusionspunkt liegt dann die Okklusion. Wolken: breiter Schirm vor der Warmfront (Aufgleiten),
// schmales Band an der Kaltfront (Schauer), dichte Bewölkung um den Kern und an der Okklusion.

const RAD = Math.PI / 180;

export type FrontKind = "warm" | "kalt" | "okklusion";

/** Linienzug einer Front in km um den Kern; Punkte vom Kern weg (bei der Okklusion vom Kern zum Okklusionspunkt). */
export interface FrontLine {
  kind: FrontKind;
  pts: { x: number; y: number }[];
}

/** Stützpunkte je Front (gleichmäßig entlang der Linie). */
const SEGMENTS = 5;

/**
 * Fronten eines Tiefs. `heading` = Zugrichtung als Peilung (Grad, 0 = Nord, im Uhrzeigersinn), `ageShare` = Anteil
 * der Lebensdauer (0–1), `radiusKm` = Radius des Tiefs. Warmfront 1,4 Radien lang, Kaltfront 1,8 Radien, beide leicht
 * gekrümmt (bei Zug nach Ost, Peilung 80°: Warmfront dreht von Ost nach Südost, Kaltfront von Süd nach Südwest).
 */
export function frontLines(heading: number, ageShare: number, radiusKm: number): FrontLine[] {
  const R = radiusKm;
  // Okklusion: ab der Lebensmitte wächst sie bis 0,9 Radien.
  const occ = 0.9 * R * smoothstep(0.45, 0.9, ageShare);
  const out: FrontLine[] = [];
  let start = { x: 0, y: 0 };
  if (occ > 1) {
    const pts = line({ x: 0, y: 0 }, heading + 40, heading + 40, occ);
    start = pts[pts.length - 1];
    out.push({ kind: "okklusion", pts });
  }
  out.push({ kind: "warm", pts: line(start, heading + 15, heading + 45, 1.4 * R) });
  out.push({ kind: "kalt", pts: line(start, heading + 105, heading + 140, 1.8 * R) });
  return out;
}

/** Linienzug ab `from` mit von b0 nach b1 drehender Peilung (Grad), Länge `len` km. */
function line(from: { x: number; y: number }, b0: number, b1: number, len: number): { x: number; y: number }[] {
  const pts = [{ ...from }];
  let { x, y } = from;
  const step = len / SEGMENTS;
  for (let i = 0; i < SEGMENTS; i++) {
    const b = (b0 + ((b1 - b0) * (i + 0.5)) / SEGMENTS) * RAD;
    x += Math.sin(b) * step;
    y += Math.cos(b) * step;
    pts.push({ x, y });
  }
  return pts;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Vorzeichenbehafteter Abstand (km) eines Punkts zum Linienzug: positiv links in Laufrichtung (bei der Warmfront die
 * kalte Seite voraus, bei der Kaltfront der Warmsektor), dazu wie weit der Punkt über das Ende hinausragt.
 */
export function frontDistance(px: number, py: number, pts: { x: number; y: number }[]): { d: number; beyond: number } {
  let best = Infinity;
  let sign = 1;
  let beyond = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len2 = ex * ex + ey * ey || 1;
    const raw = ((px - a.x) * ex + (py - a.y) * ey) / len2;
    const t = Math.max(0, Math.min(1, raw));
    const dx = px - (a.x + ex * t), dy = py - (a.y + ey * t);
    const dist = Math.hypot(dx, dy);
    if (dist < best) {
      best = dist;
      sign = ex * (py - a.y) - ey * (px - a.x) >= 0 ? 1 : -1;
      beyond = i === pts.length - 2 && raw > 1 ? (raw - 1) * Math.sqrt(len2) : 0;
    }
  }
  return { d: sign * best, beyond };
}

/**
 * Wolken eines Tiefs (vor der Stärke `s`, 0–1) an (dx, dy) km um den Kern. Warmfront: Schirm vor der Front
 * (links in Laufrichtung, Mitte 0,35 Radien voraus, nach hinten schnell klar); Kaltfront: schmales Band um die Linie;
 * Okklusion und Kern: dichte, runde Bewölkung. Über das Frontende hinaus läuft der Schirm weich aus.
 */
export function frontClouds(dx: number, dy: number, lines: FrontLine[], radiusKm: number): number {
  const R = radiusKm;
  let c = 0.75 * Math.exp(-(dx * dx + dy * dy) / (0.45 * R * R));
  for (const f of lines) {
    const { d, beyond } = frontDistance(dx, dy, f.pts);
    const fade = Math.exp(-((beyond / (0.5 * R)) ** 2));
    let v: number;
    if (f.kind === "warm") {
      const w = d >= 0.35 * R ? 0.5 * R : 0.28 * R; // voraus breit, zum Warmsektor hin schmal
      v = 0.85 * Math.exp(-(((d - 0.35 * R) / w) ** 2));
    } else if (f.kind === "kalt") {
      v = 0.6 * Math.exp(-(((d + 0.06 * R) / (0.2 * R)) ** 2));
    } else {
      v = 0.65 * Math.exp(-((d / (0.35 * R)) ** 2));
    }
    c = Math.max(c, v * fade);
  }
  return c;
}
