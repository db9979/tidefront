// Versorgung mit Strom (v1.6): Augenblick nach Quelle, Rangfolge der Verbraucher, Speicher, Stromkurve über 24 h
// und Wettervorhersage am Hafen. Kupferstich-Stil: Tinte, Schraffur, wenige Kennfarben.
import type { BaseData } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";
import { serverNow } from "../lib/time.ts";
import { Icon } from "../icons.tsx";
import { INK, MESSING, MOOS, SEE, SIEGEL } from "../icons-art.tsx";
import { Bar } from "../ui.tsx";

type Grid = BaseData["grid"];
type Hour = Grid["curve"][number];

const SOURCES = [
  { key: "kraftwerk", label: "Kraftwerk", icon: "kraftwerk", fill: "url(#tf-hd)" },
  { key: "wind", label: "Wind", icon: "windpark", fill: SEE },
  { key: "solar", label: "Sonne", icon: "solarfeld", fill: MESSING },
  { key: "storage", label: "Speicher", icon: "speicherwerk", fill: MOOS },
] as const;

const RANKS = [
  { key: "radar", label: "1 Radar" },
  { key: "production", label: "2 Produktion" },
  { key: "training", label: "3 Ausbildung" },
  { key: "research", label: "4 Forschung" },
] as const;

/** Volle Stunde in Ortszeit des Geräts. */
function hourOf(ms: number): number {
  return new Date(ms - (serverNow() - Date.now())).getHours();
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
const pct = (x: number) => `${Math.round(x * 100)} %`;

export function PowerGrid({ base }: { base: BaseData }) {
  const g = base.grid;
  const supply = sum(g.now.supply);
  const demand = sum(g.now.demand);
  const short = g.now.served.radar < 1 || g.now.served.production < 1;
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-baseline">
        <span className="flex items-center gap-1"><Icon id="strom" size={16} /> Strom jetzt</span>
        <span className={`mono ${short ? "text-red-300" : ""}`}>Bedarf {fmtNum(demand)} / Angebot {fmtNum(supply)}</span>
      </div>
      <div className="grid grid-cols-4 gap-1 text-center">
        {SOURCES.map((s) => (
          <div key={s.key} className="rounded-lg border border-rule bg-paper py-1">
            <Icon id={s.icon} size={26} />
            <div className="text-[10px] text-ink2 leading-tight">{s.label}</div>
            <div className="mono text-xs">{fmtNum(g.now.supply[s.key])}</div>
          </div>
        ))}
      </div>
      {g.now.capacity > 0 && (
        <div>
          <div className="flex justify-between text-xs text-ink2">
            <span>Speicher {fmtNum(g.now.stored)} / {fmtNum(g.now.capacity)}</span>
            <span className="mono">{g.now.charge > 0.5 ? `lädt ${fmtNum(g.now.charge)}/h` : g.now.charge < -0.5 ? `liefert ${fmtNum(-g.now.charge)}/h` : "ruht"}</span>
          </div>
          <Bar value={g.now.stored / g.now.capacity} tone="green" />
        </div>
      )}
      {g.now.throttle < 0.999 && (
        <p className="text-xs text-red-300">Kein Treibstoff: Das Kraftwerk läuft nur mit {pct(g.now.throttle)} (verbrennt, was nachkommt).</p>
      )}
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-xs">
        {RANKS.map((r) => (
          <div key={r.key} className="contents">
            <span className="text-ink2">{r.label}</span>
            <span className="mono text-right">{fmtNum(g.now.demand[r.key])}</span>
            <span className={`mono text-right ${g.now.demand[r.key] > 0 && g.now.served[r.key] < 0.999 ? "text-red-300" : "text-moos"}`}>
              {g.now.demand[r.key] > 0 ? pct(g.now.served[r.key]) : "–"}
            </span>
          </div>
        ))}
      </div>
      {g.warning ? (
        <p className="text-xs text-red-300 font-semibold" role="status">
          {g.warning.atMs - serverNow() < 3600000 ? "Jetzt" : `Ab ${hourOf(g.warning.atMs)} Uhr`} fehlen {fmtNum(g.warning.missing)} Strom – {g.warning.text}
        </p>
      ) : (
        <p className="text-xs text-moos">Die nächsten {g.curve.length} Stunden reicht der Strom.</p>
      )}
      <Curve curve={g.curve} />
      <Forecast curve={g.curve} stormFrom={g.stormFrom} />
    </div>
  );
}

