// Felder: Rohstofffelder – Oberfläche: Infoblatt auf der Karte, „Meine Felder“ (Truppen), Besatzungszeile in der
// Missionsliste, Zielzeile und Besatzungswahl in der Planung, Handbuch-Kapitel (docs/REGELN-FELDER.md).
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type Balance, type BaseData, type Outputs } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration, fmtTime, useNow } from "../lib/time.ts";
import { Button, Card, ErrorLine, UnitChips } from "../ui.tsx";
import { Icon } from "../icons.tsx";
import type { Target } from "../App.tsx";
import { FieldEscortEditor, FieldIncomingLines } from "./FieldEscort.tsx"; // Felder 2: Geleit, Vorwarnung, Verstärkung

export type FieldsData = NonNullable<Outputs["fields"]["view"]>;
type Field = FieldsData["fields"][number];
type Counts = Record<string, number>;
type FieldsRules = { maxFields: number; maxFieldsPerHarborLevels: number; minGarrisonCommandPoints: number; deliveryHours: number; yieldFactors: number[]; zoneLinkKm: number; zoneMinFields: number; zoneBonus: number; guardRespawnHours: number; cartelRaidChance: number; alliancePointsPerFieldDay: number; minKmFromBase: number; upkeepProviantPerHour: number[]; radarWarningFactor?: number; escortMinRemainCommandPoints?: number; kinds: Record<string, { resource: string; yieldPerHour: number[] }> };

export const KIND_TEXT: Record<string, string> = { oelfeld: "Ölfeld", erzbucht: "Erzbucht", fischgrund: "Fischgrund", elektronikwrack: "Elektronik-Wrack" };
const KIND_HINT: Record<string, string> = {
  oelfeld: "Bohrinsel vor der Küste – liefert Treibstoff",
  erzbucht: "Erzreiche Bucht – liefert Stahl",
  fischgrund: "Reicher Fischgrund – liefert Proviant",
  elektronikwrack: "Gesunkener Frachter voller Technik – liefert Elektronik (kein Wrackfeld zum Bergen)",
};
const RELATION_TEXT: Record<string, string> = {
  own: "Dein Feld", allianz: "Feld eines Allianzmitglieds", pakt: "Feld eines Paktpartners", krieg: "Feld eines Kriegsgegners",
  neutral: "Feld eines neutralen Spielers", kartell: "Neutral – vom Kartell bewacht", frei: "Neutral – unbewacht",
};
const RELATION_CLASS: Record<string, string> = { own: "text-ink", allianz: "text-moos", pakt: "text-messing", krieg: "text-siegel", neutral: "text-sea-300", kartell: "text-siegel", frei: "text-ink2" };

export function fieldsRules(b: Balance | undefined): FieldsRules | null {
  return ((b as unknown as { fields?: FieldsRules } | undefined)?.fields) ?? null;
}

export function useFields(enabled = true) {
  return useQuery({ ...trpc.fields.view.queryOptions(), enabled, refetchInterval: 60000 });
}

const resLine = (m: Counts | null | undefined) => Object.entries(m ?? {}).filter(([, v]) => v > 0).map(([r, v]) => `${fmtNum(v)} ${label(r)}`).join(", ") || "nichts";
const invalidate = () => [trpc.fields.pathFilter().queryKey, trpc.base.pathFilter().queryKey, trpc.world.pathFilter().queryKey];

export function fieldAt(data: FieldsData | null | undefined, t: { col: number; row: number }): Field | undefined {
  return data?.fields.find((f) => f.col === t.col && f.row === t.row);
}

