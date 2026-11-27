// Admirale: Karte im Truppen-Bildschirm (Ernennen, Spezialisierung, Hafenkommandant, Status, Lösegeld),
// Auswahl in der Missionsplanung und Abschnitt im Kampfbericht (Einfluss, Erfahrung, Wurf).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum } from "../lib/names.ts";
import { fmtDuration, fmtTime, useNow } from "../lib/time.ts";
import { Button, Card, Cost, ErrorLine } from "../ui.tsx";
import { ReasonLine } from "./Remedy.tsx"; // „Was hilft?“
import { Icon } from "../icons.tsx";
import { AdmiralRecall } from "./Fields.tsx"; // Felder: Admiral ohne Rückruf abziehen

type Line = { spec: string; path: string; factor: number };
type View = NonNullable<Awaited<ReturnType<typeof trpcClient.admiral.get.query>>>;
type Admiral = View["list"][number];

/** Kurztext eines Modifikator-Pfads. */
const MOD_TEXT: Record<string, string> = {
  "attack.see": "Angriff der Schiffe", "attack.anlage": "Angriff der Anlagen", "attackUnit.uboot": "Angriff der U-Boote",
  "attackVs.uboot": "U-Jagd", "hp.see": "LP Schiffe", "hp.land": "LP Truppen", "hp.luft": "LP Flugzeuge", "hp.anlage": "LP Anlagen",
  "speed.see": "Tempo Schiffe", "speed.luft": "Tempo Flugzeuge", fuel: "Treibstoff", stealth: "Vorwarnzeit des Ziels",
  radarWarning: "Radar-Vorwarnzeit", cargo: "Laderaum", loot: "Beute", bunker: "Bunkerschutz",
};

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

/** Karte „Admirale“ im Truppen-Bildschirm. */
export function AdmiralsCard() {
  const q = useQuery(trpc.admiral.get.queryOptions());
  const now = useNow(30000);
  const appoint = useCommand((i: { key: string; name: string | null; spec: string }) => trpcClient.admiral.appoint.mutate(i), invalidate);
  const [spec, setSpec] = useState("angriff");
  const [name, setName] = useState<string>("");
  const v = q.data;
  if (!v) return null;
  const free = v.slots - v.list.length;
  const s = v.slotsRule;
  return (
    // Truppen → Einsatz: standardmäßig eingeklappt, Zusammenfassung „Rang Name, …“.
    <Card title={<span className="flex items-center gap-2"><Icon id="admiral" size={22} />Admirale <span className="mono normal-case tracking-normal">{v.list.length}/{v.slots}</span></span>}
      collapsible storageKey="truppen-admirale" defaultOpen={false}
      summary={v.list.length === 0 ? (free > 0 ? "Noch kein Admiral – ernennen möglich." : "Kein Admiral.") : v.list.map((a) => `${a.rankName} ${a.name}`).join(" · ")}>
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
            {v.specs.map((x) => (
              <button key={x.id} type="button" onClick={() => setSpec(x.id)} className={`tap rounded-lg px-2 py-1.5 text-left text-sm border ${spec === x.id ? "border-sea-400 bg-sea-400/10 font-semibold" : "border-rule"}`}>
                {x.name}
              </button>
            ))}
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
            <Cost cost={{ credits: v.cost.credits, elektronik: v.cost.elektronik }} />
            <Button disabled={appoint.busy} onClick={() => void appoint.run({ name: name || null, spec })}>Ernennen</Button>
          </div>
          <ErrorLine text={appoint.error} code={appoint.code} detail={{ cost: v.cost }} />
        </div>
      ) : (
        <ReasonLine code="admiral_slots" text={v.slots >= s.max ? "Alle Plätze belegt." : `Weitere Plätze mit dem Ausbau der Hafenkommandantur (je ${s.perHarborLevels} Stufen).`} className="text-xs text-slate-400 mt-2" />
      )}
      <p className="text-[11.5px] text-ink2 mt-2">
        Erfahrung nur aus gewonnenen Kämpfen, je nach besiegtem Wert. Verliert sein Verband deutlich (über {Math.round(v.risk.lossShare * 100)} % Verluste), entscheidet ein W{v.risk.die}: 1 gefallen, bis {v.risk.capturedMax} gefangen ({v.risk.captiveHours} h oder Lösegeld), bis {v.risk.woundedMax} verwundet ({v.risk.woundedHours} h).
      </p>
    </Card>
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
            {a.specs.map(specName).join(" und ")} · Erfahrung {fmtNum(a.xp)}{a.next ? ` · ${a.next.name} ab ${fmtNum(a.next.minXp)}` : " · höchster Rang"}
            {a.battles > 0 ? ` · ${a.wins} Siege in ${a.battles} Kämpfen` : ""}
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
      <ErrorLine text={failed?.error} code={failed?.code} />
    </li>
  );
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
            <div className="font-display text-[10px] uppercase tracking-[0.12em] text-see">{who}</div>
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
