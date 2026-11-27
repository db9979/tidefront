// See: Minen, Blockade und Konvois – Oberfläche: Kartenblatt, Hafenbanner, Minenwarnung in der Planung, Haltezeit,
// Geleitschutz beim Handel, Konvoi-Zeile, Berichte und „Blockade aufheben“ (docs/REGELN-SEE.md).
import { useQuery } from "@tanstack/react-query";
import { hexAtXY, hexDistanceKm } from "@tidefront/world";
import { trpc, trpcClient, type BaseData, type Outputs } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { errorText, fmtNum, label } from "../lib/names.ts";
import { fmtDuration, fmtTime, useCountdownNow, useNow } from "../lib/time.ts";
import { Button, Card, CountsLine, ErrorLine, Stepper, SmallButton } from "../ui.tsx";
import { Icon } from "../icons.tsx";
import type { Target } from "../App.tsx";
import { convoyXY } from "../lib/convoy.ts"; // Konvoi: Position entlang der Route
import { ConvoyCard, convoyTitle } from "./ConvoySheet.tsx"; // Konvoi-Blatt

export type NavalData = Outputs["naval"]["view"];
type Convoy = NavalData["convoys"][number];
type Counts = Record<string, number>;

export function useNaval(enabled = true) {
  return useQuery({ ...trpc.naval.view.queryOptions(), enabled, refetchInterval: 60000 });
}

const resLine = (m: Counts | null | undefined) => {
  const parts = Object.entries(m ?? {}).filter(([, v]) => v > 0).map(([r, v]) => `${fmtNum(v)} ${label(r)}`);
  return parts.length > 0 ? parts.join(", ") : "nichts";
};

/** Banner im Hafen: „blockiert bis …“. */
export function BlockadeBanner() {
  const q = useNaval();
  const b = q.data?.ownBlockade;
  const now = useCountdownNow(b?.endsAtMs);
  if (!b || b.endsAtMs <= now) return null; // abgelaufen: ausblenden, bis die nächste Abfrage kommt
  return (
    <div className="rounded-[3px] bg-card border border-siegel border-l-4 p-3 mb-3 flex gap-3 items-start" role="status">
      <Icon id="blockade" size={40} />
      <div className="text-sm">
        <div className="font-display uppercase text-siegel text-[12px] tracking-wider">Hafen blockiert bis {fmtTime(b.endsAtMs)} · noch {fmtDuration(b.endsAtMs - now)}</div>
        <p className="text-ink2">Produktion −{Math.round((1 - b.factor) * 100)} %, eingehende Lieferungen werden zurückgehalten, Börsenverkäufe gesperrt. Greife den Blockadeverband über die Karte an – Verbündete können helfen.</p>
      </div>
    </div>
  );
}

/** Warnung in der Missionsplanung: bekannte feindliche Minenfelder auf der Route. */
export function MineWarning({ col, row, units }: { col: number; row: number; units: Counts }) {
  const q = useQuery(trpc.naval.routeMines.queryOptions({ col, row }));
  const ships = Object.entries(units).some(([id, n]) => n > 0 && !["abfangjaeger", "jagdbomber", "aufklaerungsdrohne"].includes(id));
  if (!q.data || q.data.length === 0 || !ships) return null;
  return (
    <div className="rounded-[3px] border border-siegel border-l-4 bg-card p-2 mb-3 text-sm flex gap-2 items-start" role="alert">
      <Icon id="mine" size={28} />
      <div>
        <strong className="text-siegel">Minen auf der Route:</strong> {q.data.length} bekanntes Feld{q.data.length === 1 ? "" : "er"} ({q.data.map((f) => `Stärke ${f.strength}, ${f.owner}`).join("; ")}).
        <span className="text-ink2"> Schiffe können auf der Hinfahrt sinken. Minenräumer im Verband senken die Verluste, U-Boote leiden weniger.</span>
      </div>
    </div>
  );
}

