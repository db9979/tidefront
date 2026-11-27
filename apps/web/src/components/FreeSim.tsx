// Freier Kampfsimulator (Simulator-Chunk): beide Seiten frei wählbar, Vorlagen für Nester, den eigenen Hafen und den
// Kartell-Überfall. Eigener Hafen wie im echten Abwehrkampf: Modifikatoren des Hafens, Kampfwerte des Hafenkommandanten
// (Admiral, bereit), stationierte Verbündete (zuschaltbar), Beute aus den Beständen über dem Bunkerschutz. Kartell:
// Überfall wie der Server ihn gegen diese Verteidigung zusammenstellt (mit den Modifikatoren des Hafens), Stärke als
// Regler (Schwankung des Kartells); Ergebnis aus Sicht des Verteidigers. Aus einem Bericht: Siegregel und Beute der
// Kampfart und die Seite des Lesers.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AttackerInput, CombatWeather, DefenderInput, LootRule, Side, VictoryRule } from "@tidefront/game-core";
import { trpc, type Balance, type BaseData } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { unitTone } from "../lib/info.ts";
import { nestDefenderOf } from "../lib/sim-nest.ts"; // Lebendige Nester
import { nestProbeDefenders } from "../lib/nest-intel.ts";
import { positive, raidAgainst, splitDefender, type Counts } from "../lib/sim.ts";
import { Icon, IconTile } from "../icons.tsx";
import { SmallButton, Stepper } from "../ui.tsx";
import { modLineText, withAdmiralMods } from "./Admirals.tsx"; // Hafenkommandant
import { Outcome, SimNote, weatherText } from "./SimResult.tsx";
import { WinSearch } from "./WinSearch.tsx";

