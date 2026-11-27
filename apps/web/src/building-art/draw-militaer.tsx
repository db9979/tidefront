// Stufenbilder der Militär-, Schutz- und Führungsbauten. s = Ausbauabschnitt 1 … 5.
import { G, Hall, Windows, Crane, Lattice, Flag, Wall, Lamp, Fence, Dish, Ground, Crest, WATER, LIGHT, h, hd, p, ln, fine, red, type Draw } from "./parts.tsx";
import { INK, PAPER, SIEGEL, SEE } from "../icons-art.tsx";
import { Blink, BlinkGroup, Flutter, Turn, active, useLive } from "./motion.tsx";

const lamps = (...xs: number[]) => xs.map((x) => <Lamp key={x} x={x} />);

const tiefbunker: Draw = (s) => {
  const w = 30 + 10 * s;
  const ht = 12 + 3 * s;
  const x1 = 48 - w / 2;
  const x2 = 48 + w / 2;
  const dw = 10 + s;
  const dh = 9 + s;
  const vents = s >= 2 ? [-1, 1].flatMap((k) => (s >= 4 ? [k * w * 0.18, k * w * 0.3] : [k * w * 0.22])) : [];
  return (
    <>
      {s >= 5 && (
        <>
          <path d={`M46 ${G - ht - 4} L39 ${G - ht - 13} M50 ${G - ht - 4} L57 ${G - ht - 13}`} {...ln} strokeWidth={1.6} />
          <path d={`M41 ${G - ht + 1} Q48 ${G - ht - 9} 55 ${G - ht + 1} Z`} {...p} />
        </>
      )}
      {vents.map((dx) => <rect key={dx} x={48 + dx - 2} y={G - ht * (1 - (dx / (w / 2)) ** 2) - 4} width={4} height={5} {...p} strokeWidth={1} />)}
      <path d={`M${x1} ${G} Q48 ${G - 2 * ht} ${x2} ${G} Z`} {...h} />
      {s >= 3 && <path d={`M${48 - dw / 2 - 3} ${G} V${G - dh + 2} Q48 ${G - dh - 5} ${48 + dw / 2 + 3} ${G - dh + 2} V${G}`} {...hd} strokeWidth={1.2} />}
      <path d={`M${48 - dw / 2} ${G} V${G - dh + 3} Q48 ${G - dh - 2} ${48 + dw / 2} ${G - dh + 3} V${G} Z`} {...p} />
      <path d={`M48 ${G - dh + 1} V${G}${s >= 3 ? ` M${48 - dw / 2 + 1} ${G - 4} H${48 + dw / 2 - 1}` : ""}`} {...fine} />
      {s >= 5 && <Flag x={70} y={G - ht * (1 - (22 / (w / 2)) ** 2)} ht={10} />}
      {s >= 4 && <><Wall x1={x1 - 2} x2={48 - dw / 2 - 5} ht={4} /><Wall x1={48 + dw / 2 + 5} x2={x2 + 2} ht={4} /></>}
      {s >= 5 && <>{lamps(48 - dw / 2 - 2, 48 + dw / 2 + 2)}</>}
      <Ground x1={Math.max(1, x1 - 3)} x2={Math.min(95, x2 + 3)} />
    </>
  );
};

