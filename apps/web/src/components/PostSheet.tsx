// Karte → Feld-Blatt, Lagebild Stufe 2: Radarposten auf dem Feld (eigener: Reichweite, Betrieb; fremder: angreifen)
// und Schnellstart „Radarposten errichten“ (freie Küste) bzw. „Patrouille ab hier“ (offene See).
import type { MapData } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";
import type { Target } from "../App.tsx";
import { Icon } from "../icons.tsx";
import { SmallButton } from "../ui.tsx";
import { IntelStand } from "./IntelStand.tsx";

export function PostSheet({ map, sel, now, freeCoast, sea, onPlan }: { map: MapData; sel: Target; now: number; freeCoast: boolean; sea: boolean; onPlan: (t: Target) => void }) {
  const ops = map.intel.ops;
  const post = (map.posts ?? []).find((p) => p.col === sel.col && p.row === sel.row);
  if (!ops) return null;
  return (
    <div className="mt-1 text-xs">
      {post && (
        <div className="flex items-start gap-2">
          <Icon id="radarposten" size={22} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">Radarposten{post.own ? "" : ` · ${post.owner}`}</div>
            {post.rangeKm !== null && <div className="text-ink2">Reichweite {fmtNum(post.rangeKm)} km{post.offline ? " · ohne Treibstoff aus" : " · in Betrieb"}</div>}
            {post.intel && <IntelStand tag={post.intel} now={now} />}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1 mt-1">
        {post && !post.own && <SmallButton onClick={() => onPlan({ col: sel.col, row: sel.row, postId: post.id })}>Posten angreifen</SmallButton>}
        {!post && freeCoast && ops.post && <SmallButton onClick={() => onPlan({ col: sel.col, row: sel.row, intelOp: "radarposten" })}>Radarposten errichten</SmallButton>}
        {sea && ops.patrol && <SmallButton onClick={() => onPlan({ col: sel.col, row: sel.row, intelOp: "patrouille" })}>Patrouille ab hier</SmallButton>}
      </div>
    </div>
  );
}
