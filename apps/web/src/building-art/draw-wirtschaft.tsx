// Stufenbilder der Wirtschaftsgebäude und der Kommandozentrale. s = Ausbauabschnitt 1 … 5.
import { G, Hall, Windows, Chimney, Tank, Sphere, Column, Crane, Lattice, Flag, Wall, Lamp, Fence, Ground, Crest, h, hd, p, ln, fine, red, type Draw } from "./parts.tsx";
import { SIEGEL, INK, MOOS } from "../icons-art.tsx";
import { Blink, Flicker, Smoke } from "./motion.tsx";

const lamps = (...xs: number[]) => xs.map((x) => <Lamp key={x} x={x} />);

const kommandozentrale: Draw = (s) => {
  const lit = s >= 5;
  const th = 24 + s * 5;
  const top = G - th;
  const rows = Math.max(1, Math.floor((th - 22) / 6) + 1);
  return (
    <>
      {s >= 3 && <Lattice x={52} ht={9 + s} w={3} base={top} />}
      {s >= 4 && <><Hall x={5} w={8} ht={22} roof="gable" fill="hd" /><Hall x={83} w={8} ht={22} roof="gable" fill="hd" /></>}
      {s >= 2 && <><Hall x={16} w={14} ht={13} roof="gable" /><Windows x={19} y={G - 9} cols={2} gap={5} lit={lit} /></>}
      {s >= 3 && <><Hall x={66} w={14} ht={13} roof="gable" /><Windows x={69} y={G - 9} cols={2} gap={5} lit={lit} /></>}
      <Hall x={28} w={40} ht={16} fill="h" />
      <Windows x={31} y={G - 12} cols={2} gap={4} lit={lit} />
      <Windows x={58} y={G - 12} cols={2} gap={4} lit={lit} />
      <Hall x={40} w={16} ht={th} />
      <Windows x={43.5} y={top + 5} cols={2} rows={rows} gap={6} lit={lit} />
      <path d={`M45 ${G} V${G - 7} H51 V${G}`} {...p} strokeWidth={1.2} />
      <Flag x={44} y={top} ht={11 + s} />
      {s >= 4 && <Wall x1={4} x2={44} ht={5} />}
      {s >= 4 && <Wall x1={52} x2={92} ht={5} />}
      {s >= 5 && <><Flag x={9} y={G - 22 - 2} ht={9} /><Flag x={87} y={G - 22 - 2} ht={9} /><Crest cx={48} cy={top + 2.5} r={2.2} />{lamps(34, 62)}</>}
      <Ground />
    </>
  );
};

const stahlwerk: Draw = (s) => {
  const lit = s >= 5;
  const x = 46 - 6 * s;
  const w = 22 + 8 * s;
  const end = x + w;
  const nCh = s >= 5 ? 3 : s >= 3 ? 2 : 1;
  return (
    <>
      {[0, 1, 2].slice(0, nCh).map((i) => <Chimney key={i} x={end - 9 - i * 11} ht={30 + 3 * s - i * 4} band={s >= 4} />)}
      {s >= 3 && (
        <>
          <path d={`M${x - 14} ${G} L${x - 12} ${G - 30} H${x - 4} L${x - 2} ${G} Z`} {...hd} />
          <path d={`M${x - 13} ${G - 30} V${G - 35} H${x - 3} V${G - 30}`} {...p} strokeWidth={1.2} />
        </>
      )}
      {s >= 4 && <path d={`M${x + 4} ${G - 14} L${x - 6} ${G - 32} M${x + 6} ${G - 14} L${x - 4} ${G - 32}`} {...ln} strokeWidth={1} />}
      <Hall x={x} w={w} ht={14} roof="saw" fill="h" />
      <Windows x={x + 3} y={G - 10} cols={Math.floor((w - 4) / 6)} gap={6} size={3.2} lit={lit} />
      {s >= 2 && <Hall x={end} w={10} ht={9} roof="shed" />}
      {s >= 5 && lamps(end + 13, x - 18)}
      <Ground x1={Math.min(4, x - 16)} />
    </>
  );
};

