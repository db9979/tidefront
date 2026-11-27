// Abhilfe: Felder, Mehrere Häfen, Admirale, Allianz und Diplomatie, Sammelangriffe, Schutz, Aufträge.
import { admiralSlots, allowedBases, fieldsOf, maxFieldsFor, nextUnlockLevel } from "@tidefront/game-core";
import { fmtNum } from "../names.ts";
import { fmtTime } from "../time.ts";
import { alliance, build, go, lvl, mapAction, missions, nextStep, stateOf, training } from "./helpers.ts";
import type { RemedyTable } from "./types.ts";

const myFields = go("Meine Felder", { to: "troops", seg: "einsatz" });
const diplomacy = go("Allianz → Diplomatie", { to: "meldungen", sub: "allianz" });
const offers = go("Eigene Angebote", { to: "market", seg: "spieler" });

export const WORLD: RemedyTable = {
  // Felder
  field_limit: ({ base, balance }) => {
    const hk = lvl(base, "hafenkommandantur");
    const max = balance ? maxFieldsFor(hk, balance) : null;
    const step = balance ? nextStep(hk, balance.building.maxLevel, (l) => maxFieldsFor(l, balance)) : null;
    return {
      hint: `${max !== null ? `Mit Hafenkommandantur Stufe ${hk} hältst du höchstens ${max} ${max === 1 ? "Feld" : "Felder"}. ` : ""}${step ? `Ab Stufe ${step.level} sind es ${step.value}. ` : ""}Oder ein Feld aufgeben (Truppen → Meine Felder).`,
      actions: [build("hafenkommandantur"), myFields],
    };
  },
  field_ships_only: () => ({ hint: "Nimm Truppen und Flugzeuge aus dem Verband – Felder besetzen nur Schiffe." }),
  garrison_too_weak: ({ balance }) => ({
    hint: `Als Besatzung bleiben bewaffnete Schiffe mit zusammen mindestens ${fmtNum(balance ? fieldsOf(balance)?.minGarrisonCommandPoints ?? 0 : 0)} Kommandopunkten. Mehr Kriegsschiffe mitschicken.`,
    actions: [training],
  }),
  field_escort_invalid: () => ({ hint: "Wähle das Geleit nur aus den Schiffen der Besatzung, höchstens so viele, wie dort liegen." }),
  field_escort_too_large: ({ balance }) => ({
    hint: `Auf dem Feld müssen bewaffnete Schiffe mit mindestens ${fmtNum(balance ? fieldsOf(balance)?.escortMinRemainCommandPoints ?? 0 : 0)} Kommandopunkten bleiben. Weniger Geleit wählen oder Verstärkung schicken.`,
  }),
  field_has_admiral: () => ({ hint: "Ein Feld führt nur ein Admiral. Ziehe den bisherigen ab (Truppen → Meine Felder) oder schicke den Verband ohne Admiral.", actions: [myFields] }),
  field_no_admiral: () => ({ hint: "Diese Besatzung hat keinen Admiral – es gibt nichts abzuziehen." }),

  // Mehrere Häfen
  command_level: ({ base, balance }) => {
    const next = base?.isHome && balance ? nextUnlockLevel(stateOf(base), balance) : null;
    const allowed = base?.isHome && balance ? allowedBases(stateOf(base), balance) : null;
    return {
      hint: `${allowed !== null ? `Erlaubt ${allowed === 1 ? "ist gerade 1 Hafen" : `sind gerade ${allowed} Häfen`}. ` : ""}Einen weiteren Hafen schaltet die Kommandozentrale des Heimathafens frei${next ? ` (Stufe ${next}, jetzt Stufe ${lvl(base, "kommandozentrale")})` : ""}.`,
      actions: base?.isHome ? [build("kommandozentrale")] : [],
    };
  },
  base_limit: ({ balance }) => ({
    hint: `Mehr als ${balance?.expansion?.maxBases ?? 3} Häfen gehen nicht – laufende Gründungen zählen mit. Um anderswo zu gründen, erst eine Kolonie aufgeben (Hafenverwaltung in der Basis).`,
  }),
  too_close: ({ balance }) => ({ hint: `Zu fremden Häfen braucht ein neuer Hafen mindestens ${balance?.expansion?.minDistanceHex ?? 4} Felder Abstand. Wähle ein anderes Küstenfeld.`, actions: [mapAction] }),
  too_close_own: ({ balance }) => ({ hint: `Zu eigenen Häfen braucht ein neuer Hafen mindestens ${balance?.expansion?.minDistanceOwnHex ?? 3} Felder Abstand. Wähle ein Küstenfeld weiter weg.`, actions: [mapAction] }),
  trade_port: () => ({ hint: "Wähle ein freies Küstenfeld ohne Handelshafen.", actions: [mapAction] }),
  resource_field: () => ({ hint: "Wähle ein freies Küstenfeld ohne Rohstofffeld.", actions: [mapAction] }),
  field_taken: () => ({ hint: "Wähle ein anderes freies Küstenfeld – am besten eins mit etwas Abstand zu anderen Häfen." }),
  not_coast: () => ({ hint: "Häfen liegen an der Küste: Wähle ein Landfeld direkt am Wasser." }),
  colony_ship: ({ base, balance }) => {
    const ship = balance?.expansion?.colonyShip ?? "kolonieschiff";
    const werft = balance?.units[ship]?.requiresLevel ?? 6;
    const hk = balance?.expansion?.harborLevelForShip ?? 6;
    return {
      hint: `Eine Gründung braucht genau ein Kolonieschiff im Verband. Es entsteht in der Werft (Stufe ${werft}, jetzt ${lvl(base, "werft")}) bei Hafenkommandantur Stufe ${hk} (jetzt ${lvl(base, "hafenkommandantur")}).`,
      actions: [training, build("werft")],
    };
  },
  transfer_needs_own_base: () => ({ hint: "Wähle unter „Ziel“ einen deiner anderen Häfen." }),
  admiral_other_base: () => ({ hint: "Wechsle oben in der Kopfleiste zu dem Hafen, in dem der Admiral dient, oder verlege ihn mit einer Verlegung hierher." }),
  admiral_elsewhere: () => ({ hint: "Wechsle oben in der Kopfleiste zu dem Hafen, in dem der Admiral dient." }),

  // Kolonie aufgeben: Hindernisse
  missions_out: () => ({ hint: "Rufe alle Verbände dieses Hafens zurück (auch Stationierungen, Blockaden, Feldbesatzungen) und warte die Heimkehr ab.", actions: [missions] }),
  incoming_own: () => ({ hint: "Warte, bis die eigene Verlegung oder der Transport angekommen ist." }),
  attack_incoming: () => ({ hint: "Warte, bis der Angriff abgewehrt ist; danach geht es." }),
  guests_stationed: () => ({ hint: "Bitte deine Verbündeten, ihre Verbände abzuziehen, oder warte, bis sie heimfahren.", actions: [alliance] }),
  blockaded: () => ({ hint: "Warte das Ende der Blockade ab oder brich sie mit einem Überfall.", actions: [mapAction] }),
  under_siege: () => ({ hint: "Warte das Ende der Belagerung ab oder brich den Ring (Weltereignis auf der Karte).", actions: [mapAction] }),
  deliveries_underway: () => ({ hint: "Warte, bis alle Lieferungen angekommen sind (Zeiten in der Basis)." }),
  offers_open: () => ({ hint: "Ziehe die offenen Handelsangebote dieses Hafens zurück.", actions: [offers] }),
  field_held: () => ({ hint: "Gib die Rohstofffelder auf, die an diesen Hafen liefern.", actions: [myFields] }),

  // Admirale
  admiral_slots: ({ base, balance }) => {
    const hk = lvl(base, "hafenkommandantur");
    const now = balance ? admiralSlots(hk, balance) : null;
    const step = balance ? nextStep(hk, balance.building.maxLevel, (l) => admiralSlots(l, balance)) : null;
    return {
      hint: `${now !== null ? `Bei Hafenkommandantur Stufe ${hk} ${now === 1 ? "dient höchstens 1 Admiral" : `dienen höchstens ${now} Admirale`}. ` : ""}${step ? `Ab Stufe ${step.level} sind es ${step.value}. ` : "Mehr Plätze gibt es nicht. "}Oder einen Admiral entlassen.`,
      actions: step ? [build("hafenkommandantur")] : [],
    };
  },
  admiral_name: () => ({ hint: "Wähle einen anderen Namen aus der Liste oder lass das Feld leer – dann wird einer gewürfelt." }),
  admiral_rank: ({ balance }) => {
    const r = balance?.admirals?.ranks?.[(balance.admirals.secondSpecFromRank ?? 2) - 1] as { name?: string; minXp?: number } | undefined;
    return { hint: `Die zweite Spezialisierung gibt es ab ${r?.name ?? "Vizeadmiral"}${r?.minXp !== undefined ? ` (${fmtNum(r.minXp)} Erfahrung)` : ""}. Erfahrung sammelt der Admiral in Gefechten.` };
  },
  admiral_busy: () => ({ hint: "Warte, bis der Admiral heimgekehrt oder genesen ist. Ist er gefangen, lässt er sich freikaufen.", actions: [missions] }),

  // Allianz, Diplomatie
  ally: () => ({ hint: "Verbündete greift man nicht an. Zum Helfen: Stationieren (Truppen verteidigen mit) oder Transport." }),
  pact: () => ({ hint: "Mit diesem Hafen gilt ein Nichtangriffspakt. Erst kündigen und die Frist abwarten (Allianzführung).", actions: [diplomacy] }),
  no_alliance: () => ({ hint: "Tritt einer Allianz bei oder gründe eine eigene.", actions: [alliance] }),
  in_alliance: () => ({ hint: "Erst die bisherige Allianz verlassen.", actions: [alliance] }),
  no_rights: () => ({ hint: "Das darf nur die Allianzführung (teils auch Offiziere). Frag sie im Allianz-Funk.", actions: [alliance] }),
  alliance_full: () => ({ hint: "Wähle eine andere Allianz oder bitte die Führung, Platz zu schaffen." }),
  at_war: () => ({ hint: "Erst Frieden schließen: Die Allianzführung bietet unter Diplomatie einen Pakt an.", actions: [diplomacy] }),
  pact_active: () => ({ hint: "Die Allianzführung kündigt den Pakt unter Diplomatie; nach Ablauf der Frist geht es.", actions: [diplomacy] }),

  // Sammelangriff
  raid_closed: () => ({ hint: "Eröffne selbst einen neuen Sammelangriff: Mission planen → Überfall auf ein festes Ziel → „Als Sammelangriff“." }),
  raid_full: ({ balance }) => ({ hint: `Mehr als ${balance?.allianceOps?.raid?.maxParticipants ?? 8} Verbände nimmt ein Sammelangriff nicht. Eröffne einen eigenen.` }),
  raid_limit: ({ balance }) => ({ hint: `Eine Allianz hat höchstens ${balance?.allianceOps?.raid?.maxOpenPerAlliance ?? 3} offene Sammelangriffe. Warte, bis einer ausläuft, oder tritt einem bestehenden bei.`, actions: [alliance] }),
  raid_bad_target: () => ({ hint: "Wähle ein festes Ziel: Hafen, Nest, Großflotte oder Belagerung." }),
  raid_launched: () => ({ hint: "Der Verband ist unterwegs – zurückrufen geht unter Truppen → Einsatz.", actions: [missions] }),
  bad_time: ({ balance }) => {
    const r = balance?.allianceOps?.raid;
    return r ? { hint: `Beitrittsfrist ${r.minJoinMinutes} Minuten bis ${r.maxJoinHours} Stunden, Ankunft nicht vor der Frist und höchstens ${r.maxArriveHours} Stunden.` } : null;
  },

  // Schutz und Einstellungen
  shield_cooldown: ({ base, balance, now }) => {
    const p = base?.protection as { nightShieldChangedAtMs?: number } | undefined;
    const at = p?.nightShieldChangedAtMs !== undefined && balance ? p.nightShieldChangedAtMs + balance.protection.nightShieldChangeHours * 3_600_000 : null;
    return { hint: `Der Nachtschild lässt sich nur einmal je ${balance?.protection.nightShieldChangeHours ?? 24} Stunden umstellen.${at && at > now ? ` Wieder ab ${fmtTime(at)}.` : ""}` };
  },

  // Aufträge, Tagesbefehle, Erfolge
  not_done: () => ({ hint: "Erst die Bedingung erfüllen – der Fortschritt steht am Auftrag." }),
  not_unlocked: () => ({ hint: "Erst die vorige Stufe dieses Erfolgs erreichen." }),
  reroll_used: () => ({ hint: "Neu würfeln geht einmal am Tag – morgen wieder." }),
  no_alternative: () => ({ hint: "Später erneut versuchen, wenn sich dein Hafen weiterentwickelt hat." }),

  // Anmeldung und Konto
  no_email: () => ({ hint: "Hinterlege in den Einstellungen (Handbuch → Einstellungen) eine eigene E-Mail-Adresse." }),
};
