// Stufenbilder der Strom- und Geheimdienstbauten (Windpark, Solarfeld, Speicherwerk, Nachrichtendienst). s = 1 … 5.
import { G, Hall, Windows, Lattice, Flag, Lamp, Fence, Dish, Ground, Tank, h, hd, p, ln, fine, type Draw } from "./parts.tsx";
import { INK } from "../icons-art.tsx";

const lamps = (...xs: number[]) => xs.map((x) => <Lamp key={x} x={x} />);

/** Windrad: schlanker Mast, Gondel, drei Flügel (Winkel a in Grad). */
function Turbine({ x, ht, r, a = 0 }: { x: number; ht: number; r: number; a?: number }) {
  const hy = G - ht;
  const blades = [0, 120, 240].map((d) => {
    const rad = ((d + a) * Math.PI) / 180;
    const tx = x + Math.sin(rad) * r;
    const ty = hy - Math.cos(rad) * r;
    const nx = Math.cos(rad) * 1.6;
    const ny = Math.sin(rad) * 1.6;
    return `M${x + nx} ${hy + ny} L${tx} ${ty} L${x - nx} ${hy - ny} Z`;
  });
  return (
    <>
      <path d={`M${x - 1.6} ${G} L${x - 0.7} ${hy} H${x + 0.7} L${x + 1.6} ${G} Z`} {...p} strokeWidth={1.2} />
      <path d={blades.join(" ")} {...p} strokeWidth={1} />
      <circle cx={x} cy={hy} r={1.8} {...hd} strokeWidth={1} />
    </>
  );
}

const windpark: Draw = (s) => {
  const n = Math.min(4, 1 + Math.floor((s + 1) / 2));
  const xs = [48, 24, 72, 86].slice(0, n);
  return (
    <>
      {xs.map((x, i) => <Turbine key={x} x={x} ht={34 + 3 * s - i * 4} r={12 + s - i} a={i * 37} />)}
      {s >= 3 && <Hall x={4} w={14} ht={8} roof="shed" fill="h" />}
      {s >= 4 && <path d={`M18 ${G - 6} Q33 ${G - 2} ${xs[1] ?? 48} ${G - 1}`} {...fine} strokeWidth={0.7} />}
      {s >= 5 && <Flag x={11} y={G - 10} ht={8} wide={5} />}
      <Ground x1={2} x2={94} />
    </>
  );
};

/** Schräg aufgeständerte Solartafel-Reihe. */
function Panels({ x, w, y = G }: { x: number; w: number; y?: number }) {
  const top = y - 9;
  let grid = "";
  for (let i = 1; i < 4; i++) grid += `M${x + 2 + (w * i) / 4} ${top} L${x + (w * i) / 4} ${y - 3}`;
  return (
    <>
      <path d={`M${x + 3} ${y} V${y - 3} M${x + w - 3} ${y} V${top + 1}`} {...ln} strokeWidth={1} />
      <path d={`M${x} ${y - 3} L${x + 2} ${top} H${x + w + 2} L${x + w} ${y - 3} Z`} {...hd} strokeWidth={1.1} />
      <path d={grid} {...fine} strokeWidth={0.6} />
    </>
  );
}

const solarfeld: Draw = (s) => {
  const rows = Math.min(3, 1 + Math.floor(s / 2));
  const cols = s >= 4 ? 4 : s >= 2 ? 3 : 2;
  const w = 18;
  const x0 = 48 - (cols * (w + 3)) / 2;
  return (
    <>
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => <Panels key={`${r}-${c}`} x={x0 + c * (w + 3) + r * 3} w={w} y={G - r * 7} />),
      ).reverse()}
      {s >= 3 && <Hall x={84} w={10} ht={8} roof="flat" fill="h" />}
      {s >= 4 && <Fence x1={2} x2={x0 - 2} />}
      {s >= 5 && lamps(x0 - 4, 82)}
      <Ground x1={2} x2={94} />
    </>
  );
};

const speicherwerk: Draw = (s) => {
  const n = s >= 4 ? 3 : s >= 2 ? 2 : 1;
  const ht = 16 + 2 * s;
  return (
    <>
      {Array.from({ length: n }, (_, i) => <Tank key={i} x={10 + i * 15} w={12} ht={ht - i * 2} fill={i % 2 ? "p" : "h"} />)}
      <Hall x={58} w={26} ht={12 + s} roof="flat" />
      <Windows x={61} y={G - 8 - s} cols={4} gap={5} lit={s >= 5} />
      <path d={`M64 ${G - 12 - s} l3 -5 h-3 l3 -5`} {...ln} strokeWidth={1.2} stroke={INK} />
      {s >= 3 && <Lattice x={88} ht={22 + 2 * s} w={6} />}
      {s >= 3 && <path d={`M${10 + n * 15} ${G - ht + 4} Q50 ${G - ht} 58 ${G - 10}`} {...fine} strokeWidth={0.7} />}
      {s >= 5 && lamps(50, 86)}
      <Ground x1={2} x2={94} />
    </>
  );
};

const nachrichtendienst: Draw = (s) => {
  const w = 34 + 4 * s;
  const ht = 14 + 3 * s;
  const x = 46 - w / 2;
  return (
    <>
      <Hall x={x} w={w} ht={ht} roof="gable" />
      <Windows x={x + 4} y={G - ht + 5} cols={Math.floor((w - 6) / 5)} rows={Math.max(1, Math.floor((ht - 8) / 6))} gap={5} lit={s >= 5} />
      {s >= 2 && <Lattice x={x + w + 6} ht={28 + 3 * s} w={6} />}
      {s >= 3 && <Dish cx={x - 6} y={G - 10} r={6 + s / 2} />}
      {s >= 4 && <Fence x1={2} x2={x - 13} />}
      {s >= 4 && <path d={`M${x + w + 9} ${G - 36 - 3 * s} c4 -3 8 -3 12 0 M${x + w + 11} ${G - 40 - 3 * s} c3 -2 5 -2 8 0`} {...fine} strokeWidth={0.8} />}
      {s >= 5 && <Flag x={46} y={G - ht - w * 0.28} ht={9} wide={5} />}
      <path d={`M${46 - 3} ${G} V${G - 7} H${46 + 3} V${G} Z`} {...h} strokeWidth={1} />
      <Ground x1={2} x2={94} />
    </>
  );
};

export const ENERGIE: Record<string, Draw> = { windpark, solarfeld, speicherwerk, nachrichtendienst };
