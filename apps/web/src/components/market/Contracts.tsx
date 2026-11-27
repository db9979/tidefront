// Börse, Reiter „Verträge“ (Lieferverträge, v1.31): Angebote der KI-Spieler, Verträge mit Spielern und die eigene
// Vertragsliste mit Status, Fälligkeit, Lieferung und Kündigung (mit genauer Strafe).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData, type Outputs } from "../../lib/trpc.ts";
import { useCommand } from "../../lib/command.ts";
import { fmtNum, label } from "../../lib/names.ts";
import { fmtDuration, useNow } from "../../lib/time.ts";
import { Badge, Button, Card, ErrorLine, Loading } from "../../ui.tsx";
import { Icon } from "../../icons.tsx";
import { when } from "./calc.ts";
import { KiOffers } from "./ContractsKi.tsx";
import { PlayerContracts } from "./ContractsPlayer.tsx";

export type ContractsData = Extract<Outputs["contracts"]["list"], { enabled: true }>;
type Mine = ContractsData["mine"][number];
type Res = { ok: boolean; code?: string };

export const contractsInvalidate = () => [trpc.contracts.pathFilter().queryKey, trpc.base.pathFilter().queryKey, trpc.market.pathFilter().queryKey, trpc.naval.pathFilter().queryKey];

const STATUS: Record<string, { text: string; tone: "slate" | "brass" | "green" | "red" | "sea" }> = {
  angeboten: { text: "angeboten", tone: "sea" },
  offen: { text: "offen", tone: "slate" },
  nachfrist: { text: "Nachfrist", tone: "red" },
  erfuellt: { text: "erfüllt", tone: "green" },
  teilweise: { text: "teilweise erfüllt", tone: "brass" },
  geplatzt: { text: "geplatzt", tone: "red" },
  gekuendigt: { text: "gekündigt", tone: "slate" },
  zurueckgezogen: { text: "zurückgezogen", tone: "slate" },
  abgelaufen: { text: "abgelaufen", tone: "slate" },
  rueckabgewickelt: { text: "rückabgewickelt", tone: "slate" },
};

export const kr = (n: number) => `${fmtNum(n, 2)} T`;

export function Contracts({ base }: { base: BaseData }) {
  const q = useQuery({ ...trpc.contracts.list.queryOptions(), refetchInterval: 60000 });
  if (!q.data) return <Loading cards={2} error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.enabled) return <Card title="Verträge"><p className="text-sm text-ink2">Lieferverträge gibt es in dieser Saison nicht.</p></Card>;
  const d = q.data;
  const reserved = Object.entries(d.reserved).filter(([, n]) => n > 0);
  return (
    <div>
      <Card title={<><Icon id="credits" size={18} /> Lieferverträge</>} right={<span className="text-[11px] text-ink2">offen {d.openCount}/{d.cfg.maxOpen}</span>}>
        <p className="text-sm font-serif italic">Ein Vertrag ist nie billiger als die Börse. Du zahlst für den festen Preis und für die Lieferung später.</p>
        <p className="text-xs text-ink2 mt-1">
          Anzahlung bzw. Pfand {fmtNum(d.cfg.depositShare * 100)} % sofort in Treuhand, der Rest bei Fälligkeit. Reicht es dann nicht:
          {" "}{d.cfg.graceHours} h Nachfrist, danach anteilig – {fmtNum(d.cfg.penaltyShare * 100)} % des nicht erfüllten Werts verfallen.
          Vertragslieferungen je Ressource höchstens {fmtNum(d.contractLimit)} in 24 h ({fmtNum(d.cfg.limitShare * 100)} % des Tageslimits).
        </p>
        {reserved.length > 0 && (
          <p className="text-xs text-ink2 mt-1" data-testid="contracts-reserved">
            Im Tageslimit der Börse für Verträge vorgemerkt (nächste 24 h): {reserved.map(([r, n]) => `${fmtNum(n)} ${label(r)}`).join(", ")}.
          </p>
        )}
      </Card>
      <KiOffers base={base} data={d} />
      <PlayerContracts base={base} data={d} />
      <MyContracts data={d} />
    </div>
  );
}

