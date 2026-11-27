// Admirale: Karte im Truppen-Bildschirm (Ernennen, Spezialisierung, Hafenkommandant, Status, Lösegeld),
// Auswahl in der Missionsplanung und Abschnitt im Kampfbericht (Einfluss, Erfahrung, Wurf).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum, label, nOf } from "../lib/names.ts";
import { fmtDuration, fmtTime, useNow } from "../lib/time.ts";
import { Button, Card, Cost, ErrorLine } from "../ui.tsx";
import { ReasonLine } from "./Remedy.tsx"; // „Was hilft?“
import { Icon } from "../icons.tsx";
import { AdmiralRecall } from "./Fields.tsx"; // Felder: Admiral ohne Rückruf abziehen

/** Bild je Spezialisierung (vorhandene Symbole). */
const SPEC_ICON: Record<string, string> = {
  angriff: "ueberfall", verteidigung: "schild", landung: "landungsschiff", logistik: "transport",
  aufklaerung: "aufklaerung", beutemeister: "kran", uboot: "uboot",
};

/** Auswahlknopf einer Spezialisierung: Symbol + Name. */
function SpecButton({ id, name, active, onClick }: { id: string; name: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`tap rounded-lg px-2 py-1.5 text-left text-sm border flex items-center gap-2 min-w-0 ${active ? "border-sea-400 bg-sea-400/10 font-semibold" : "border-rule"}`}>
      <Icon id={SPEC_ICON[id] ?? "admiral"} size={28} className="shrink-0" />
      <span className="min-w-0 hyphens-manual">{name}</span>
    </button>
  );
}

type Line = { spec: string; path: string; factor: number };
type View = NonNullable<Awaited<ReturnType<typeof trpcClient.admiral.get.query>>>;
type Admiral = View["list"][number];

/** Kurztext eines Modifikator-Pfads. */
const MOD_TEXT: Record<string, string> = {
  "attack.see": "Angriff der Schiffe", "attack.anlage": "Angriff der Anlagen", "attackUnit.uboot": "Angriff der U-Boote",
  "attackVs.uboot": "U-Jagd", "hp.see": "LP Schiffe", "hp.land": "LP Truppen", "hp.luft": "LP Flugzeuge", "hp.anlage": "LP Anlagen",
  "speed.see": "Tempo Schiffe", "speed.luft": "Tempo Flugzeuge", fuel: "Treibstoff", stealth: "Vorwarnzeit des Ziels",
  radarWarning: "Radar-Vorwarnzeit", cargo: "Laderaum", loot: "Beute", bunker: "Bunkerschutz",
  "attack.land": "Angriff der Truppen", mineDamage: "Minenschaden", nestLoot: "Nestbeute",
};

/** Modifikatoren (wie game-core, ohne den Kern ins Hauptpaket zu laden) um die Missionswirkung eines Admirals ergänzen. */
export function withAdmiralMods<M extends object>(base: M | undefined, lines: Line[]): M | undefined {
  if (lines.length === 0) return base;
  const out = structuredClone(base ?? {}) as Record<string, number | Record<string, number>>;
  for (const l of lines) {
    const [k, e] = l.path.split(".");
    if (e === undefined) out[k] = ((out[k] as number | undefined) ?? 1) * l.factor;
    else {
      const m = { ...((out[k] as Record<string, number> | undefined) ?? {}) };
      m[e] = (m[e] ?? 1) * l.factor;
      out[k] = m;
    }
  }
  return out as M;
}

/** „1.200 Kredite und 150 Elektronik“ (was für die Ernennung fehlt). */
export function missingText(m: Record<string, number>): string {
  const parts = Object.entries(m).map(([r, n]) => (r === "credits" ? nOf(n, "Kredit", "Kredite") : `${fmtNum(n)} ${label(r)}`));
  return parts.join(" und ");
}

function pct(f: number): string {
  const v = Math.round((f - 1) * 1000) / 10;
  return `${v >= 0 ? "+" : "−"}${String(Math.abs(v)).replace(".", ",")} %`;
}

/** „Angriff der Schiffe +8 % · LP Schiffe +6 %“ */
export function modLineText(lines: Line[]): string {
  return lines.map((l) => `${MOD_TEXT[l.path] ?? l.path} ${pct(l.factor)}`).join(" · ");
}