/** Haltezeit einer Blockade. */
export function HoldHours({ value, onChange }: { value: number; onChange: (h: number) => void }) {
  const q = useNaval();
  const r = q.data?.rules.blockade;
  if (!r) return null;
  return (
    <Card title="Haltezeit">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>Vor dem Hafen liegen: <strong>{value} h</strong></span>
        <Stepper value={value} max={r.maxHours} onChange={(v) => onChange(Math.max(r.minHours, v))} />
      </div>
      <p className="text-xs text-ink2 mt-1">
        {r.minHours}–{r.maxHours} Stunden. Solange der Verband hält: Produktion des Ziels −{Math.round((1 - r.productionFactor) * 100)} %, Lieferungen zurückgehalten, Börsenverkäufe gesperrt.
        Nur bewaffnete Schiffe, zusammen mindestens {r.minCommandPoints} Kommandopunkte. Der Verteidiger und seine Verbündeten können angreifen.
      </p>
    </Card>
  );
}

/** Was auf einem Kartenfeld an Seegeschehen liegt (Konvois an ihrer Position jetzt, entlang der Route). */
export function navalAt(data: NavalData | undefined, t: { col: number; row: number }, now = Date.now()) {
  return {
    mines: data?.minefields.filter((f) => f.col === t.col && f.row === t.row) ?? [],
    blockade: data?.blockades.find((b) => b.col === t.col && b.row === t.row),
    convoys: data?.convoys.filter((c) => { const p = convoyXY(c, now); return hexDistanceKm(hexAtXY(p.x, p.y), t) < 70; }) ?? [],
  };
}

/** Kartenblatt: Minenfeld, Blockade, Konvoi am gewählten Feld mit passenden Aktionen. */
export function NavalSheet({ data, sel, onPlan, base }: { data: NavalData | undefined; sel: { col: number; row: number }; onPlan: (t: Target) => void; base?: BaseData }) {
  const now = useNow();
  const a = navalAt(data, sel, now);
  if (a.mines.length === 0 && !a.blockade && a.convoys.length === 0) return null;
  return (
    <div className="mt-1 space-y-1.5 text-xs">
      {a.mines.map((f) => (
        <div key={f.id} className="flex items-start gap-2">
          <Icon id="mine" size={22} />
          <span>
            <strong>Minenfeld</strong> {f.own ? "(deins)" : f.allied ? `(Allianz: ${f.owner})` : `von ${f.owner}`} · Stärke {f.strength}/{f.maxStrength} · verfällt in {fmtDuration(f.expiresAtMs - now)}
            {!f.own && !f.allied && <span className="text-siegel"> – fremde Schiffe, die hindurchfahren, sinken. {f.via === "radar" ? "(vom Radar erfasst)" : ""}</span>}
            {!f.own && !f.allied && <SmallButton className="ml-1 mt-1" onClick={() => onPlan({ col: f.col, row: f.row, naval: "raeumen" })}>Räumen</SmallButton>}
          </span>
        </div>
      ))}
      {a.blockade && (
        <div className="flex items-start gap-2">
          <Icon id="blockade" size={22} />
          <span>
            <strong>Blockade vor {a.blockade.targetName}</strong> durch {a.blockade.attackerName} · noch {fmtDuration(a.blockade.endsAtMs - now)}
            {a.blockade.units && <span className="block text-ink2"><CountsLine counts={a.blockade.units} /></span>}
            {a.blockade.canAttack && <Button className="mt-1" kind={a.blockade.role === "target" ? "primary" : "secondary"} onClick={() => onPlan({ col: a.blockade!.col, row: a.blockade!.row, blockadeId: a.blockade!.id })}>Blockadeverband angreifen</Button>}
          </span>
        </div>
      )}
      {a.convoys.map((c) => <ConvoyCard key={c.id} c={c} now={now} base={base} onPlan={onPlan} />)}
    </div>
  );
}

function ConvoyText({ c, now }: { c: Convoy; now: number }) {
  const last = c.events.at(-1);
  return (
    <>
      <strong>{convoyTitle(c)}{c.enemy && c.recipient ? ` (an ${c.recipient})` : ""}</strong> · {c.cargo ? resLine(c.cargo) : "Ladung unbekannt"}{c.arriveAtMs !== null && ` · Ankunft in ${fmtDuration(c.arriveAtMs - now)}`}
      <span className="block text-ink2">{c.escorted ? <>Geleit: <CountsLine counts={c.escort} /></> : "ohne Geleitschutz – Risiko: das Kartell fängt gelegentlich ab"}</span>
      {last && <span className={`block ${last.escortHeld ? "text-moos" : "text-siegel"}`}>{last.by === "kartell" ? "Kartell" : last.name} griff an: {last.escortHeld ? "abgewehrt" : `verloren ${resLine(last.lost)}`}</span>}
    </>
  );
}

