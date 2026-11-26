// Handbuch: Spielziel, Ablauf und Regeln in kurzen Kapiteln; Einheitentabelle aus der Balance.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { label, fmtNum } from "../lib/names.ts";
import { BUILDING_TEXT, UNIT_TEXT, unitTone } from "../lib/info.ts";
import { Icon, IconTile } from "../icons.tsx";
import { Button } from "../ui.tsx";
import { SettingsScreen } from "./Settings.tsx";

interface Chapter { id: string; icon: string; title: string; body: ReactNode }

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-200 mb-2 leading-relaxed">{children}</p>;
}

export function Handbook({ onClose, onLogout, playerName, initialView }: { onClose: () => void; onLogout: () => void; playerName: string; initialView?: "settings" | "admin" | null }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const [open, setOpen] = useState<string | null>("ziel");
  const [view, setView] = useState(initialView ?? null);
  const b = meta.data?.balance;

  const chapters: Chapter[] = [
    {
      id: "ziel", icon: "anker", title: "Worum es geht",
      body: (
        <>
          <P>Du führst einen Hafen an der Küste des Nordatlantiks oder des Mittelmeers. Baue deine Wirtschaft auf, stelle eine Flotte mit Truppen auf, überfalle die Nester des Freibeuter-Kartells und halte deinen Hafen gegen Überfälle.</P>
          <P>Alles läuft in Echtzeit weiter, auch wenn die App geschlossen ist: Bauaufträge werden fertig, Flotten fahren, das Kartell greift an. Schau ein paar Mal am Tag vorbei.</P>
          <P>Das <strong>Auftragsbuch</strong> auf der Basis führt dich Schritt für Schritt durch die ersten Tage.</P>
        </>
      ),
    },
    {
      id: "wirtschaft", icon: "stahlwerk", title: "Ressourcen, Strom, Lager",
      body: (
        <>
          <P>Vier Ressourcen: Stahl, Treibstoff, Elektronik und Proviant. Jeder Hafen erzeugt eine kleine Grundmenge; den Großteil liefern Stahlwerk, Raffinerie, Chipfabrik und Versorgungshof.</P>
          <P>Diese Gebäude brauchen <strong>Strom</strong> vom Kraftwerk. Reicht er nicht, sinkt ihre Produktion anteilig – der Blitz in der Basis zeigt Bedarf und Angebot.</P>
          <P>Produktion füllt nur bis zur <strong>Lagerkapazität</strong> (Lagerkomplex). Beute und Lieferungen dürfen darüber liegen. Einheiten essen <strong>Proviant</strong>; fällt er auf 0, herrscht Versorgungsmangel: keine Ausbildung, Angriffskraft −20 %.</P>
        </>
      ),
    },
    {
      id: "bauen", icon: "kommandozentrale", title: "Bauen und Ausbilden",
      body: (
        <>
          <P>Es läuft immer genau ein Gebäudeausbau. Werft, Kaserne, Flugfeld und Anlagenbau arbeiten daneben jeweils an einem eigenen Auftrag. Abbrechen erstattet den Anteil der Restzeit.</P>
          <P>Kein Gebäude darf mehr als {b?.building.levelCapAboveCommand ?? 3} Stufen über der Kommandozentrale liegen.</P>
          {b && (
            <ul className="space-y-2 mt-2">
              {Object.keys(b.buildings).map((id) => (
                <li key={id} className="flex gap-2 items-start">
                  <IconTile id={id} size={36} />
                  <div className="text-sm"><strong>{label(id)}</strong> – {BUILDING_TEXT[id]?.lang}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      ),
    },
    {
      id: "missionen", icon: "ueberfall", title: "Missionen",
      body: (
        <>
          <P><strong>Überfall:</strong> Kampf am Ziel. Bei Sieg kommt Beute mit den Landungsschiffen heim. Ziele: Piratennester und andere Spieler ohne Schutz.</P>
          <P><strong>Aufklärung:</strong> Lagebild ohne Kampf – Besatzung eines Nests oder Bestände, Gebäude und Truppen eines Spielers.</P>
          <P><strong>Transport:</strong> Ladung an einen anderen Spielerhafen.</P>
          <P>Treibstoff für Hin- und Rückweg wird beim Auslaufen bezahlt. Die Reisezeit richtet sich nach dem langsamsten Schiff. Wie viele Missionen gleichzeitig laufen, bestimmt die Hafenkommandantur; wie groß ein Verband sein darf, die Kommandopunkte.</P>
          <P>Bodentruppen fahren nur auf Landungsschiffen (100 Plätze je Schiff, Panzer brauchen 10). Flugzeuge fliegen nur innerhalb ihrer Reichweite mit.</P>
          <P>Auf Kampffeldern bleiben <strong>Wracks</strong>. Jede deiner Missionen, die dort ankommt, birgt Stahl und Elektronik mit freier Ladekapazität. Wracks zerfallen in {b?.combat.wreckHours ?? 48} Stunden.</P>
        </>
      ),
    },
    {
      id: "kampf", icon: "zerstoerer", title: "So läuft ein Kampf",
      body: (
        <>
          <P>Automatisch in vier Phasen mit höchstens {b?.combat.maxRoundsPerPhase ?? 3} Runden:</P>
          <ol className="text-sm list-decimal pl-5 space-y-1 mb-2">
            <li><strong>Luftkampf:</strong> Abfangjäger beider Seiten. Wer danach mehr Jäger hat, hat Luftüberlegenheit.</li>
            <li><strong>Luftschlag:</strong> Flak und Schiffe schießen auf Bomber, dann treffen die Bomber Schiffe und Anlagen (mit Luftüberlegenheit stärker).</li>
            <li><strong>Seegefecht:</strong> Schiffe gegeneinander, Küstenbatterien feuern mit.</li>
            <li><strong>Landung:</strong> Nur mit überlebenden Landungsschiffen. Minen treffen einmal (Pioniere halbieren), dann Bodenkampf gegen Truppen und Bunkerlinie.</li>
          </ol>
          <P>Du gewinnst, wenn nach der Landung keine Verteidiger und keine Bunkerlinie mehr stehen und eigene Truppen leben. Schaden verteilt sich nach Lebenspunkten auf die Gegner; angefangener Schaden bleibt über Runden erhalten.</P>
          <P>Nach dem Kampf kehren Verwundete zurück (Lazarett), beschädigte Flugzeuge werden repariert, zerstörte Anlagen teilweise wieder aufgebaut. Beute: {Math.round((b?.loot.maxShareOfUnprotected ?? 0.3) * 100)} % des ungeschützten Bestands, bei wiederholten Angriffen weniger.</P>
        </>
      ),
    },
    {
      id: "schutz", icon: "schild", title: "Kartell und Schutz",
      body: (
        <>
          <P>Das <strong>Freibeuter-Kartell</strong> greift jeden Hafen etwa alle {b?.pirates.raidIntervalHours ?? 18} Stunden an. Seine Stärke richtet sich nach deinen Schiffen und Anlagen; die Miliz landet auf den Schnellbooten. Bodentruppen daheim sind die beste Abwehr.</P>
          <P><strong>Anfängerschutz:</strong> {b?.protection.beginnerDays ?? 7} Tage nach der Gründung. <strong>Nachtschild:</strong> täglich {b?.protection.nightShieldHours ?? 8} Stunden ab der Startstunde, die du in der Basis wählst – ein eigener Überfall hebt ihn für diese Nacht auf. <strong>Nach einer Niederlage:</strong> {b?.protection.afterDefeatShieldHours ?? 8} Stunden Schutz.</P>
          <P>Das <strong>Radar</strong> zeigt anrückende Angriffe früher. Der <strong>Tiefbunker</strong> schützt einen Grundstock jeder Ressource.</P>
        </>
      ),
    },
    {
      id: "boerse", icon: "credits", title: "Börse",
      body: (
        <>
          <P>Ab Hafenkommandantur Stufe 3. Verkaufen bringt sofort Kredite, gekaufte Ware kommt per Konvoi vom nächsten Handelshafen. Gebühr {Math.round((b?.market.fee ?? 0.04) * 100)} % je Geschäft.</P>
          <P>Große Mengen bewegen den Kurs; der Kurs kehrt langsam zum Richtwert zurück. Tageslimit je Ressource, Kreditlimit nach Stufe der Hafenkommandantur. Bei einem erkannten Angriff sind Verkäufe gesperrt.</P>
        </>
      ),
    },
    {
      id: "saison", icon: "nav-bericht", title: "Saison und Wertung",
      body: (
        <>
          <P>Gespielt wird in <strong>Saisons</strong> von einigen Wochen. Unter Meldungen → Rangliste siehst du, welche Saison läuft und wie viele Tage bleiben. In den letzten drei Tagen erscheint zusätzlich ein Hinweis auf der Basis.</P>
          <P>Die <strong>Rangliste</strong> zählt vier Kategorien, je 100 Ressourcen Kostenwert ergeben einen Punkt:</P>
          <ul className="text-sm list-disc pl-5 space-y-1 mb-2 text-slate-200">
            <li><strong>Ausbau:</strong> Kosten aller gebauten Gebäudestufen.</li>
            <li><strong>Militär:</strong> Kosten deiner Einheiten und Anlagen, auch der Verbände unterwegs.</li>
            <li><strong>Kampf:</strong> Kostenwert der gegnerischen Einheiten und Anlagen, die du im Kampf vernichtest – auch Kartell und Nester.</li>
            <li><strong>Beute:</strong> alle Ressourcen, die du erbeutest.</li>
          </ul>
          <P>Am Saisonende wird der Endstand festgehalten: Gold, Silber und Bronze für die ersten drei Plätze, dazu je eine Auszeichnung für den Besten jeder Kategorie. Jeder erhält eine Nachricht mit seinem Platz; die <strong>Ruhmeshalle</strong> zeigt alle vergangenen Saisons.</P>
          <P>Danach beginnt die Welt neu: Häfen, Flotten, Berichte, Lieferungen und Kredite verfallen, Nester und Börse starten frisch. Dein Konto und deine Nachrichten bleiben – du wählst einfach einen neuen Hafen und hast wieder Anfängerschutz.</P>
          <P>Unter Meldungen → Rangliste findest du auch alle Mitspieler. Tippe einen an, um ihm eine <strong>Nachricht</strong> zu schreiben oder seinen Hafen auf der Karte zu zeigen.</P>
        </>
      ),
    },
    {
      id: "einheiten", icon: "kampfpanzer", title: "Einheiten im Überblick",
      body: b ? (
        <ul className="space-y-2">
          {[...Object.keys(b.units), ...Object.keys(b.defenses)].map((id) => {
            const u = b.units[id];
            const d = b.defenses[id];
            const a = u?.attack ?? d?.attack;
            return (
              <li key={id} className="flex gap-2 items-start">
                <IconTile id={id} size={40} tone={unitTone(b, id)} />
                <div className="text-sm min-w-0">
                  <strong>{label(id)}</strong> <span className="text-xs text-slate-400">{u ? `aus ${label(u.builtIn ?? "")}` : "Anlage"}</span>
                  <div className="text-slate-300">{UNIT_TEXT[id]}</div>
                  <div className="text-xs text-slate-400 tabular-nums">
                    HP {fmtNum(u?.hp ?? d?.hp ?? 0)}{a ? ` · See ${a.see} · Luft ${a.luft} · Land ${a.land}` : ""}{u?.speedKmh ? ` · ${u.speedKmh} km/h` : ""}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null,
    },
  ];

  if (view) return <SettingsScreen onClose={() => setView(null)} initialAdmin={view === "admin"} />;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-display text-xl font-bold uppercase">Handbuch</h1>
        <Button kind="secondary" onClick={onClose}>Zurück</Button>
      </div>
      {chapters.map((c) => (
        <section key={c.id} className="panel rounded-xl mb-2 overflow-hidden">
          <button type="button" className="tap w-full flex items-center gap-3 p-3 text-left" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
            <Icon id={c.icon} size={30} />
            <span className="font-serif text-[18px] flex-1">{c.title}</span>
            <span className="text-slate-400">{open === c.id ? "▴" : "▾"}</span>
          </button>
          {open === c.id && <div className="px-3 pb-3">{c.body}</div>}
        </section>
      ))}
      <div className="panel rounded-xl p-3 mt-4 flex items-center justify-between gap-2">
        <span className="text-sm text-slate-300">Angemeldet als <strong>{playerName}</strong></span>
        <div className="flex gap-2">
          <Button kind="secondary" onClick={() => setView("settings")}>Einstellungen</Button>
          <Button kind="secondary" onClick={onLogout}>Abmelden</Button>
        </div>
      </div>
    </div>
  );
}