const werft: Draw = (s) => {
  const lit = s >= 5;
  const hw = 26 + 8 * s;
  const hx = 48 - hw / 2;
  const deck = G - 5;
  return (
    <>
      {s >= 2 && <><Hall x={68} w={26} ht={14 + s} roof="arch" fill="h" /><path d={`M73 ${G} V${G - 9} H89 V${G}`} {...p} strokeWidth={1.1} /></>}
      {s >= 5 ? <Crane x={50} ht={52} reach={26} dir={-1} base={G - 1} work="training" /> : null}
      <Crane x={9} ht={32 + 3 * s} reach={16 + 2 * s} work="training" />
      {s >= 3 && <Crane x={84} ht={32 + 3 * s} reach={14 + 2 * s} dir={-1} work="training" />}
      {/* Schiff im Dock */}
      {s >= 2 && <path d={`M${48 + hw * 0.1} ${deck} V${deck - 6 - s} H${48 + hw * 0.32} V${deck} Z`} {...p} strokeWidth={1.3} />}
      {s >= 2 && <Windows x={48 + hw * 0.1 + 2} y={deck - 5 - s} cols={Math.max(1, Math.floor((hw * 0.22 - 3) / 4))} gap={4} size={2} lit={lit} />}
      {s >= 3 && <path d={`M${48 + hw * 0.2} ${deck - 6 - s} V${deck - 16 - 2 * s} M${48 + hw * 0.2 - 3} ${deck - 12 - 2 * s} H${48 + hw * 0.2 + 3}`} {...ln} strokeWidth={1.1} />}
      {s >= 4 && <path d={`M${48 - hw * 0.05} ${deck} L${48 - hw * 0.04} ${deck - 9} H${48 + hw * 0.05} L${48 + hw * 0.06} ${deck} Z`} {...hd} strokeWidth={1.2} />}
      {s >= 5 && <path d={`M${48 - hw * 0.32} ${deck - 2} H${48 - hw * 0.18} M${48 - hw * 0.3} ${deck - 2} L${48 - hw * 0.42} ${deck - 4}`} {...ln} strokeWidth={1.4} />}
      <path d={`M${hx} ${deck} H${hx + hw} L${hx + hw - 6} ${G + 2} H${hx + 6} Z`} {...h} />
      {s >= 5 && <Flag x={48 + hw * 0.2} y={deck - 16 - 2 * s} ht={5} wide={5} />}
      <path d={`M1 ${G} H18 M78 ${G} H95`} {...ln} strokeWidth={1.3} />
      {s >= 4 && lamps(16, 80)}
      {WATER}
    </>
  );
};

const kaserne: Draw = (s) => {
  const lit = s >= 5;
  const w = 28 + 6 * s;
  const x = 48 - w / 2;
  const ht = 11 + s;
  const end = x + w;
  return (
    <>
      {s >= 3 && <Hall x={x - 6} w={26} ht={ht + 3} roof="gable" fill="h" />}
      {s >= 2 && <Flag x={end + 4} ht={22 + s} wide={8} flutter="training" />}
      <Hall x={x} w={w} ht={ht} roof="gable" />
      <path d={`M${x} ${G - ht} L${x + w / 2} ${G - ht - w * 0.28} L${end} ${G - ht} L${end - 3} ${G - ht + 1.5} L${x + w / 2} ${G - ht - w * 0.28 + 3} L${x + 3} ${G - ht + 1.5} Z`} {...h} strokeWidth={1.2} />
      <Windows x={x + 4} y={G - ht + 4} cols={Math.floor((w / 2 - 8) / 5)} gap={5} size={3} lit={lit} />
      <Windows x={x + w / 2 + 5} y={G - ht + 4} cols={Math.floor((w / 2 - 8) / 5)} gap={5} size={3} lit={lit} />
      <path d={`M${x + w / 2 - 3} ${G} V${G - 7} H${x + w / 2 + 3} V${G}`} {...p} strokeWidth={1.2} />
      {s >= 4 && (
        <>
          <Lattice x={88} ht={24} w={7} />
          <Hall x={83} w={10} ht={6} y={G - 24} roof="gable" fill="hd" />
          <Wall x1={2} x2={x + w / 2 - 5} ht={4} />
          <Wall x1={x + w / 2 + 5} x2={82} ht={4} />
        </>
      )}
      {s >= 5 && <><Lattice x={6} ht={24} w={7} /><Hall x={1} w={10} ht={6} y={G - 24} roof="gable" fill="hd" /><Crest cx={x + w / 2} cy={G - ht - 3} r={2.4} /></>}
      <Ground x1={1} x2={95} />
    </>
  );
};