/** Zählungen bearbeiten: vorhandene Typen mit Zähler, weitere über eine Auswahl hinzufügen. */
function CountEditor({ ids, counts, onChange, balance }: { ids: string[]; counts: Counts; onChange: (c: Counts) => void; balance: Balance }) {
  const shown = ids.filter((id) => (counts[id] ?? 0) > 0);
  const rest = ids.filter((id) => !((counts[id] ?? 0) > 0));
  return (
    <div>
      <ul className="divide-y divide-rule">
        {shown.map((id) => (
          <li key={id} className="py-1.5 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm min-w-0 flex-1"><IconTile id={id} size={32} tone={unitTone(balance, id)} /><span className="min-w-0 break-words leading-tight">{label(id)}</span></span>
            <Stepper value={counts[id] ?? 0} onChange={(v) => onChange({ ...counts, [id]: v })} />
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <select className="mt-2 h-11 w-full rounded-lg field px-2 text-sm" value="" onChange={(e) => e.target.value && onChange({ ...counts, [e.target.value]: 1 })}>
          <option value="">+ Einheit hinzufügen …</option>
          {rest.map((id) => <option key={id} value={id}>{label(id)}</option>)}
        </select>
      )}
    </div>
  );
}

type AttMode = "eigen" | "frei" | "kartell" | "bericht";

/** Vorbelegung aus einem Bericht („Im Kampfsimulator öffnen“): Verbände, Kampfbedingungen, Wetter, Siegregel, Seite. */
export interface FreeSimPreset { attacker: AttackerInput; defender: DefenderInput; weather?: CombatWeather; rule?: VictoryRule; loot?: LootRule; mine?: Side }

/** Hafenkommandant des aktiven Hafens (stationiert und bereit) mit seinen Verteidigungswerten. */
function useHarborAdmiral() {
  const q = useQuery(trpc.admiral.get.queryOptions());
  return q.data?.list.find((a) => a.here && a.stationed && a.status === "bereit") ?? null;
}

/** Freier Simulator: beide Seiten frei wählbar, Vorlagen für Nester, eigenen Hafen und Kartell-Überfall. */
export function FreeSim({ balance, base, preset, planAt }: { balance: Balance; base: BaseData; preset?: FreeSimPreset; planAt?: { col: number; row: number } | null }) {
  const home = useMemo(() => positive(Object.fromEntries(base.units.filter((u) => !balance.units[u.id]?.covert).map((u) => [u.id, u.home]))), [base.units, balance]);
  const ownDef = useMemo(() => positive(Object.fromEntries(base.defenses.map((d) => [d.id, d.count]))), [base.defenses]);
  const guests = useMemo(() => {
    const out: Counts = {};
    for (const g of base.stationed?.guests ?? []) if (g.status === "stationed") for (const [id, n] of Object.entries(g.units)) out[id] = (out[id] ?? 0) + n;
    return positive(out);
  }, [base.stationed]);
  const admiral = useHarborAdmiral();
  const harborMods = useMemo(() => withAdmiralMods(base.modifiers, admiral?.defense ?? []), [base.modifiers, admiral]);
  const nestLevels = Object.keys(balance.pirates.nestLevels).sort((a, b) => Number(a) - Number(b));
  const fromReport = useMemo(() => (preset ? { att: positive(preset.attacker.units), def: positive({ ...preset.defender.units, ...preset.defender.defenses }) } : null), [preset]);
  const [attMode, setAttMode] = useState<AttMode>(preset ? "bericht" : "eigen");
  const [att, setAtt] = useState<Counts>(fromReport?.att ?? home);
  const [withGuests, setWithGuests] = useState(true);
  const spread = balance.pirates.raidStrengthSpread ?? 0;
  const [strength, setStrength] = useState(100);
  const [defPreset, setDefPreset] = useState<string>(preset ? "bericht" : nestLevels[0] ? `nest:${nestLevels[0]}` : "frei");
  const harborUnits = (g: boolean) => { const u: Counts = { ...home }; if (g) for (const [id, n] of Object.entries(guests)) u[id] = (u[id] ?? 0) + n; return u; };
  const [def, setDef] = useState<Counts>(() => {
    if (fromReport) return fromReport.def;
    const d = nestLevels[0] ? nestDefenderOf(Number(nestLevels[0]), "mid", balance) : null;
    return d ? { ...d.units, ...d.defenses } : {};
  });
  // Lebendige Nester: Vorlagen „Mitte“, „ungünstig“ und „aus Lagebild“ (genaue Lagebilder der Karte).
  const map = useQuery(trpc.world.map.queryOptions());
  const known = (map.data?.nests ?? []).filter((n) => n.level !== null && !n.empty && n.lagebild);
  const presetDefender = (v: string): DefenderInput | null => {
    const [kind, a, b] = v.split(":");
    if (kind === "nest") return nestDefenderOf(Number(a), b === "worst" ? "worst" : "mid", balance);
    if (kind === "lagebild") { const n = known.find((x) => x.id === Number(a)); return n ? nestProbeDefenders(n.level!, n.lagebild, Date.now(), balance)[0] : null; }
    return null;
  };
  const pickDefender = (v: string) => {
    setDefPreset(v);
    if (v === "bericht" && fromReport) { setDef(fromReport.def); return; }
    const d = presetDefender(v);
    if (d) setDef({ ...d.units, ...d.defenses });
    else if (v === "hafen") setDef({ ...harborUnits(withGuests), ...ownDef });
  };
  const pickAttacker = (m: AttMode) => {
    setAttMode(m);
    if (m === "eigen") setAtt(home);
    if (m === "bericht" && fromReport) setAtt(fromReport.att);
    if (m === "kartell") pickDefender("hafen");
  };
  const toggleGuests = (g: boolean) => { setWithGuests(g); if (defPreset === "hafen") setDef({ ...harborUnits(g), ...ownDef }); };

  const playerIds = Object.keys(balance.units).filter((id) => !balance.units[id].covert); // Spione kämpfen nicht
  const attIds = preset ? [...playerIds, ...Object.keys(balance.npcUnits)] : playerIds; // Bericht: auch Kartell-Angreifer
  const defIds = [...playerIds, ...Object.keys(balance.npcUnits), ...Object.keys(balance.defenses)];
  const split = useMemo(() => splitDefender(def, balance), [def, balance]);
  const fromBericht = attMode === "bericht" && defPreset === "bericht" && !!preset;
  const attacker = useMemo<AttackerInput>(
    // Eigene Verbände rechnen mit den eigenen Modifikatoren (Forschung, Veteranen). Kartell: wie der Server, mit den
    // Modifikatoren des Hafens (ohne Admiral) und der gewählten Stärke.
    () => (attMode === "bericht" && preset ? { ...preset.attacker, units: positive(att) }
      : attMode === "kartell" ? raidAgainst(split.units, split.defenses, balance, base.modifiers, strength)
      : { units: positive(att), versorgungsmangel: attMode === "eigen" && base.versorgungsmangel, ...(attMode === "eigen" ? { modifiers: base.modifiers } : {}) }),
    [attMode, att, split, balance, base.versorgungsmangel, base.modifiers, preset, strength],
  );
  const defender = useMemo<DefenderInput>(() => {
    const nest = defPreset.startsWith("nest:") || defPreset.startsWith("lagebild:") ? presetDefender(defPreset) : null;
    if (nest) return { ...split, fixedLoot: nest.fixedLoot };
    if (defPreset === "bericht" && preset) return { ...preset.defender, ...split };
    if (defPreset === "hafen") return { ...split, resources: base.resources, protectedPerResource: base.bunkerProtection, versorgungsmangel: base.versorgungsmangel, ...(harborMods ? { modifiers: harborMods } : {}) };
    return split;
  }, [defPreset, split, balance, base, preset, harborMods]);
  // Seite des Lesers: aus dem Bericht, beim Kartell der Hafen (Verteidiger), sonst der Angreifer.
  const mine: Side = attMode === "kartell" ? "defender" : attMode === "bericht" && preset?.mine ? preset.mine : "attacker";
  const rule = fromBericht ? preset?.rule : undefined;
  const loot = fromBericht ? preset?.loot : undefined;
  const weather = attMode === "bericht" || defPreset === "bericht" ? preset?.weather : undefined;
  const [win, setWin] = useState(false);
  const { units: _u, ...conditions } = attacker;

  const tab = (m: AttMode, text: string) => (
    <button key={m} type="button" onClick={() => pickAttacker(m)} className={`tap flex-1 rounded-lg border text-sm ${attMode === m ? "border-ink bg-card font-semibold reticle" : "border-rule"}`}>{text}</button>
  );
  const kartellMin = Math.round((1 - spread) * 100), kartellMax = Math.round((1 + spread) * 100);
  const sideTitle = (s: Side) => (s === mine ? (s === "attacker" ? "Eigene Verluste (Angreifer)" : "Eigene Verluste (Verteidiger)") : attMode === "kartell" ? "Verluste des Kartells" : s === "attacker" ? "Verluste des Angreifers" : "Verluste des Verteidigers");

  return (
    <div className="space-y-4">
      <section>
        <h3 className="font-serif text-lg mb-1 flex items-center gap-2"><Icon id="ueberfall" size={24} /> Angreifer</h3>
        <div className="flex gap-2 mb-2">{preset && tab("bericht", "Bericht")}{tab("eigen", "Eigene")}{tab("frei", "Frei")}{tab("kartell", "Kartell")}</div>
        {attMode === "kartell" ? (
          <div className="text-sm space-y-1" data-testid="sim-kartell">
            <p>So stellt das Kartell einen Überfall gegen die Verteidigung rechts zusammen: <strong>{Object.entries(attacker.units).map(([id, n]) => `${fmtNum(n)} ${label(id)}`).join(", ")}</strong>.</p>
            {spread > 0 && (
              <label className="block">
                <span className="text-xs text-ink2">Kartellstärke {strength} % (Schwankung {kartellMin}–{kartellMax} %)</span>
                <input type="range" className="w-full" min={kartellMin} max={kartellMax} step={5} value={strength} onChange={(e) => setStrength(Number(e.target.value))} aria-label="Kartellstärke" />
              </label>
            )}
          </div>
        ) : (
          <CountEditor ids={attIds} counts={att} onChange={(c) => { setAtt(c); if (attMode !== "bericht") setAttMode("frei"); }} balance={balance} />
        )}
      </section>
      <section>
        <h3 className="font-serif text-lg mb-1 flex items-center gap-2"><Icon id="schild" size={24} /> Verteidiger</h3>
        <select className="h-11 w-full rounded-lg field px-2 text-sm mb-2" value={defPreset} onChange={(e) => pickDefender(e.target.value)} aria-label="Verteidiger">
          {preset && <option value="bericht">Aus dem Bericht</option>}
          {nestLevels.map((l) => <option key={l} value={`nest:${l}`}>Nest Stufe {l} (Mitte)</option>)}
          {nestLevels.map((l) => <option key={`w${l}`} value={`nest:${l}:worst`}>Nest Stufe {l} ungünstig</option>)}
          {known.map((n) => <option key={`l${n.id}`} value={`lagebild:${n.id}`}>Nest Stufe {n.level} aus Lagebild ({n.col}/{n.row})</option>)}
          <option value="hafen">Eigener Hafen (daheim)</option>
          <option value="frei">Frei</option>
        </select>
        {defPreset === "hafen" && (
          <div className="text-xs text-ink2 mb-2 space-y-1" data-testid="sim-hafen">
            <p>Mit den Modifikatoren deines Hafens (Forschung, Veteranen){admiral ? <> und Hafenkommandant <strong>{admiral.rankName} {admiral.name}</strong>: {modLineText(admiral.defense) || "ohne Wirkung"}</> : " – kein Hafenkommandant bereit"}.</p>
            {Object.keys(guests).length > 0 && (
              <label className="flex items-center gap-2 min-h-[44px] text-sm text-ink">
                <input type="checkbox" className="h-5 w-5" checked={withGuests} onChange={(e) => toggleGuests(e.target.checked)} />
                <span>Stationierte Verbündete verteidigen mit ({Object.entries(guests).map(([id, n]) => `${fmtNum(n)} ${label(id)}`).join(", ")})</span>
              </label>
            )}
          </div>
        )}
        <CountEditor ids={defIds} counts={def} onChange={(c) => { setDef(c); if (defPreset === "hafen" || defPreset === "bericht" || defPreset.startsWith("nest:") || defPreset.startsWith("lagebild:")) return; setDefPreset("frei"); }} balance={balance} />
      </section>
      <section className="rounded-xl bg-paper border border-rule p-3">
        {weather && <p className="text-xs text-ink2 mb-2">Wetter am Kampfort des Berichts: {weatherText(weather)}.</p>}
        <Outcome attacker={attacker} defender={defender} balance={balance} weather={weather} rule={rule} loot={loot} mine={mine} ownTitle={sideTitle(mine)} enemyTitle={sideTitle(mine === "attacker" ? "defender" : "attacker")} />
        <SimNote attacker={attacker} defender={defender} weather={weather} rule={rule} extra={rule === "halten" ? "Sieg wie im echten Kampf: Gegner vernichtet; getauchte U-Boote halten nicht." : rule === "vernichtung" ? "Sieg wie im echten Kampf: Gegner vernichtet." : "Beute bei Nestern fest, beim eigenen Hafen aus den Beständen über dem Bunkerschutz."} />
        {mine === "attacker" && attMode !== "kartell" && Object.keys(attacker.units).length > 0 && (
          <div className="mt-3">
            {win
              ? <WinSearch target={{ attacker: conditions, defenders: [defender], ...(weather ? { weather } : {}), ...(rule ? { rule } : {}), ...(loot ? { loot } : {}) }} base={base} balance={balance} planAt={planAt} autoStart />
              : <SmallButton onClick={() => setWin(true)}>Was fehlt zum Sieg?</SmallButton>}
          </div>
        )}
      </section>
    </div>
  );
}