const raffinerie: Draw = (s) => {
  const nCol = Math.min(s, 3);
  const tanks = [{ x: 30, w: 16, ht: 14 }, { x: 12, w: 16, ht: 11 }, { x: 70, w: 12, ht: 9 }];
  const nTank = s >= 5 ? 3 : s >= 2 ? 2 : 1;
  const fh = 36 + 2 * s;
  return (
    <>
      {s >= 3 ? <Lattice x={88} ht={fh} w={6} /> : <path d={`M88 ${G} V${G - fh}`} {...ln} />}
      <Flicker ox={88} oy={G - fh - 1}><path d={`M88 ${G - fh - 1} c-3 -4 1 -6 0 -9 c3 3 4 6 0 9 Z`} {...red} /></Flicker>
      {[0, 1, 2].slice(0, nCol).map((i) => <Column key={i} x={52 + i * 8} ht={30 + 3 * s - i * 5} w={6 - i * 0.5} />)}
      {s >= 3 && <path d={`M28 ${G - 20} H52 M28 ${G - 20} V${G} M40 ${G - 20} V${G - 14} M52 ${G - 18} H${52 + nCol * 8}`} {...ln} strokeWidth={1.1} />}
      {tanks.slice(0, nTank).map((t) => <Tank key={t.x} {...t} />)}
      {s >= 4 && <Sphere cx={7} r={5.5} />}
      {s >= 4 && <Fence x1={50} x2={84} />}
      {s >= 5 && <><Chimney x={78} ht={24} w={4} band smoke={false} />{lamps(48, 66)}</>}
      <Ground x1={s >= 4 ? 1 : 10} />
    </>
  );
};

const chipfabrik: Draw = (s) => {
  const lit = s >= 5;
  const w = 30 + 9 * s;
  const x = 46 - w / 2;
  const ht = 14 + s;
  const top = G - ht;
  const nBox = s + 1;
  return (
    <>
      {s >= 5 && <Lattice x={x + w * 0.5} ht={14} w={4} base={top - 7} />}
      {s >= 3 && <Hall x={x + w * 0.3} w={w * 0.4} ht={7} y={top} />}
      {Array.from({ length: nBox }, (_, i) => (
        <rect key={i} x={x + 3 + (i * (w - 12)) / Math.max(1, nBox - 1)} y={top - 4} width={6} height={4} {...h} strokeWidth={1.1} />
      ))}
      <Hall x={x} w={w} ht={ht} />
      <path d={`M${x + 3} ${top + 5} H${x + w - 3} M${x + 3} ${top + 9} H${x + w - 3}`} {...fine} />
      {Array.from({ length: 3 + s }, (_, i) => (
        <Blink key={i} x={x + 6 + (i * (w - 12)) / (2 + s)} y={top + 7} r={0.8} when="producing" color={i % 3 ? MOOS : "#e8b64c"} period={1.1 + (i % 4) * 0.35} delay={-((i * 0.53) % 1.7)} hard />
      ))}
      {s >= 2 && <Windows x={x + 4} y={G - 6} cols={Math.floor((w - 8) / 7)} gap={7} size={3} lit={lit} />}
      {s >= 4 && <><Tank x={x + w + 2} w={7} ht={13} fill="p" />{s >= 5 && <Tank x={x - 9} w={7} ht={11} fill="p" />}</>}
      {s >= 5 && <Flag x={x + w * 0.3 + 2} y={top - 7} ht={9} />}
      <Ground />
    </>
  );
};

const versorgungshof: Draw = (s) => {
  const lit = s >= 5;
  const nSilo = s >= 5 ? 4 : s >= 4 ? 3 : s >= 3 ? 2 : 1;
  const sh = 22 + 2 * s;
  return (
    <>
      {s >= 4 && <><Lattice x={7} ht={20} w={7} /><Hall x={2} w={10} ht={8} y={G - 20} fill="h" /></>}
      {Array.from({ length: nSilo }, (_, i) => <Tank key={i} x={58 + i * 9} w={8} ht={sh - i * 2} fill={i % 2 ? "p" : "h"} />)}
      <Hall x={30} w={24} ht={12 + Math.min(s, 3)} roof="gable" />
      <path d={`M${42 - 6.7} ${G - 12 - Math.min(s, 3)} L42 ${G - 12 - Math.min(s, 3) - 6.7} L${42 + 6.7} ${G - 12 - Math.min(s, 3)}`} {...fine} />
      <path d={`M38 ${G} V${G - 8} H46 V${G} M38 ${G - 8} L46 ${G} M46 ${G - 8} L38 ${G}`} {...fine} />
      {s >= 3 && <Windows x={32} y={G - 10} cols={1} lit={lit} />}
      {s >= 3 && <Windows x={49} y={G - 10} cols={1} lit={lit} />}
      {s >= 2 && <><Hall x={13} w={16} ht={5} roof="arch" /><path d={`M17 ${G} V${G - 8} M21 ${G} V${G - 10} M25 ${G} V${G - 8}`} {...fine} strokeWidth={0.7} /></>}
      {s >= 3 && <Fence x1={2} x2={28} ht={3} />}
      {s >= 5 && <><Flag x={92} ht={18} />{lamps(55)}</>}
      <Ground x1={2} />
    </>
  );
};

