// Truppen → Ausbilden mit vorgewählten Mengen öffnen („Was fehlt zum Sieg?“ → „Ausbilden“): die Mengen liegen kurz
// bereit, die Ausbildungszeilen übernehmen sie beim Aufbau; Sprung über useNav ({ to: "troops", seg: "ausbilden" }).
const TTL_MS = 120_000;
let preset: { counts: Record<string, number>; at: number; scrolled: boolean } | null = null;

export function setTrainPreset(counts: Record<string, number>): void {
  preset = { counts: { ...counts }, at: Date.now(), scrolled: false };
}

/** Vorgewählte Menge für eine Einheit (0 ohne oder nach Ablauf). */
export function trainPresetFor(id: string): number {
  if (!preset || Date.now() - preset.at > TTL_MS) return 0;
  return Math.max(0, Math.floor(preset.counts[id] ?? 0));
}

/** Nur die erste vorgewählte Zeile scrollt ins Bild. */
export function claimTrainScroll(): boolean {
  if (!preset || preset.scrolled) return false;
  preset.scrolled = true;
  return true;
}
