// Abhilfe: Lagebild Stufe 2 – Patrouille, Aufklärungskampagne, Radarposten; Stufe 3 – Satelliten, Voraussetzungen.
import { missingRequirement, postLimit, type BaseState } from "@tidefront/game-core";
import { label } from "../names.ts";
import { build, lvl, mapAction, missions, research, stateOf, training } from "./helpers.ts";
import type { RemedyTable } from "./types.ts";

const meldungenLagebild = { label: "Lagebild", go: { to: "meldungen" as const, sub: "lagebild" as const } };

export const INTEL: RemedyTable = {
  patrol_units: () => ({ hint: "Nimm nur Korvetten, Zerstörer, U-Boote oder Aufklärungsdrohnen mit. Landungsschiffe, Truppen und Bomber bleiben daheim.", actions: [training] }),
  patrol_waypoints: () => ({ hint: "Tippe auf der Karte 2 bis 4 Seefelder als Wegpunkte an. Der Verband fährt sie im Kreis ab." }),
  patrol_sea: () => ({ hint: "Wegpunkte liegen auf offener See. Tippe den falschen Punkt in der Liste an, um ihn zu entfernen, und wähle ein Seefeld." }),
  patrol_hours: () => ({ hint: "Wähle 4, 8 oder 12 Stunden Dauer." }),
  patrol_drone_hours: () => ({ hint: "Drohnen fliegen höchstens 6 Stunden: Wähle 4 Stunden oder schicke Schiffe ohne Drohnen für längere Patrouillen." }),
  patrol_drone_range: () => ({ hint: "Drohnen reichen 800 km weit. Lege die Wegpunkte näher an den Hafen oder schicke Schiffe.", actions: [mapAction] }),
  campaign_targets: () => ({ hint: "Wähle 1 bis 4 verschiedene Ziele (Häfen, Nester, Rohstofffelder). Ein Ziel in der Liste antippen entfernt es." }),
  post_crew: () => ({ hint: "Nimm mindestens 5 Pioniere und ein Landungsschiff mit. Pioniere bildet die Kaserne aus, Landungsschiffe die Werft.", actions: [training] }),
  post_radar: ({ base, balance }) => ({
    hint: `Radarposten errichtet nur ein Hafen mit Radarstation Stufe ${balance?.intel?.post?.radarLevel ?? 3} (jetzt Stufe ${lvl(base, "radarstation")}).`,
    actions: [build("radarstation")],
  }),
  post_site: () => ({ hint: "Wähle ein freies Küstenfeld (Land am Wasser, kein Hafen, Nest oder Handelshafen) oder ein eigenes Rohstofffeld.", actions: [mapAction] }),
  post_limit: ({ base, balance }) => {
    const pb = balance?.intel?.post;
    const hk = lvl(base, "hafenkommandantur");
    return {
      hint: pb
        ? `Du darfst ${postLimit(hk, pb)} Radarposten halten${hk < pb.harborLevel ? `, ab Hafenkommandantur Stufe ${pb.harborLevel} sind es ${pb.maxHarbor}` : ""}. Oder einen Posten abbauen (50 % der Kosten kommen zurück).`
        : "Baue einen bestehenden Radarposten ab.",
      actions: [meldungenLagebild, ...(pb && hk < pb.harborLevel ? [build("hafenkommandantur")] : [])],
    };
  },
  post_too_close: () => ({ hint: "Radarposten brauchen 300 km Abstand zueinander (auch zu Posten, die gerade errichtet werden). Wähle eine Küste weiter weg.", actions: [mapAction, meldungenLagebild] }),
  no_post: () => ({ hint: "Der Posten wurde inzwischen abgebaut oder zerstört.", actions: [missions] }),
  // Stufe 3: Voraussetzungen (Startrampe, Störsender) und Satelliten
  building_requires: ({ base, balance, detail }) => {
    const id = detail?.building ?? "";
    const need = Object.entries(balance?.buildings[id]?.requires ?? {}).filter(([b, l]) => lvl(base, b) < l);
    const first = base && balance ? missingRequirement(stateOf(base) as BaseState, id, balance) : null;
    const list = need.map(([b, l]) => `${label(b)} ${l} (jetzt ${lvl(base, b)})`);
    return {
      hint: need.length ? `${label(id)} braucht ${list.join(", ")}.` : "Es fehlen Voraussetzungen in diesem Hafen.",
      summary: need.length ? `Fehlt ${list.join(", ")}` : undefined,
      actions: need.slice(0, 3).map(([b]) => build(b)).concat(first && !need.length ? [build(first.id)] : []),
    };
  },
  sat_pad: ({ base, balance }) => {
    const req = Object.entries(balance?.buildings.startrampe?.requires ?? {}).filter(([b, l]) => lvl(base, b) < l);
    return {
      hint: `Satelliten starten von der Startrampe (Hafengebäude)${req.length ? `; sie braucht ${req.map(([b, l]) => `${label(b)} ${l}`).join(", ")}` : ""}.`,
      summary: req.length ? `Startrampe fehlt · braucht ${req.map(([b, l]) => `${label(b)} ${l}`).join(", ")}` : "Startrampe fehlt",
      actions: [build("startrampe", "Startrampe bauen"), ...req.slice(0, 2).map(([b]) => build(b))],
    };
  },
  sat_tech: () => ({ hint: "Erforsche im Zweig Raumfahrt den optischen Satelliten (Forschungsamt 5) bzw. den Radarsatelliten (Forschungsamt 6).", summary: "Raumfahrt erforschen", actions: [research] }),
  sat_limit: ({ balance }) => {
    const sb = balance?.intel?.satellite;
    return {
      hint: sb ? `Du hältst höchstens ${sb.max} Satelliten gleichzeitig, mit erforschtem Radarsatelliten ${sb.maxMore}. Jeder fliegt ${Math.round(sb.lifetimeHours / 24)} Tage.` : "Warte, bis ein Satellit verglüht.",
      summary: sb ? `höchstens ${sb.max} (mit Raumfahrt 2: ${sb.maxMore})` : undefined,
      actions: [meldungenLagebild, research],
    };
  },
  sat_type: () => ({ hint: "Wähle einen optischen Satelliten oder einen Radarsatelliten.", summary: "optisch oder Radar wählen" }),
};
