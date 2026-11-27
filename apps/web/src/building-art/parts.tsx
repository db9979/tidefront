// Bausteine der Stufenbilder (Kupferstich: Tintenkontur, Schraffur aus IconDefs, Papier als Licht).
// Bildfläche 96×80, Grundlinie y = 72. Alle Bausteine stehen auf der Grundlinie, sofern nicht anders angegeben.
import type { ReactNode, SVGAttributes } from "react";
import { INK, PAPER, SIEGEL, SEE, MESSING } from "../icons-art.tsx";
import { Bob, Flutter, Smoke, type When } from "./motion.tsx";

export const W = 96;
export const H = 80;
export const G = 72;
/** Warmes Licht in Fenstern und Laternen (Prachtbau). */
export const LIGHT = "#e8b64c";

type P = SVGAttributes<SVGElement>;
const K = { stroke: INK, strokeWidth: 1.7, strokeLinejoin: "round", strokeLinecap: "round" } as const;
export const h: P = { fill: "url(#tf-h)", ...K };
export const hd: P = { fill: "url(#tf-hd)", ...K };
export const p: P = { fill: PAPER, ...K };
export const ln: P = { fill: "none", ...K };
export const fine: P = { fill: "none", ...K, strokeWidth: 1.1 };
export const red: P = { fill: SIEGEL, ...K, strokeWidth: 1.1 };

export type Roof = "flat" | "gable" | "saw" | "arch" | "shed";

/** Halle mit Dach; x links, w Breite, ht Wandhöhe. */
export function Hall({ x, w, ht, roof = "flat", fill = "p", y = G }: { x: number; w: number; ht: number; roof?: Roof; fill?: "p" | "h" | "hd"; y?: number }) {
  const top = y - ht;
  const f = fill === "p" ? p : fill === "h" ? h : hd;
  let d = `M${x} ${y} V${top}`;
  if (roof === "gable") d += ` L${x + w / 2} ${top - w * 0.28} L${x + w} ${top}`;
  else if (roof === "arch") d += ` Q${x + w / 2} ${top - w * 0.55} ${x + w} ${top}`;
  else if (roof === "shed") d += ` L${x + w} ${top - w * 0.2}`;
  else if (roof === "saw") {
    const n = Math.max(2, Math.round(w / 9));
    const step = w / n;
    for (let i = 0; i < n; i++) d += ` V${top - 6} L${x + (i + 1) * step} ${top}`;
  } else d += ` H${x + w}`;
  if (roof !== "flat" && roof !== "saw") d += ` H${x + w}`;
  d += ` V${y} Z`;
  return <path d={d} {...f} />;
}

/** Fensterreihen; lit = warmes Licht. */
export function Windows({ x, y, cols, rows = 1, gap = 5, size = 2.6, lit = false }: { x: number; y: number; cols: number; rows?: number; gap?: number; size?: number; lit?: boolean }) {
  let d = "";
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) d += `M${x + c * gap} ${y + r * gap}h${size}v${size}h${-size}Z`;
  return <path d={d} fill={lit ? LIGHT : PAPER} stroke={INK} strokeWidth={0.8} />;
}

/** Schornstein mit optionalem Rauch (steigt, solange das Gebäude produziert; siehe motion.tsx). */
export function Chimney({ x, ht, w = 5, smoke = true, band = false }: { x: number; ht: number; w?: number; smoke?: boolean; band?: boolean }) {
  const top = G - ht;
  return (
    <>
      <path d={`M${x} ${G} L${x + 0.6} ${top} H${x + w - 0.6} L${x + w} ${G} Z`} {...p} />
      {band && <path d={`M${x + 0.7} ${top + 4} H${x + w - 0.7}`} stroke={SIEGEL} strokeWidth={2.2} />}
      {smoke && <Smoke x={x + w / 2} y={top - 2} />}
    </>
  );
}