/** Bonus bei voller Stärke aus der Balance (Pfad → Bonus), als Text. */
export function bonusText(m: Record<string, number>): string {
  return Object.entries(m).map(([p, b]) => `${MOD_TEXT[p] ?? p} ${pct(1 + b)}`).join(" · ");
}

const STATUS: Record<string, [string, string]> = {
  bereit: ["bereit", "text-moos border-moos"],
  unterwegs: ["unterwegs", "text-see border-see"],
  verwundet: ["verwundet", "text-messing border-messing"],
  gefangen: ["gefangen", "text-siegel border-siegel"],
};

function StatusChip({ a, now }: { a: Admiral; now: number }) {
  const [text, cls] = STATUS[a.status] ?? [a.status, "border-rule"];
  return (
    <span className={`inline-flex px-1.5 rounded-[3px] border text-[11px] font-display uppercase tracking-[0.08em] ${cls}`}>
      {text}{a.until ? ` · noch ${fmtDuration(a.until - now)}` : ""}
    </span>
  );
}

const invalidate = () => [trpc.admiral.pathFilter().queryKey, trpc.base.pathFilter().queryKey];

/** Admirale (Truppen → Einsatz, Kachel „Admirale“ öffnet diese Ansicht im Blatt). */
export function AdmiralsPanel() {
  const q = useQuery(trpc.admiral.get.queryOptions());
  const now = useNow(30000);
  const appoint = useCommand((i: { key: string; name: string | null; spec: string }) => trpcClient.admiral.appoint.mutate(i), invalidate);
  const [spec, setSpec] = useState("angriff");
  const [name, setName] = useState<string>("");
  const v = q.data;
  if (!v) return null;
  const free = v.slots - v.list.length;
  const lacking = Object.keys(v.missing).length > 0;
  const s = v.slotsRule;
  return (
    <div>
      <p className="text-xs text-ink2 mb-2">
        Ein Admiral führt einen Verband auf Mission oder als Hafenkommandant daheim die Verteidigung. Plätze: {s.base} + 1 je {s.perHarborLevels} Stufen Hafenkommandantur, höchstens {s.max}.
      </p>
      <ul className="divide-y divide-rule">
        {v.list.map((a) => <AdmiralItem key={a.id} a={a} v={v} now={now} />)}
      </ul>
      {free > 0 ? (
        <div className="mt-3 border-t border-rule pt-3">
          <div className="font-display text-[11px] uppercase tracking-[0.12em] text-ink2 mb-1">Admiral ernennen</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {v.specs.map((x) => <SpecButton key={x.id} id={x.id} name={x.name} active={spec === x.id} onClick={() => setSpec(x.id)} />)}
          </div>
          <SpecInfo spec={v.specs.find((x) => x.id === spec)} />
          <label className="block text-sm mt-2">
            <span className="text-ink2 text-xs">Name</span>
            <select value={name} onChange={(e) => setName(e.target.value)} className="block w-full mt-0.5 min-h-[44px] rounded-lg border border-rule bg-transparent px-2">
              <option value="">Zufällig aus der Liste</option>
              {v.names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
            <Cost cost={{ credits: v.cost.credits, elektronik: v.cost.elektronik }} have={v.have} />
            <Button disabled={appoint.busy || lacking} onClick={() => void appoint.run({ name: name || null, spec })}>Ernennen</Button>
          </div>
          {lacking && (
            <ReasonLine code={v.missing.credits ? "admiral_funds" : "insufficient_resources"} text={`Fehlt: ${missingText(v.missing)}.`}
              detail={{ cost: v.missing.credits ? { credits: v.cost.credits } : { elektronik: v.cost.elektronik } }} className="text-sm text-brass-300 mt-2" />
          )}
          <ErrorLine text={appoint.error} code={appoint.code} detail={{ cost: v.cost }} />
        </div>
      ) : (
        <ReasonLine code="admiral_slots" text={v.slots >= s.max ? "Alle Plätze belegt." : `Weitere Plätze mit dem Ausbau der Hafenkommandantur (je ${s.perHarborLevels} Stufen).`} className="text-xs text-slate-400 mt-2" />
      )}
      <p className="text-[11.5px] text-ink2 mt-2">
        Erfahrung nur aus gewonnenen Kämpfen, je nach besiegtem Wert. Verliert sein Verband deutlich (über {Math.round(v.risk.lossShare * 100)} % Verluste), entscheidet ein W{v.risk.die}: 1 gefallen, bis {v.risk.capturedMax} gefangen ({v.risk.captiveHours} h oder Lösegeld), bis {v.risk.woundedMax} verwundet ({v.risk.woundedHours} h).
      </p>
    </div>
  );
}

function SpecInfo({ spec }: { spec: View["specs"][number] | undefined }) {
  if (!spec) return null;
  return (
    <div className="text-[11.5px] text-ink2 mt-1.5 space-y-0.5">
      <div>{spec.text}</div>
      {Object.keys(spec.mission).length > 0 && <div>Auf Mission (voll ausgebildet): {bonusText(spec.mission)}</div>}
      {Object.keys(spec.defense).length > 0 && <div>Verteidigung daheim: {bonusText(spec.defense)}</div>}
      {Object.keys(spec.harbor).length > 0 && <div>Als Hafenkommandant: {bonusText(spec.harbor)}</div>}
    </div>
  );
}

function AdmiralItem({ a, v, now }: { a: Admiral; v: View; now: number }) {
  const station = useCommand((i: { key: string; admiralId: number | null }) => trpcClient.admiral.station.mutate(i), invalidate);
  const ransom = useCommand((i: { key: string; admiralId: number }) => trpcClient.admiral.ransom.mutate(i), invalidate);
  const second = useCommand((i: { key: string; admiralId: number; spec: string }) => trpcClient.admiral.spec.mutate(i), invalidate);
  const dismiss = useCommand((i: { key: string; admiralId: number }) => trpcClient.admiral.dismiss.mutate(i), invalidate);
  const [spec2, setSpec2] = useState("");
  const [confirm, setConfirm] = useState(false);
  const specName = (id: string) => v.specs.find((x) => x.id === id)?.name ?? id;
  const failed = [station, ransom, second, dismiss].find((c) => c.error);
  return (
    <li className="py-2.5">
      <div className="flex items-start gap-2">
        <Icon id="admiral" size={40} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <strong className="font-serif">{a.rankName} {a.name}</strong>
            <StatusChip a={a} now={now} />
          </div>
          <div className="text-xs text-ink2">
            {a.specs.map((id) => <span key={id} className="inline-flex items-center gap-0.5 align-middle mr-1"><Icon id={SPEC_ICON[id] ?? "admiral"} size={16} />{specName(id)}</span>)}· Erfahrung {fmtNum(a.xp)}{a.next ? ` · ${a.next.name} ab ${fmtNum(a.next.minXp)}` : " · höchster Rang"}
            {a.battles > 0 ? ` · ${nOf(a.wins, "Sieg", "Siege")} in ${a.battles} ${a.battles === 1 ? "Kampf" : "Kämpfen"}` : ""}
          </div>
          {a.mission.length > 0 && <div className="text-[11.5px] text-ink2">Auf Mission: {modLineText(a.mission)}</div>}
          {a.defense.length > 0 && <div className="text-[11.5px] text-ink2">Verteidigung: {modLineText(a.defense)}</div>}
          {a.harbor.length > 0 && <div className="text-[11.5px] text-ink2">Hafen: {modLineText(a.harbor)}</div>}
          {a.post && <div className="text-[11.5px] text-see mt-0.5">{a.post[0].toUpperCase() + a.post.slice(1)}{a.postFieldId ? " – kehrt mit ihr heim oder allein, wenn du ihn abziehst" : ""}</div>}
          {a.postFieldId && <AdmiralRecall fieldId={a.postFieldId} />}
          {a.stationed && <div className="text-[11.5px] text-moos mt-0.5">Hafenkommandant{a.status !== "bereit" ? " – führt die Verteidigung, sobald er bereit ist" : ""}</div>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        {a.stationed
          ? <Button kind="secondary" disabled={station.busy} onClick={() => void station.run({ admiralId: null })}>Abberufen</Button>
          : <Button kind="secondary" disabled={station.busy} onClick={() => void station.run({ admiralId: a.id })}>Hafenkommandant</Button>}
        {a.status === "gefangen" && (
          <Button disabled={ransom.busy} onClick={() => void ransom.run({ admiralId: a.id })}>Lösegeld {fmtNum(v.risk.ransomCredits)} Kredite</Button>
        )}
        {a.status !== "unterwegs" && (confirm
          ? <Button kind="secondary" disabled={dismiss.busy} onClick={() => void dismiss.run({ admiralId: a.id })}>Wirklich entlassen?</Button>
          : <Button kind="ghost" onClick={() => setConfirm(true)}>Entlassen</Button>)}
      </div>
      {a.canChooseSecond && (
        <div className="mt-2 flex gap-2 items-center flex-wrap">
          <select value={spec2} onChange={(e) => setSpec2(e.target.value)} className="min-h-[44px] rounded-lg border border-rule bg-transparent px-2 flex-1 min-w-0">
            <option value="">Zweite Spezialisierung …</option>
            {v.specs.filter((x) => !a.specs.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <Button disabled={!spec2 || second.busy} onClick={() => void second.run({ admiralId: a.id, spec: spec2 })}>Wählen</Button>
        </div>
      )}
      {a.canRetrain && <Retrain a={a} v={v} />}
      <ErrorLine text={failed?.error} code={failed?.code} />
    </li>
  );
}

/** Umschulung: erste Spezialisierung einmal kostenlos wechseln (mit Bestätigung). */
function Retrain({ a, v }: { a: Admiral; v: View }) {
  const retrain = useCommand((i: { key: string; admiralId: number; spec: string }) => trpcClient.admiral.retrain.mutate(i), invalidate);
  const [open, setOpen] = useState(false);
  const [spec, setSpec] = useState("");
  const [sure, setSure] = useState(false);
  const specName = (id: string) => v.specs.find((x) => x.id === id)?.name ?? id;
  const choices = v.specs.filter((x) => !a.specs.includes(x.id));
  if (!open) {
    return (
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span className="text-[11.5px] text-ink2 flex-1 min-w-0">Neu: Spezialisierung „{specName("landung")}“. Einmal kostenlos umschulen.</span>
        <Button kind="secondary" onClick={() => setOpen(true)}>Umschulen …</Button>
      </div>
    );
  }
  return (
    <div className="mt-2 border border-rule rounded-lg p-2">
      <div className="font-display text-[11px] uppercase tracking-[0.12em] text-ink2 mb-1">Umschulung – {specName(a.specs[0])} ersetzen</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {choices.map((x) => <SpecButton key={x.id} id={x.id} name={x.name} active={spec === x.id} onClick={() => { setSpec(x.id); setSure(false); }} />)}
      </div>
      <SpecInfo spec={v.specs.find((x) => x.id === spec)} />
      {spec && sure && (
        <p className="text-sm font-semibold text-messing mt-2">
          {specName(a.specs[0])} wird durch {specName(spec)} ersetzt. Kostenlos, aber nur dieses eine Mal – danach ist die erste Spezialisierung fest. Rang und Erfahrung bleiben.
        </p>
      )}
      <div className="flex gap-2 mt-2 flex-wrap">
        {spec && !sure && <Button onClick={() => setSure(true)}>Umschulen auf {specName(spec)}</Button>}
        {spec && sure && <Button disabled={retrain.busy} onClick={() => void retrain.run({ admiralId: a.id, spec })}>Ja, endgültig umschulen</Button>}
        <Button kind="ghost" onClick={() => { setOpen(false); setSpec(""); setSure(false); }}>Abbrechen</Button>
      </div>
      <ErrorLine text={retrain.error} code={retrain.code} />
    </div>
  );
}

/** Gewählter Admiral der Missionsplanung (für den Probekampf): Name und Missionswirkung, sonst undefined. */
export function useAdmiralChoice(id: number | null): { name: string; lines: Line[] } | undefined {
  const q = useQuery(trpc.admiral.get.queryOptions());
  const a = id === null ? undefined : q.data?.list.find((x) => x.id === id && x.status === "bereit");
  return useMemo(() => (a ? { name: `${a.rankName} ${a.name}`, lines: a.mission } : undefined), [a]);
}

/** Auswahl in der Missionsplanung: bereite Admirale, mit Wirkung auf diesen Verband. */
export function AdmiralPick({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const q = useQuery(trpc.admiral.get.queryOptions());
  const v = q.data;
  if (!v || v.list.length === 0) return null;
  const ready = v.list.filter((a) => a.status === "bereit");
  const chosen = ready.find((a) => a.id === value);
  return (
    <Card title={<span className="flex items-center gap-2"><Icon id="admiral" size={22} />Führung</span>}>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onChange(null)} className={`tap rounded-lg px-2 py-1.5 text-sm border ${chosen ? "border-rule" : "border-sea-400 bg-sea-400/10 font-semibold"}`}>Ohne Admiral</button>
        {ready.map((a) => (
          <button key={a.id} type="button" onClick={() => onChange(a.id)} className={`tap rounded-lg px-2 py-1.5 text-sm border ${value === a.id ? "border-sea-400 bg-sea-400/10 font-semibold" : "border-rule"}`}>
            {a.rankName} {a.name}
          </button>
        ))}
      </div>
      {chosen && <p className="text-xs text-ink2 mt-1.5">{modLineText(chosen.mission) || "Keine Wirkung auf diesen Verband."}{chosen.stationed ? " Solange er unterwegs ist, fehlt daheim der Hafenkommandant." : ""}</p>}
      {ready.length < v.list.length && <p className="text-xs text-slate-400 mt-1">{v.list.length - ready.length} nicht verfügbar (unterwegs, verwundet oder gefangen).</p>}
    </Card>
  );
}

type ReportSide = {
  name: string; rankName: string; specs: { id: string; name: string }[]; lines: Line[]; xpGain: number; xp: number;
  promoted: string | null; lossShare: number; roll: number | null; fate: string; until: number | null;
};
type ReportData = { attacker?: ReportSide; defender?: ReportSide; rule: { lossShare: number; die: number; fallenMax: number; capturedMax: number; woundedMax: number } };

const FATE: Record<string, string> = {
  unversehrt: "unversehrt", verwundet: "verwundet", gefangen: "in Gefangenschaft geraten", gefallen: "gefallen",
};

/** Abschnitt „Admirale“ im Kampfbericht: beide Seiten, Einfluss, Erfahrung, Wurf. */
export function AdmiralReport({ d, names }: { d: ReportData; names: [string, string] }) {
  const sides: [string, ReportSide | undefined][] = [[names[0], d.attacker], [names[1], d.defender]];
  const r = d.rule;
  return (
    <Card title={<span className="flex items-center gap-2"><Icon id="admiral" size={22} />Admirale</span>}>
      <div className="space-y-2.5 text-sm">
        {sides.map(([who, s]) => (
          <div key={who}>
            <div className="font-display text-[11px] uppercase tracking-[0.12em] text-see">{who}</div>
            {!s ? <div className="text-xs text-ink2">ohne Admiral</div> : (
              <>
                <div><strong className="font-serif">{s.rankName} {s.name}</strong> <span className="text-xs text-ink2">({s.specs.map((x) => x.name).join(", ")})</span></div>
                <div className="text-[11.5px] text-ink2">Einfluss: {modLineText(s.lines) || "keiner in diesem Kampf"}</div>
                <div className="text-[11.5px]">
                  {s.xpGain > 0 ? `Erfahrung +${fmtNum(s.xpGain)} (jetzt ${fmtNum(s.xp)})` : "Keine Erfahrung (kein Sieg)"}
                  {s.promoted ? <span className="text-moos font-semibold"> · befördert zum {s.promoted}</span> : null}
                </div>
                {s.roll !== null ? (
                  <div className={`text-[11.5px] ${s.fate === "unversehrt" ? "" : "text-siegel"}`}>
                    Verluste {Math.round(s.lossShare * 100)} % – Wurf W{r.die}: <span className="mono font-semibold">{s.roll}</span> → {FATE[s.fate] ?? s.fate}
                    {s.until ? ` bis ${fmtTime(s.until)}` : ""}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ))}
        <p className="text-[11px] text-ink2">Wurf nur nach Niederlage mit über {Math.round(r.lossShare * 100)} % Verlusten: {r.fallenMax} gefallen, bis {r.capturedMax} gefangen, bis {r.woundedMax} verwundet, darüber unversehrt.</p>
      </div>
    </Card>
  );
}
