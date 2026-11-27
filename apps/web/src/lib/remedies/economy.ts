// Abhilfe: Bauen, Ausbilden, Forschung, Versorgung, Kredite.
import { aircraftSlots, espionageOf, spyCap, type BaseState } from "@tidefront/game-core";
import { fmtNum, label } from "../names.ts";
import { fmtTime } from "../time.ts";
import { build, go, joinDe, lvl, market, missingResources, nextStep, research, stateOf, training } from "./helpers.ts";
import { techName as techLabel } from "../research.ts";
import type { RemedyCtx, RemedyTable } from "./types.ts";

/** Baugebäude der betroffenen Einheit/Anlage (Ausbildung) bzw. das genannte Gebäude. */
function builtIn(ctx: RemedyCtx): string | null {
  const { balance, detail } = ctx;
  if (detail.building) return detail.building;
  if (detail.unit && balance?.units[detail.unit]) return balance.units[detail.unit].builtIn ?? null;
  if (detail.unit && balance?.defenses[detail.unit]) return "anlagen";
  return null;
}

/** Forschungsamt-Technik der Stelle (Forschung), sonst null. */
function techOf(ctx: RemedyCtx) {
  const t = ctx.detail.tech;
  return t && ctx.balance?.research?.techs[t] ? ctx.balance.research.techs[t] : null;
}