const flugfeld: Draw = (s) => {
  const n = s >= 5 ? 3 : s >= 3 ? 2 : 1;
  const xs = [32, 6, 58].slice(0, n);
  const half = 22 + 5 * s;
  return (
    <>
      {s >= 2 && (
        <>
          <path d={`M87 ${G} V${G - 24 - s} H92 V${G} Z`} {...p} strokeWidth={1.3} />
          <path d={`M84.5 ${G - 24 - s} V${G - 30 - s} H94.5 V${G - 24 - s} Z`} {...hd} strokeWidth={1.2} />
          <path d={`M89.5 ${G - 30 - s} V${G - 35 - s}`} {...fine} />
          {s >= 4 && <Flutter ox={89.5} oy={G - 33.5 - s} when="training"><path d={`M89.5 ${G - 35 - s} L95 ${G - 33.5 - s} L89.5 ${G - 32 - s}`} {...red} /></Flutter>}
          {s < 4 && <Blink x={89.5} y={G - 35.5 - s} r={1} when="training" color={SIEGEL} period={1.6} hard />}
        </>
      )}
      {xs.map((x) => (
        <g key={x}>
          <Hall x={x} w={26} ht={8} roof="arch" fill="h" />
          <path d={`M${x + 6} ${G} V${G - 8} Q${x + 13} ${G - 16} ${x + 20} ${G - 8} V${G} Z`} {...p} strokeWidth={1.1} />
        </g>
      ))}
      <rect x={48 - half} y={G} width={half * 2} height={3} fill={INK} />
      <path d={Array.from({ length: Math.floor(half / 4) }, (_, i) => `M${48 - half + 3 + i * 8} ${G + 1.5} h4`).join("")} stroke={PAPER} strokeWidth={1} />
      <Blink x={48 - half + 1.5} y={G - 1.2} r={1.1} when="training" period={1.8} hard />
      <Blink x={48 + half - 1.5} y={G - 1.2} r={1.1} when="training" period={1.8} delay={-0.9} hard />
      {s >= 5 && Array.from({ length: 7 }, (_, i) => <circle key={i} cx={48 - half + 2 + (i * (half * 2 - 4)) / 6} cy={G - 1.2} r={1.1} fill={LIGHT} stroke={INK} strokeWidth={0.5} />)}
    </>
  );
};

/** Funkwellen (Seeblau); mit Live-Daten nur bei laufendem Radar, dann leise pulsierend. */
function Waves({ x, y, n }: { x: number; y: number; n: number }) {
  const l = useLive();
  if (l && !active(l, "radar")) return null;
  const path = <path d={Array.from({ length: n }, (_, i) => `M${x + 3 + i * 4} ${y - 3 - i * 2} a${5 + i * 4} ${5 + i * 4} 0 0 1 ${3 + i} ${6 + i * 3}`).join("")} fill="none" stroke={SEE} strokeWidth={1.2} strokeLinecap="round" />;
  return l ? <g className="tf-mv tf-blink" style={{ animationDuration: "3s" }}>{path}</g> : path;
}

const radarstation: Draw = (s) => {
  const th = 22 + 5 * s;
  const top = G - th;
  return (
    <>
      {s >= 5 && <><Lattice x={10} ht={56} w={7} /><circle cx={10} cy={G - 57} r={1.6} fill={SIEGEL} stroke={INK} strokeWidth={0.6} /></>}
      {s >= 3 && <><path d={`M22 ${G} V${G - 14}`} {...ln} /><Dish cx={22} y={G - 16} r={6 + (s >= 4 ? 1 : 0)} tilt={25} /></>}
      <Lattice x={46} ht={th} w={10} />
      <Turn cx={46} cy={top - 2} when="radar"><Dish cx={46} y={top - 2} r={9 + s} /></Turn>
      <Waves x={46 + 4 + s} y={top - 6} n={Math.min(3, 1 + Math.floor(s / 2))} />
      {s >= 2 && <><Hall x={52} w={14} ht={8} fill="h" /><Windows x={55} y={G - 6} cols={2} gap={5} lit={s >= 5} /></>}
      {s >= 4 && (
        <>
          <Hall x={70} w={18} ht={8} />
          <path d={`M71 ${G - 8} A8 8 0 0 1 87 ${G - 8} Z`} {...p} />
          <path d={`M74 ${G - 12} Q79 ${G - 15} 84 ${G - 12} M71.5 ${G - 9.5} H86.5`} {...fine} strokeWidth={0.7} />
        </>
      )}
      {s >= 3 && <Fence x1={s >= 5 ? 15 : 28} x2={50} />}
      {s >= 5 && lamps(68, 92)}
      <Ground />
    </>
  );
};

