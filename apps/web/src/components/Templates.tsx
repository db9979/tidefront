// Verbandsvorlagen in der Missionsplanung: mit einem Tipp einsetzen (gekürzt auf die Einheiten daheim),
// aktuellen Verband unter einem Namen speichern, Vorlagen löschen. Gespeichert wird serverseitig.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient, type BaseData } from "../lib/trpc.ts";
import { errorText, fmtNum, label } from "../lib/names.ts";
import { fitUnits, isPlanType, type PlanType } from "../lib/plan-request.ts";
import { Icon } from "../icons.tsx";
import { Button, Card, ErrorLine } from "../ui.tsx";

/** Hinweis auf gekürzte Typen, z. B. „Korvette 2 statt 4“. */
export function shortText(short: { id: string; wanted: number; available: number }[]): string | null {
  if (short.length === 0) return null;
  return `Auf Verfügbares gekürzt: ${short.map((s) => `${label(s.id)} ${fmtNum(s.available)} statt ${fmtNum(s.wanted)}`).join(", ")}.`;
}

export function TemplateBar({ base, units, type, onApply }: {
  base: BaseData;
  units: Record<string, number>;
  type: PlanType;
  onApply: (units: Record<string, number>, type: PlanType | null, note: string | null) => void;
}) {
  const list = useQuery(trpc.comfort.templates.queryOptions());
  const [saving, setSaving] = useState(false);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState("");
  const [withType, setWithType] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const home = Object.fromEntries(base.units.map((u) => [u.id, u.home]));
  const refresh = () => queryClient.invalidateQueries(trpc.comfort.templates.pathFilter());
  const hasUnits = Object.values(units).some((n) => n > 0);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await trpcClient.comfort.saveTemplate.mutate({ name, units, missionType: withType ? type : null });
      if (!r.ok) setError(errorText(r.code));
      else {
        setSaving(false);
        setName("");
      }
      await refresh();
    } catch {
      setError(errorText("network"));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: number) => {
    await trpcClient.comfort.deleteTemplate.mutate({ id }).catch(() => setError(errorText("network")));
    await refresh();
  };

  const rows = list.data ?? [];
  return (
    <Card title="Vorlagen" right={rows.length > 0 ? <Button kind="ghost" onClick={() => setEdit(!edit)}>{edit ? "Fertig" : "Verwalten"}</Button> : undefined}>
      {rows.length === 0 && !saving && <p className="text-sm text-ink2 mb-2">Noch keine Vorlagen. Stelle einen Verband zusammen und speichere ihn unter einem Namen, z. B. „Nestjäger“.</p>}
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {rows.map((t) => {
            const fit = fitUnits(t.units, home);
            const none = Object.keys(fit.units).length === 0;
            return (
              <span key={t.id} className="inline-flex items-stretch">
                <button
                  type="button"
                  disabled={edit || none}
                  onClick={() => onApply(fit.units, isPlanType(t.missionType) ? t.missionType : null, shortText(fit.short))}
                  className={`tap px-3 rounded-lg border text-sm flex items-center gap-1.5 bg-card disabled:opacity-45 ${fit.short.length ? "border-messing" : "border-rule"}`}
                  title={none ? "Keine dieser Einheiten daheim" : undefined}
                >
                  {t.missionType && <Icon id={t.missionType} size={18} />}
                  <span className="font-serif">{t.name}</span>
                  {fit.short.length > 0 && !none && <span className="text-[10px] text-messing font-display uppercase">gekürzt</span>}
                </button>
                {edit && (
                  <button type="button" className="tap ml-1 rounded-lg border border-siegel text-siegel px-2" aria-label={`${t.name} löschen`} onClick={() => void remove(t.id)}>✕</button>
                )}
              </span>
            );
          })}
        </div>
      )}
      {saving ? (
        <div className="space-y-2">
          <input className="w-full h-11 rounded-lg field px-3" maxLength={32} placeholder="Name, z. B. Nestjäger" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={withType} onChange={(e) => setWithType(e.target.checked)} /> Missionsart ({label(type)}) mitspeichern</label>
          <div className="flex gap-2">
            <Button kind="secondary" className="flex-1" onClick={() => setSaving(false)}>Abbrechen</Button>
            <Button className="flex-1" disabled={busy || name.trim() === ""} onClick={() => void save()}>Speichern</Button>
          </div>
          <p className="text-xs text-ink2">Gleicher Name überschreibt die Vorlage.</p>
        </div>
      ) : (
        <Button kind="secondary" className="w-full" disabled={!hasUnits} onClick={() => setSaving(true)}>Verband als Vorlage speichern</Button>
      )}
      <ErrorLine text={error} />
    </Card>
  );
}
