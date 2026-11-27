// Missionsplanung „Spionage“: Auftragsart, Ziel (Karte) bzw. Kartell, Sabotageziel, Vorschau mit offenem W20
// (Erfolgswert, Abwehr, Zielzahl, Erfolgs- und Enttarnungs-Chance). Gerechnet wird nur auf dem Server.
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData, type MapData } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum } from "../lib/names.ts";
import { fmtSeconds, fmtTime } from "../lib/time.ts";
import type { Target } from "../App.tsx";
import { HexMap } from "../screens/LazyHexMap.tsx";
import { Icon } from "../icons.tsx";
import { RELATION_HEX } from "../map/TacticalIcon.tsx";
import { Button, Card, ErrorLine } from "../ui.tsx";
import { ReasonLine } from "./Remedy.tsx"; // „Was hilft?“

type Kind = "erkunden" | "sabotage" | "desinformation" | "kartell";

export const SPY_KINDS: { id: Kind; text: string; icon: string; hint: string }[] = [
  { id: "erkunden", text: "Erkunden", icon: "aufklaerung", hint: "Lagebild wie Aufklärung, dazu Forschung, Bauschlange, Ausbildung und Veteranen; ab Stufe 4 auch die Missionen des Ziels." },
  { id: "sabotage", text: "Sabotage", icon: "sabotage", hint: "Ein Gebäude fällt für einige Stunden aus oder der Ausbau verzögert sich. Nicht gegen Verbündete und Paktpartner, höchstens einmal je Ziel und 24 Stunden." },
  { id: "desinformation", text: "Desinformation", icon: "spionage", hint: "Das Ziel sieht im nächsten Lagebild über dich verfälschte Zahlen (mehr Truppen, weniger Vorräte)." },
  { id: "kartell", text: "Kartell", icon: "kartell", hint: "Informanten im Kartell: nächstes Weltereignis, Routen, Zielhäfen und Zeitplan genauer und früher." },
];

const SABOTAGE_TARGETS: { id: string; text: string }[] = [
  { id: "kraftwerk", text: "Kraftwerk – Gebäudeproduktion halbiert" },
  { id: "radarstation", text: "Radarstation – keine Vorwarnung" },
  { id: "werft", text: "Werft – Bau steht still, neue Aufträge dauern doppelt" },
  { id: "kaserne", text: "Kaserne – Ausbildung steht still, neue dauern doppelt" },
  { id: "flugfeld", text: "Flugfeld – Ausbildung steht still, neue dauern doppelt" },
  { id: "forschungsamt", text: "Forschungsamt – Forschung steht still, neue dauert doppelt" },
  { id: "bauschlange", text: "Bauschlange – Ausbau verzögert sich" },
  { id: "seekabel", text: "Seekabel – Kabel unterbrochen (nur Kriegsgegner)" },
];

const PART: Record<string, string> = {
  grundwert: "Grundwert", nachrichtendienst: "Nachrichtendienst", forschung: "Forschung", erfahrung: "Erfahrung", auftrag: "Auftragsart", kartell: "Abwehr des Kartells",
};