/** Infoblatt beim Antippen eines Felds auf der Karte. */
export function FieldSheet({ data, sel, onPlan }: { data: FieldsData | null | undefined; sel: { col: number; row: number }; onPlan: (t: Target) => void }) {
  const f = fieldAt(data, sel);
  const now = useNow();
  if (!f || !data) return null;
  const mine = data.mine.find((m) => m.id === f.id);
  const canTake = f.relation === "kartell" || f.relation === "frei" || f.relation === "krieg" || f.relation === "neutral";
  return (
    <div className="mt-1">
      <div className="font-serif text-[19px] leading-tight flex items-center gap-2 mt-0.5">
        <Icon id={f.kind} size={30} /><span>{KIND_TEXT[f.kind] ?? f.kind} <em className="text-[13px] text-ink2">Stufe {f.tier}</em></span>
      </div>
      <div className="text-xs text-ink2">{KIND_HINT[f.kind]}</div>
      <div className={`text-xs font-semibold ${RELATION_CLASS[f.relation] ?? ""}`}>{RELATION_TEXT[f.relation]}{f.owner && f.relation !== "own" ? `: ${f.owner}` : ""}</div>
      <div className="text-xs text-emerald-300">Ertrag: {resLine(f.yieldPerHour)} je Stunde{mine ? ` · bei dir ${resLine(mine.yieldPerHour)}/h` : ""}</div>
      {f.garrison && <div className="text-xs">Besatzung: <UnitChips counts={f.garrison} /></div>}
      {f.guard && Object.keys(f.guard).length > 0 && <div className="text-xs">Kartell-Wache: <UnitChips counts={f.guard} /></div>}
      {f.guardAtMs && <div className="text-xs text-ink2">Unbewacht – das Kartell kehrt in {fmtDuration(f.guardAtMs - now)} zurück</div>}
      {f.intel && <div className="text-xs">Lagebild vom {fmtTime(f.intel.atMs)}: <UnitChips counts={f.intel.units} /></div>}
      {!f.garrison && !f.guard && !f.intel && f.relation !== "frei" && <div className="text-xs text-ink2">Besatzung unbekannt – erst aufklären.</div>}
      {f.zone && f.zone.size >= 2 && <div className="text-xs text-moos">Einflusszone: {f.zone.size} Felder{f.zone.bonus ? " – Ertragsbonus aktiv" : ""}</div>}
      <div className="flex gap-2 mt-2">
        {f.relation !== "own" && <Button kind="secondary" className="flex-1" onClick={() => onPlan({ col: f.col, row: f.row, fieldId: f.id, fieldMission: "aufklaerung" })}>Aufklären</Button>}
        {canTake && <Button className="flex-1" onClick={() => onPlan({ col: f.col, row: f.row, fieldId: f.id, fieldMission: "besetzen" })}>{f.owner ? "Angreifen" : "Besetzen"}</Button>}
      </div>
      {mine && <FieldIncomingLines incoming={mine.incoming} reinforcements={mine.reinforcements} />}
      {mine && <Button kind="secondary" className="w-full mt-2" onClick={() => onPlan({ col: f.col, row: f.row, fieldId: f.id, fieldMission: "besetzen" })}>Verstärken (Schiffe zur Besatzung schicken)</Button>}
      {mine && <RecallButton fieldId={f.id} />}
    </div>
  );
}

function RecallButton({ fieldId }: { fieldId: number }) {
  const recall = useCommand((i: { key: string; fieldId: number }) => trpcClient.fields.recall.mutate(i), invalidate);
  return (
    <div className="mt-2">
      <Button kind="secondary" className="w-full" disabled={recall.busy} onClick={() => void recall.run({ fieldId })}>Besatzung zurückrufen (Feld wird neutral)</Button>
      <ErrorLine text={recall.error} />
    </div>
  );
}

/** Missionsliste: Zeile einer Besatzung auf einem Feld. */
export function FieldMissionLine({ missionId }: { missionId: number }) {
  const q = useFields();
  const f = q.data?.mine.find((m) => m.missionId === missionId);
  return (
    <div>
      <div className="text-sea-300">Besatzung auf {f ? `${KIND_TEXT[f.kind]} (Stufe ${f.tier})` : "einem Rohstofffeld"} – hält das Feld</div>
      {f && <RecallButton fieldId={f.id} />}
    </div>
  );
}

