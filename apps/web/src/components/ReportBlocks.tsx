// Berichtsansicht aus denselben Bausteinen wie die ausführliche E-Mail (report.get → blocks, engine/mail-report*.ts):
// Ergebnis-Kopf, Kurzfazit, Kennzahlen-Kacheln, Tabellen mit Symbolen, Kennzahlen, Listen – im Stil der App
// (Papier/Tinte), mobil ab 390 px ohne Überlauf: lange Namen brechen um, Zahlenspalten bleiben schmal.
import { Icon } from "../icons.tsx";

type Tone = "win" | "loss" | "warn" | "info";
type Cell = string | { v: string; tone?: Tone; bold?: boolean; muted?: boolean; icon?: string };
export type ReportBlock =
  | { type: "banner"; tone: Tone; kicker?: string; title: string; sub?: string }
  | { type: "tiles"; tiles: { label: string; value: string; tone?: Tone }[] }
  | { type: "section"; title: string }
  | { type: "table"; head: string[]; rows: Cell[][]; align?: ("left" | "right")[]; foot?: Cell[]; maxRows?: number; caption?: string }
  | { type: "facts"; facts: [string, string][] }
  | { type: "list"; items: string[] }
  | { type: "text"; text: string; tone?: "muted" | Tone };

const TONE_TEXT: Record<Tone | "muted", string> = { win: "text-moos", loss: "text-siegel", warn: "text-messing", info: "text-ink", muted: "text-ink2" };
const TONE_RULE: Record<Tone, string> = { win: "bg-moos", loss: "bg-siegel", warn: "bg-messing", info: "bg-see" };

/** Textsymbol der E-Mail (⚓︎, ✈︎, ♞︎, ▣) entfällt, wenn die App ein Bild zeigt. */
const stripSymbol = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, "");

function Banner({ b }: { b: Extract<ReportBlock, { type: "banner" }> }) {
  return (
    <section className="text-center pb-3 mb-3 border-b border-rule" data-testid="report-banner">
      {b.kicker && <div className="font-display text-[11px] uppercase tracking-[0.18em] text-ink2 break-words">{b.kicker}</div>}
      <div className="flex items-center gap-2 mx-10 mt-2" aria-hidden="true">
        <i className="flex-1 border-t-[3px] border-double border-ink" /><span className={`diamond ${TONE_RULE[b.tone]}`} /><i className="flex-1 border-t-[3px] border-double border-ink" />
      </div>
      <h2 className={`font-serif italic text-[34px] leading-tight mt-1.5 mb-1 break-words ${b.tone === "loss" ? "text-siegel" : "text-ink"}`}>{b.title}</h2>
      {b.sub && <div className="text-[12px] text-ink2 break-words">{b.sub}</div>}
    </section>
  );
}

function Tiles({ b }: { b: Extract<ReportBlock, { type: "tiles" }> }) {
  return (
    <div className={`grid gap-1.5 my-3 ${b.tiles.length >= 3 ? "grid-cols-3" : "grid-cols-2"}`}>
      {b.tiles.map((t, i) => (
        <div key={i} className="min-w-0 text-center border border-rule rounded-[3px] bg-card py-1.5 px-1">
          <div className={`mono text-[17px] font-semibold break-words ${t.tone ? TONE_TEXT[t.tone] : "text-ink"}`}>{t.value}</div>
          <div className="text-[11px] text-ink2 leading-tight break-words">{t.label}</div>
        </div>
      ))}
    </div>
  );
}

function CellView({ c, right, foot }: { c: Cell; right: boolean; foot?: boolean }) {
  const o = typeof c === "string" ? { v: c } : c;
  const color = o.tone ? TONE_TEXT[o.tone] : o.muted ? "text-ink2" : "";
  const cls = `py-1 px-1.5 align-top ${right ? "text-right mono whitespace-nowrap" : "text-left break-words"} ${color} ${o.bold || foot ? "font-semibold" : ""}`;
  return (
    <td className={cls}>
      {o.icon ? (
        <span className="flex items-center gap-1.5 min-w-0"><Icon id={o.icon} size={22} className="shrink-0" /><span className="min-w-0 leading-tight">{stripSymbol(o.v)}</span></span>
      ) : o.v}
    </td>
  );
}

function Table({ b }: { b: Extract<ReportBlock, { type: "table" }> }) {
  const right = (i: number) => (b.align?.[i] ?? (i === 0 ? "left" : "right")) === "right";
  return (
    <div className="my-1.5">
      <table className="w-full text-[13px] border-collapse">
        {b.head.length > 0 && (
          <thead>
            <tr className="border-b border-ink">
              {b.head.map((h, i) => <th key={i} className={`py-1 px-1.5 font-display text-[10.5px] uppercase tracking-[0.1em] text-ink2 font-normal ${right(i) ? "text-right" : "text-left"}`}>{h}</th>)}
            </tr>
          </thead>
        )}
        <tbody>
          {b.rows.map((r, k) => (
            <tr key={k} className="border-b border-dotted border-rule">{r.map((c, i) => <CellView key={i} c={c} right={right(i)} />)}</tr>
          ))}
          {b.foot && <tr className="bg-card border-t border-ink">{b.foot.map((c, i) => <CellView key={i} c={c} right={right(i)} foot />)}</tr>}
        </tbody>
      </table>
      {b.caption && <p className="text-[11.5px] text-ink2 mt-1">{b.caption}</p>}
    </div>
  );
}

function Facts({ b }: { b: Extract<ReportBlock, { type: "facts" }> }) {
  return (
    <dl className="text-[13px] my-1.5">
      {b.facts.map(([k, v], i) => (
        <div key={i} className="flex flex-wrap justify-between gap-x-3 py-1 border-b border-dotted border-rule">
          <dt className="text-ink2 min-w-0 break-words">{k}</dt>
          <dd className="min-w-0 text-right break-words ml-auto">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Block({ b }: { b: ReportBlock }) {
  switch (b.type) {
    case "banner": return <Banner b={b} />;
    case "tiles": return <Tiles b={b} />;
    case "section": return <h3 className="font-display text-[11px] uppercase tracking-[0.16em] text-ink2 mt-4 mb-0.5 pb-0.5 border-b border-rule break-words">{b.title}</h3>;
    case "table": return <Table b={b} />;
    case "facts": return <Facts b={b} />;
    case "list":
      return (
        <ul className="my-1.5 space-y-1 text-[13px]">
          {b.items.map((t, i) => <li key={i} className="flex gap-2"><span className="diamond bg-siegel mt-1.5 shrink-0" /><span className="min-w-0 break-words">{t}</span></li>)}
        </ul>
      );
    case "text": return <p className={`text-[14px] my-1.5 break-words ${b.tone ? TONE_TEXT[b.tone] : ""} ${b.tone === "muted" ? "text-[13px]" : "font-serif"}`}>{b.text}</p>;
    default: return null;
  }
}

/** Bausteine nacheinander; `only` beschränkt auf bestimmte Arten (z. B. nur den Kopf). */
export function ReportBlocks({ blocks, only }: { blocks: ReportBlock[]; only?: ReportBlock["type"][] }) {
  const shown = only ? blocks.filter((b) => only.includes(b.type)) : blocks;
  return <div className="min-w-0" data-testid="report-blocks">{shown.map((b, i) => <Block key={i} b={b} />)}</div>;
}
