// Versorgung mit Strom (v1.6): Augenblick nach Quelle, Rangfolge der Verbraucher, Speicher, Stromkurve über 24 h
// und Wettervorhersage am Hafen. Kupferstich-Stil: Tinte, Schraffur, wenige Kennfarben.
// v1.18: Kurve und Wetter sind eine Vorhersage mit Spannbreite (Band um das Angebot, Wind von–bis).
// v1.21: Seekabel als Quelle, Verwendung des Überschusses (→ Treibstoff, → Partner, verfällt), Ökostrom-Anteil.
import type React from "react";
import { BEAUFORT_WORDS, beaufort } from "@tidefront/game-core";
import type { BaseData } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";
import { serverNow } from "../lib/time.ts";
import { Icon } from "../icons.tsx";
import { INK, MESSING, MOOS, SEE, SIEGEL } from "../icons-art.tsx";
import { Bar } from "../ui.tsx";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { BuildingArt } from "../building-art/index.tsx";
import { buildingLive } from "../lib/live-art.ts"; // Bewegte Gebäude: dieselben Zeichnungen wie auf der Basis

type Grid = BaseData["grid"];
type Hour = Grid["curve"][number];

const SOURCES = [
  { key: "kraftwerk", label: "Kraftwerk", icon: "kraftwerk", fill: "url(#tf-hd)" },
  { key: "wind", label: "Wind", icon: "windpark", fill: SEE },
  { key: "solar", label: "Sonne", icon: "solarfeld", fill: MESSING },
  { key: "storage", label: "Speicher", icon: "speicherwerk", fill: MOOS },
  { key: "cable", label: "Kabel", icon: "seekabel", fill: "url(#tf-h)" },
] as const;

