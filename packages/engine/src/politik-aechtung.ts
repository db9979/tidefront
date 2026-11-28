// Weltpolitik Stufe 2: Ächtung im Seerat (docs/REGELN-WELTPOLITIK.md, Abschnitt 5a). Option der Wochensitzungen, nur
// wenn es beim Öffnen Berüchtigte gibt (Ruf ≤ −30). Gewinnt sie (normale Auszählung: Quorum, Allianz höchstens 40 %,
// KI-Spieler zusammen eine Stimme und nie für die Ächtung), trifft sie jeden, der beim Schluss berüchtigt ist –
// niemand wird mit Namen zur Wahl gestellt, Rang zählt nicht. Wirkung 72 h: keine KI-Verträge und Gesuche,
// Kopfgeld-Zuschlag +0,2. Endet spätestens an der Finale-Sperre.
import { eq } from "drizzle-orm";
import { aechtungTargets, politikLimitMs, politikOf, withAechtung } from "@tidefront/game-core";
import { tables, type Tx } from "@tidefront/db";
import { balance } from "./context.ts";
import { politikSeason } from "./politik-core.ts";
import { noteAechtung, rufMap, rufRules } from "./politik-ruf.ts";

const HOUR_MS = 3_600_000;

type SitzungRow = typeof tables.seeratSitzung.$inferSelect;

/** Beim Öffnen einer Wochensitzung: Option „Ächtung“ ergänzen, wenn es Berüchtigte gibt (sonst unverändert). */
export async function aechtungOnOpen(tx: Tx, s: SitzungRow, due: number): Promise<string[]> {
  const options = s.options as string[];
  const cfg = rufRules();
  if (s.kind !== "woche" || !cfg || !politikOf(balance)?.seerat.aechtung) return options;
  const any = aechtungTargets([...(await rufMap(tx, due)).values()].map((r) => ({ playerId: r.playerId, value: r.value })), cfg).length > 0;
  const next = withAechtung(options, any);
  if (next !== options) await tx.update(tables.seeratSitzung).set({ options: next }).where(eq(tables.seeratSitzung.id, s.id));
  return next;
}

/**
 * Beschlossene Ächtung anwenden: Merker je Berüchtigtem (jetzt bis +72 h, höchstens bis zur Finale-Sperre) und eine
 * Systemnachricht an jeden Geächteten. Rückgabe: Zahl der Geächteten und Ende.
 */
export async function applyAechtung(tx: Tx, s: SitzungRow, due: number): Promise<{ count: number; untilMs: number }> {
  const cfg = rufRules()!;
  const season = await politikSeason(tx);
  const limit = season ? politikLimitMs(season.startMs, season.endMs, balance) : Number.POSITIVE_INFINITY;
  const untilMs = Math.max(due, Math.min(due + cfg.aechtungHours * HOUR_MS, limit));
  const targets = aechtungTargets([...(await rufMap(tx, due)).values()].map((r) => ({ playerId: r.playerId, value: r.value })), cfg);
  if (!season || targets.length === 0 || untilMs <= due) return { count: 0, untilMs };
  await noteAechtung(tx, season.id, targets, s.id, due, untilMs);
  await tx.insert(tables.message).values(targets.map((id) => ({
    fromPlayerId: null, toPlayerId: id, subject: "Seerat: Du bist geächtet",
    body: `Der Seerat hat alle Berüchtigten geächtet – auch dich (dein Ruf liegt bei −${Math.abs(cfg.beruechtigtTo)} oder tiefer). ${cfg.aechtungHours} Stunden lang schließt kein KI-Spieler mit dir ab und gibt dir kein Gesuch; wer dich angreift, bekommt +${Math.round(cfg.aechtungBounty * 100)} % Kopfgeld. Ruf zurückgewinnen: KI-Verträge erfüllen, Konvois und Felder gegen das Kartell halten, Verbündeten gegen das Kartell helfen.`,
    createdAt: new Date(due),
  })));
  return { count: targets.length, untilMs };
}
