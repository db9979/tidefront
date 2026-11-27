// Web Worker für rechenintensive Kampfsuchen (nicht im Haupt-Thread, damit die Oberfläche nicht stockt):
//   win   – „Was fehlt zum Sieg?“ (game-core searchWinningForce), mit Fortschritt
//   plans – „Lohnende Ziele“: Vorschlag je Nest (planNestRaid)
// Nachrichten: { id, kind, … } → { id, progress } … { id, result } bzw. { id, error }.
import { searchWinningForce, type Balance as CoreBalance, type WinSearchInput } from "@tidefront/game-core";
import { planNestRaid, type PlanJob } from "./raid-plan.ts";
import type { Balance } from "./trpc.ts";

type Msg =
  | { id: number; kind: "win"; input: WinSearchInput; balance: Balance }
  | { id: number; kind: "plans"; jobs: PlanJob[]; balance: Balance };

const post = (m: unknown) => (self as unknown as { postMessage: (m: unknown) => void }).postMessage(m);

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.kind === "win") {
      let last = 0;
      const result = searchWinningForce(m.input, m.balance as unknown as CoreBalance, (p) => {
        if (p - last >= 0.02 || p >= 1) { last = p; post({ id: m.id, progress: p }); }
      });
      post({ id: m.id, result });
    } else {
      const result = m.jobs.map((j) => ({ key: j.key, plan: planNestRaid(j.full, j.level, m.balance, j.opts) }));
      post({ id: m.id, result });
    }
  } catch (err) {
    post({ id: m.id, error: String(err) });
  }
};
