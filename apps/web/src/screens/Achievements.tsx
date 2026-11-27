// Erfolge (Meldungen → Erfolge): Abzeichen-Raster im Kupferstich-Stil, gesperrt grau, Stufen Bronze/Silber/Gold,
// Fortschrittsbalken zur nächsten Stufe, Abholen der Belohnungen. Antippen zeigt alle drei Stufen.
// Errungene (ab Bronze oder mit Abholbarem) oben als große Kacheln, gesperrte darunter als kleines 4-Spalten-Raster.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type Outputs } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum } from "../lib/names.ts";
import { fmtTime } from "../lib/time.ts";
import { Badge, Bar, Button, Card, ErrorLine, Loading, ResChips, Sheet } from "../ui.tsx";
import { AchievementBadge, TIER_LABEL } from "../components/achievement-art.tsx";

type View = Outputs["achievements"]["get"];
type Item = View["achievements"][number];

const invalidate = () => [trpc.achievements.pathFilter().queryKey, trpc.base.pathFilter().queryKey, trpc.social.ranking.pathFilter().queryKey];

/** Erfolge des Spielers; auch für einen Zähler nutzbar. */
export function useAchievements(enabled = true) {
  return useQuery({ ...trpc.achievements.get.queryOptions(), enabled, refetchInterval: 120000 });
}

const TONE = ["slate", "brass", "sea", "brass"] as const;

export function AchievementsScreen() {
  const q = useAchievements();
  const [open, setOpen] = useState<string | null>(null);
  const claim = useCommand((i: { key: string; id: string; tier: number }) => trpcClient.achievements.claim.mutate(i), invalidate);
  if (!q.data) return <Loading />;
  const v = q.data;
  const item = v.achievements.find((a) => a.id === open) ?? null;
  const claimNext = (a: Item) => a.tiers.find((t) => t.unlocked && !t.claimed);
  const won = v.achievements.filter((a) => a.tier > 0 || claimNext(a));
  const locked = v.achievements.filter((a) => !(a.tier > 0 || claimNext(a)));

  return (
    <div>
      <Card title="Erfolge" right={<span className="text-[11px] text-ink2 mono">{v.unlocked}/{v.total} Stufen</span>}>
        <p className="text-sm text-ink2 mb-2">
          Abzeichen bleiben über alle Saisons. Jede Stufe bringt einmal eine kleine Belohnung; deine drei höchsten
          Abzeichen stehen in der Rangliste neben deinem Namen.
        </p>
        {v.badges.length > 0 && (
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-ink2">In der Rangliste:</span>
            {v.badges.map((b) => <AchievementBadge key={b.id} id={b.id} tier={b.tier} size={30} title={b.title} />)}
          </div>
        )}
        {v.claimable > 0 && <p className="text-sm text-moos" role="status">{v.claimable} {v.claimable === 1 ? "Belohnung wartet" : "Belohnungen warten"} auf dich.</p>}
        <ErrorLine text={claim.error} code={claim.code} />
      </Card>

      <ul className="grid grid-cols-2 gap-2 mb-3" aria-label="Errungene Abzeichen">
        {won.map((a) => {
          const next = claimNext(a);
          return (
            <li key={a.id} className={`panel rounded-xl p-2.5 flex flex-col items-center text-center ${next ? "border-moos" : ""}`}>
              <button type="button" className="tap flex flex-col items-center w-full" onClick={() => setOpen(a.id)} aria-label={`${a.title} – Details`}>
                <AchievementBadge id={a.id} tier={a.tier} size={64} title={a.title} />
                <span className="font-serif text-[15.5px] leading-tight mt-1">{a.title}</span>
                <span className="mt-0.5"><Badge tone={TONE[a.tier]}>{TIER_LABEL[a.tier]}</Badge></span>
                <span className="text-[11.5px] text-ink2 leading-snug mt-1 min-h-[2.4em]">{a.description}</span>
              </button>
              <div className="w-full mt-1">
                <Bar value={a.share} tone={a.tier >= 3 ? "green" : "brass"} />
                <div className="text-[11px] mono text-ink2 mt-0.5">
                  {a.placement
                    ? (a.next === null ? "höchste Stufe" : `nächste: ${a.tiers[a.tier]?.text}`)
                    : a.next === null ? `${fmtNum(a.value)} – höchste Stufe` : `${fmtNum(a.value)}/${fmtNum(a.next)}`}
                </div>
              </div>
              {next && (
                <Button className="w-full mt-1.5" disabled={claim.busy} onClick={() => void claim.run({ id: a.id, tier: next.tier })}>
                  Abholen
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {locked.length > 0 && (
        <section className="mb-3" aria-label="Gesperrte Abzeichen">
          <h2 className="font-display text-[11px] uppercase text-ink2 tracking-[0.16em] mb-1.5 px-0.5">Noch gesperrt ({locked.length})</h2>
          <ul className="grid grid-cols-4 gap-1.5">
            {locked.map((a) => (
              <li key={a.id}>
                <button type="button" className="tap w-full panel rounded-lg p-1.5 flex flex-col items-center text-center" onClick={() => setOpen(a.id)} aria-label={`${a.title} – gesperrt, Details`}>
                  <AchievementBadge id={a.id} tier={0} size={40} title={a.title} />
                  <span className="text-[10.5px] leading-tight mt-0.5 line-clamp-2 min-h-[2.5em]">{a.title}</span>
                  <span className="w-full mt-1"><Bar value={a.share} tone="brass" /></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Sheet open={item !== null} onClose={() => setOpen(null)} title={item?.title ?? ""} icon={item ? <AchievementBadge id={item.id} tier={item.tier} size={30} /> : null}>
        {item && (
          <div className="space-y-3">
            <p className="text-sm">{item.description}{item.placement ? "" : `: bisher ${fmtNum(item.value)}`}.</p>
            <ol className="divide-y divide-navy-700">
              {item.tiers.map((t) => (
                <li key={t.tier} className="py-2 flex gap-3 items-start">
                  <AchievementBadge id={item.id} tier={t.unlocked ? t.tier : 0} size={44} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Badge tone={TONE[t.tier]}>{t.name}</Badge>
                      {t.claimed ? <Badge tone="green">abgeholt</Badge> : t.unlocked ? <Badge tone="green">freigeschaltet</Badge> : null}
                    </div>
                    <div className="text-sm mt-0.5">{t.text}</div>
                    {t.unlockedAtMs && <div className="text-[11px] text-ink2">seit {fmtTime(t.unlockedAtMs)}</div>}
                    <div className="text-xs mt-1"><ResChips values={t.reward} /></div>
                    {t.unlocked && !t.claimed && (
                      <Button className="w-full mt-1.5" disabled={claim.busy} onClick={() => void claim.run({ id: item.id, tier: t.tier })}>Abholen</Button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <ErrorLine text={claim.error} code={claim.code} />
          </div>
        )}
      </Sheet>
    </div>
  );
}