export const ECONOMY: RemedyTable = {
  insufficient_resources: (ctx) => missingResources(ctx, ctx.detail.cost),

  queue_full: ({ base }) => {
    if (!base) return { hint: "Die Bauschlange ist voll. Warte, bis ein Ausbau fertig ist, oder brich einen wartenden Auftrag ab." };
    const first = base.buildQueue[0];
    return {
      hint: `Bauschlange ${base.buildQueue.length}/${base.buildQueueSlots} belegt.${first ? ` Der laufende Ausbau (${label(first.buildingId)}) ist ${fmtTime(first.finishesAt)} fertig.` : ""} Danach ist wieder Platz – oder einen wartenden Auftrag im Bauhof abbrechen.`,
      actions: [go("Zum Bauhof", { to: "base" })],
    };
  },

  command_cap: ({ base, balance, detail }) => {
    const kz = lvl(base, "kommandozentrale");
    const cap = balance?.building.levelCapAboveCommand ?? 3;
    const b = detail.building ? base?.buildings.find((x) => x.id === detail.building) : undefined;
    const need = b ? b.planned + 1 - cap : kz + 1;
    return {
      hint: `Gebäude dürfen höchstens ${cap} Stufen über der Kommandozentrale stehen (sie hat Stufe ${kz}, eingereihte Ausbauten zählen mit).${b ? ` Für ${label(b.id)} Stufe ${b.planned + 1} braucht sie Stufe ${need}.` : ""}`,
      actions: [build("kommandozentrale")],
    };
  },

  building_required: (ctx) => {
    const tech = techOf(ctx);
    const id = tech ? ctx.balance!.research!.building : builtIn(ctx);
    if (!id || id === "anlagen") return null;
    return { hint: `Dafür brauchst du: ${label(id)} Stufe 1.`, actions: [build(id, `${label(id)} bauen`)] };
  },

  building_level: (ctx) => {
    const { base, balance, detail } = ctx;
    const tech = techOf(ctx);
    const id = tech ? balance!.research!.building : builtIn(ctx);
    if (!id) return null;
    const need = tech ? tech.requiresBuildingLevel ?? 1 : detail.unit ? balance?.units[detail.unit]?.requiresLevel ?? null : null;
    const what = tech ? "Diese Forschung" : detail.unit ? label(detail.unit) : "Das";
    return {
      hint: need ? `${what} braucht ${label(id)} Stufe ${need} (jetzt Stufe ${lvl(base, id)}).` : `Dafür muss ${label(id)} weiter ausgebaut sein (jetzt Stufe ${lvl(base, id)}).`,
      actions: [build(id)],
    };
  },

  harbor_level: ({ base, balance }) => {
    const need = balance?.expansion?.harborLevelForShip;
    return {
      hint: need
        ? `Kolonieschiffe baut die Werft erst ab Hafenkommandantur Stufe ${need} (jetzt Stufe ${lvl(base, "hafenkommandantur")}).`
        : "Dafür muss die Hafenkommandantur weiter ausgebaut sein.",
      actions: [build("hafenkommandantur")],
    };
  },

  home_only: () => ({
    hint: "Das geht nur im Heimathafen. Wechsle oben in der Kopfleiste (Hafenname) zum Heimathafen und versuche es dort.",
  }),

  supply_shortage: ({ base }) => ({
    hint: `Versorgungsmangel: Der Proviant ist aufgebraucht${base ? ` und der Unterhalt (${fmtNum(base.upkeepPerHour)}/h) frisst die Förderung` : ""}. Baue den Versorgungshof aus, kaufe Proviant zu – dann geht die Ausbildung wieder.`,
    actions: [build("versorgungshof"), market("proviant")],
  }),

  queue_busy: (ctx) => {
    const id = builtIn(ctx);
    const order = id ? ctx.base?.trainingQueue.find((o) => o.builtIn === id) : undefined;
    return {
      hint: `${id && id !== "anlagen" ? label(id) : "Dieses Gebäude"} bildet schon aus${order ? ` (fertig ${fmtTime(order.finishesAt)})` : ""}. Jedes Gebäude arbeitet einen Auftrag nach dem anderen ab – danach ist es wieder frei.`,
    };
  },

  no_aircraft_slots: ({ base, balance }) => {
    const per = balance?.buildings.flugfeld.slotsPerLevel ?? 0;
    const used = base?.aircraftSlots.used ?? 0;
    const total = base?.aircraftSlots.total ?? 0;
    const step = base && balance ? nextStep(lvl(base, "flugfeld"), balance.building.maxLevel, (l) => aircraftSlots(stateOf(base, { flugfeld: l }), balance)) : null;
    return {
      hint: `Stellplätze auf dem Flugfeld: ${fmtNum(used)} von ${fmtNum(total)} belegt (Flugzeuge daheim, unterwegs und in Ausbildung).${step ? ` Flugfeld Stufe ${step.level} bringt ${fmtNum(step.value)} Plätze (+${fmtNum(per)} je Stufe).` : ""}`,
      actions: [build("flugfeld")],
    };
  },

  unit_cap: (ctx) => {
    const { base, balance, detail } = ctx;
    const e = balance ? espionageOf(balance) : null;
    const unit = detail.unit ?? e?.unit;
    const def = unit ? balance?.units[unit] : undefined;
    const where = def?.builtIn ?? e?.building ?? "nachrichtendienst";
    const cap = base && balance && unit === e?.unit ? spyCap(stateOf(base) as BaseState, balance) : null;
    if (def?.maxPerLevel === undefined) return { hint: `Höchstzahl erreicht. Mehr gibt es mit dem Ausbau von ${label(where)}.`, actions: [build(where)] };
    return {
      hint: `${unit ? label(unit) : "Diese Einheit"}: höchstens ${fmtNum(def.maxPerLevel, 1)} je Stufe von ${label(where)} (jetzt Stufe ${lvl(base, where)}${cap !== null ? `, also ${fmtNum(cap)}` : ""}) – daheim, unterwegs und in Ausbildung zusammen. Mehr gibt es mit dem nächsten Ausbau.`,
      actions: [build(where)],
    };
  },

  spy_level: ({ base, balance, detail }) => {
    const e = balance ? espionageOf(balance) : null;
    const kind = detail.type && e ? (e.kinds as Record<string, { minLevel: number }>)[detail.type] : undefined;
    const id = e?.building ?? "nachrichtendienst";
    return {
      hint: kind
        ? `${label(detail.type!)} braucht ${label(id)} Stufe ${kind.minLevel} (jetzt Stufe ${lvl(base, id)}).`
        : `Dafür braucht ${label(id)} eine höhere Stufe (jetzt Stufe ${lvl(base, id)}).`,
      actions: [build(id)],
    };
  },

  no_spies: () => ({
    hint: "Nicht genug Spione daheim. Bilde im Nachrichtendienst Spione aus oder warte, bis unterwegs befindliche zurück sind.",
    actions: [training, go("Laufende Missionen", { to: "troops", seg: "einsatz" })],
  }),

  requires_tech: (ctx) => {
    const req = techOf(ctx)?.requires ?? {};
    const levels = (ctx.base?.research as { levels?: Record<string, number> } | null)?.levels ?? {};
    const open = Object.entries(req).filter(([t, n]) => (levels[t] ?? 0) < n).map(([t, n]) => `${techLabel(t)} Stufe ${n}`);
    return {
      hint: open.length ? `Erst ${joinDe(open)} erforschen.` : "Erst die Voraussetzung erforschen – im Blatt der Technik steht, welche Stufe von welcher Technik fehlt.",
      actions: [research],
    };
  },

  research_busy: ({ base }) => {
    const order = (base?.research as { order?: { finishesAt: number } | null } | null)?.order;
    return {
      hint: `Es läuft schon eine Forschung${order ? ` (fertig ${fmtTime(order.finishesAt)})` : ""}. Das Forschungsamt forscht eine Technik nach der anderen – abwarten oder die laufende abbrechen.`,
      actions: [research],
    };
  },

  breakthrough_pending: () => ({ hint: "Erst die Belohnung des Durchbruchs wählen (Stufe oder Tempo), dann geht es weiter.", actions: [research] }),

  no_research: () => ({ hint: "Forschung braucht ein Forschungsamt im Heimathafen.", actions: [build("forschungsamt", "Forschungsamt bauen")] }),

  admiral_funds: (ctx) => credits(ctx),
  funds: (ctx) => credits(ctx),

  template_limit: () => ({ hint: "Lösche zuerst eine alte Vorlage (Mülleimer neben der Vorlage), dann ist wieder Platz." }),
};

/** Kredite fehlen: Herkunft der Kredite und Sprung zur Börse. */
function credits({ base, balance, detail }: RemedyCtx) {
  const have = base?.market.credits ?? 0;
  const need = detail.cost?.credits;
  const lack = need !== undefined ? Math.ceil(need - have) : null;
  const open = base?.market.unlocked;
  return {
    hint: `${lack !== null && lack > 0 ? `Es fehlen ${fmtNum(lack)} Kredite (Konto: ${fmtNum(have)}). ` : `Konto: ${fmtNum(have)} Kredite. `}Kredite bekommst du durch Verkäufe an der Börse${open ? "" : ` (öffnet ab Hafenkommandantur Stufe ${balance?.buildings.hafenkommandantur?.marketFromLevel ?? 3})`} oder im Spielerhandel. Bei Rohstoffen: Bestand prüfen oder kleinere Menge wählen.`,
    actions: [market(), go("Spielerhandel", { to: "market", seg: "spieler" })],
  };
}
