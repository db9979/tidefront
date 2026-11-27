// Abhilfe: Börse (Kurse, Limits, Sperren) und Spielerhandel (Angebote, Geleit).
import { fmtNum, label } from "../names.ts";
import { build, go, lvl, marketLevel, missions, training } from "./helpers.ts";
import type { RemedyTable } from "./types.ts";

const tradePlayers = go("Spielerhandel", { to: "market", seg: "spieler" });
const own = go("Eigene Angebote", { to: "market", seg: "spieler" });

export const TRADE: RemedyTable = {
  locked: ({ base, balance }) => {
    const need = marketLevel(balance);
    return {
      hint: `Börse und Spielerhandel öffnen ab Hafenkommandantur Stufe ${need} in einem deiner Häfen (hier: Stufe ${lvl(base, "hafenkommandantur")}). Bis dahin Rohstoffe selbst fördern.`,
      actions: [build("hafenkommandantur")],
    };
  },

  halted: ({ balance }) => ({
    hint: `Der Kurs ist zu stark gesprungen; der Handel mit dieser Ressource ruht etwa ${balance?.market.haltMinutes ?? 30} Minuten (Restzeit an der Kurstafel). Bis dahin mit einer anderen Ressource handeln.`,
  }),
  band: ({ balance }) => ({
    hint: `Das Kursband ist verletzt; der Handel ruht etwa ${balance?.market.haltMinutes ?? 30} Minuten. Danach erneut versuchen – oder kleinere Mengen handeln.`,
  }),

  impact: ({ balance, detail }) => ({
    hint: `Ein Geschäft darf den Kurs um höchstens ${fmtNum((balance?.market.maxImpactPerTrade ?? 0.02) * 100)} % bewegen${detail.qty ? ` – ${fmtNum(detail.qty)} ${detail.resource ? label(detail.resource) : ""} sind zu viel` : ""}. Teile die Menge auf mehrere kleinere Orders auf.`,
  }),

  rate: ({ balance }) => ({ hint: `Höchstens ${balance?.market.tradesPerMinute ?? 10} Geschäfte je Minute. Kurz warten und dann erneut senden.` }),

  daily_limit: ({ base, balance, detail }) => {
    const share = balance?.market.dailyLimitShareOfStorage ?? 0.2;
    const limit = base ? Math.floor(share * base.capacity) : null;
    return {
      hint: `Je Ressource und Tag lassen sich ${fmtNum(share * 100)} % der Lagergröße handeln${limit !== null ? ` (hier ${fmtNum(limit)}${detail.resource ? ` ${label(detail.resource)}` : ""})` : ""}. Das Limit setzt um Mitternacht (UTC) zurück. Mehr geht mit einem größeren Lagerkomplex.`,
      actions: [build("lagerkomplex")],
    };
  },

  under_attack: () => ({
    hint: "Solange ein Angriff auf deinen Hafen im Anmarsch ist, sind Verkäufe gesperrt (kein Notverkauf vor der Plünderung). Kaufen geht weiter; nach dem Kampf ist der Verkauf wieder frei.",
    actions: [go("Zur Basis", { to: "base" })],
  }),

  credit_limit: ({ base, balance }) => {
    const per = balance?.buildings.hafenkommandantur?.creditLimitPerLevel ?? 0;
    return {
      hint: `Das Kreditkonto fasst höchstens ${fmtNum(base?.market.creditLimit ?? 0)} Kredite (${fmtNum(per)} je Stufe der Hafenkommandantur). Erst Kredite ausgeben (z. B. Rohstoffe kaufen) oder die Hafenkommandantur ausbauen.`,
      actions: [build("hafenkommandantur")],
    };
  },

  slippage: () => ({ hint: "Der Kurs hat sich seit dem Angebot bewegt. Prüfe den neuen Preis und sende die Order noch einmal." }),
  price_bounds: () => ({ hint: "Der Kurs würde die erlaubte Unter- oder Obergrenze verlassen. Kleinere Menge wählen oder später handeln." }),

  siege: () => ({
    hint: "Ein Belagerungsring liegt vor dem Hafen. Brich ihn mit einem Überfall (Weltereignis auf der Karte, gern mit Verbündeten) oder warte das Ende ab; verkaufen geht weiter.",
    actions: [go("Zur Karte", { to: "map" })],
  }),
  blockade: () => ({
    hint: "Eine Seeblockade liegt vor dem Hafen. Greife den Blockadeverband auf der Karte an (Überfall) oder warte das Ende ab; kaufen geht weiter.",
    actions: [go("Zur Karte", { to: "map" })],
  }),

  // Spielerhandel
  too_many_offers: () => ({ hint: "Ziehe ein offenes Angebot zurück oder warte, bis eins angenommen wird.", actions: [own] }),
  not_ally: () => ({ hint: "Dieses Angebot gilt nur für die Allianz des Anbieters. Wähle ein öffentliches Angebot.", actions: [tradePlayers] }),
  offer_gone: () => ({ hint: "Jemand war schneller oder der Anbieter hat zurückgezogen. Die Liste zeigt die aktuellen Angebote.", actions: [tradePlayers] }),
  seller_gone: () => ({ hint: "Wähle ein anderes Angebot.", actions: [tradePlayers] }),
  escort_units: () => ({ hint: "Wähle weniger Geleitschiffe – nur Schiffe, die gerade daheim sind, können mitfahren.", actions: [missions, training] }),
  escort_ships_only: () => ({ hint: "Nimm nur Schiffe ins Geleit; Truppen und Flugzeuge begleiten keine Konvois." }),
  escort_no_cargo: () => ({ hint: "Kredite werden sofort gutgeschrieben. Geleit nur wählen, wenn Ressourcen per Konvoi reisen." }),
  offer_escorted: () => ({ hint: "Der Anbieter schützt die Ware schon selbst. Nimm das Angebot ohne eigenes Geleit an." }),
};