/** Stehender Tank (Zylinder) mit Deckelellipse. */
export function Tank({ x, w, ht, fill = "h" }: { x: number; w: number; ht: number; fill?: "p" | "h" }) {
  const top = G - ht;
  const ry = w * 0.18;
  return (
    <>
      <path d={`M${x} ${G} V${top} A${w / 2} ${ry} 0 0 1 ${x + w} ${top} V${G} Z`} {...(fill === "h" ? h : p)} />
      <path d={`M${x} ${top} A${w / 2} ${ry} 0 0 0 ${x + w} ${top}`} {...fine} />
    </>
  );
}

/** Kugeltank auf Stelzen. */
export function Sphere({ cx, r }: { cx: number; r: number }) {
  const cy = G - r - 5;
  return (
    <>
      <path d={`M${cx - r * 0.7} ${G} V${cy} M${cx + r * 0.7} ${G} V${cy}`} {...ln} strokeWidth={1.3} />
      <circle cx={cx} cy={cy} r={r} {...h} />
      <path d={`M${cx - r} ${cy} H${cx + r}`} {...fine} />
    </>
  );
}

/** Schlanke Kolonne (Raffinerie) mit Ringen. */
export function Column({ x, ht, w = 5 }: { x: number; ht: number; w?: number }) {
  const top = G - ht;
  let rings = "";
  for (let y = top + 6; y < G - 3; y += 7) rings += `M${x} ${y}h${w}`;
  return (
    <>
      <path d={`M${x} ${G} V${top + 2} Q${x + w / 2} ${top - 2} ${x + w} ${top + 2} V${G} Z`} {...p} />
      <path d={rings} {...fine} />
    </>
  );
}

/** Turmdrehkran (Gitter angedeutet), Ausleger nach rechts (dir 1) oder links (-1); work: Haken hebt, solange die Bedingung gilt. */
export function Crane({ x, ht, reach, dir = 1, base = G, work }: { x: number; ht: number; reach: number; dir?: 1 | -1; base?: number; work?: When }) {
  const top = base - ht;
  const tip = x + dir * reach;
  return (
    <>
      <path d={`M${x - 1.5} ${base} V${top} M${x + 1.5} ${base} V${top}`} {...ln} strokeWidth={1.2} />
      <path d={zig(x - 1.5, x + 1.5, base, top)} {...fine} strokeWidth={0.7} />
      <path d={`M${x - dir * 7} ${top} H${tip} M${x} ${top - 5} L${tip} ${top} M${x} ${top - 5} L${x - dir * 7} ${top}`} {...ln} strokeWidth={1.2} />
      {work ? (
        <Bob when={work} amp={ht * 0.15}>
          <path d={`M${tip - dir * 3} ${top} V${top + ht * 0.4}`} {...fine} />
          <rect x={tip - dir * 3 - 2} y={top + ht * 0.4} width={4} height={3} {...hd} strokeWidth={0.8} />
        </Bob>
      ) : (
        <>
          <path d={`M${tip - dir * 3} ${top} V${top + ht * 0.4}`} {...fine} />
          <rect x={tip - dir * 3 - 2} y={top + ht * 0.4} width={4} height={3} {...hd} strokeWidth={0.8} />
        </>
      )}
      <rect x={x - dir * 7 - (dir > 0 ? 0 : 4)} y={top} width={4} height={3} {...hd} strokeWidth={0.8} />
    </>
  );
}

function zig(x1: number, x2: number, y1: number, y2: number): string {
  let d = "";
  let left = true;
  for (let y = y1; y > y2; y -= 4) {
    d += `M${left ? x1 : x2} ${y} L${left ? x2 : x1} ${Math.max(y2, y - 4)}`;
    left = !left;
  }
  return d;
}

