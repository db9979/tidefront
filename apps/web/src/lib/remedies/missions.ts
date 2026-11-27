// Abhilfe: Missionen planen (Verband, Plätze, Treibstoff, Reichweite, Ziel, Wetter) und Spionageaufträge.
import { blockadeOf, commandPoints, commandPointsAt, fuelCost, minesOf, missionSlots, sabotageCooldownUntil } from "@tidefront/game-core";
import { countLabel, fmtNum, label } from "../names.ts";
import { fmtTime } from "../time.ts";
import { build, go, joinDe, lvl, mapAction, market, missions, nextStep, producer, stateOf, training } from "./helpers.ts";
import type { RemedyCtx, RemedyTable } from "./types.ts";

/** Kommandopunkte, Truppengröße, Truppenplatz und Ladekapazität des gewählten Verbands. */
function totals({ balance, detail }: RemedyCtx) {
  let cp = 0, troops = 0, space = 0, cargo = 0;
  for (const [id, n] of Object.entries(detail.units ?? {})) {
    const d = balance?.units[id];
    if (!d) continue;
    cp += (d.commandPoints ?? 0) * n;
    if (d.branch === "land") troops += (d.size ?? 0) * n;
    space += (d.troopSpace ?? 0) * n;
    cargo += (d.cargo ?? 0) * n;
  }
  return { cp, troops, space, cargo };
}