/** Verwendung des Überschusses (v1.21). */
const SURPLUS = [
  { key: "fuel", label: "→ Treibstoff", fill: SIEGEL, opacity: 0.55 },
  { key: "cable", label: "→ Partner", fill: SEE, opacity: 0.55 },
  { key: "wasted", label: "verfällt", fill: INK, opacity: 0.2 },
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

/** Uhrzeit hh:mm in Ortszeit des Geräts. */
function clockOf(ms: number): string {
  return new Date(ms - (serverNow() - Date.now())).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Gebäude-Zeichnung je Stromquelle (bewegt nach Zustand), sonst das Symbol. */
const SOURCE_ART: Record<string, string> = { kraftwerk: "kraftwerk", wind: "windpark", solar: "solarfeld", storage: "speicherwerk", cable: "seekabel" };

function SourceArt({ base, k, icon, windCut }: { base: BaseData; k: string; icon: string; windCut?: number }) {
  const id = SOURCE_ART[k];
  const level = id ? base.buildings.find((b) => b.id === id)?.level ?? 0 : 0;
  if (!id || level <= 0) return <Icon id={icon} size={26} />;
  // Fester Rahmen: alle Zeichnungen stehen auf derselben Grundlinie, gleich welches Seitenverhältnis.
  return (
    <span className="flex h-11 items-end justify-center overflow-hidden">
      <BuildingArt id={id} level={level} size={62} live={buildingLive(base, id, level, serverNow(), windCut)} />
    </span>
  );
}

/** Wetter-Symbol mit leiser Bewegung je Lage (Sonne dreht, Wolken ziehen, Mond glimmt, Sturm rüttelt). */
function WeatherGlyph({ id, i }: { id: string; i: number }) {
  return (
    <span className={`inline-block tf-mv tf-wx-${id}`} style={{ animationDelay: `${-(i * 0.7).toFixed(1)}s` }}>
      <Icon id={id} size={22} />
    </span>
  );
}

export function PowerGrid({ base }: { base: BaseData }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const windCut = (meta.data?.balance as { buildings?: { windpark?: { stormCutoff?: number } } } | undefined)?.buildings?.windpark?.stormCutoff;
  const g = base.grid;
  const supply = sum(g.now.supply);
  const demand = sum(g.now.demand);
  const short = g.now.served.radar < 1 || g.now.served.production < 1;
  // Kabel-Kachel nur, wenn der Hafen Strom aus einem Kabel bezieht (sonst bleibt es bei vier Quellen).
  const sources = SOURCES.filter((x) => x.key !== "cable" || g.green?.cable?.role === "in" || g.now.supply.cable > 0);
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-baseline">
        <span className="flex items-center gap-1"><Icon id="strom" size={16} /> Strom jetzt</span>
        <span className={`mono ${short ? "text-red-300" : ""}`}>Bedarf {fmtNum(demand)} / Angebot {fmtNum(supply)}</span>
      </div>
      <div className={`grid ${sources.length > 4 ? "grid-cols-5" : "grid-cols-4"} gap-1 text-center`}>
        {sources.map((s) => (
          <div key={s.key} className="rounded-lg border border-rule bg-paper py-1">
            <SourceArt base={base} k={s.key} icon={s.icon} windCut={windCut} />
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
      <SurplusNow g={g} />
      <GreenLine g={g} />
      {g.now.fuelLimited ? (
        <p className="text-xs text-red-300">Kein Treibstoff: Das Kraftwerk läuft nur mit {pct(g.now.throttle)} (verbrennt, was nachkommt).</p>
      ) : g.now.supply.kraftwerk > 0.5 || g.now.throttle < 0.999 ? (
        <p className="text-xs text-ink2">Kraftwerk regelt nach: {pct(g.now.throttle)} Auslastung, {fmtNum(g.now.fuelPerHour)} Treibstoff/h – es deckt nur, was Ökostrom und Speicher offen lassen.</p>
      ) : null}
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
          {g.warning.atMs - serverNow() < 60000 ? "Jetzt" : `Voraussichtlich ab ${hourOf(g.warning.atMs)} Uhr`} fehlen {fmtNum(g.warning.missing)} Strom – {g.warning.text}
        </p>
      ) : (
        <p className="text-xs text-moos">Die nächsten {g.curve.length} Stunden reicht der Strom voraussichtlich.</p>
      )}
      <Curve curve={g.curve} sources={sources} />
      <SurplusAhead curve={g.curve} />
      {g.forecast && (
        <p className="text-[10.5px] text-ink2">
          Vorhersage: je weiter voraus, desto unsicherer (alle {g.forecast.issuedEveryHours} h neu).
          {g.forecast.skill < 0.999 ? ` Funkmesstechnik und Radar: Unsicherheit −${Math.round((1 - g.forecast.skill) * 100)} %.` : " Funkmesstechnik und Radarstation machen sie genauer."}
        </p>
      )}
      <Forecast g={g} />
    </div>
  );
}

/** Stromkurve: Angebot gestapelt nach Quelle (Balken je Stunde), Bedarf als Treppenlinie, Speicherstand gestrichelt. */
function Curve({ curve, sources }: { curve: Hour[]; sources: readonly (typeof SOURCES)[number][] }) {
  const W = 340;
  const H = 120;
  const n = curve.length;
  if (n === 0) return null;
  const max = Math.max(1, ...curve.map((h) => Math.max(sum(h.supply), sum(h.demand), h.supplyHigh)));
  const maxStore = Math.max(1, ...curve.map((h) => h.stored));
  const bw = W / n;
  const y = (v: number) => H - (v / max) * (H - 8);
  let demandPath = "";
  curve.forEach((h, i) => {
    const d = y(sum(h.demand));
    demandPath += `${i === 0 ? "M" : "L"}${i * bw} ${d} H${(i + 1) * bw} `;
  });
  // Spannbreite des Angebots (Wind und Sonne von schlecht bis gut) als Band über den Balken.
  const bandTop = curve.map((h, i) => `${i === 0 ? "M" : "L"}${i * bw} ${y(h.supplyHigh)} H${(i + 1) * bw}`).join(" ");
  const bandBottom = [...curve].reverse().map((h, j) => `L${(n - j) * bw} ${y(h.supplyLow)} H${(n - j - 1) * bw}`).join(" ");
  const storePath = curve.map((h, i) => `${i === 0 ? "M" : "L"}${(i + 0.5) * bw} ${H - (h.stored / maxStore) * (H - 8) * 0.9}`).join(" ");
  return (
    <figure className="m-0">
      <svg viewBox={`0 -2 ${W} ${H + 19}`} className="w-full h-auto" role="img" aria-label="Stromkurve der nächsten 24 Stunden (Vorhersage mit Spannbreite)">
        {curve.map((h, i) => {
          let acc = 0;
          return (
            <g key={h.atMs}>
              {sources.map((s) => {
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
        <path d={`${bandTop} ${bandBottom} Z`} fill={INK} fillOpacity={0.13} stroke={INK} strokeWidth={0.6} strokeDasharray="1.5 1.5" data-testid="strom-band" />
        <path d={demandPath} fill="none" stroke={SIEGEL} strokeWidth={1.6} />
        <path d={storePath} fill="none" stroke={MOOS} strokeWidth={1.2} strokeDasharray="3 2" />
        <path d={`M0 ${H} H${W}`} stroke={INK} strokeWidth={0.8} />
        {/* Überschuss je Stunde als Streifen unter der Achse (Elektrolyse, Kabel, verfällt). */}
        {curve.map((h, i) => {
          let acc = 0;
          const tot = sum(h.surplus);
          if (tot <= 0.5) return null;
          return SURPLUS.map((k) => {
            const v = h.surplus[k.key];
            if (v <= 0) return null;
            const r = <rect key={`${h.atMs}-${k.key}`} x={i * bw + 0.6 + (acc / tot) * (bw - 1.2)} y={H + 1} width={(v / tot) * (bw - 1.2)} height={4} fill={k.fill} fillOpacity={k.opacity} />;
            acc += v;
            return r;
          });
        })}
        {curve.map((h, i) => (i % 6 === 0 ? <text key={h.atMs} x={i * bw + 1} y={H + 14} fontSize={9} fill={INK} className="mono">{hourOf(h.atMs)} Uhr</text> : null))}
      </svg>
      <figcaption className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink2">
        {sources.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <svg width="10" height="10" aria-hidden="true"><rect width="10" height="10" fill={s.fill} stroke={INK} strokeWidth={0.6} /></svg>{s.label}
          </span>
        ))}
        <span className="flex items-center gap-1"><svg width="14" height="6" aria-hidden="true"><path d="M0 3 H14" stroke={SIEGEL} strokeWidth={1.6} /></svg>Bedarf</span>
        <span className="flex items-center gap-1"><svg width="14" height="6" aria-hidden="true"><path d="M0 3 H14" stroke={MOOS} strokeWidth={1.2} strokeDasharray="3 2" /></svg>Speicherstand</span>
        <span className="flex items-center gap-1"><svg width="10" height="10" aria-hidden="true"><rect width="10" height="10" fill={INK} fillOpacity={0.13} stroke={INK} strokeWidth={0.6} strokeDasharray="1.5 1.5" /></svg>Spannbreite (Vorhersage)</span>
      </figcaption>
    </figure>
  );
}

const SURPLUS_TEXT = { fuel: "in die Elektrolyse", cable: "ins Seekabel", wasted: "verfällt" } as const;

/** Überschuss jetzt: wohin er geht (Elektrolyse → Treibstoff, Kabel → Partner, sonst verfällt er). */
function SurplusNow({ g }: { g: Grid }) {
  const s = g.now.surplus;
  const total = sum(s);
  if (total < 0.5) return null;
  const parts = SURPLUS.filter((k) => s[k.key] >= 0.5).map((k) => (
    <span key={k.key} className="whitespace-nowrap">{fmtNum(s[k.key])} {SURPLUS_TEXT[k.key]}{k.key === "fuel" ? ` (+${fmtNum(g.now.fuelMade, 1)} Treibstoff/h)` : ""}</span>
  ));
  return (
    <p className="text-xs text-ink2" data-testid="strom-ueberschuss">
      Überschuss {fmtNum(total)}/h: {parts.reduce<React.ReactNode[]>((a, x, i) => (i === 0 ? [x] : [...a, " · ", x]), [])}
    </p>
  );
}

/** Ökostrom-Anteil der letzten 24 h und Grüner Hafen (+3 % Produktion ab 60 %). */
function GreenLine({ g }: { g: Grid }) {
  const x = g.green;
  if (!x || x.total <= 0) return null;
  const pctShare = Math.round(x.share * 100);
  return (
    <p className={`text-xs ${x.active ? "text-moos font-semibold" : "text-ink2"}`} data-testid="oekostrom-anteil">
      Ökostrom {x.windowHours} h: {pctShare} %
      {x.active ? ` – Grüner Hafen: Produktion +${Math.round(x.bonus * 100)} %` : ` (ab ${Math.round(x.shareMin * 100)} % gibt es +${Math.round(x.bonus * 100)} % Produktion)`}
    </p>
  );
}

/** Summe des Überschusses der Kurve (nächste 24 h) mit Hinweis, was ihn nutzen würde. */
function SurplusAhead({ curve }: { curve: Hour[] }) {
  const t = { fuel: 0, cable: 0, wasted: 0 };
  let greenWasted = 0;
  for (const h of curve) {
    for (const k of SURPLUS) t[k.key] += h.surplus[k.key];
    greenWasted += h.greenWasted;
  }
  if (t.fuel + t.cable + t.wasted < 1) return null;
  return (
    <div className="text-[10.5px] text-ink2">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span>Überschuss {curve.length} h (Streifen unter der Kurve):</span>
        {SURPLUS.map((k) => t[k.key] >= 1 && (
          <span key={k.key} className="flex items-center gap-1 whitespace-nowrap">
            <svg width="10" height="6" aria-hidden="true"><rect width="10" height="6" fill={k.fill} fillOpacity={k.opacity} /></svg>{k.label} {fmtNum(t[k.key])}
          </span>
        ))}
      </div>
      {greenWasted >= 50 && <p>Davon Ökostrom ohne Abnehmer: {fmtNum(greenWasted)} – Elektrolyse (mehr Stufen) oder ein Seekabel könnten ihn nutzen.</p>}
    </div>
  );
}

function weatherIcon(h: Hour, g: Grid): string {
  if (h.storm || h.wind >= g.stormFrom) return "sturm";
  if (h.fog >= g.fogFrom) return "nebel";
  if (h.clouds >= 0.55) return "wolke";
  if (h.wind >= g.slowFrom) return "wind";
  return h.daylight > 0.05 ? "sonne" : "mond";
}

/** Halbe Stunden als Text („1½“). */
const halfH = (h: number) => `${Math.floor(h)}${h % 1 >= 0.5 ? "½" : ""}`;

/** Wind in Beaufort von–bis (gleich: eine Zahl). */
function bftRange(lo: number, hi: number): string {
  const a = beaufort(lo);
  const b = beaufort(hi);
  return a === b ? `${a}` : `${a}–${b}`;
}

/**
 * Wettervorhersage am Hafen alle drei Stunden: Wind (von–bis), Bewölkung, Nebel; Sturmwarnung mit Zeitunsicherheit
 * und „Sturm möglich“, wenn nur der obere Rand der Spannbreite Sturm erreicht.
 */
function Forecast({ g }: { g: Grid }) {
  const slots = g.curve.filter((_, i) => i % 3 === 0);
  const storm = g.stormWarning;
  const possible = storm === null ? g.stormPossibleAt : null;
  const text = "Schiffe langsamer, reine Luftmissionen starten nicht, Windparks schalten über Orkanstärke ab.";
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink2 mb-1 font-display">Wettervorhersage am Hafen</div>
      {storm !== null && (
        <p className="text-xs text-red-300 font-semibold mb-1">
          {storm.atMs - serverNow() < 5 * 60000
            ? "Sturm am Hafen"
            : `Sturmwarnung ab etwa ${clockOf(storm.atMs)} Uhr${storm.plusMinusH >= 0.5 ? ` (±${halfH(storm.plusMinusH)} h)` : ""}`}: {text}
        </p>
      )}
      {possible !== null && (
        <p className="text-xs text-ink2 mb-1">Sturm möglich ab etwa {hourOf(possible)} Uhr (oberer Rand der Vorhersage).</p>
      )}
      <div className="grid grid-cols-8 gap-0.5 text-center text-[10px]">
        {slots.map((h, i) => (
          <div key={h.atMs} className="rounded border border-rule bg-paper py-0.5">
            <div className="mono">{hourOf(h.atMs)}h</div>
            <WeatherGlyph id={weatherIcon(h, g)} i={i} />
            <div className="mono whitespace-nowrap" title={`Wind: ${BEAUFORT_WORDS[beaufort(h.wind)]}`}>{bftRange(h.windRange[0], h.windRange[1])}</div>
            <div className="mono text-ink2" title="Bewölkung">{Math.round(h.clouds * 100)}</div>
          </div>
        ))}
      </div>
      <p className="text-[10.5px] text-ink2 mt-0.5">Zeilen: Wind in Beaufort (von–bis), Bewölkung in Prozent. Nebel kürzt die Radar-Vorwarnzeit und trübt Aufklärung.</p>
    </div>
  );
}