/** Gittermast (z. B. Antenne, Hochspannung). */
export function Lattice({ x, ht, w = 8, base = G }: { x: number; ht: number; w?: number; base?: number }) {
  const top = base - ht;
  const l = x - w / 2;
  const r = x + w / 2;
  let d = `M${l} ${base} L${x - 0.8} ${top} M${r} ${base} L${x + 0.8} ${top}`;
  const n = Math.max(2, Math.floor(ht / 7));
  for (let i = 0; i < n; i++) {
    const y0 = base - (ht * i) / n;
    const y1 = base - (ht * (i + 1)) / n;
    const s0 = (w / 2) * (1 - i / n) + 0.8 * (i / n);
    const s1 = (w / 2) * (1 - (i + 1) / n) + 0.8 * ((i + 1) / n);
    d += `M${x - s0} ${y0} L${x + s1} ${y1} M${x + s0} ${y0} L${x - s1} ${y1}`;
  }
  return <path d={d} {...ln} strokeWidth={1} />;
}

/** Fahnenmast mit Wimpel in Siegelrot; flutter: Wimpel flattert, solange die Bedingung gilt. */
export function Flag({ x, y = G, ht = 14, wide = 7, flutter }: { x: number; y?: number; ht?: number; wide?: number; flutter?: When }) {
  const top = y - ht;
  const pennant = <path d={`M${x} ${top} L${x + wide} ${top + 2.2} L${x} ${top + 4.5} Z`} {...red} />;
  return (
    <>
      <path d={`M${x} ${y} V${top}`} {...ln} strokeWidth={1.2} />
      {flutter ? <Flutter ox={x} oy={top + 2.2} when={flutter}>{pennant}</Flutter> : pennant}
    </>
  );
}

/** Mauer mit Zinnen über die Breite. */
export function Wall({ x1, x2, ht = 6 }: { x1: number; x2: number; ht?: number }) {
  const top = G - ht;
  let d = `M${x1} ${G} V${top}`;
  for (let x = x1; x < x2 - 3; x += 6) d += ` H${x + 3} V${top - 2} H${Math.min(x2, x + 6)} V${top}`;
  d += ` H${x2} V${G} Z`;
  return <path d={d} {...hd} strokeWidth={1.2} />;
}

/** Laterne mit warmem Licht. */
export function Lamp({ x, ht = 9 }: { x: number; ht?: number }) {
  return (
    <>
      <path d={`M${x} ${G} V${G - ht}`} {...ln} strokeWidth={1} />
      <circle cx={x} cy={G - ht - 1.2} r={1.6} fill={LIGHT} stroke={INK} strokeWidth={0.7} />
    </>
  );
}

/** Zaun aus Pfählen. */
export function Fence({ x1, x2, ht = 4 }: { x1: number; x2: number; ht?: number }) {
  let d = `M${x1} ${G - ht + 1} H${x2}`;
  for (let x = x1; x <= x2; x += 3) d += `M${x} ${G} V${G - ht}`;
  return <path d={d} {...fine} strokeWidth={0.8} />;
}

/** Parabolantenne auf Sockel. */
export function Dish({ cx, y, r, tilt = -30 }: { cx: number; y: number; r: number; tilt?: number }) {
  return (
    <g transform={`rotate(${tilt} ${cx} ${y})`}>
      <path d={`M${cx - r} ${y - r * 0.2} Q${cx} ${y + r * 0.9} ${cx + r} ${y - r * 0.2} Z`} {...p} />
      <path d={`M${cx} ${y + r * 0.35} V${y - r * 0.8}`} {...fine} />
    </g>
  );
}

/** Wasserlinie unter Hafenbauten. */
export const WATER = <path d="M0 74 q4 -2.4 8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0" fill="none" stroke={SEE} strokeWidth={1.3} strokeLinecap="round" />;
/** Grundlinie (Erdboden) über die Bildbreite, nur so breit wie bebaut. */
export function Ground({ x1 = 4, x2 = 92 }: { x1?: number; x2?: number }) {
  return <path d={`M${x1} ${G} H${x2}`} {...ln} strokeWidth={1.3} />;
}

/** Messingtafel (Wappenschild) als Zierde des Prachtbaus. */
export function Crest({ cx, cy, r = 3 }: { cx: number; cy: number; r?: number }) {
  return <circle cx={cx} cy={cy} r={r} fill={MESSING} stroke={INK} strokeWidth={0.8} />;
}

export type Draw = (s: number) => ReactNode;
