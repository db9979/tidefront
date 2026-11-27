// Bewegte Gebäude: kleine, wiederverwendbare Bewegungs-Bausteine für die Stufenbilder (und die Hafen-Vignette).
//
// Grundsatz: Bewegt wird nur per CSS-Animation (transform, opacity; Keyframes „tf-…“ in styles.css), nie per
// React-State oder setInterval. React rendert nur neu, wenn sich der Spielzustand (Live) ändert.
// - Live-Zustand kommt über <LiveScope value={…}> (BuildingArt setzt ihn aus der Prop `live`). Ohne Live-Daten
//   (null, z. B. Handbuch, Vorschau „nach dem Ausbau“, Bauplan) zeigen alle Bausteine die ruhende Zeichnung wie bisher;
//   rein zusätzliche Teile (LEDs, Glanz, Ladebalken, Leuchtfeuer, Baukran) entfallen dann.
// - Jedes bewegte Element trägt die Klasse „tf-mv“: pausiert außerhalb des Bildschirms ([data-tf-off], IntersectionObserver
//   in index.tsx) und im verborgenen Tab (html.tf-hidden); bei prefers-reduced-motion steht alles still.
// - Statischer Ausgangszustand = Zeichnung ohne Animation. Teile, die ruhend unsichtbar sein sollen, haben opacity={0}
//   als Attribut (die Animation überschreibt es, bei reduzierter Bewegung bleibt es), z. B. der Glanz.
//
// Neue Zeichnung übernimmt die Bewegung so (Beispiel Elektrolyse / Seekabel):
//   <Smoke x={…} y={…} />                      Rauch/Dampf steigt, solange live.producing (schwächer bei Strommangel)
//   <Rotor cx cy>{Flügel}</Rotor>              dreht mit live.wind (Flaute/Sturmabschaltung: steht)
//   <Blink when="night" x y />                 Licht blinkt, wenn die Bedingung gilt (night | producing | training | building)
//   <Flicker ox oy>{Flamme}</Flicker>          flackert, solange produziert wird
//   <Turn cx when="radar">{Schüssel}</Turn>     dreht sich (scaleX), z. B. Antenne
//   <Bob when="training">{Haken}</Bob>         auf und ab (Kranhaken), <Flutter> für Wimpel, <Glint> für Glanz
//   <Smoke when="launch" …/>                   Dampf nach einem Satellitenstart (Startrampe, live.launch)
// Allgemeine Zusätze (Baukran bei laufendem Ausbau) setzt drawings.tsx für jedes Gebäude, ohne eigene Zeile.
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { INK, PAPER } from "../icons-art.tsx";

/** Spielzustand eines Gebäudes für die Bewegung. Alles optional; fehlende Werte = ruhend. */
export type Live = {
  /** Wind am Hafen 0 … 1. */
  wind?: number;
  /** Abschaltwind der Windparks (balance.buildings.windpark.stormCutoff). */
  windCut?: number;
  /** Tageslicht 0 … 1 (nachts 0). */
  daylight?: number;
  /** Bewölkung 0 … 1. */
  clouds?: number;
  /** Strommangel beim Gebäude (Produktion/Radar nicht voll versorgt). */
  powerShort?: boolean;
  /** Gebäude hat Stufe > 0 und arbeitet (produziert, Kraftwerk läuft). */
  producing?: boolean;
  /** Ausbildung läuft in diesem Gebäude. */
  training?: boolean;
  /** Ausbau dieses Gebäudes läuft gerade. */
  building?: boolean;
  /** Gebäude außer Betrieb (Sabotage). */
  disabled?: boolean;
  /** Speicherfüllstand 0 … 1 (Speicherwerk). */
  fill?: number;
  /** Startrampe: Start in der letzten halben Stunde (Dampf aus der Flammenrinne). */
  launch?: boolean;
};

const Ctx = createContext<Live | null>(null);
export const LiveScope = Ctx.Provider;
export const useLive = () => useContext(Ctx);

