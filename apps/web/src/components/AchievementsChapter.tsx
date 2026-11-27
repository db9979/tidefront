// Handbuch-Kapitel „Erfolge und Wochenziele“: Abzeichen mit Stufen und Belohnungen, Wochenziele; Zahlen aus der Balance.
import type { ReactNode } from "react";
import type { Balance } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";
import { ResChips } from "../ui.tsx";
import { AchievementBadge } from "./achievement-art.tsx";

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-200 mb-2 leading-relaxed">{children}</p>;
}

export function AchievementsChapter({ b }: { b: Balance | undefined }) {
  const a = b?.achievements;
  if (!a) return <P>Erfolge und Wochenziele gibt es in dieser Saison nicht.</P>;
  return (
    <>
      <P><strong>Erfolge</strong> sind dauerhafte Abzeichen: Sie bleiben über alle Saisons erhalten. Jedes hat drei Stufen – <strong>Bronze, Silber, Gold</strong>. Erreichst du eine Stufe, bekommst du eine Nachricht (und einen Push, falls eingeschaltet); die Belohnung holst du unter <strong>Meldungen → Erfolge</strong> mit <strong>Abholen</strong> ab, je Stufe genau einmal. Deine drei höchsten Abzeichen stehen in der Rangliste neben deinem Namen.</P>
      <div className="text-sm text-slate-200 mb-2">
        Belohnung je Stufe:
        {a.rewards.map((r, i) => (
          <div key={i} className="flex items-center gap-2 mt-1"><span className="w-12 text-ink2">{["Bronze", "Silber", "Gold"][i]}</span><ResChips values={r} /></div>
        ))}
      </div>
      <ul className="text-sm text-slate-200 mb-3 space-y-1.5">
        {Object.entries(a.list).map(([id, d]) => (
          <li key={id} className="flex gap-2 items-center">
            <AchievementBadge id={id} tier={3} size={32} />
            <span><strong>{d.title}</strong> – {d.description}: {(d.tierTexts ?? d.thresholds.map((t) => fmtNum(t))).join(" / ")}</span>
          </li>
        ))}
      </ul>
      <P><strong>Wochenziele:</strong> Jeden <strong>Montag um 0:00 Uhr</strong> (deutsche Zeit) bekommst du auf der Basis drei Wochenziele, die bis Sonntagnacht laufen – größer als Tagesbefehle und passend zu deinem Ausbaustand: zum Beispiel Piratennester ab einer Stufe ausheben, Beute machen, Gebäudestufen abschließen, Missionen erfolgreich beenden, Aufträge des Nachrichtendienstes, Transporte an Allianzmitglieder, Forschungen, Börsengeschäfte, Angriffe abwehren, Wrackgut bergen, Anlagen errichten oder Tagesbefehle abholen.</P>
      <P>Jedes erfüllte Ziel bringt ein Ressourcenpaket und Taler (wachsend mit der Kommandozentrale, ab {fmtNum(a.weekly.goalCredits)} Taler). Holst du alle drei einer Woche ab, gibt es einmal den <strong>Wochenbonus</strong> (ab {fmtNum(a.weekly.bonusCredits)} Taler und ein großes Paket). Erfüllte Ziele der Vorwoche kannst du noch abholen. Fortschritt zählt immer in der Woche, in der das Geschehen stattfand.</P>
    </>
  );
}