export const MISSIONS: RemedyTable = {
  no_mission_slot: ({ base, balance, now }) => {
    if (!base || !balance) return { hint: "Mehr Missionsplätze bringt die Hafenkommandantur. Oder eine laufende Mission zurückrufen.", actions: [build("hafenkommandantur"), missions] };
    const hk = lvl(base, "hafenkommandantur");
    const step = nextStep(hk, balance.building.maxLevel, (l) => missionSlots(stateOf(base, { hafenkommandantur: l }), balance));
    const back = base.missions.map((m) => m.returnAtMs).filter((t): t is number => typeof t === "number" && t > now).sort((a, b) => a - b)[0];
    const parts: string[] = [];
    if (step) parts.push(`Mehr Plätze bringt die Hafenkommandantur: Stufe ${step.level} gibt ${step.value} Plätze (jetzt Stufe ${hk}).`);
    parts.push(`Oder eine laufende Mission zurückrufen${back ? ` – die nächste ist um ${fmtTime(back)} zurück` : ""}.`);
    const summary = `${base.activeMissions} von ${base.missionSlots} belegt${back ? ` · nächste Rückkehr ${fmtTime(back)}` : ""}`;
    return { hint: parts.join(" "), summary, actions: [build("hafenkommandantur"), missions] };
  },

  command_points: (ctx) => {
    const { base, balance } = ctx;
    const { cp } = totals(ctx);
    const have = base?.commandPoints ?? 0;
    const kzNow = base ? lvl(base, "kommandozentrale") : 0; // v1.24: ab KZ 9 mehr je Stufe
    const per = balance ? commandPointsAt(kzNow + 1, balance) - commandPointsAt(kzNow, balance) : 0;
    const step = base && balance ? nextStep(lvl(base, "kommandozentrale"), balance.building.maxLevel, (l) => commandPoints(stateOf(base, { kommandozentrale: l }), balance)) : null;
    const target = base && balance && cp > have ? nextStep(lvl(base, "kommandozentrale"), balance.building.maxLevel, (l) => commandPoints(stateOf(base, { kommandozentrale: l }), balance) >= cp ? 1 : 0) : null;
    return {
      hint: `${cp > 0 ? `Der Verband braucht ${fmtNum(cp, 1)} Kommandopunkte, du hast ${fmtNum(have)}. ` : ""}Weniger oder kleinere Einheiten mitschicken – oder die Kommandozentrale ausbauen (+${fmtNum(per)} mit der nächsten Stufe${target ? `; ab Stufe ${target.level} reicht es` : step ? `; Stufe ${step.level}: ${fmtNum(step.value)}` : ""}).`,
      summary: cp > 0 ? `Verband ${fmtNum(cp, 1)} von ${fmtNum(have)} Kommandopunkten` : undefined,
      actions: [build("kommandozentrale")],
    };
  },

  troop_capacity: (ctx) => {
    const { balance } = ctx;
    const { troops, space } = totals(ctx);
    const per = balance?.units.landungsschiff?.troopSpace ?? 0;
    const more = per > 0 && troops > space ? Math.ceil((troops - space) / per) : 0;
    return {
      hint: `Landtruppen brauchen Platz auf Landungsschiffen: ${fmtNum(troops)} Truppen, ${fmtNum(space)} Platz.${more > 0 ? ` Nimm ${fmtNum(more)} ${countLabel("landungsschiff", more)} mehr mit (je ${fmtNum(per)} Platz) oder weniger Truppen.` : " Mehr Landungsschiffe mitnehmen oder weniger Truppen."}`,
      actions: [go("Landungsschiffe ausbilden", { to: "troops", seg: "ausbilden" })],
    };
  },

  fuel: ({ base, balance, detail }) => {
    const need = base && balance && detail.units && detail.distanceKm !== undefined
      ? fuelCost(detail.units, detail.distanceKm, balance, base.modifiers as never) : null;
    const have = Math.floor(base?.resources.treibstoff ?? 0);
    const lack = need !== null ? need - have : null;
    const prod = producer(balance, "treibstoff");
    return {
      hint: "Kleineren oder sparsameren Verband wählen, ein näheres Ziel nehmen, Treibstoff an der Börse kaufen oder die Raffinerie ausbauen.",
      summary: need !== null && lack && lack > 0 ? `Fehlt: ${fmtNum(lack)} Treibstoff für Hin- und Rückfahrt` : undefined,
      items: need !== null ? [{ id: "treibstoff", label: "Treibstoff", have, need }] : undefined,
      actions: [market("treibstoff"), ...(prod ? [build(prod)] : [])],
    };
  },

  storm: () => ({ hint: "Bei Sturm am eigenen Hafen starten keine reinen Luftverbände. Nimm mindestens ein Schiff mit oder warte, bis der Sturm abzieht (Wetter auf der Karte)." , actions: [mapAction] }),

  out_of_range: ({ balance, detail }) => {
    const far = Object.entries(detail.units ?? {})
      .filter(([id, n]) => n > 0 && balance?.units[id]?.branch === "luft" && detail.distanceKm !== undefined && detail.distanceKm > (balance.units[id].rangeKm ?? 0))
      .map(([id]) => `${label(id)} (${fmtNum(balance!.units[id].rangeKm ?? 0)} km)`);
    return {
      hint: `${detail.distanceKm !== undefined ? `Das Ziel liegt ${fmtNum(detail.distanceKm)} km entfernt. ` : ""}${far.length ? `Zu kurze Reichweite: ${joinDe(far)}. ` : ""}Diese Flugzeuge herausnehmen, ein näheres Ziel wählen oder aus einem näheren eigenen Hafen starten.`,
      actions: [mapAction],
    };
  },

  target_protected: () => ({
    hint: "Das Ziel ist gerade geschützt (Anfängerschutz, Nachtschild, Schutz nach Niederlage oder Gründungsschutz – die Karte zeigt, welcher). Aufklärung geht trotzdem; für einen Überfall ein anderes Ziel wählen oder das Schutzende abwarten.",
    actions: [mapAction],
  }),

  nest_empty: () => ({ hint: "Dieses Nest ist verlassen und kehrt später zurück (Zeit im Nest-Blatt auf der Karte). Wähle ein anderes Nest.", actions: [mapAction] }),
  no_target: () => ({ hint: "Auf diesem Feld liegt nichts. Tippe auf der Karte einen Hafen, ein Nest, ein Rohstofffeld oder ein Weltereignis an.", actions: [mapAction] }),
  own_base: () => ({ hint: "Wähle ein fremdes Ziel. Ladung in einen anderen eigenen Hafen bringt ein Transport oder eine Verlegung." }),
  transport_needs_base: () => ({ hint: "Wähle als Ziel einen Hafen – einen eigenen oder den eines Mitspielers." }),
  empty_fleet: () => ({ hint: "Wähle unter „Verband“ mindestens eine Einheit." }),
  no_combat_units: () => ({ hint: "Für einen Überfall brauchst du Kampfschiffe und für die Beute Landungsschiffe mit Truppen daheim. Bilde sie in Werft und Kaserne aus oder warte auf die Heimkehr; aufklären geht schon jetzt.", actions: [training, missions] }), // Lohnende Ziele ohne Kampfeinheiten
  units_unavailable: () => ({ hint: "Ein Teil der gewählten Einheiten ist unterwegs, in Ausbildung oder gefallen. Anzahl verringern oder auf die Heimkehr warten.", actions: [missions, training] }),
  no_carrier: () => ({ hint: "Landtruppen fahren nicht allein: Nimm Schiffe (für Truppen Landungsschiffe) oder Flugzeuge mit.", actions: [training] }),

  cargo_capacity: (ctx) => {
    const { cargo } = totals(ctx);
    const load = Object.values(ctx.detail.cargo ?? {}).reduce((a, b) => a + b, 0);
    const per = ctx.balance?.units.landungsschiff?.cargo ?? 0;
    return {
      hint: `Ladung ${fmtNum(load)}, Laderaum etwa ${fmtNum(cargo)}. Weniger laden oder mehr Laderaum mitschicken${per ? ` (Landungsschiff: ${fmtNum(per)} je Schiff)` : ""}.`,
    };
  },

  cargo_not_allowed: () => ({ hint: "Ladung nehmen nur Transport, Gründung und Verlegung mit. Ladung auf 0 setzen oder die Art auf „Transport“ stellen." }),
  covert_unit: () => ({ hint: "Spione reisen nicht im Verband. Nimm sie heraus und schicke sie über die Art „Spionage“." }),

  event_needs_raid: () => ({ hint: "Gegen Weltereignisse wählst du unter „Art“ den Überfall." }),
  own_siege: () => ({ hint: "Greife den Belagerungsring aus einem anderen deiner Häfen an (Hafen oben wechseln) oder bitte Verbündete um Hilfe." , actions: [go("Allianz", { to: "meldungen", sub: "allianz" })] }),
  intercept_impossible: () => ({ hint: "Das Schatzschiff ist zu schnell für diesen Verband. Nimm nur schnelle Schiffe (z. B. Korvetten) mit oder starte aus einem näheren Hafen." }),
  too_late: () => ({ hint: "Der Verband käme nach dem Ende des Ereignisses an. Schnellere Einheiten wählen oder aus einem näheren Hafen starten." }),

  // Allianz-Ops
  station_not_ally: () => ({ hint: "Stationieren geht nur bei Mitgliedern deiner Allianz. Tritt einer Allianz bei oder wähle einen Hafen eines Verbündeten.", actions: [go("Allianz", { to: "meldungen", sub: "allianz" })] }),
  station_full: ({ balance }) => ({ hint: `In einem Hafen liegen höchstens ${balance?.allianceOps?.station?.maxPerBase ?? 3} verbündete Verbände. Wähle einen anderen Verbündeten oder warte, bis einer abzieht.` }),

  // Spionage
  target_beginner: () => ({ hint: "Gegen Häfen im Anfängerschutz gibt es keine Spionage. Wähle ein anderes Ziel oder warte das Schutzende ab (Karte).", actions: [mapAction] }),
  spy_target: () => ({ hint: "Spione arbeiten nur gegen Spielerhäfen – tippe auf der Karte einen fremden Hafen an.", actions: [mapAction] }),
  sabotage_cooldown: ({ base, balance }) => {
    const until = base && balance ? sabotageCooldownUntil(stateOf(base), balance) : 0;
    return { hint: `Ein Hafen lässt sich höchstens einmal je 24 Stunden sabotieren.${until > Date.now() ? ` Wieder möglich ab ${fmtTime(until)}.` : ""} Bis dahin ein anderes Ziel wählen oder erkunden.` };
  },
  bad_sabotage_target: () => ({ hint: "Wähle ein Gebäude, das der Zielhafen auch besitzt (Stufe 1 oder höher)." }),

  // See: Minen, Blockade, Konvoi
  not_sea: () => ({ hint: "Minen liegen nur auf offener See: Wähle ein Wasserfeld ohne Hafen, Nest oder Küste." }),
  too_far: ({ balance, detail }) => {
    if (detail.type === "gruendung" || detail.type === "verlegung") {
      return { hint: `Ein neuer Hafen darf höchstens ${fmtNum(balance?.expansion?.maxRangeKm ?? 0)} km vom Heimathafen entfernt liegen. Wähle ein näheres Küstenfeld.`, actions: [mapAction] };
    }
    const m = balance ? minesOf(balance) : null;
    return { hint: `Minen legst du nur bis ${fmtNum(m?.layRadiusKm ?? 0)} km um den aktiven Hafen. Wähle ein näheres Seefeld oder wechsle den Hafen.`, actions: [mapAction] };
  },
  no_minelayer: () => ({ hint: "Nimm mindestens einen Minenleger in den Verband (Werft).", actions: [go("Minenleger ausbilden", { to: "troops", seg: "ausbilden" })] }),
  no_sweeper: () => ({ hint: "Nimm mindestens einen Minenräumer in den Verband (Werft).", actions: [go("Minenräumer ausbilden", { to: "troops", seg: "ausbilden" })] }),
  too_many_fields: ({ balance }) => {
    const max = balance ? minesOf(balance)?.maxFieldsPerPlayer : undefined;
    return { hint: `Mehr als ${max ?? "die erlaubten"} Minenfelder gleichzeitig gehen nicht. Warte, bis eins verfällt oder geräumt wird.` };
  },
  blockade_ships_only: () => ({ hint: "Nimm Truppen und Flugzeuge aus dem Verband – eine Blockade halten nur Schiffe." }),
  blockade_too_weak: (ctx) => {
    const min = ctx.balance ? blockadeOf(ctx.balance)?.minCommandPoints : undefined;
    return { hint: `Eine Blockade braucht bewaffnete Schiffe mit zusammen mindestens ${fmtNum(min ?? 0)} Kommandopunkten${ctx.detail.units ? ` (gewählt: ${fmtNum(totals(ctx).cp, 1)})` : ""}. Mehr Kriegsschiffe mitschicken.`, actions: [training] };
  },
  already_blockading: () => ({ hint: "Deine Blockade liegt schon vor diesem Hafen. Sie lässt sich unter „Truppen“ verfolgen oder aufheben.", actions: [missions] }),
  own_blockade: () => ({ hint: "Deine eigene Blockade hebst du unter „Truppen“ auf.", actions: [missions] }),
  convoy_not_enemy: () => ({ hint: "Abfangen geht nur bei Konvois von Kriegsgegnern. Krieg erklärt die Allianzführung unter Allianz → Diplomatie.", actions: [go("Allianz", { to: "meldungen", sub: "allianz" })] }),
  intercept_needs_ships: () => ({ hint: "Nimm Schiffe in den Verband – Flugzeuge und Truppen fangen keine Konvois ab." }),
};