const hafenkommandantur: Draw = (s) => {
  const lit = s >= 5;
  const ht = 13 + s;
  const lh = 26 + 4 * s;
  const lt = G - lh;
  let bands = "";
  for (let y = lt + 8; y < G - 4; y += 9) bands += `M54.6 ${y} H61.4`;
  return (
    <>
      {s >= 3 && <path d={`M63 ${lt - 3} L90 ${lt - 10} M63 ${lt - 2} L90 ${lt + 5}`} stroke={INK} strokeWidth={0.6} strokeDasharray="2 2" />}
      {s >= 4 && <Crane x={86} ht={30} reach={18} dir={-1} />}
      {s >= 3 && <><Hall x={3} w={14} ht={10} roof="gable" /><Windows x={6} y={G - 7} cols={2} gap={5} lit={lit} /></>}
      <Hall x={16} w={34} ht={ht} />
      <path d={`M12 ${G - ht} L33 ${G - ht - 12} L54 ${G - ht} Z`} {...h} />
      <Windows x={20} y={G - ht + 4} cols={2} gap={6} size={3} lit={lit} />
      <Windows x={38} y={G - ht + 4} cols={2} gap={6} size={3} lit={lit} />
      <path d={`M29 ${G} V${G - 8} H37 V${G}`} {...p} strokeWidth={1.2} />
      <path d={`M54 ${G} L55 ${lt} H61 L62 ${G} Z`} {...p} />
      <path d={bands} stroke={SIEGEL} strokeWidth={2.6} />
      <path d={`M52.5 ${lt} H63.5 L62 ${lt - 5} H54 Z`} {...hd} strokeWidth={1.2} />
      <path d={`M58 ${lt - 5} V${lt - 8}`} {...ln} strokeWidth={1.1} />
      <BlinkGroup when="night" period={3.2}>
        <path d={`M63 ${lt - 3} L94 ${lt - 11} V${lt + 6} L63 ${lt - 1.5} Z`} fill={LIGHT} opacity={0.35} />
      </BlinkGroup>
      <Blink x={58} y={lt - 2.5} r={2.2} when="night" period={3.2} />
      {s >= 2 && <path d={`M62 ${G - 1} H94 M66 ${G - 1} V${G + 4} M74 ${G - 1} V${G + 4} M82 ${G - 1} V${G + 4} M90 ${G - 1} V${G + 4}`} {...ln} strokeWidth={1.3} />}
      {s >= 5 && <><Flag x={92} y={G - 1} ht={14} /><Crest cx={33} cy={G - ht - 5} r={2.2} /><Lamp x={70} /></>}
      <path d={`M1 ${G} H62`} {...ln} strokeWidth={1.3} />
      {WATER}
    </>
  );
};

const forschungsamt: Draw = (s) => {
  const lit = s >= 5;
  const w = 32 + 7 * s;
  const x = 46 - w / 2;
  const ht = 13 + s;
  const top = G - ht;
  const r = 8 + s;
  return (
    <>
      {s >= 3 && <><Lattice x={x + w - 5} ht={12 + 2 * s} w={4} base={top} /><circle cx={x + w - 5} cy={top - 13 - 2 * s} r={1.3} fill={SIEGEL} stroke={INK} strokeWidth={0.5} /></>}
      <path d={`M46 ${top - r * 0.6} L${46 + r + 4} ${top - r - 8}`} {...ln} strokeWidth={2.6} />
      <path d={`M${46 - r} ${top} A${r} ${r} 0 0 1 ${46 + r} ${top} Z`} {...h} />
      {s >= 4 && <path d={`M${x + 4} ${top} A6 6 0 0 1 ${x + 16} ${top} Z`} {...hd} strokeWidth={1.2} />}
      <Hall x={x} w={w} ht={ht} />
      <Windows x={x + 4} y={top + 4} cols={Math.floor((w / 2 - 9) / 5)} gap={5} size={3} lit={lit} />
      <Windows x={46 + 6} y={top + 4} cols={Math.floor((w / 2 - 9) / 5)} gap={5} size={3} lit={lit} />
      <path d={`M42 ${G} V${G - 8} H50 V${G}`} {...p} strokeWidth={1.2} />
      {s >= 2 && <path d={`M${x + 2} ${top + 0.5} H${x + w - 2}`} {...fine} strokeDasharray="1 1.5" />}
      {s >= 5 && <><Dish cx={x - 4} y={G - 10} r={5} tilt={-35} /><path d={`M${x - 4} ${G} V${G - 9}`} {...ln} strokeWidth={1.1} /><Flag x={x + 10} y={top - 6} ht={8} />{lamps(x + w + 3)}</>}
      <Ground />
    </>
  );
};

export const MILITAER: Record<string, Draw> = { tiefbunker, werft, kaserne, flugfeld, radarstation, hafenkommandantur, forschungsamt };