/** Konvoi-Zeile zu einer eigenen Lieferung (Börse, Zeitleiste). */
export function ConvoyLine({ deliveryId }: { deliveryId: string }) {
  const q = useNaval();
  const now = useNow();
  const c = q.data?.convoys.find((x) => x.deliveryId === deliveryId);
  if (!c) return null;
  return <div className="text-xs"><ConvoyText c={c} now={now} /></div>;
}

/** Eigene Handelskonvois unterwegs (Börse). */
export function ConvoyList() {
  const q = useNaval();
  const now = useNow();
  const own = (q.data?.convoys ?? []).filter((c) => c.own);
  if (own.length === 0) return null;
  return (
    <Card title={<><Icon id="konvoi" size={18} /> Konvois unterwegs</>}>
      <ul className="divide-y divide-navy-700">
        {own.map((c) => <li key={c.id} className="py-2 text-sm"><ConvoyText c={c} now={now} /></li>)}
      </ul>
      <p className="text-xs text-ink2 mt-1">Das Kartell fängt gelegentlich ab, Kriegsgegner gezielt. Ohne Geleitschutz geht ein Teil der Ladung verloren.</p>
    </Card>
  );
}

/** Geleitschutz beim Annehmen: Schiffe daheim wählen. */
export function EscortPicker({ base, value, onChange, hint }: { base: BaseData; value: Counts; onChange: (v: Counts) => void; hint?: string }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const ships = base.units.filter((u) => u.home > 0 && meta.data?.balance.units[u.id]?.branch === "see");
  if (ships.length === 0) return <p className="text-xs text-ink2 mt-1">Kein Geleitschutz möglich – keine Schiffe daheim.</p>;
  return (
    <div className="mt-2">
      <div className="text-[11px] font-display uppercase text-ink2">Geleitschutz (optional)</div>
      <ul>
        {ships.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-2 py-1 text-sm">
            <span className="flex items-center gap-1"><Icon id={u.id} size={20} />{label(u.id)} <span className="text-xs text-ink2">({fmtNum(u.home)})</span></span>
            <Stepper value={value[u.id] ?? 0} max={u.home} onChange={(v) => onChange({ ...value, [u.id]: v })} />
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink2">{hint ?? "Die Schiffe fahren der Ware entgegen und kommen mit ihr heim (Treibstoff, ein Missionsplatz). Sie kämpfen, wenn das Kartell oder ein Kriegsgegner den Konvoi abfängt."} Minenräumer im Geleit schützen die Ladung in Minenfeldern.</p>
    </div>
  );
}

/** Blockade aufheben (eigene haltende Mission). */
export function LiftBlockade({ missionId }: { missionId: number }) {
  const q = useNaval();
  const lift = useCommand((i: { key: string; blockadeId: number }) => trpcClient.naval.liftBlockade.mutate(i), () => [trpc.base.pathFilter().queryKey, trpc.naval.pathFilter().queryKey]);
  const b = q.data?.blockades.find((x) => x.role === "own");
  const now = useNow();
  void missionId;
  if (!b) return null;
  return (
    <div className="mt-1">
      <span className="text-xs text-ink2 block">Hält die Blockade vor {b.targetName} noch {fmtDuration(b.endsAtMs - now)}.</span>
      <Button kind="secondary" disabled={lift.busy} onClick={() => void lift.run({ blockadeId: b.id })}>Blockade aufheben</Button>
      <ErrorLine text={lift.error} code={lift.code} />
    </div>
  );
}

/** Berichte der Seeregeln ohne Kampfbericht (Minen, Blockade, Konvoi). */
export function NavalReport({ kind, d }: { kind: string; d: Record<string, unknown> }) {
  if (kind === "minen" && d.mines) {
    const m = d.mines as { action: string; leg?: string; strength?: number; swept?: { owner: string; before: number; after: number }[]; hits?: { owner: string; strength: number; losses: Counts; share?: number }[]; before?: Counts; after?: Counts; refused?: string; lost?: Counts; cargoLeft?: Counts };
    return (
      <Card title={<><Icon id="mine" size={18} /> {m.action === "legen" ? "Minenfeld" : m.action === "raeumen" ? "Räumfahrt" : m.action === "konvoi" ? "Konvoi im Minenfeld" : m.leg === "rueckfahrt" ? "Minenfeld auf der Rückfahrt" : "Minenfeld durchfahren"}</>}>
        {m.action === "legen" && <p className="text-sm">{m.refused ? "Nicht gelegt: Höchstzahl an Feldern erreicht." : `Das Feld hat jetzt Stärke ${m.strength}. Fremde Schiffe, die hindurchfahren, sinken.`}</p>}
        {m.action === "raeumen" && <p className="text-sm">{m.swept && m.swept.length > 0 ? m.swept.map((s) => `Feld von ${s.owner}: ${s.before} → ${s.after}`).join("; ") : "Keine Minen gefunden."}</p>}
        {m.action === "konvoi" && (
          <div className="text-sm space-y-1">
            {m.hits?.map((h, i) => <div key={i}>Feld von {h.owner} (Stärke {h.strength}): Ladung −{Math.round((h.share ?? 0) * 1000) / 10} %{Object.keys(h.losses).length > 0 && <> · Geleit verloren <CountsLine counts={h.losses} /></>}</div>)}
            <div className="text-siegel">Versenkt: {resLine(m.lost)}</div>
            <div className="text-ink2">Ladung danach: {resLine(m.cargoLeft)}</div>
          </div>
        )}
        {m.action === "durchfahrt" && (
          <div className="text-sm space-y-1">
            {m.hits?.map((h, i) => <div key={i}>Feld von {h.owner} (Stärke {h.strength}): verloren <CountsLine counts={h.losses} /></div>)}
            <div className="text-ink2">Vorher <CountsLine counts={m.before} /> · danach <CountsLine counts={m.after} /></div>
          </div>
        )}
      </Card>
    );
  }
  if (kind === "blockade" && d.blockade) {
    const b = d.blockade as { targetName?: string; attackerName?: string; endsAtMs?: number; refused?: string; factor?: number };
    return (
      <Card title={<><Icon id="blockade" size={18} /> Seeblockade</>}>
        <p className="text-sm">{b.refused ? `Die Blockade vor ${b.targetName} begann nicht: ${b.refused === "fleet_lost" ? "Verband verloren." : errorText(b.refused)}` : `${b.attackerName} blockiert ${b.targetName} bis ${fmtTime(b.endsAtMs ?? 0)}: Produktion −${Math.round((1 - (b.factor ?? 1)) * 100)} %, Lieferungen zurückgehalten, Börsenverkäufe gesperrt.`}</p>
      </Card>
    );
  }
  if (kind === "konvoi" && d.convoy) {
    const c = d.convoy as { by?: string; held?: boolean | null; lost?: Counts; loot?: Counts; cargoLeft?: Counts; missed?: boolean; force?: Counts };
    return (
      <Card title={<><Icon id="konvoi" size={18} /> Konvoi</>}>
        {c.missed ? <p className="text-sm">Der Konvoi war schon eingelaufen.</p> : (
          <div className="text-sm space-y-1">
            <div>{c.by === "kartell" ? <>Kartellverband: <CountsLine counts={c.force} /></> : "Abfangverband eines Kriegsgegners."}</div>
            <div>{c.held === true ? "Der Geleitschutz hat gehalten – nichts verloren." : c.held === false ? "Der Geleitschutz unterlag." : "Ohne Geleitschutz."}</div>
            {c.held !== true && <div className="text-siegel">Verlust: {resLine(c.lost)}{c.loot && Object.keys(c.loot).length > 0 ? ` (davon erbeutet: ${resLine(c.loot)})` : ""}</div>}
            <div className="text-ink2">Ladung danach: {resLine(c.cargoLeft)}</div>
          </div>
        )}
      </Card>
    );
  }
  return null;
}
