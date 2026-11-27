// Abholen mit Lagerwarnung für Tagesbefehle, Wochenziele und Erfolge (seit 0.24.0 liefern sie nur bis zur
// Lagergrenze des Heimathafens). Vor dem Abholen: was je Ressource verfiele, mit Bestand/Kapazität des
// Heimathafens, Knopf „Lagerkomplex ausbauen“ und „Trotzdem abholen“. Nach dem Abholen: lostNote() für die Bestätigung.
import { useNav } from "../lib/nav.ts";
import { setActiveBase } from "../lib/active-base.ts";
import { fmtNum, label } from "../lib/names.ts";
import { Icon } from "../icons.tsx";
import { Button } from "../ui.tsx";

/** Lager des Heimathafens, wie es die Ansichten daily.get, achievements.get und achievements.weekly liefern. */
export type RewardStorage = { baseName: string; capacity: number; resources: Record<string, number> } | null | undefined;
type Reward = Record<string, number> | null | undefined;
export type Overflow = { id: string; amount: number; have: number; lost: number };

/**
 * Was beim Abholen verfiele, je Ressource. Mehrere Belohnungen (Ziel + Wochenbonus) werden nacheinander
 * eingelagert wie auf dem Server; Kredite und andere Nicht-Ressourcen zählen nicht.
 */
export function overflowOf(storage: RewardStorage, rewards: Reward[]): Overflow[] {
  if (!storage || !(storage.capacity > 0)) return [];
  const cur = { ...storage.resources };
  const out = new Map<string, Overflow>();
  for (const reward of rewards) {
    for (const [id, n] of Object.entries(reward ?? {})) {
      if (!(n > 0) || !(id in storage.resources)) continue;
      const have = cur[id] ?? 0;
      const add = Math.min(n, Math.max(0, storage.capacity - have));
      cur[id] = have + add;
      const o = out.get(id) ?? { id, amount: 0, have: storage.resources[id] ?? 0, lost: 0 };
      o.amount += n;
      o.lost += n - add;
      out.set(id, o);
    }
  }
  return [...out.values()].filter((o) => Math.round(o.lost) > 0).map((o) => ({ ...o, lost: Math.round(o.lost) }));
}

/** Satz für die Bestätigung nach dem Abholen, oder "" wenn nichts verfallen ist. */
export function lostNote(lost: Record<string, number> | null | undefined): string {
  const parts = Object.entries(lost ?? {}).filter(([, n]) => Math.round(n) > 0).map(([id, n]) => `${fmtNum(Math.round(n))} ${label(id)}`);
  return parts.length ? ` Lager voll: ${parts.join(", ")} verfallen.` : "";
}

/**
 * Knopf „Abholen“ mit Lagerwarnung. rewards: alles, was dieses Abholen einlagert (z. B. Ziel und Wochenbonus).
 * onExpand: eigener Weg zum Lagerkomplex (z. B. Blatt erst schließen); sonst über die App-Navigation.
 */
export function RewardClaim(props: { storage: RewardStorage; rewards: Reward[]; busy: boolean; onClaim: () => void; onExpand?: () => void; className?: string }) {
  const nav = useNav();
  const over = overflowOf(props.storage, props.rewards);
  const expand = () => {
    // Belohnungen gehen in den Heimathafen: dort ausbauen.
    if (nav.base && !nav.base.isHome) setActiveBase(null);
    if (props.onExpand) props.onExpand();
    else nav.go({ to: "building", id: "lagerkomplex" });
  };
  if (over.length === 0) {
    return <Button className={props.className ?? "w-full mt-1.5"} disabled={props.busy} onClick={props.onClaim}>Abholen</Button>;
  }
  const s = props.storage!;
  return (
    <div className={`mt-1.5 border border-messing/60 bg-messing/5 px-2 py-1.5 ${props.className ?? ""}`} role="note" aria-label="Lagerwarnung">
      <p className="text-[12px] font-semibold text-messing">Lager zu voll – beim Abholen verfiele:</p>
      <ul className="mt-0.5 space-y-0.5">
        {over.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-x-1.5 text-[12px]">
            <Icon id={o.id} size={16} />
            <span className="mono">{fmtNum(o.lost)}</span>
            <span>von {fmtNum(o.amount)} {label(o.id)}</span>
            <span className="text-ink2 ml-auto mono whitespace-nowrap">Lager {fmtNum(o.have)}/{fmtNum(s.capacity)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-ink2 mt-0.5">Belohnungen gehen in den Heimathafen {s.baseName}. Du kannst sie auch später abholen.</p>
      <div className="flex gap-2 mt-1.5">
        <Button kind="secondary" className="flex-1 px-2" onClick={expand}>Lagerkomplex ausbauen</Button>
        <Button kind="ghost" className="flex-1 px-2" disabled={props.busy} onClick={props.onClaim}>Trotzdem abholen</Button>
      </div>
    </div>
  );
}
