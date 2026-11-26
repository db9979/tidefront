import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, httpLink, splitLink, TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@tidefront/api/router";
import { noteServerTime } from "./time.ts";
import { logTrpcError } from "./bug-log.ts";
import { activeBaseId, isNoBase, withBaseId } from "./active-base.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      // Ohne Wiederholung: Abmeldung und „Hafen nicht eigen“ (no_base → sofort zurück zum Heimathafen).
      retry: (n, err) => !(err instanceof TRPCClientError && err.data?.code === "UNAUTHORIZED") && !isNoBase(err) && n < 2,
    },
  },
});

/** Fehlgeschlagene Aufrufe ins Client-Log für „Fehler melden“ (ohne Eingaben). */
const logLink: TRPCLink<AppRouter> = () => ({ op, next }) =>
  observable((observer) =>
    next(op).subscribe({
      next: (v) => observer.next(v),
      error: (err) => {
        logTrpcError(op.path, op.type, err);
        observer.error(err);
      },
      complete: () => observer.complete(),
    }));

/** Mehrere Häfen: hafenbezogene Aufrufe tragen die baseId des aktiven Hafens (ausdrücklich gesetzte bleibt). */
const activeBaseLink: TRPCLink<AppRouter> = () => ({ op, next }) => {
  const input = withBaseId(op.path, op.input, activeBaseId());
  return next(input === op.input ? op : { ...op, input });
};

const sameOrigin = (url: RequestInfo | URL, opts: unknown) => fetch(url, { ...(opts as RequestInit), credentials: "same-origin" });

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    logLink,
    activeBaseLink,
    // Fehlermeldungen (mit Screenshot) einzeln: nur dieser Weg darf große Anfragen senden.
    splitLink({
      condition: (op) => op.path === "bugReport.send",
      true: httpLink({ url: "/trpc", fetch: sameOrigin }),
      false: httpBatchLink({ url: "/trpc", fetch: sameOrigin }),
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient });

export type Outputs = inferRouterOutputs<AppRouter>;
export type BaseData = NonNullable<Outputs["base"]["get"]["base"]>;
export type MapData = Outputs["world"]["map"];
export type Balance = Outputs["meta"]["balance"];

/**
 * Frische Antworten mit serverNow aktualisieren den Zeitversatz. Nur bei erfolgreichem Abruf und nur, wenn die Daten
 * neuer sind als die zuletzt übernommenen: Statuswechsel (Abruf beginnt, Invalidierung, Fehler) melden ebenfalls
 * „updated“, tragen aber noch die alten Daten – deren serverNow würde die Uhr zurückspringen lassen.
 */
let serverTimeFrom = 0;
queryClient.getQueryCache().subscribe((e) => {
  if (e.type !== "updated" || e.action.type !== "success") return;
  const data = e.query.state.data as { serverNow?: number } | undefined;
  const at = e.query.state.dataUpdatedAt;
  if (!data || typeof data.serverNow !== "number" || at <= serverTimeFrom) return;
  serverTimeFrom = at;
  noteServerTime(data.serverNow);
});