/** Stromkurve: Angebot gestapelt nach Quelle (Balken je Stunde), Bedarf als Treppenlinie, Speicherstand gestrichelt. */
function Curve({ curve }: { curve: Hour[] }) {
  const W = 340;
  const H = 120;
  const n = curve.length;
  if (n === 0) return null;
  const max = Math.max(1, ...curve.map((h) => Math.max(sum(h.supply), sum(h.demand))));
  const maxStore = Math.max(1, ...curve.map((h) => h.stored));
  const bw = W / n;
  const y = (v: number) => H - (v / max) * (H - 8);
  let demandPath = "";
  curve.forEach((h, i) => {
    const d = y(sum(h.demand));
    demandPath += `${i === 0 ? "M" : "L"}${i * bw} ${d} H${(i + 1) * bw} `;
  });
  const storePath = curve.map((h, i) => `${i === 0 ? "M" : "L"}${(i + 0.5) * bw} ${H - (h.stored / maxStore) * (H - 8) * 0.9}`).join(" ");
  return (
    <figure className="m-0">
      <svg viewBox={`0 -2 ${W} ${H + 16}`} className="w-full h-auto" role="img" aria-label="Stromkurve der nächsten 24 Stunden">
        {curve.map((h, i) => {
          let acc = 0;
          return (
            <g key={h.atMs}>
              {SOURCES.map((s) => {
                const v = h.supply[s.key];
                if (v <= 0) return null;
                const top = y(acc + v);
                const r = <rect key={s.key} x={i * bw + 0.6} y={top} width={bw - 1.2} height={y(acc) - top} fill={s.fill} stroke={INK} strokeWidth={0.3} />;
                acc += v;
                return r;
              })}
              {h.storm && <path d={`M${(i + 0.5) * bw - 3} 2 l3 4 l-2 0 l3 4`} stroke={SIEGEL} strokeWidth={1.2} fill="none" />}
            </g>
          );
        })}
        <path d={demandPath} fill="none" stroke={SIEGEL} strokeWidth={1.6} />
        <path d={storePath} fill="none" stroke={MOOS} strokeWidth={1.2} strokeDasharray="3 2" />
        <path d={`M0 ${H} H${W}`} stroke={INK} strokeWidth={0.8} />
        {curve.map((h, i) => (i % 6 === 0 ? <text key={h.atMs} x={i * bw + 1} y={H + 11} fontSize={9} fill={INK} className="mono">{hourOf(h.atMs)} Uhr</text> : null))}
      </svg>
      <figcaption className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink2">
        {SOURCES.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <svg width="10" height="10" aria-hidden="true"><rect width="10" height="10" fill={s.fill} stroke={INK} strokeWidth={0.6} /></svg>{s.label}
          </span>
        ))}
        <span className="flex items-center gap-1"><svg width="14" height="6" aria-hidden="true"><path d="M0 3 H14" stroke={SIEGEL} strokeWidth={1.6} /></svg>Bedarf</span>
        <span className="flex items-center gap-1"><svg width="14" height="6" aria-hidden="true"><path d="M0 3 H14" stroke={MOOS} strokeWidth={1.2} strokeDasharray="3 2" /></svg>Speicherstand</span>
      </figcaption>
    </figure>
  );
}

function weatherIcon(h: Hour, stormFrom: number): string {
  if (h.storm || h.wind >= stormFrom) return "sturm";
  if (h.fog >= 0.35) return "nebel";
  if (h.clouds >= 0.55) return "wolke";
  if (h.daylight > 0.05) return "sonne";
  return h.wind >= 0.5 ? "wind" : "wolke";
}

/** Wettervorhersage am Hafen alle drei Stunden: Wind, Sonne, Bewölkung, Nebel; Sturmwarnung. */
function Forecast({ curve, stormFrom }: { curve: Hour[]; stormFrom: number }) {
  const slots = curve.filter((_, i) => i % 3 === 0);
  const storm = curve.find((h) => h.storm);
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink2 mb-1 font-display">Wetter am Hafen</div>
      {storm && <p className="text-xs text-red-300 font-semibold mb-1">Sturmwarnung ab {hourOf(storm.atMs)} Uhr: Schiffe langsamer, reine Luftmissionen starten nicht, Windparks schalten über Orkanstärke ab.</p>}
      <div className="grid grid-cols-8 gap-0.5 text-center text-[10px]">
        {slots.map((h) => (
          <div key={h.atMs} className="rounded border border-rule bg-paper py-0.5">
            <div className="mono">{hourOf(h.atMs)}h</div>
            <Icon id={weatherIcon(h, stormFrom)} size={22} />
            <div className="mono" title="Wind">{Math.round(h.wind * 100)}</div>
            <div className="mono text-ink2" title="Bewölkung">{Math.round(h.clouds * 100)}</div>
          </div>
        ))}
      </div>
      <p className="text-[10.5px] text-ink2 mt-0.5">Zeilen: Wind und Bewölkung in Prozent. Nebel kürzt die Radar-Vorwarnzeit und trübt Aufklärung.</p>
    </div>
  );
}