/** Truppen: „Meine Felder“ mit Ertrag, Besatzung, nächster Lieferung und Rückruf. */
export function MyFieldsCard({ base, onShowOnMap }: { base: BaseData; onShowOnMap: (t: Target) => void }) {
  const q = useFields();
  const now = useNow();
  const d = q.data;
  if (!d) return null;
  return (
    <Card title={<><Icon id="besetzen" size={18} /> Meine Felder {d.mine.length}/{d.maxFields}</>}>
      {d.mine.length === 0 && <p className="text-sm text-ink2">Noch kein Rohstofffeld. Felder liegen auf See zwischen den Häfen (Karte: Bohrinsel, Erzbucht, Fischgrund, Wrack) – aufklären, dann mit Schiffen besetzen. {d.maxFields === 0 ? "Dafür brauchst du eine Hafenkommandantur." : ""}</p>}
      <ul className="divide-y divide-navy-700">
        {d.mine.map((m) => (
          <li key={m.id} className="py-2 text-sm flex gap-3">
            <Icon id={m.kind} size={36} />
            <div className="flex-1 min-w-0">
              <div className="flex justify-between gap-2">
                <strong>{KIND_TEXT[m.kind]} · Stufe {m.tier}</strong>
                <button type="button" className="tap text-sea-300 underline text-xs" onClick={() => onShowOnMap({ col: m.col, row: m.row })}>Feld {m.col}/{m.row}</button>
              </div>
              <div className="text-xs text-emerald-300">Ertrag {resLine(m.yieldPerHour)}/h ({Math.round(m.factor * 100)} %{m.zoneBonus ? ", Zonenbonus" : ""}) · Unterhalt {fmtNum(m.upkeepPerHour)} Proviant/h</div>
              <FieldIncomingLines incoming={m.incoming} reinforcements={m.reinforcements} />
              <div className="text-xs">Besatzung: <UnitChips counts={m.garrison} />{Object.keys(m.escort).length > 0 && <span className="text-ink2"> – gegen Spieler verteidigt: <UnitChips counts={m.defenders} /> (gegen das Kartell alle)</span>}</div>
              <FieldEscortEditor key={JSON.stringify(m.escort)} fieldId={m.id} garrison={m.garrison} escort={m.escort} />
              <div className="text-xs text-ink2">Nächste Lieferung {d.nextDeliveryAtMs ? `in ${fmtDuration(d.nextDeliveryAtMs - now)}` : "bald"} per Konvoi nach {m.home ?? base.name}</div>
              <button type="button" className="tap text-sea-300 underline text-xs mt-1" onClick={() => onShowOnMap({ col: m.col, row: m.row })}>Verstärken: auf der Karte das Feld antippen</button>
              <RecallButton fieldId={m.id} />
            </div>
          </li>
        ))}
      </ul>
      {d.alliancePoints !== null && d.alliancePoints > 0 && <p className="text-xs text-moos mt-1">Feldpunkte deiner Allianz in dieser Saison: {fmtNum(d.alliancePoints)}</p>}
    </Card>
  );
}

/** Planung: Zielzeile und Besatzungswahl. */
export function FieldTargetLine({ fieldId }: { fieldId: number }) {
  const q = useFields();
  const f = q.data?.fields.find((x) => x.id === fieldId);
  if (!f) return <>Rohstofffeld …<br /></>;
  if (f.relation === "own") {
    return <>Dein Rohstofffeld <strong>{KIND_TEXT[f.kind]} Stufe {f.tier}</strong> – <strong>Verstärkung</strong>: die Schiffe werden ohne Kampf der Besatzung hinzugefügt (aus einem anderen Hafen wechseln sie in den Hafen des Felds). Nur Schiffe; ein mitfahrender Admiral übernimmt die Besatzung, wenn sie noch keinen hat.<br /></>;
  }
  return <>Rohstofffeld <strong>{KIND_TEXT[f.kind]} Stufe {f.tier}</strong> – {RELATION_TEXT[f.relation]}{f.owner && f.relation !== "own" ? ` (${f.owner})` : ""}. Nur Schiffe; Seekampf gegen {f.owner ? "die Besatzung" : "die Kartell-Wache"}. Ein Admiral führt den Verband und bleibt nach der Einnahme bei der Besatzung.<br /></>;
}