export type When = "night" | "producing" | "training" | "building" | "radar" | "sunny" | "launch";

/** Gilt die Bedingung im Live-Zustand? null = keine Live-Daten. */
export function active(l: Live | null, w: When): boolean {
  if (!l) return false;
  switch (w) {
    case "night": return l.daylight !== undefined && l.daylight < 0.2;
    case "sunny": return (l.daylight ?? 0) > 0.25 && (l.clouds ?? 1) < 0.45;
    case "producing": return !!l.producing && !l.disabled;
    case "training": return !!l.training;
    case "building": return !!l.building;
    case "radar": return !!l.producing && !l.disabled && !l.powerShort;
    case "launch": return !!l.launch;
  }
}

/** Ursprung einer CSS-Transformation in Bildkoordinaten (SVG-Nutzereinheiten). */
const at = (x: number, y: number): CSSProperties => ({ transformOrigin: `${x}px ${y}px` });

/**
 * Rauchfahne (gestrichelte Kringel) über (x, y). Ohne Live-Daten ruhend wie bisher; mit Live-Daten nur, wenn produziert
 * wird: zwei versetzte Schwaden steigen und verblassen, bei Strommangel stockend und blasser.
 */
export function Smoke({ x, y, d, when = "producing" }: { x: number; y: number; d?: string; when?: When }) {
  const l = useLive();
  const path = d ?? `M${x} ${y} c-2 -4 3 -5 2 -9 c-1 -3 3 -4 5 -6`;
  const fine = { fill: "none", stroke: INK, strokeWidth: 1.1, strokeLinecap: "round", strokeDasharray: "1.6 2.2" } as const;
  if (!l) return <path d={path} {...fine} />;
  if (!active(l, when)) return null;
  const weak = !!l.powerShort;
  const style = (delay: number): CSSProperties => ({
    animationDuration: weak ? "4.6s" : "3.2s",
    animationDelay: `${delay}s`,
    animationTimingFunction: weak ? "steps(5, end)" : "ease-out",
    ["--tf-op" as string]: weak ? 0.45 : 0.9,
  });
  return (
    <>
      <path d={path} {...fine} className="tf-mv tf-smoke" style={style(0)} />
      <path d={path} {...fine} className="tf-mv tf-smoke" style={style(weak ? -2.3 : -1.6)} />
    </>
  );
}

/** Rotor (Kinder = Flügel) um (cx, cy): dreht mit dem Wind; Flaute (< 0,06) und Sturmabschaltung stehen still. */
export function Rotor({ cx, cy, children, phase = 0 }: { cx: number; cy: number; children: ReactNode; phase?: number }) {
  const l = useLive();
  const w = l?.wind;
  const spin = w !== undefined && w >= 0.06 && w <= (l?.windCut ?? 1);
  if (!spin) return <g>{children}</g>;
  const dur = Math.max(1.4, 9 - 8 * w) * (1 + phase * 0.08);
  return <g className="tf-mv tf-spin" style={{ ...at(cx, cy), animationDuration: `${dur.toFixed(2)}s`, animationDelay: `${-phase * 0.7}s` }}>{children}</g>;
}

/** Warmes Licht bei (x, y), das blinkt, solange `when` gilt; sonst (und ohne Live-Daten) nicht gezeichnet. */
export function Blink({ x, y, r = 1.4, when, color = "#e8b64c", period = 2.4, delay = 0, hard = false }: { x: number; y: number; r?: number; when: When; color?: string; period?: number; delay?: number; hard?: boolean }) {
  const l = useLive();
  if (!active(l, when)) return null;
  return <circle cx={x} cy={y} r={r} fill={color} stroke={INK} strokeWidth={0.4} className="tf-mv tf-blink" style={{ animationDuration: `${period}s`, animationDelay: `${delay}s`, animationTimingFunction: hard ? "steps(1, end)" : "ease-in-out" }} />;
}

