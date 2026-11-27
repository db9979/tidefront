// Spieler gegen Spieler (Kopfgeld, Mutfaktor, Paarbremse): Kennzeichen in der Rangliste, Hinweis beim Zielen
// (Missionsplanung, Kartenblatt eines Spielerhafens) und Zeile im Kampfbericht. Regeln: Handbuch „Spieler gegen Spieler“.
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";

const factor = (f: number) => `×${fmtNum(f, 2)}`;

/** Kopfgeld-Kennzeichen (Rangliste, Spielerübersicht). */
export function BountyMark({ pct, long = false }: { pct: number | null | undefined; long?: boolean }) {
  if (!pct) return null;
  return (
    <span title={`Kopfgeld: Kampfpunkte +${pct} % für schlechter Platzierte, die diesen Spieler angreifen (Rang zum Tagesbeginn)`}
      data-testid="bounty-mark"
      className="ml-1 align-[1px] rounded border border-messing px-1 text-[11px] font-semibold text-messing whitespace-nowrap">
      {long ? `Kopfgeld +${pct} %` : `+${pct} %`}
    </span>
  );
}

/**
 * Was ein Überfall auf den Spielerhafen auf col/row für die Wertung bedeutet; dazu der Hinweis, wenn der eigene
 * Anfängerschutz damit endet. Ohne fremden Spielerhafen nichts.
 */
export function PvpTargetHint({ col, row, beginner = true }: { col: number; row: number; beginner?: boolean }) {
  const q = useQuery({ ...trpc.social.pvpTarget.queryOptions({ col, row }), staleTime: 60000 });
  const t = q.data?.target;
  if (!t) return null;
  const lines: { text: string; tone: string }[] = [];
  if (t.bountyPct > 0) lines.push({ text: `Kopfgeld +${t.bountyPct} % auf deine Kampfpunkte (${t.name} ist Rang ${t.targetRank}).`, tone: "text-messing font-semibold" });
  else if (t.bountyBlocked) lines.push({ text: `Kein Kopfgeld: Handel, Transport, Allianz oder Pakt mit ${t.name} in den letzten ${t.collusionDays} Tagen.`, tone: "text-ink2" });
  if (Math.abs(t.mut - 1) > 0.005) {
    lines.push({ text: `Mutfaktor ${factor(t.mut)} auf Kampf- und Beutepunkte (${t.mut > 1 ? "stärkerer" : "schwächerer"} Gegner).`, tone: t.mut > 1 ? "text-moos" : "text-ink2" });
  }
  if (t.pairFights > 0) {
    lines.push({
      text: t.pairFactor > 0
        ? `Paarbremse: ${t.pairFights}. Kampf mit ${t.name} in ${t.pairWindowHours} h – zählt nur ${factor(t.pairFactor)} für die Wertung.`
        : `Paarbremse: schon ${t.pairFights} Kämpfe mit ${t.name} in ${t.pairWindowHours} h – dieser zählt nicht für die Wertung.`,
      tone: "text-siegel",
    });
  }
  if (t.collusion && !t.bountyBlocked && t.bountyPct === 0) lines.push({ text: `Absprache-Sperre: Handel, Transport, Allianz oder Pakt in den letzten ${t.collusionDays} Tagen – kein Kopfgeld, Mutfaktor höchstens ×1.`, tone: "text-ink2" });
  const warn = beginner && t.beginnerEnds;
  if (lines.length === 0 && !warn) return null;
  return (
    <div className="mt-1 text-xs space-y-0.5" data-testid="pvp-hint">
      {lines.map((l) => <div key={l.text} className={l.tone}>{l.text}</div>)}
      {warn && <div className="text-siegel font-semibold" data-testid="beginner-ends">Dein Anfängerschutz endet damit: Ein Überfall auf einen Spielerhafen beendet ihn sofort, danach kannst auch du angegriffen werden.</div>}
    </div>
  );
}

interface Stamp { bountyRank: number | null; bountyFactor: number; mut: number; collusion: boolean; defenderRank: number | null }

/** Kampfbericht zwischen Spielern: festgehaltenes Kopfgeld, Mutfaktor, Absprache, ggf. „aus der Wertung genommen“. */
export function PvpReportNote({ d }: { d: Record<string, unknown> }) {
  const s = d.pvp as Stamp | undefined;
  if (!s && !d.pvpExcluded) return null;
  const parts: string[] = [];
  if (s) {
    if (s.bountyFactor > 1) parts.push(`Kopfgeld +${fmtNum((s.bountyFactor - 1) * 100)} % (Ziel Rang ${s.bountyRank})`);
    if (s.bountyRank !== null) parts.push(`Verteidigung von Rang ${s.bountyRank} zählt halb`);
    if (Math.abs(s.mut - 1) > 0.005) parts.push(`Mutfaktor ${factor(s.mut)}`);
    if (s.collusion) parts.push("Absprache-Sperre (kein Kopfgeld)");
  }
  if (d.pvpExcluded) parts.push("von der Verwaltung aus der Wertung genommen");
  if (parts.length === 0) return null;
  return (
    <p className="text-xs text-ink2 mb-2" data-testid="pvp-report">
      Wertung: {parts.join(" · ")}.
    </p>
  );
}
