import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@tidefront/api/router";
import { noteServerTime } from "./time.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: (n, err) => !(err instanceof TRPCClientError && err.data?.code === "UNAUTHORIZED") && n < 2,
    },
  },
});

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/trpc",
      fetch: (url, opts) => fetch(url, { ...(opts as RequestInit), credentials: "same-origin" }),
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient });

export type Outputs = inferRouterOutputs<AppRouter>;
export type BaseData = NonNullable<Outputs["base"]["get"]["base"]>;
export type MapData = Outputs["world"]["map"];
export type Balance = Outputs["meta"]["balance"];

/** Antworten mit serverNow aktualisieren den Zeitversatz. */
queryClient.getQueryCache().subscribe((e) => {
  const data = e.query.state.data as { serverNow?: number } | undefined;
  if (e.type === "updated" && data && typeof data.serverNow === "number") noteServerTime(data.serverNow);
});