/** Wie Blink, aber für beliebige Kinder (z. B. Lichtkegel des Leuchtturms). */
export function BlinkGroup({ when, children, period = 2.4 }: { when: When; children: ReactNode; period?: number }) {
  const l = useLive();
  if (!active(l, when)) return null;
  return <g className="tf-mv tf-blink" style={{ animationDuration: `${period}s` }}>{children}</g>;
}

/** Flamme (Kinder) flackert um ihren Fuß (ox, oy), solange produziert wird; mit Live-Daten und ohne Betrieb erloschen. */
export function Flicker({ ox, oy, children }: { ox: number; oy: number; children: ReactNode }) {
  const l = useLive();
  if (!l) return <>{children}</>;
  if (!active(l, "producing")) return null;
  const weak = !!l.powerShort;
  return <g className="tf-mv tf-flicker" style={{ ...at(ox, oy), animationDuration: weak ? "1.6s" : "0.9s", opacity: weak ? 0.6 : 1 }}>{children}</g>;
}

/** Dreht Kinder um die senkrechte Achse durch cx (Seitenansicht: scaleX), solange `when` gilt. */
export function Turn({ cx, cy, when, children, period = 6 }: { cx: number; cy: number; when: When; children: ReactNode; period?: number }) {
  const l = useLive();
  if (!active(l, when)) return <g>{children}</g>;
  return <g className="tf-mv tf-turn" style={{ ...at(cx, cy), animationDuration: `${period}s` }}>{children}</g>;
}

/** Hebt und senkt Kinder um amp Einheiten (Kranhaken), solange `when` gilt. */
export function Bob({ when, children, amp = 4, period = 3.6 }: { when: When; children: ReactNode; amp?: number; period?: number }) {
  const l = useLive();
  if (!active(l, when)) return <g>{children}</g>;
  return <g className="tf-mv tf-bob" style={{ animationDuration: `${period}s`, ["--tf-amp" as string]: `${amp}px` }}>{children}</g>;
}

/** Wimpel (Kinder) flattert um den Mast (ox, oy), solange `when` gilt. */
export function Flutter({ ox, oy, when, children }: { ox: number; oy: number; when: When; children: ReactNode }) {
  const l = useLive();
  if (!active(l, when)) return <g>{children}</g>;
  return <g className="tf-mv tf-flutter" style={at(ox, oy)}>{children}</g>;
}

/** Leiser Glanzstreif (Pfad d in Papierweiß), nur tagsüber bei geringer Bewölkung. */
export function Glint({ d, delay = 0 }: { d: string; delay?: number }) {
  const l = useLive();
  if (!active(l, "sunny")) return null;
  return <path d={d} fill="none" stroke={PAPER} strokeWidth={1.3} strokeLinecap="round" opacity={0} className="tf-mv tf-glint" style={{ animationDelay: `${delay}s` }} />;
}

/** Kleiner Baukran am rechten Bildrand, solange der Ausbau läuft: Ausleger schwenkt, Haken hebt. */
export function BuildCrane() {
  const l = useLive();
  if (!active(l, "building")) return null;
  const x = 90;
  const top = 40;
  const k = { fill: "none", stroke: INK, strokeWidth: 0.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <g>
      <path d={`M${x - 1} 72 V${top} M${x + 1} 72 V${top} M${x - 1} 68 L${x + 1} 64 L${x - 1} 60 L${x + 1} 56 L${x - 1} 52 L${x + 1} 48 L${x - 1} 44`} {...k} />
      <g className="tf-mv tf-swing" style={at(x, top)}>
        <path d={`M${x + 4} ${top} H${x - 16} M${x} ${top - 3} L${x - 16} ${top} M${x} ${top - 3} L${x + 4} ${top}`} {...k} />
        <g className="tf-mv tf-bob" style={{ animationDuration: "3s", ["--tf-amp" as string]: "5px" }}>
          <path d={`M${x - 13} ${top} V${top + 9}`} {...k} strokeWidth={0.6} />
          <rect x={x - 15} y={top + 9} width={4} height={2.6} fill="url(#tf-hd)" stroke={INK} strokeWidth={0.6} />
        </g>
      </g>
    </g>
  );
}
