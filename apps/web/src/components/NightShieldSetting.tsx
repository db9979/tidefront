// Nachtschild-Startzeit wählen (früher nur Basis → Hafen → Schutz; UX-0.43 A6 auch unter Einstellungen → Spiel).
// Vorgemerkte Einstellung gilt erst ab fromMs; Änderungen höchstens einmal je Frist (balance.protection).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtTime } from "../lib/time.ts";
import { Button, ErrorLine } from "../ui.tsx";

const pad = (h: number) => String(h).padStart(2, "0");

export function NightShieldSetting({ base, now, id = "tf-night" }: { base: BaseData; now: number; id?: string }) {
  const p = base.protection;
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const prot = meta.data?.balance.protection;
  const next = p.nightShieldNext && p.nightShieldNext.fromMs > now ? p.nightShieldNext : null;
  const chosen = next ? next.startHour : p.nightShieldStartHour;
  const [hour, setHour] = useState<number | null>(chosen);
  const save = useCommand(
    (i: { key: string; startHour: number | null; tzOffsetMinutes: number; timeZone?: string }) => trpcClient.base.nightShield.mutate(i),
    () => [trpc.base.pathFilter().queryKey],
  );
  const changeH = prot?.nightShieldChangeHours ?? 24;
  const lockedUntil = p.nightShieldChangedAtMs !== undefined ? p.nightShieldChangedAtMs + changeH * 3600000 : 0;
  const locked = lockedUntil > now;
  return (
    <div>
      {next && (
        <p className="text-xs text-sea-300 mb-2">
          Neue Einstellung ab {fmtTime(next.fromMs)}: {next.startHour === null ? "kein Nachtschild" : `Beginn um ${pad(next.startHour)}:00 Uhr`}.
        </p>
      )}
      <label className="block text-xs text-slate-400 mb-1" htmlFor={id}>Nachtschild ({prot?.nightShieldHours ?? 8} Stunden täglich) beginnt</label>
      <div className="flex items-center gap-2">
        <select id={id} disabled={locked} className="h-11 flex-1 min-w-0 rounded-lg field px-2" value={hour ?? ""} onChange={(e) => setHour(e.target.value === "" ? null : Number(e.target.value))}>
          <option value="">kein Nachtschild</option>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>um {pad(h)}:00 Uhr</option>)}
        </select>
        <Button kind="secondary" disabled={save.busy || locked || hour === chosen} onClick={() => void save.run({ startHour: hour, tzOffsetMinutes: -new Date().getTimezoneOffset(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined })}>
          Speichern
        </Button>
      </div>
      <p className="text-xs text-slate-400 mt-1">
        {locked
          ? `Nächste Änderung ab ${fmtTime(lockedUntil)} möglich.`
          : `Eine Änderung gilt erst nach ${changeH} Stunden und ist danach ${changeH} Stunden gesperrt – den Schild gegen einen schon gemeldeten Angriff einzuschalten geht nicht.`}
      </p>
      <ErrorLine text={save.error} code={save.code} />
    </div>
  );
}