/** Kühlturm (Hyperboloid). */
function Tower({ x, w, ht }: { x: number; w: number; ht: number }) {
  const t = G - ht;
  return (
    <>
      <path d={`M${x} ${G} C${x + w * 0.2} ${G - ht * 0.45} ${x + w * 0.2} ${t + ht * 0.25} ${x + w * 0.08} ${t} H${x + w * 0.92} C${x + w * 0.8} ${t + ht * 0.25} ${x + w * 0.8} ${G - ht * 0.45} ${x + w} ${G} Z`} {...h} />
      <Smoke x={x + w * 0.25} y={t - 2} d={`M${x + w * 0.25} ${t - 2} c-1 -4 4 -5 4 -8 c1 3 6 2 7 6`} />
    </>
  );
}

const kraftwerk: Draw = (s) => {
  const lit = s >= 5;
  const n = s >= 5 ? 3 : s >= 3 ? 2 : 1;
  const th = 26 + 3 * s;
  const hx = 4 + n * 16 + 4;
  const hw = 18 + 2 * s;
  return (
    <>
      {s >= 2 && <Chimney x={hx + hw - 7} ht={34 + 2 * s} w={4} smoke={false} band />}
      {Array.from({ length: n }, (_, i) => <Tower key={i} x={4 + i * 16} w={20} ht={th - (n - 1 - i) * 3} />)}
      <Hall x={hx} w={hw} ht={14} roof="shed" />
      <Windows x={hx + 3} y={G - 10} cols={Math.floor((hw - 4) / 5)} gap={5} lit={lit} />
      {s >= 4 && (
        <>
          <Lattice x={89} ht={30} w={8} />
          <path d={`M84 ${G - 26} H94 M86 ${G - 20} H92`} {...ln} strokeWidth={1} />
          <path d={`M84 ${G - 26} Q${(84 + hx + hw) / 2} ${G - 16} ${hx + hw} ${G - 14}`} {...fine} strokeWidth={0.7} />
        </>
      )}
      {s >= 5 && lamps(hx - 2)}
      <Ground x1={2} x2={94} />
    </>
  );
};

/** Lagerhaus mit Satteldach und zwei Toren. */
function Store({ x, ht }: { x: number; ht: number }) {
  return (
    <>
      <Hall x={x} w={24} ht={ht} roof="gable" />
      <path d={`M${x + 3} ${G} V${G - 7} H${x + 10} V${G} Z M${x + 14} ${G} V${G - 7} H${x + 21} V${G} Z`} {...h} strokeWidth={1.1} />
    </>
  );
}

const lagerkomplex: Draw = (s) => {
  const ht = 10 + s;
  const n = s >= 4 ? 3 : s >= 2 ? 2 : 1;
  const xs = [36, 10, 62].slice(0, n);
  return (
    <>
      {s >= 5 && <Crane x={88} ht={44} reach={22} dir={-1} />}
      {xs.map((x) => <Store key={x} x={x} ht={ht} />)}
      {s >= 3 && (
        <>
          <rect x={64} y={G - 5} width={10} height={5} {...hd} strokeWidth={1} />
          <rect x={74} y={G - 5} width={10} height={5} {...p} strokeWidth={1} />
          <rect x={68} y={G - 10} width={10} height={5} {...h} strokeWidth={1} />
          {s >= 4 && <rect x={84} y={G - 5} width={8} height={5} fill={SIEGEL} stroke={INK} strokeWidth={1} />}
        </>
      )}
      {s >= 4 && <Fence x1={2} x2={9} />}
      {s >= 5 && lamps(35, 61)}
      <Ground x1={2} x2={94} />
    </>
  );
};

export const WIRTSCHAFT: Record<string, Draw> = { kommandozentrale, stahlwerk, raffinerie, chipfabrik, versorgungshof, kraftwerk, lagerkomplex };
