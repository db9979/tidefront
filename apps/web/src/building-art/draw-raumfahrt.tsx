// Stufenbilder Lagebild Stufe 3 (v1.23): Startrampe und Störsender. s = 1 … 5.
// Bewegung (motion.tsx): Startrampe – Warnlicht am Startturm blinkt, solange ein eigener Satellit fliegt; Dampf am
// Startplatz in der ersten halben Stunde nach einem Start. Störsender – Sendelicht blinkt, solange er Strom hat;
// die Störwellen pulsieren.
import { G, Hall, Windows, Lattice, Flag, Lamp, Fence, Dish, Ground, Tank, h, hd, p, ln, fine, red, type Draw } from "./parts.tsx";
import { INK, SIEGEL } from "../icons-art.tsx";
import { Blink, BlinkGroup, Smoke, Turn, useLive } from "./motion.tsx";

const lamps = (...xs: number[]) => xs.map((x) => <Lamp key={x} x={x} />);

/** Rakete auf dem Startplatz (Spitze bei top), mit Stabilisierungsflossen; ab Stufe 4 mit Zusatzstufen. */
function Rocket({ x, top, ht, boosters }: { x: number; top: number; ht: number; boosters: boolean }) {
  const w = 6 + ht / 12;
  return (
    <>
      {boosters && <><path d={`M${x - w / 2 - 3} ${G - 2} V${top + ht * 0.45} l1.5 -4 l1.5 4 V${G - 2} Z`} {...h} strokeWidth={0.9} /><path d={`M${x + w / 2} ${G - 2} V${top + ht * 0.45} l1.5 -4 l1.5 4 V${G - 2} Z`} {...h} strokeWidth={0.9} /></>}
      <path d={`M${x - w / 2} ${G - 2} V${top + w} Q${x} ${top - 2} ${x + w / 2} ${top + w} V${G - 2} Z`} {...p} strokeWidth={1.1} />
      <path d={`M${x - w / 2} ${top + ht * 0.35} H${x + w / 2} M${x - w / 2} ${top + ht * 0.7} H${x + w / 2}`} {...fine} strokeWidth={0.8} />
      <path d={`M${x - w / 2} ${G - 2} l-3 3 V${G - 8} Z M${x + w / 2} ${G - 2} l3 3 V${G - 8} Z`} {...red} strokeWidth={0.8} />
    </>
  );
}

/** Startrampe: Startplatz mit Flammenrinne, Rakete, Startturm mit Versorgungsarmen; später Hangar, Tanks, Bahnverfolgung. */
const startrampe: Draw = (s) => {
  const ht = 26 + 5 * s;
  const top = G - ht;
  const tower = ht + 6;
  return (
    <>
      <path d={`M26 ${G} V${G - 3} H62 V${G}`} {...hd} strokeWidth={1} />
      <Rocket x={44} top={top} ht={ht} boosters={s >= 4} />
      <Lattice x={58} ht={tower} w={7} />
      <path d={`M55 ${G - tower * 0.55} H${48 + s * 0.4} M55 ${G - tower * 0.8} H${48 + s * 0.4}`} {...ln} strokeWidth={1.1} />
      {/* Warnlicht: blinkt, solange ein eigener Satellit in der Umlaufbahn ist */}
      <circle cx={58} cy={G - tower - 1.5} r={1.4} fill={SIEGEL} stroke={INK} strokeWidth={0.5} />
      <Blink x={58} y={G - tower - 1.5} r={1.6} when="producing" color="#e04a2c" period={1.4} hard />
      {/* Dampf aus der Flammenrinne kurz nach dem Start */}
      <Smoke x={36} y={G - 3} d={`M36 ${G - 3} c-3 -2 -5 -6 -2 -9 c2 -3 -1 -5 1 -8`} when="launch" />
      <Smoke x={52} y={G - 3} d={`M52 ${G - 3} c3 -2 5 -6 2 -9 c-2 -3 1 -5 -1 -8`} when="launch" />
      {s >= 2 && <><Hall x={6} w={16} ht={10 + s} roof="arch" fill="h" /><Windows x={9} y={G - 6} cols={2} gap={5} lit={s >= 5} /></>}
      {s >= 3 && <><Tank x={68} w={8} ht={14 + s} /><Tank x={78} w={8} ht={12 + s} fill="p" /><path d={`M66 ${G - 4} H62`} {...ln} strokeWidth={1} /></>}
      {s >= 4 && <><path d={`M88 ${G} V${G - 16}`} {...ln} /><Turn cx={88} cy={G - 18} when="producing"><Dish cx={88} y={G - 18} r={5 + s / 2} /></Turn></>}
      {s >= 4 && <Fence x1={2} x2={5} />}
      {s >= 5 && <Flag x={14} y={G - 10 - s - 7} ht={8} wide={5} />}
      {s >= 5 && lamps(24, 64)}
      <Ground x1={2} x2={94} />
    </>
  );
};

/** Störwellen (Zickzack): pulsieren, solange der Störsender Strom hat; ohne Live-Daten ruhend gezeichnet. */
function JamWaves({ top }: { top: number }) {
  const l = useLive();
  const waves = <path d={`M54 ${top + 4} l3 3 l-3 3 l3 3 l-3 3 M60 ${top} l4 4 l-4 4 l4 4 l-4 4 l4 4`} fill="none" stroke={SIEGEL} strokeWidth={1.1} strokeLinejoin="round" />;
  return l ? <BlinkGroup when="producing" period={1.2}>{waves}</BlinkGroup> : waves;
}

/** Störsender: Sendehaus mit Gittermast und Querantennen; die Störwellen pulsieren, solange er Strom hat. */
const stoersender: Draw = (s) => {
  const mast = 26 + 5 * s;
  const w = 18 + 2 * s;
  return (
    <>
      <Hall x={10} w={w} ht={10 + s} roof="flat" fill="h" />
      <Windows x={13} y={G - 6} cols={Math.max(2, Math.floor(w / 6))} gap={5} lit={s >= 5} />
      <Lattice x={44} ht={mast} w={6 + s / 2} />
      {Array.from({ length: Math.min(4, 1 + Math.floor(s / 1.5)) }, (_, i) => (
        <path key={i} d={`M${38 - i} ${G - mast + 6 + i * 6} H${50 + i}`} {...ln} strokeWidth={1} />
      ))}
      <circle cx={44} cy={G - mast - 2} r={1.4} fill={SIEGEL} stroke={INK} strokeWidth={0.5} />
      <Blink x={44} y={G - mast - 2} r={1.7} when="producing" color="#e04a2c" period={0.9} hard />
      <JamWaves top={G - mast} />
      {s >= 3 && <><path d={`M72 ${G} V${G - 12}`} {...ln} /><Dish cx={72} y={G - 14} r={5 + s / 2} tilt={-20} /></>}
      {s >= 4 && <Fence x1={2} x2={8} />}
      {s >= 4 && <Hall x={78} w={12} ht={8} />}
      {s >= 5 && <Flag x={20} y={G - 10 - s - 8} ht={8} wide={5} />}
      {s >= 5 && lamps(34, 66)}
      <path d={`M28 ${G - 4} H41`} {...fine} />
      <Ground x1={2} x2={94} />
    </>
  );
};

export const RAUMFAHRT: Record<string, Draw> = { startrampe, stoersender };
