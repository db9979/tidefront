// Die Karte (PixiJS) wird erst geladen, wenn ein Screen sie zeigt; der erste Start bleibt schlank.
import { lazy, Suspense, type ComponentProps } from "react";
import { Icon } from "../icons.tsx";

const Inner = lazy(() => import("./HexMap.tsx").then((m) => ({ default: m.HexMap })));

export type HexMapProps = ComponentProps<typeof Inner>;

function MapLoading() {
  return (
    <div className="w-full h-full grid place-items-center bg-navy-950/60">
      <div className="flex flex-col items-center gap-2 text-slate-400">
        <Icon id="nav-karte" size={40} className="animate-pulse" />
        <span className="font-display uppercase text-sm">Karte lädt …</span>
      </div>
    </div>
  );
}

export function HexMap(props: HexMapProps) {
  return (
    <Suspense fallback={<MapLoading />}>
      <Inner {...props} />
    </Suspense>
  );
}
