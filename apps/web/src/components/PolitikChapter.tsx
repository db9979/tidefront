// Handbuch-Kapitel „Weltpolitik“ (docs/REGELN-WELTPOLITIK.md): Gezeit, Seerat, Ansehen, Gesuche, Sperre nach Überfall.
// Zahlen aus balance.politik (Grundbalance aus meta, nicht die gerade wirksame).
import type { ReactNode } from "react";
import type { Balance } from "../lib/trpc.ts";
import type { PolitikBalance } from "@tidefront/game-core";

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-200 mb-2 leading-relaxed">{children}</p>;
}

const pct = (x: number) => `${String(Math.round(x * 1000) / 10).replace(".", ",")} %`;
const days = (l: number[]) => l.map((d) => String(d)).join(" / ");

export function PolitikChapter({ b }: { b: Balance | undefined }) {
  const p = (b as { politik?: PolitikBalance } | undefined)?.politik;
  if (!p) return <P>In dieser Runde gibt es keine Weltpolitik.</P>;
  const fee = b!.market.fee;
  const lim = b!.market.dailyLimitShareOfStorage;
  const e = p.effects;
  const a = p.ansehen;
  const g = p.gesuche;
  const s = p.seerat;
  return (
    <>
      <P>Die Welt bleibt nicht stehen: Dreimal je Saison verschiebt eine <strong>Gezeit</strong> für {p.gezeit.durationHours} Stunden vorhandene Regeln, der <strong>Seerat</strong> stimmt über Beschlüsse ab, und jeder KI-Spieler merkt sich, wie du mit ihm umgehst (<strong>Ansehen</strong>). Was gerade gilt, steht auf der <strong>Lage</strong> (Zeile Weltpolitik, groß bei offener Abstimmung), ausführlich unter <strong>Meldungen → Saison → Welt</strong> und dort, wo es wirkt (Order, Verträge, Konvoi), mit Restzeit und Wert danach.</P>
      <P><strong>Gezeit:</strong> Fenster ab Tag {days(p.gezeit.windowStartDays)} (± {String(p.gezeit.spreadDays).replace(".", ",")} Tag), angekündigt {p.gezeit.announceHours} Stunden vorher, mit einer Mitteilung zum Beginn. Jede Art kommt einmal je Saison:
        {" "}<strong>Handelskrise</strong> – Börsengebühr {pct(fee * (e.handelskrise.fee ?? 1))} statt {pct(fee)}, Tageslimit {pct(lim * (e.handelskrise.dailyLimit ?? 1))} statt {pct(lim)} des Lagers, Lieferverträge mit KI-Spielern {pct(e.handelskrise.kiBonus ?? 0)} günstiger;
        {" "}<strong>Rohstoffboom</strong> – ein Gut (nie Stahl) mit {pct((e.rohstoffboom.production ?? 1) - 1)} mehr Produktion und Feldertrag, Kurs {pct(e.rohstoffboom.pricePct ?? 0)};
        {" "}<strong>Kartellfehde</strong> – Kartell-Überfälle nur alle {Math.round(b!.pirates.raidIntervalHours * (e.kartellfehde.raidInterval ?? 1))} statt {b!.pirates.raidIntervalHours} Stunden, halb so viele Angriffe auf Felder, häufiger Großflotten. Spätestens {p.finaleGapHours} Stunden vor der Ankündigung des Finales ist alles vorbei.</P>
      <P><strong>Seerat:</strong> tagt {s.openBeforeHours}–{s.closeBeforeHours} Stunden vor jedem Gezeit-Fenster mit drei Knöpfen: die Gezeit wie geplant, ein Beschluss oder „Ruhige See“. Zusätzlich an Tag {days(s.weeklyDays)} eine Wochensitzung ({s.weeklyVoteHours} Stunden Abstimmung, {s.weeklyEffectHours} Stunden Wirkung, nie zugleich mit einer Gezeit). Beschlüsse: <strong>Handelsfrieden</strong> (Börsengebühr × {String(e.handelsfrieden.fee).replace(".", ",")}, Spielerhandel × {String(e.handelsfrieden.playerTradeFee).replace(".", ",")}), <strong>Geleitschutz</strong> (Kartellchance aller Konvois × {String(e.geleitschutz.convoyCartelChance).replace(".", ",")}), <strong>Gebührensenkung</strong> (Börse und KI-Verträge × {String(e.gebuehrensenkung.fee).replace(".", ",")}), <strong>Gemeinsame Aktion</strong> (neue Weltereignisse + {pct((e.gemeinsame_aktion.worldEventLoot ?? 1) - 1)} Beute). Jeder Kapitän hat eine geheime, bis zum Schluss änderbare Stimme; alle KI-Spieler zusammen eine, offen begründet. Eine Allianz zählt höchstens {pct(s.allianceMaxShare)}. Stimmen weniger als {pct(s.quorumShare)} der aktiven Kapitäne ab, gilt die Vorgabe; bei Gleichstand Ruhige See. Das Ergebnis kommt als Nachricht.</P>
      <P><strong>Ansehen</strong> bei jedem KI-Spieler von −100 bis +100, Start 0, jede Saison neu: erfüllter Liefervertrag +{a.contract} (höchstens +{a.contractMaxPerDay} je Tag), erfülltes Gesuch +{a.gesuch}, Vertragsstrafe {a.penalty}, Überfall auf ihn {a.raid}. Pluspunkte wirken umso schwächer, je höher das Ansehen schon ist; jeden Tag verliert es {pct(a.decayPerDay)} Richtung 0. Ab +{a.vertrautFrom} bist du <strong>Vertraut</strong> (Vertragsbonus {pct(a.bonusDelta.vertraut)}, Kontingent {pct(a.quotaShare.vertraut)}; er bietet dir einen Nichtangriffspakt an, höchstens alle {a.pactOfferEveryDays ?? 7} Tage), ab {a.misstrautTo} <strong>Misstraut</strong> (Bonus {pct(a.bonusDelta.misstraut)}, Kontingent {pct(a.quotaShare.misstraut)}, keine Gesuche). Das Ansehen ändert keine Börsenpreise.</P>
      <P><strong>Nach einem Überfall</strong> schließen Händler und Festung {a.raidBlockHours} Stunden lang nichts mit dir ab. Wer einen selbst gekündigten Pakt mit einem KI-Spieler bricht (Überfall bis {a.pactBreakHours} Stunden nach dem Erlöschen), verliert zusätzlich {Math.abs(a.pactBreak)}. Wer bei den KI-Spielern im Mittel bei {a.notoriousMean} oder darunter steht, ist <strong>berüchtigt</strong>: keine Verträge und Gesuche bei Händler und Festung, und wer ihn angreift, bekommt + {String(a.notoriousBounty).replace(".", ",")} Kopfgeld.</P>
      <P><strong>Gesuche:</strong> Händler und Festung bitten dich höchstens einmal am Tag um eine Lieferung (etwa {g.qtyHours} Stunden deiner Produktion, 24 Stunden gültig). Du findest es bei den <strong>Tagesbefehlen</strong>; Annehmen schließt den Liefervertrag und belegt einen der drei Plätze. Erfüllt: Kaufpreis wie üblich plus <strong>Lohn von {g.rewardHours} Stunden deiner Produktion</strong> aus dem Lager des KI-Spielers und Ansehen +{a.gesuch}. Ist sein Lager leer, gibt es an dem Tag kein Gesuch. Ab Tag {g.lastDay} keine neuen.</P>
    </>
  );
}