export function partsText(v: { parts: { id: string; value: number }[] }): string {
  return v.parts.filter((p) => p.value !== 0).map((p) => `${PART[p.id] ?? p.id} ${p.value > 0 ? "+" : "−"}${Math.abs(p.value)}`).join(" · ") || "0";
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
/** Verhältnis zum Ziel (aus der Kartenansicht); neutral ohne Zusatz. */
const REL: Record<string, string> = { own: "eigener Hafen", allianz: "Allianzmitglied", pakt: "Paktpartner", krieg: "Kriegsgegner", neutral: "" };

export function SpyPlan({ base, map, target, setTarget, center, onClose }: { base: BaseData; map: MapData; target: Target | null; setTarget: (t: Target | null) => void; center: Target; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>("erkunden");
  const [building, setBuilding] = useState("kraftwerk");
  const [sent, setSent] = useState<{ arriveAtMs: number; chance: number } | null>(null);
  const intel = base.intel;
  const level = intel?.level ?? 0;
  const minLevel = (k: Kind) => ({ erkunden: 1, desinformation: 2, kartell: 2, sabotage: 3 })[k];
  const input = kind === "kartell"
    ? { kind }
    : target && !target.eventId ? { kind, col: target.col, row: target.row, ...(kind === "sabotage" ? { building } : {}) } : null;
  const preview = useQuery({ ...trpc.espionage.preview.queryOptions(input ?? { kind }), enabled: !!input, placeholderData: keepPreviousData, refetchInterval: 60_000 }); // Ankunftszeit aktuell
  const launch = useCommand(
    (i: { key: string; kind: Kind; col?: number; row?: number; building?: string }) => trpcClient.espionage.launch.mutate(i),
    () => [trpc.base.pathFilter().queryKey],
  );
  const tBase = target && !target.eventId ? map.bases.find((b) => b.col === target.col && b.row === target.row) : undefined;
  const p = input ? preview.data : undefined;

  if (sent) {
    return (
      <Card title="Spion unterwegs">
        <div className="flex items-center gap-3"><Icon id="spion" size={48} /><p>Ankunft {fmtTime(sent.arriveAtMs)} · Erfolgschance {pct(sent.chance)}. Der Spionagebericht erscheint unter „Meldungen“ – das Ziel bemerkt nichts, solange er nicht enttarnt wird.</p></div>
        <Button className="mt-3 w-full" onClick={onClose}>Fertig</Button>
      </Card>
    );
  }

  return (
    <>
      <Card title="Auftrag" right={<span className="text-xs text-slate-400">Nachrichtendienst Stufe {level} · {fmtNum(intel?.spies.home ?? 0)} Spione daheim</span>}>
        {level < 1 && <p className="text-sm text-brass-300 mb-2">Erst einen Nachrichtendienst bauen und Spione ausbilden (Basis → Hafen → Führung und Schutz).</p>}
        <div className="grid grid-cols-2 gap-2">
          {SPY_KINDS.map((k) => (
            <button key={k.id} type="button" onClick={() => setKind(k.id)} className={`tap rounded-xl px-1 py-2 text-sm flex flex-col items-center gap-1 border ${kind === k.id ? "border-sea-400 bg-sea-400/10 font-semibold reticle" : "border-navy-600 bg-navy-900"}`}>
              <Icon id={k.icon} size={28} />
              {k.text}
              {level < minLevel(k.id) && <span className="text-[11px] text-slate-400">ab Stufe {minLevel(k.id)}</span>}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-1">{SPY_KINDS.find((k) => k.id === kind)!.hint}</p>
      </Card>

      {kind !== "kartell" && (
        <Card title="Ziel">
          <div className="h-56 rounded-lg overflow-hidden mb-2">
            <HexMap data={map} selected={target} onSelect={setTarget} center={center} />
          </div>
          <p className="text-sm">
            {!target || target.eventId ? "Spielerhafen auf der Karte antippen." : tBase ? <>Hafen <strong>{tBase.name}</strong> ({tBase.owner}){REL[tBase.relation] && <span className="font-semibold" style={{ color: RELATION_HEX[tBase.relation] }}> · {REL[tBase.relation]}</span>}</> : <span className="text-slate-400">Feld {target.col}/{target.row}: kein Hafen</span>}
          </p>
        </Card>
      )}

      {kind === "sabotage" && (
        <Card title="Sabotageziel">
          <div className="space-y-1">
            {SABOTAGE_TARGETS.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm min-h-[40px]">
                <input type="radio" name="sabotage" checked={building === t.id} onChange={() => setBuilding(t.id)} />
                <Icon id={t.id === "bauschlange" ? "kran" : t.id} size={22} /> {t.text}
              </label>
            ))}
          </div>
        </Card>
      )}

      <Card title="Probe (offener W20)">
        {!input ? (
          <p className="text-sm text-slate-400">Ziel wählen.</p>
        ) : !p ? (
          <p className="text-sm text-slate-400">Berechne …</p>
        ) : (
          <div className="text-sm space-y-1">
            {"success" in p && p.success && p.defense && (
              <>
                <div className="flex justify-between"><span>Erfolgswert</span><strong className="mono">{p.success.total}</strong></div>
                <div className="text-xs text-slate-400">{partsText(p.success)}</div>
                <div className="flex justify-between"><span>{kind === "kartell" ? "Abwehr des Kartells" : "Abwehr des Ziels"}</span><strong className="mono">− {p.defense.total}</strong></div>
                <div className="text-xs text-slate-400">{partsText(p.defense)}</div>
                <div className="flex justify-between gap-2 border-t border-rule pt-1">
                  <span>Gelingt bei Wurf (W{p.die}) von 1 bis</span><strong className="mono">{p.threshold}</strong>
                </div>
                {/* Breite in CSS-Schreibweise (pct() setzt ein Leerzeichen vor %, das wäre ungültig). */}
                <div className="flex h-2.5 overflow-hidden rounded bg-navy-950 mt-1" role="img" aria-label={`Erfolg ${pct(p.chance)}, Enttarnung ${pct(p.detectChance)}`}>
                  <div className="bg-moos" style={{ width: `${Math.round(p.chance * 100)}%` }} />
                  <div className="bg-siegel flex-1" />
                </div>
                <div className="flex justify-between text-xs font-semibold"><span className="text-moos">Erfolg {pct(p.chance)}</span><span className="text-siegel">Enttarnt {pct(p.detectChance)}</span></div>
                <p className="text-xs text-slate-400">
                  Misslingt der Wurf, wird der Spion enttarnt: {kind === "kartell" ? "er ist verloren." : "er ist verloren und das Ziel erfährt, wer ihn geschickt hat."} Gewürfelt wird bei Ankunft mit den dann gültigen Werten.
                </p>
              </>
            )}
            {p.ok ? (
              <div className="pt-1 border-t border-rule">
                <div>{fmtNum(p.spies)} {p.spies === 1 ? "Spion" : "Spione"} · {kind === "kartell" ? "Treffen mit Informanten" : `${fmtNum(p.distanceKm)} km`} · Reise {fmtSeconds(p.travelSeconds)} je Richtung, ohne Treibstoff</div>
                <div>Ankunft {fmtTime(p.arriveAtMs)} · zurück {fmtTime(p.returnAtMs)}</div>
              </div>
            ) : (
              <ReasonLine code={p.code} detail={{ type: kind }} className="text-red-300" />
            )}
          </div>
        )}
        <Button
          className="w-full mt-3"
          disabled={!p?.ok || launch.busy}
          onClick={async () => {
            if (!input) return;
            const r = await launch.run(input);
            if (r && r.ok) setSent({ arriveAtMs: r.arriveAtMs, chance: r.chance });
          }}
        >
          Spion entsenden
        </Button>
        <ErrorLine text={launch.error} code={launch.code} detail={{ type: kind }} />
      </Card>
    </>
  );
}

/** Name einer Spionage-Art (Truppen-Liste, Berichte). */
export function spyKindText(kind: string | null | undefined): string {
  return SPY_KINDS.find((k) => k.id === kind)?.text ?? (kind === "kartell" ? "Kartell-Aufklärung" : "Spionage");
}
