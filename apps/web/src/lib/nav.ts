// Sprungziele aus Hinweisen („Was hilft?“): App.tsx stellt Navigation und aktiven Hafen bereit, jede Komponente kann springen.
import { createContext, useContext } from "react";
import type { BaseData } from "./trpc.ts";
import type { NavTarget } from "./remedies/types.ts";

export interface NavApi {
  go: (t: NavTarget) => void;
  base: BaseData | null;
}

export const NavContext = createContext<NavApi>({ go: () => {}, base: null });

export function useNav(): NavApi {
  return useContext(NavContext);
}