function MyContracts({ data }: { data: ContractsData }) {
  const now = useNow(30000);
  const cancel = useCommand((i: { key: string; contractId: number }) => trpcClient.contracts.cancel.mutate(i) as Promise<Res>, contractsInvalidate);
  const withdraw = useCommand((i: { key: string; contractId: number }) => trpcClient.contracts.withdraw.mutate(i) as Promise<Res>, contractsInvalidate);
  // Abos zusammenfassen: je Abo eine Zeile (die nächste offene Tranche), Rest als Zahl.
  const rows: (Mine & { more: number })[] = [];
  const seen = new Map<number, Mine & { more: number }>();
  for (const c of [...data.mine].sort((a, b) => a.dueAtMs - b.dueAtMs)) {
    if (c.aboId === null) { rows.push({ ...c, more: 0 }); continue; }
    const first = seen.get(c.aboId);
    if (first && first.status === c.status) { first.more++; continue; }
    const row = { ...c, more: 0 };
    seen.set(c.aboId, row);
    rows.push(row);
  }
  rows.sort((a, b) => (a.closedAtMs === null ? 0 : 1) - (b.closedAtMs === null ? 0 : 1) || a.dueAtMs - b.dueAtMs);
  return (
    <Card title={<><Icon id="nav-bericht" size={18} /> Meine Verträge</>}>
      {rows.length === 0 ? (
        <p className="text-sm text-ink2 py-2 text-center font-serif italic">Noch keine Verträge.</p>
      ) : (
        <ul aria-label="Meine Verträge">
          {rows.map((c) => <MineRow key={c.id} c={c} now={now} busy={cancel.busy || withdraw.busy}
            onCancel={() => void cancel.run({ contractId: c.id })} onWithdraw={() => void withdraw.run({ contractId: c.id })} />)}
        </ul>
      )}
      <ErrorLine text={cancel.error ?? withdraw.error} code={cancel.error ? cancel.code : withdraw.code} />
    </Card>
  );
}

function MineRow({ c, now, busy, onCancel, onWithdraw }: { c: Mine & { more: number }; now: number; busy: boolean; onCancel: () => void; onWithdraw: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const st = STATUS[c.status] ?? { text: c.status, tone: "slate" as const };
  const running = c.status === "offen" || c.status === "nachfrist";
  const who = c.partner ?? (c.target ? `an ${c.target}` : "an alle");
  return (
    <li className="py-2.5 pl-2.5 dotted-row border-l-[3px] border-l-rule" data-testid="contract-row">
      <div className="flex items-center gap-2 text-sm">
        <Icon id={c.resource} size={18} />
        <strong className="min-w-0 flex-1 truncate">
          {c.side === "buy" ? "Kauf" : "Lieferung"} {fmtNum(c.qty)} {label(c.resource)}
          <span className="font-normal text-ink2"> · {c.partner ? `${c.side === "buy" ? "von" : "an"} ${c.partner}` : `Angebot ${who}`}</span>
        </strong>
        <Badge tone={st.tone}>{st.text}</Badge>
      </div>
      <div className="text-xs text-ink2 mt-1 flex flex-wrap gap-x-3">
        <span className="mono">{fmtNum(c.unitPrice, 3)} je Einheit · {kr(c.totalCredits)}</span>
        {c.tranches > 1 && <span>Abo {c.tranche}/{c.tranches}{c.more > 0 ? ` (+${c.more} weitere)` : ""}</span>}
        {running && <span>fällig {when(c.dueAtMs, now)} Uhr (in {fmtDuration(Math.max(0, c.dueAtMs - now))})</span>}
        {c.status === "nachfrist" && c.graceUntilMs && <span className="text-siegel">Nachfrist bis {when(c.graceUntilMs, now)} Uhr</span>}
        {c.status === "angeboten" && c.offerUntilMs && <span>gilt bis {when(c.offerUntilMs, now)} Uhr</span>}
        {c.delivery === "konvoi" && <span>Konvoi über die Seewege{c.deliveryId && c.closedAtMs ? " – unterwegs bzw. eingelaufen (Karte)" : ""}</span>}
        {c.deliveredQty !== null && c.status !== "erfuellt" && <span>geliefert {fmtNum(c.deliveredQty)}</span>}
        {c.penaltyCredits > 0 && <span className="text-siegel">verfallen {kr(c.penaltyCredits)}</span>}
        {!c.counts && <span>zählt nicht für Erfolge (verbundene Spieler)</span>}
      </div>
      {running && !confirm && (
        <div className="flex justify-end mt-1">
          <Button kind="secondary" disabled={busy} onClick={() => setConfirm(true)}>Kündigen</Button>
        </div>
      )}
      {c.status === "angeboten" && c.own && (
        <div className="flex justify-end mt-1"><Button kind="secondary" disabled={busy} onClick={onWithdraw}>Zurückziehen</Button></div>
      )}
      {confirm && (
        <div className="mt-2 rounded-lg border border-siegel p-2" role="group" aria-label="Kündigung bestätigen">
          <p className="text-sm">
            Kündigen kostet dich <strong className="mono">{kr(c.cancelPenaltyCredits ?? 0)}</strong>
            {c.tranches > 1 ? " (alle offenen Tranchen des Abos)" : ""}. Der Rest deiner Sicherheit kommt zurück.
          </p>
          <div className="flex gap-2 mt-2">
            <Button kind="secondary" className="flex-1" onClick={() => setConfirm(false)}>Abbrechen</Button>
            <Button kind="danger" className="flex-1" disabled={busy} onClick={() => { setConfirm(false); onCancel(); }}>Kündigung bestätigen</Button>
          </div>
        </div>
      )}
    </li>
  );
}