export function StayAllToggle({ value, onChange, balance, fieldId }: { value: boolean; onChange: (v: boolean) => void; balance: Balance; fieldId?: number }) {
  const r = fieldsRules(balance);
  const q = useFields();
  if (fieldId !== undefined && q.data?.fields.find((x) => x.id === fieldId)?.relation === "own") return null; // Verstärkung: alles bleibt
  return (
    <Card title="Besatzung">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={value} onChange={(e) => onChange(e.target.checked)} />
        <span>Ganzer Verband bleibt als Besatzung<span className="block text-xs text-ink2">Sonst bleibt nur die Mindestbesatzung ({r?.minGarrisonCommandPoints ?? 6} Kommandopunkte, bewaffnete Schiffe), der Rest fährt heim. Die Besatzung belegt einen Missionsplatz, bis du sie zurückrufst.</span></span>
      </label>
    </Card>
  );
}

const OUTCOME_TEXT: Record<string, string> = {
  captured: "Feld besetzt – deine Besatzung hält es, der Rest des Verbands fährt heim.",
  cleared: "Wache bzw. Besatzung geschlagen, aber die Überlebenden reichen nicht für eine Besatzung. Das Feld ist neutral.",
  limit: "Feld freigekämpft, aber die Höchstzahl deiner Felder ist erreicht. Das Feld ist neutral.",
  held: "Der Angriff wurde abgewiesen.",
  reinforced: "Die Verstärkung ist eingetroffen und gehört jetzt zur Besatzung.",
  cartel: "Das Kartell hat die Besatzung geschlagen und hält das Feld.",
};

/** Bericht: Aufklärung oder Kampf um ein Feld. */
export function FieldReport({ d }: { d: { kind?: string; tier?: number; owner?: string | null; units?: Counts; garrison?: Counts; outcome?: string; refused?: string; gone?: boolean } }) {
  if (d.gone) return <Card><p>Das Feld gibt es nicht mehr (Saisonwechsel oder neu verteilt). Der Verband kehrt um.</p></Card>;
  return (
    <Card title={<><Icon id={d.kind ?? "besetzen"} size={18} /> {KIND_TEXT[d.kind ?? ""] ?? "Rohstofffeld"}{d.tier ? ` · Stufe ${d.tier}` : ""}</>}>
      <div className="text-sm space-y-1">
        {d.refused && <p>{d.refused === "field_lost" ? "Verstärkung kehrt um: das Feld wird nicht mehr von dir gehalten" : <>Nicht besetzt: {d.refused === "own_field" ? "das Feld gehört dir schon" : d.refused === "fleet_lost" ? "keine Schiffe mehr im Verband" : "Verbündete und Paktpartner greift man nicht an"}</>}.</p>}
        {d.outcome && <p>{OUTCOME_TEXT[d.outcome] ?? ""}</p>}
        {d.outcome === "reinforced" && d.garrison && <div><span className="text-ink2">Besatzung jetzt:</span> <UnitChips counts={d.garrison} /></div>}
        {d.units && <div><span className="text-ink2">{d.outcome === "reinforced" ? "Verstärkung:" : d.owner ? `Besatzung von ${d.owner}:` : "Kartell-Wache:"}</span> {Object.keys(d.units).length > 0 ? <UnitChips counts={d.units} /> : "keine"}</div>}
      </div>
    </Card>
  );
}
