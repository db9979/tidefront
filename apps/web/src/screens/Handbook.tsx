// Handbuch: Spielziel, Ablauf und Regeln in kurzen Kapiteln; Einheitentabelle aus der Balance.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useBackLayer } from "../lib/back.ts";
import { ChangelogSheet, VersionLine } from "../components/Changelog.tsx";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { label, fmtNum } from "../lib/names.ts";
import { buildingText, unitText, unitTone } from "../lib/info.ts";
import { Icon, IconTile } from "../icons.tsx";
import { Button } from "../ui.tsx";
import { SettingsScreen } from "./Settings.tsx";
import { IntelChapter } from "../components/IntelChapter.tsx";
import { AdmiralChapter } from "../components/AdmiralChapter.tsx"; // Admirale
import { AchievementsChapter } from "../components/AchievementsChapter.tsx"; // Erfolge
import { AllianceOpsChapter } from "../components/AllianceOps.tsx"; // Allianz-Ops
import { NavalChapter } from "../components/NavalChapter.tsx"; // See: Minen/Blockade/Konvoi
import { FieldsChapter } from "../components/FieldsChapter.tsx"; // Felder
import { HarborsChapter } from "../components/HarborsChapter.tsx"; // Mehrere Häfen
import { BotsChapter } from "../components/BotsChapter.tsx"; // KI-Spieler
import { requestBugReport } from "../lib/bug-log.ts";
import { HScroll } from "../components/HScroll.tsx";

/** Kachel im Schnellzugriff oben im Handbuch. */
function QuickButton({ onClick, title, icon, mark, accent = false }: { onClick: () => void; title: string; icon?: string; mark?: string; accent?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`tap panel rounded-xl p-2 flex flex-col items-center gap-1 text-center ${accent ? "border-siegel" : ""}`}>
      {mark ? (
        <span aria-hidden className="grid place-items-center w-8 h-8 rounded-full bg-siegel text-[#f6f1e5] font-serif text-lg font-bold">{mark}</span>
      ) : (
        <Icon id={icon ?? "anker"} size={32} />
      )}
      <span className={`text-xs font-semibold leading-tight ${accent ? "text-siegel" : ""}`}>{title}</span>
    </button>
  );
}

interface Chapter { id: string; icon: string; title: string; body: ReactNode }

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-200 mb-2 leading-relaxed">{children}</p>;
}

export function Handbook({ onClose, onLogout, playerName, initialView, onView }: { onClose: () => void; onLogout: () => void; playerName: string; initialView?: "settings" | "admin" | null; onView?: (v: "settings" | "admin" | null) => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  // Alle Kapitel zu: die Sprungleiste oben ist die Übersicht (vorher war „Worum es geht“ offen).
  const [open, setOpen] = useState<string | null>(null);
  // Beim Öffnen eines Kapitels (Kopf oder Sprungleiste) dessen Anfang ins Bild holen – nicht beim ersten Anzeigen.
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current) { opened.current = true; return; }
    if (open) setTimeout(() => document.getElementById(`hb-${open}`)?.scrollIntoView?.({ block: "start", behavior: "smooth" }), 0);
  }, [open]);
  const [view, setViewState] = useState(initialView ?? null);
  // Ansicht an die App melden (Adresse ?view=…); Zurück schließt die Einstellungen.
  const setView = (v: "settings" | "admin" | null) => { setViewState(v); onView?.(v); };
  useBackLayer(!!view, () => setView(null), 2);
  const [news, setNews] = useState(false);
  const b = meta.data?.balance;
  const pct = (v: number | undefined, d: number) => `${Math.round((v ?? d) * 100)} %`;
  const radar = b?.buildings.radarstation;
  const lander = b?.units.landungsschiff;
  // Werte der Weltereignisse (balance.worldEvents; nicht im Balance-Typ des Regelkerns)
  const we = (b as unknown as { worldEvents?: { spawnIntervalHours: number[]; schatzschiff: { durationHours: number[] }; grossflotte: { announceHours: number; attackIntervalHours: number }; belagerung: { durationHours: number; productionPenalty: number } } } | undefined)?.worldEvents;

  const chapters: Chapter[] = [
    {
      id: "ziel", icon: "anker", title: "Worum es geht",
      body: (
        <>
          <P>Du führst einen Hafen an der Küste des Nordatlantiks oder des Mittelmeers. Baue deine Wirtschaft auf, stelle eine Flotte mit Truppen auf, überfalle die Nester des Freibeuter-Kartells und halte deinen Hafen gegen Überfälle.</P>
          <P>Alles läuft in Echtzeit weiter, auch wenn die App geschlossen ist: Bauaufträge werden fertig, Flotten fahren, das Kartell greift an. Schau ein paar Mal am Tag vorbei.</P>
          <P>Das <strong>Auftragsbuch</strong> auf der Basis führt dich Schritt für Schritt durch die ersten Tage. Jeder erfüllte Auftrag bringt ein Ressourcenpaket für den nächsten Schritt – tippe auf <strong>Abholen</strong>, auch für Aufträge, die du schon früher erledigt hast. Nach allen elf gibt es ein großes Paket, einmalig eine Stunde weniger Bauzeit für den laufenden (sonst den nächsten) Ausbau und das Abzeichen <strong>Hafenmeister</strong>, das diese Saison in der Rangliste neben deinem Namen steht. In jeder neuen Saison beginnt das Auftragsbuch von vorn.</P>
        </>
      ),
    },
    {
      id: "wirtschaft", icon: "stahlwerk", title: "Ressourcen, Strom, Lager",
      body: (
        <>
          <P>Vier Ressourcen: Stahl, Treibstoff, Elektronik und Proviant. Jeder Hafen erzeugt eine kleine Grundmenge; den Großteil liefern Stahlwerk, Raffinerie, Chipfabrik und Versorgungshof.</P>
          <P>Diese Gebäude brauchen <strong>Strom</strong> von Kraftwerk, Windpark oder Solarfeld. Reicht er nicht, sinkt ihre Produktion anteilig – die Versorgung in der Basis zeigt Angebot, Bedarf und die Kurve der nächsten 24 Stunden (Kapitel „Wetter und Strom“).</P>
          <P>Produktion füllt nur bis zur <strong>Lagerkapazität</strong> (Lagerkomplex). Beute und Lieferungen dürfen darüber liegen. Einheiten essen <strong>Proviant</strong>. Versorgungsmangel herrscht erst, wenn der Bestand auf 0 fällt <em>und</em> die Netto-Rate (Produktion minus Unterhalt) negativ ist: keine Ausbildung, Angriffskraft −20 %.</P>
        </>
      ),
    },
    {
      id: "wetter", icon: "windpark", title: "Wetter und Strom",
      body: (
        <>
          <P>Über der Karte ziehen <strong>Wettersysteme</strong>: Tiefs ziehen vom Westatlantik nach Nordost und bringen Wind, Wolken und Sturm – am stärksten weht es im Ring um den Kern und an ihrer Südflanke, im Winter kräftiger als im Sommer. Hochs wandern langsam und bringen ruhiges, klares Wetter. Der Nordatlantik und die Nordsee sind windiger und wolkiger, das Mittelmeer ist sonniger; dort wehen eigene Winde: Mistral im Golf von Lion und Bora in der Adria (Winter), Meltemi in der Ägäis (Sommer), Levante in der Straße von Gibraltar. <strong>Nebel</strong> liegt gern über der Neufundlandbank, in der Nordsee, im Ärmelkanal und vor Portugal, vor allem im Sommer, nachts und bei Flaute; bei Sturm nie. Das Tageslicht folgt dem Sonnenstand. Das Wetter steht fest – die Vorhersage auf der Basis stimmt.</P>
          <P><strong>Wetterkarte:</strong> Die abschaltbare Wetterschicht zeigt Isobaren um Tiefs (T) und Hochs (H), Windfahnen (Pfeil in Windrichtung; je mehr Striche, desto stärker – zwei Striche ab 6 Bft, dann sind Schiffe langsamer; ein Wimpel heißt Sturm ab 9 Bft), Wolken mit Regenstrichen, Sturmwimpel und Nebel (gestrichelt). Kräftige Tiefs tragen <strong>Fronten</strong>: Die <strong>Warmfront</strong> (rot, Halbkreise) läuft vom Tief nach Osten bis Südosten, vor ihr liegt ein breiter Wolkenschirm mit Regen; die <strong>Kaltfront</strong> (blau, Dreiecke) läuft nach Süden bis Südwesten und bringt ein schmales Schauerband, dahinter wird es klarer. Dazwischen liegt der lichtere Warmsektor. Altert das Tief, holt die Kaltfront die Warmfront ein: Die <strong>Okklusion</strong> (violett, Dreiecke und Halbkreise im Wechsel) bringt dichte Wolken nahe am Kern. Die Zeichen zeigen, wohin die Front zieht. Nah herangezoomt hat jedes Feld sein eigenes Zeichen; ein rötlicher Ton heißt: Schiffe werden hier gebremst. Wind wird in Beaufort angegeben (Sturm = 9 Bft).</P>
          <P><strong>Stromquellen:</strong> Das <strong>Kraftwerk</strong> liefert {fmtNum(b?.buildings.kraftwerk?.powerSupplyPerLevel ?? 60)} Strom je Stufe bei jedem Wetter, verbrennt aber {fmtNum(b?.buildings.kraftwerk?.fuelPerHourPerLevel ?? 3)} Treibstoff je Stunde und Stufe; ist kein Treibstoff da, verbrennt es nur, was nachkommt. Der <strong>Windpark</strong> liefert bis zu {fmtNum(b?.buildings.windpark?.windPowerPerLevel ?? 0)} je Stufe im Verhältnis zum Wind und schaltet bei Orkan ab. Das <strong>Solarfeld</strong> liefert bis zu {fmtNum(b?.buildings.solarfeld?.solarPowerPerLevel ?? 0)} je Stufe bei hoher Sonne, Wolken kosten bis zu {pct(b?.buildings.solarfeld?.cloudLoss, 0.7)}, nachts nichts. Das <strong>Speicherwerk</strong> lädt Überschuss ({fmtNum(b?.buildings.speicherwerk?.storagePerLevel ?? 0)} je Stufe, höchstens {fmtNum(b?.buildings.speicherwerk?.storageRatePerLevel ?? 0)} je Stunde) und gibt ihn bei Flaute oder nachts wieder ab.</P>
          <P><strong>Rangfolge bei Mangel:</strong> 1. Radar (ohne volle Versorgung schrumpft die Vorwarnzeit anteilig, ohne Strom gibt es keine), 2. Produktion (gedrosselt), 3. Werft, Kaserne und Flugfeld während der Ausbildung, 4. Forschung. Ausbildung und Forschung laufen bei Mangel langsamer (mindestens mit {pct(b?.power?.minSpeed, 0.25)} Tempo); ihre Fertigstellung wird beim Start mit der Stromprognose festgelegt und ändert sich danach nicht mehr. Die Basis warnt, wann und wie viel Strom fehlt.</P>
          <P><strong>Wetter im Einsatz:</strong> Sturm auf der Route verlängert die Reisezeit der Schiffe um bis zu {pct(b?.weather?.shipSlowMax, 0.3)} (bestimmt bei Abfahrt); die Missionsplanung zeigt Wetter und Zuschlag. Bei Sturm am Hafen starten reine Luftmissionen nicht, und im Kampf treffen Flugzeuge im Sturm schwächer (bis −{pct(b?.weather?.airStormPenalty, 0.6)}); Wolken am Kampfort schwächen den Luftschlag (bis −{pct(b?.weather?.cloudStrikePenalty, 0.3)}). Nebel am eigenen Hafen kürzt die Radar-Vorwarnzeit (bis −{pct(b?.weather?.fogRadarMax, 0.3)}), Nebel am Ziel macht Aufklärung unsicher: Bestände und Truppen erscheinen gerundet. Die Missionsplanung zeigt auch das Wetter am Ziel zur Ankunft.</P>
        </>
      ),
    },
    {
      id: "bauen", icon: "kommandozentrale", title: "Bauen und Ausbilden",
      body: (
        <>
          <P><strong>Bauschlange:</strong> bis zu {b?.building.queueSlots ?? 3} Ausbauten je Hafen, abgearbeitet nacheinander. Die Kosten zahlst du schon beim Einreihen. Werft, Kaserne, Flugfeld und Anlagenbau arbeiten daneben jeweils an einem eigenen Auftrag.</P>
          <P><strong>Abbrechen</strong> (mit Rückfrage): Ein laufender Auftrag erstattet nur den Anteil der Restzeit, ein wartender alles. Spätere Stufen desselben Gebäudes in der Schlange fallen mit weg und werden voll erstattet.</P>
          <P>Kein Gebäude darf mehr als {b?.building.levelCapAboveCommand ?? 3} Stufen über der Kommandozentrale liegen.</P>
          {b && (
            <ul className="space-y-2 mt-2">
              {Object.keys(b.buildings).map((id) => (
                <li key={id} className="flex gap-2 items-start">
                  <IconTile id={id} size={36} />
                  <div className="text-sm"><strong>{label(id)}</strong> – {buildingText(b, id)}</div>
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
          <P><strong>Piratennester</strong> haben die Stufen I bis V, verteilt über alle Küsten, und sind nach einem Sieg {b?.pirates.nestRespawnHours ?? 12} Stunden verlassen. Dazu kommen wenige <strong>Inselfestungen der Stufe VI</strong> auf abgelegenen Inseln (Bermuda, Azoren, Jan Mayen, Balearen, Rhodos) – das Ziel für die letzten Saisonwochen: Ein voller Verband schafft sie etwa ab der fünften Woche, vorher kaum. Sie geben die größte Beute (viel Elektronik; nimm genug Landungsschiffe mit) und sind nach einem Sieg {Number(b?.pirates.nestLevels["6"]?.respawnHours ?? 24)} Stunden verlassen.</P>
          <P><strong>Transport:</strong> Ladung an einen anderen Spielerhafen.</P>
          <P>Treibstoff für Hin- und Rückweg wird beim Auslaufen bezahlt. Die Reisezeit richtet sich nach dem langsamsten Schiff. Wie viele Missionen gleichzeitig laufen, bestimmt die Hafenkommandantur; wie groß ein Verband sein darf, die Kommandopunkte.</P>
          <P>Bodentruppen fahren nur auf Landungsschiffen ({fmtNum(lander?.troopSpace ?? 100)} Plätze je Schiff, Panzer brauchen {b?.units.kampfpanzer?.size ?? 10}). Flugzeuge fliegen nur innerhalb ihrer Reichweite mit.</P>
          <P><strong>Rückruf:</strong> Auf der Hinfahrt kannst du einen Verband unter Truppen zurückrufen. Er kehrt sofort um und ist nach der schon gefahrenen Zeit wieder daheim; am Ziel geschieht nichts. Treibstoff wird nicht erstattet, Transportgut kommt zurück.</P>
          <P>Auf Kampffeldern bleiben <strong>Wracks</strong>. Jede deiner Missionen, die dort ankommt, birgt Stahl und Elektronik mit freier Ladekapazität. Wracks zerfallen in {b?.combat.wreckHours ?? 48} Stunden.</P>
        </>
      ),
    },
    {
      id: "kampf", icon: "zerstoerer", title: "So läuft ein Kampf",
      body: (
        <>
          <P>Automatisch in fünf Phasen mit höchstens {b?.combat.maxRoundsPerPhase ?? 3} Runden:</P>
          <ol className="text-sm list-decimal pl-5 space-y-1 mb-2">
            <li><strong>Luftkampf:</strong> Abfangjäger beider Seiten. Wer danach mehr Jäger-Lebenspunkte hat, hat Luftüberlegenheit.</li>
            <li><strong>Luftschlag:</strong> Flak und Schiffe schießen auf Bomber, dann treffen die Bomber Schiffe und Anlagen – mit eigener Luftüberlegenheit ×{fmtNum(b?.combat.airSuperiorityBomberBonus ?? 1.25, 2)}, gegen fremde Luftüberlegenheit nur ×{fmtNum(b?.combat.airSuperiorityBomberMalus ?? 0.75, 2)}.</li>
            <li><strong>U-Boot-Angriff:</strong> Getauchte U-Boote beider Seiten feuern eine Torpedosalve auf Schiffe über Wasser – ohne Gegenwehr.</li>
            <li><strong>Seegefecht:</strong> Schiffe gegeneinander, Küstenbatterien feuern mit. U-Boote schießen weiter, können aber nur von Schiffen mit <strong>U-Jagd</strong> (Korvette, Zerstörer) getroffen werden – nicht von Bombern, Batterien oder dem Kartell.</li>
            <li><strong>Landung:</strong> Nur mit überlebenden Landungsschiffen. Truppen, für die nach dem Seegefecht kein Platz mehr auf den Landungsschiffen ist, gehen verloren. Minen treffen einmal (Pioniere halbieren), dann Bodenkampf gegen Truppen und Bunkerlinie.</li>
          </ol>
          <P>Du gewinnst, wenn nach der Landung keine Verteidiger und keine Bunkerlinie mehr stehen und eigene Truppen leben. Schaden verteilt sich nach Lebenspunkten auf die Gegner; angefangener Schaden bleibt über Runden erhalten.</P>
          <P>Nach dem Kampf kehren Verwundete zurück (Lazarett), beschädigte Flugzeuge werden repariert, zerstörte Anlagen teilweise wieder aufgebaut.</P>
          <P><strong>Beute</strong> (nur bei Sieg): {pct(b?.loot.maxShareOfUnprotected, 0.3)} des Bestands über dem Bunkerschutz, höchstens so viel, wie die überlebenden Landungsschiffe laden ({fmtNum(lander?.cargo ?? 4000)} je Schiff). Wiederholte Überfälle auf denselben Hafen binnen {b?.loot.repeatWindowHours ?? 24} Stunden bringen {(b?.loot.repeatFactors ?? [1, 0.5, 0.25, 0]).map((f) => `${Math.round(f * 100)} %`).join(" / ")}. Ist das Ziel schwächer als {pct(b?.loot.weakTargetBelowShare, 0.5)} deines Hafens (Summe der Gebäudestufen), gibt es nur ×{fmtNum(b?.loot.weakTargetLootFactor ?? 0.1, 1)}. Nester geben ihre feste Beute.</P>
        </>
      ),
    },
    {
      id: "schutz", icon: "schild", title: "Kartell und Schutz",
      body: (
        <>
          <P>Das <strong>Freibeuter-Kartell</strong> greift jeden Hafen etwa alle {b?.pirates.raidIntervalHours ?? 18} Stunden an. Seine Stärke richtet sich nach den Lebenspunkten deiner Bodentruppen, Anlagen und Schiffe daheim und schwankt von Überfall zu Überfall um bis zu ±{pct(b?.pirates.raidStrengthSpread, 0.3)}. Kriegsschiffe zählen nur zur Hälfte, weil sie an Land nicht mitkämpfen; Landungsschiffe, Kolonieschiffe, Minenleger und Flugzeuge zählen nicht. Eine Flotte daheim lockt also keine stärkeren Überfälle an, sondern versenkt Schnellboote, bevor die Miliz landet. Die Miliz landet von den Schnellbooten und greift Bodentruppen und Bunkerlinie gleich hart an: Eine Bunkerlinie ist ein starker Schutz, hält aber nicht jeden Überfall auf. Bodentruppen, Bunkerlinie und Küstenbatterien sind die beste Abwehr. Das Wetter am Hafen gilt auch hier: Das Kartell hat keine Flugzeuge, aber deine Jäger und Bomber treffen bei Sturm schwächer und der Luftschlag leidet unter Wolken.</P>
          <P><strong>Anfängerschutz:</strong> {b?.protection.beginnerDays ?? 7} Tage nach der Gründung. <strong>Nachtschild:</strong> täglich {b?.protection.nightShieldHours ?? 8} Stunden ab der Startstunde, die du in der Basis wählst; ohne gewählte Stunde ist er aus. Eine Änderung gilt erst nach {b?.protection.nightShieldChangeHours ?? 24} Stunden und ist so lange auch gesperrt – den Schild gegen einen schon gemeldeten Angriff einzuschalten geht nicht. Ein eigener Überfall hebt ihn für diese Nacht auf. <strong>Nach einer Niederlage:</strong> {b?.protection.afterDefeatShieldHours ?? 8} Stunden Schutz.</P>
          <P>Das <strong>Radar</strong> meldet anrückende Angriffe vor der Ankunft: {radar ? `${(radar.warningMinutesBase ?? 0) + (radar.warningMinutesPerLevel ?? 0)} Minuten auf Stufe 1, je Stufe ${radar.warningMinutesPerLevel ?? 0} mehr` : "je Stufe länger"}; ohne Radar siehst du einen Angriff erst bei Ankunft. Einmal erkannt bleibt ein Angriff sichtbar, auch wenn das Radar danach Strom verliert oder Nebel aufzieht. Der <strong>Tiefbunker</strong> schützt einen Grundstock jeder Ressource vor Plünderung.</P>
        </>
      ),
    },
    {
      id: "weltereignisse", icon: "kartell", title: "Weltereignisse",
      body: (
        <>
          <P>Alle {we?.spawnIntervalHours[0] ? we.spawnIntervalHours[0] / 24 : 2}–{we?.spawnIntervalHours[1] ? we.spawnIntervalHours[1] / 24 : 4} Tage zettelt das Kartell ein <strong>Weltereignis</strong> an, das alle betrifft. Es erscheint auf der Karte mit siegelroten Zeichen; jeder bekommt eine Nachricht, wer in der Nähe ist zusätzlich ein Banner auf der Basis. Tippe das Zeichen an: Das Blatt zeigt Besatzung, Restzeit und Belohnung, „Mission planen“ schickt einen Überfall los. Die Ereignisse werden im Lauf der Saison und mit der Stärke der Spieler härter; Spieler im Anfängerschutz sind nie Ziel.</P>
          <P><strong>Schatzschiff:</strong> fährt mit Schnellbooten Begleitschutz in {we?.schatzschiff.durationHours[0] ?? 12}–{we?.schatzschiff.durationHours[1] ?? 24} Stunden eine Route in einen Kartellhafen. Beim Planen wird der Abfangpunkt berechnet – ist dein Verband zu langsam, wird die Mission abgelehnt. Nur der erste Verband, der den Begleitschutz versenkt, erhält die große Beute (begrenzt durch seinen Laderaum); wer danach ankommt, findet nur Treibgut.</P>
          <P><strong>Großflotte:</strong> wird {we?.grossflotte.announceHours ?? 12} Stunden vorher angekündigt, mit Zielregion und Zielhäfen. Dann greift sie die Häfen nacheinander an, alle {we?.grossflotte.attackIntervalHours ?? 3} Stunden einen. Nachtschild, Anfängerschutz und Schutz nach Niederlage gelten: ein geschützter Hafen wird übersprungen. Jeder kann sie vorher und zwischendurch auf See angreifen – ihre Verluste bleiben, und du erhältst Beute anteilig zu deinem Schaden sowie Kampfpunkte.</P>
          <P><strong>Belagerung:</strong> ein Ring aus Schnellbooten um einen Hafen für {we?.belagerung.durationHours ?? 24} Stunden: keine Börsenkäufe, Produktion −{Math.round((we?.belagerung.productionPenalty ?? 0.3) * 100)} %. Brechen können ihn nur die anderen – Verbündete und Mitspieler schicken einen Überfall auf den Ring und teilen sich den Beutepool nach Schaden.</P>
          <P>Auf See gibt es keine Landung: Sinken alle Boote, ertrinkt die Miliz an Bord. Kampfberichte gegen Ereignisse findest du wie gewohnt unter Meldungen.</P>
        </>
      ),
    },
    {
      id: "boerse", icon: "credits", title: "Börse",
      body: (
        <>
          <P>Ab Hafenkommandantur Stufe 3. Verkaufen bringt sofort Kredite, gekaufte Ware kommt per Konvoi vom nächsten Handelshafen. Gebühr {Math.round((b?.market.fee ?? 0.04) * 100)} % je Geschäft.</P>
          <P>Große Mengen bewegen den Kurs; der Kurs kehrt langsam zum Richtwert zurück. Tageslimit je Ressource, Kreditlimit nach Stufe der Hafenkommandantur. Bei einem erkannten Angriff sind Verkäufe gesperrt.</P>
          <P><strong>Marktnachrichten:</strong> Die Welt verschiebt den Richtwert vorübergehend – eine Großflotte macht Treibstoff und Proviant teurer, eine Belagerung Proviant, ein erbeutetes Schatzschiff drückt Stahl und Elektronik, Kriege und Kartell-Überfälle heben Treibstoff, volle oder leere Lager aller Häfen wirken einmal am Tag, und in der letzten Saisonwoche steigen Stahl und Elektronik. Zusammen höchstens ±{Math.round((b?.market.news?.maxTotal ?? 0.25) * 100)} %, und der Richtwert bewegt sich höchstens {Math.round((b?.market.news?.maxChangePerHour ?? 0.05) * 100)} % je Stunde. Der Kurs springt nicht, er folgt dem neuen Richtwert langsam. Nach dem Anlass klingt die Wirkung über ein bis zwei Tage ab. Als Push „Marktnachricht“ abonnierbar (Einstellungen).</P>
        </>
      ),
    },
    {
      id: "forschung", icon: "forschungsamt", title: "Forschung",
      body: (
        <>
          <P>Im <strong>Forschungsamt</strong> (Basis → Führung und Schutz) erforschst du Techniken in fünf Zweigen: Seefahrt, Heer, Luftfahrt, Wirtschaft und Nachrichtendienst. Es läuft immer <strong>eine</strong> Forschung; sie kostet Ressourcen und Zeit. Abbrechen erstattet den Anteil der Restzeit.</P>
          <P>Jede Technik hat 1 bis 3 Stufen mit je 5 bis 12 % Wirkung, zum Beispiel Dampfturbinen +8 % Tempo der Schiffe, Sonar +10 % U-Jagd, Hochofen +8 % Stahl oder Logistik −8 % Treibstoff und +8 % Ladung. Voll erforscht bringt kein Bereich mehr als 25 %. Fortgeschrittene Techniken brauchen eine höhere Stufe des Forschungsamts (3 oder 5) und eine Vorgänger-Technik. Jede Stufe des Forschungsamts über 1 forscht 10 % schneller.</P>
          <P>Die Boni wirken überall: in Kämpfen (auch gegen das Kartell), auf Reisen, in Produktion, Lager und Bunker. Die Info-Blätter zeigen sie als „+10 % durch Forschung“. Treffen mehrere Quellen denselben Wert, werden sie multipliziert.</P>
          <P><strong>Durchbruch:</strong> Beim Abschluss jeder Forschung wird ein Prozentwurf (W100) gewürfelt. Die Chance steht vorher im Info-Blatt: {b?.research?.breakthrough ? `${Math.round(b.research.breakthrough.baseChance * 100)} % plus ${Math.round(b.research.breakthrough.perBuildingLevel * 100)} Punkte je Stufe des Forschungsamts, höchstens ${Math.round(b.research.breakthrough.maxChance * 100)} %` : "10 % plus 2 Punkte je Stufe, höchstens 25 %"}. Bei einem Durchbruch wählst du: (a) die Technik erhält sofort eine Stufe zusätzlich oder (b) deine nächste Forschung dauert nur halb so lange. Ist die Technik schon auf Höchststufe, gibt es automatisch (b). Kein Einsatz, kein Risiko – nur ein Bonus.</P>
          <P>Forschung gilt für eine <strong>Saison</strong>: Zum Saisonende beginnt jeder wieder ohne Techniken.</P>
        </>
      ),
    },
    // Nachrichtendienst und Spionage (components/Intel.tsx)
    { id: "nachrichtendienst", icon: "spion", title: "Nachrichtendienst", body: <IntelChapter b={b} /> },
    // Admirale (components/Admirals.tsx)
    { id: "admirale", icon: "admiral", title: "Admirale", body: <AdmiralChapter b={b} /> },
    { id: "see", icon: "mine", title: "Minen, Blockade, Konvois", body: <NavalChapter b={b} /> }, // See
    { id: "felder", icon: "oelfeld", title: "Rohstofffelder", body: <FieldsChapter b={b} /> }, // Felder
    { id: "haefen", icon: "gruendung", title: "Mehrere Häfen", body: <HarborsChapter b={b} /> }, // Mehrere Häfen
    {
      id: "tagesbefehle", icon: "uhr", title: "Tagesbefehle",
      body: (
        <>
          <P>Jeden Tag um <strong>0:00 Uhr</strong> (deutsche Zeit) erhältst du auf der Basis drei <strong>Tagesbefehle</strong>: einen leichten, einen mittleren und einen schweren. Sie passen zu deinem Stand – ein Nest-Überfall wird erst verlangt, wenn du Werft und Kaserne hast, und die Ziele wachsen mit deiner Kommandozentrale.</P>
          <P>Mögliche Befehle: Ausbauten abschließen, die Bauschlange füllen, Bodentruppen, Schiffe oder Flugzeuge ausbilden, Anlagen errichten, einen Vorrat anlegen, die Produktion steigern, die Kommandozentrale ausbauen, ein Nest besiegen, einen Kartell-Überfall abwehren, eine Forschung abschließen, Aufklärung, Transporte, Börsenhandel, Wrackgut bergen, Beute machen, ohne Verluste siegen oder einem Mitspieler schreiben. Zu Wetter und Strom: Speicherwerk ausbauen, einen Stromüberschuss im Speicher halten, Windpark oder Solarfeld ausbauen, gleichzeitig viel Strom aus Wind und Sonne erzeugen (zählt, sobald du die Befehle ansiehst) und eine Mission trotz Sturm auf der Route erfolgreich beenden; mit Nachrichtendienst auch Ziele erkunden.</P>
          <P>Der Balken zeigt den Fortschritt. Ist ein Befehl erfüllt, holst du die Belohnung mit <strong>Abholen</strong> ab: Ressourcen (auch über die Lagerkapazität) und Punkte für die Kategorie Befehle – leicht 3, mittel 6, schwer 12. Erfüllte Befehle kannst du auch später noch abholen, bis die Saison endet. Ein grüner Zähler an der Basis zeigt, was bereitliegt.</P>
          <P>Einmal am Tag darfst du einen offenen Befehl kostenlos <strong>neu würfeln</strong>; der neue hat dieselbe Schwierigkeit, sein Fortschritt beginnt bei null.</P>
          <P><strong>Serie:</strong> Holst du an aufeinanderfolgenden Tagen alle drei Befehle ab, wächst deine Serie. Am 3. Tag gibt es 10 Punkte Bonus, am 7. Tag 25, an jedem weiteren 7. Tag 10 mehr – jeweils mit Nachschub. Ein ausgelassener Tag beginnt die Serie von vorn. Zum Saisonende verfallen Befehle und Serie.</P>
        </>
      ),
    },
    // Erfolge (Abzeichen) und Wochenziele (components/AchievementsChapter.tsx)
    { id: "erfolge", icon: "hafenmeister", title: "Erfolge und Wochenziele", body: <AchievementsChapter b={b} /> },
    {
      id: "saison", icon: "nav-bericht", title: "Saison und Wertung",
      body: (
        <>
          <P>Gespielt wird in <strong>Saisons</strong> von einigen Wochen. Unter Meldungen → Rangliste siehst du, welche Saison läuft und wie viele Tage bleiben. In den letzten drei Tagen erscheint zusätzlich ein Hinweis auf der Basis.</P>
          <P>Die <strong>Rangliste</strong> zählt fünf Kategorien; in den ersten vier ergeben je 100 Ressourcen Kostenwert einen Punkt:</P>
          <ul className="text-sm list-disc pl-5 space-y-1 mb-2 text-slate-200">
            <li><strong>Ausbau:</strong> Kosten aller gebauten Gebäudestufen.</li>
            <li><strong>Militär:</strong> Kosten deiner Einheiten und Anlagen, auch der Verbände unterwegs.</li>
            <li><strong>Kampf:</strong> Kostenwert der gegnerischen Einheiten und Anlagen, die du im Kampf vernichtest – auch Kartell und Nester.</li>
            <li><strong>Beute:</strong> alle Ressourcen, die du erbeutest.</li>
            <li><strong>Befehle:</strong> Punkte aus abgeholten Tagesbefehlen samt Serienbonus.</li>
          </ul>
          <P>Am Saisonende wird der Endstand festgehalten: Gold, Silber und Bronze für die ersten drei Plätze, dazu je eine Auszeichnung für den Besten jeder Kategorie. Jeder erhält eine Nachricht mit seinem Platz; die <strong>Ruhmeshalle</strong> zeigt alle vergangenen Saisons.</P>
          <P>Danach beginnt die Welt neu: Häfen, Flotten, Berichte, Lieferungen und Kredite verfallen, Nester und Börse starten frisch. Dein Konto und deine Nachrichten bleiben – du wählst einfach einen neuen Hafen und hast wieder Anfängerschutz.</P>
          <P>Unter Meldungen → Rangliste findest du auch alle Mitspieler. Tippe einen an, um ihm eine <strong>Nachricht</strong> zu schreiben oder seinen Hafen auf der Karte zu zeigen.</P>
        </>
      ),
    },
    {
      id: "freunde", icon: "anker", title: "Freunde einladen",
      body: (
        <>
          <P>Unter Einstellungen → <strong>Freunde einladen</strong> (oder Meldungen → Rangliste) schickst du einem Freund eine Einladung per E-Mail – mit persönlicher Nachricht – oder teilst einen persönlichen Link über Messenger und Co.</P>
          <P>Jede Einladung hat einen eigenen Code, gilt einmal und 14 Tage. Folgt dein Freund ihr, bekommst du eine Nachricht. Unter „Meine Einladungen“ siehst du den Stand, kannst Einladungen zurückziehen oder nach einem Tag erneut senden. Wie viele Einladungen offen sein dürfen, legt die Verwaltung fest.</P>
        </>
      ),
    },
    {
      id: "komfort", icon: "uhr", title: "Planen ohne Rätselraten",
      body: (
        <>
          <P><strong>Probekampf:</strong> In der Missionsplanung rechnet „Probekampf“ einen Überfall 50-mal durch und zeigt Siegchance, erwartete Verluste, Beute und die Spannweite. Gegen Nester zählt die bekannte Besatzung, gegen Spielerhäfen nur das Lagebild deiner letzten Aufklärung – ohne Aufklärung heißt es: erst aufklären. Unter Truppen → Kampfsimulator stellst du beide Seiten frei zusammen, auch das Kartell gegen deinen Hafen.</P>
          <P><strong>Vorlagen:</strong> Speichere einen Verband unter einem Namen (z. B. „Nestjäger“). Ein Tipp setzt ihn in der Planung ein; fehlen Einheiten daheim, wird auf das Verfügbare gekürzt. <strong>Wiederholen</strong> an einem eigenen Bericht oder unter „Zuletzt heimgekehrt“ öffnet die Planung mit demselben Ziel und Verband.</P>
          <P><strong>Als Nächstes:</strong> Die Zeitleiste auf der Basis zeigt Ausbauten, Ausbildungen, Ankunft und Rückkehr deiner Verbände, erkannte Angriffe, Lieferungen, Nachtschild und Saisonende mit Countdown. Der <strong>Morgenbericht</strong> (Einstellungen) fasst einmal am Tag zusammen, was über Nacht geschah.</P>
        </>
      ),
    },
    {
      id: "allianz", icon: "transport", title: "Allianzen, Diplomatie, Handel",
      body: (
        <>
          <P>Unter Meldungen → <strong>Allianz</strong> gründest du eine Allianz (Name und Kürzel aus 2–4 Zeichen) oder fragst bei einer an. Führung und Offiziere laden ein und nehmen Anfragen an; die Führung vergibt Rollen und kann die Allianz auflösen. Das Kürzel steht in der Rangliste vor deinem Namen, die <strong>Allianzwertung</strong> zählt die Punkte aller Mitglieder zusammen. Allianzen bleiben über das Saisonende bestehen.</P>
          <P><strong>Verbündete</strong> können sich nicht überfallen. Im Allianz-Chat sprecht ihr euch ab. Auf der Karte erscheinen ihre Häfen grün mit Doppelring, die von Paktpartnern ocker und die von Kriegsgegnern rot mit Peilstrichen (weit herausgezoomt als farbige Punkte); antippen zeigt das Verhältnis. Die Legende erklärt die Zeichen.</P>
          <P><strong>Diplomatie</strong> gibt es zwischen Allianzen und Spielern ohne Allianz. Ein <strong>Nichtangriffspakt</strong> gilt, wenn beide Seiten zustimmen; danach sind gegenseitige Überfälle ausgeschlossen. Kündigen kann jede Seite, der Pakt gilt dann noch 24 Stunden. Eine <strong>Kriegserklärung</strong> wirkt nach 12 Stunden Vorlauf; während des Vorlaufs kann die erklärende Seite sie noch zurückziehen. Im Krieg entfällt die Schwachziel-Kürzung der Beute. Frieden gibt es, wenn beide Seiten ihn wollen.</P>
          <P>In der Börse findest du den <strong>Handel mit Spielern</strong>: Biete eine Ressource oder Kredite gegen eine andere an, für alle oder nur für deine Allianz. Die Ware geht beim Einstellen in Treuhand und kommt beim Zurückziehen sofort zurück. Wer annimmt, zahlt sofort; Ressourcen reisen auf beiden Seiten per Konvoi nach Entfernung der Häfen, Kredite kommen sofort. Je Seite wird eine kleine Gebühr einbehalten. Offene Angebote verfallen am Saisonende.</P>
          <P>Spielerhandel verändert die Börsenkurse nicht; angezeigt wird der <strong>Börsenwert</strong> zur Orientierung: Jedes Angebot zeigt, was du gibst und bekommst, umgerechnet zum aktuellen Börsenkurs, und wie weit das darunter oder darüber liegt. Weicht ein Angebot um mehr als 20 % ab, warnt das Spiel und fragt vor der Annahme nach. Unter „Spielerhandel (7 Tage)“ siehst du, zu welchen Kursen andere Spieler zuletzt getauscht haben.</P>
        </>
      ),
    },
    { id: "allianz-ops", icon: "sammelangriff", title: "Sammelangriff und Stationierung", body: <AllianceOpsChapter b={b} /> },
    { id: "ki", icon: "anker", title: "KI-Spieler", body: <BotsChapter b={b} /> }, // KI-Spieler
    {
      id: "einheiten", icon: "kampfpanzer", title: "Einheiten im Überblick",
      body: b ? (
        <ul className="space-y-2">
          {[...Object.keys(b.units), ...Object.keys(b.defenses)].map((id) => {
            const u = b.units[id];
            const d = b.defenses[id];
            const a = u?.attack ?? d?.attack;
            // Nur Werte, die der Kampf benutzt: Bomber treffen Schiffe und Anlagen, Jäger nur in der Luft.
            const bomber = u?.branch === "luft" && !!a && (a.see > 0 || (a.anlage ?? 0) > 0);
            const values = !a ? ""
              : u?.branch === "luft" ? (bomber ? ` · Schiffe ${a.see} · Anlagen ${a.anlage ?? 0}` : a.luft > 0 ? ` · Luft ${a.luft}` : " · kämpft nicht")
              : ` · See ${a.see} · Luft ${a.luft} · Land ${a.land}${a.anlage ? ` · Anlagen ${a.anlage}` : ""}`;
            return (
              <li key={id} className="flex gap-2 items-start">
                <IconTile id={id} size={40} tone={unitTone(b, id)} />
                <div className="text-sm min-w-0">
                  <strong>{label(id)}</strong> <span className="text-xs text-slate-400">{u ? `aus ${label(u.builtIn ?? "")}${(u.requiresLevel ?? 1) > 1 ? ` ab Stufe ${u.requiresLevel}` : ""}` : "Anlage"}</span>
                  <div className="text-slate-300">{unitText(b, id)}</div>
                  <div className="text-xs text-slate-400 tabular-nums">
                    LP {fmtNum(u?.hp ?? d?.hp ?? 0)}{values}{a?.uboot ? ` · U-Jagd ${a.uboot}` : ""}{u?.submerged ? " · getaucht" : ""}{u?.speedKmh ? ` · ${u.speedKmh} km/h` : ""}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null,
    },
  ];

  if (view) return <SettingsScreen onClose={() => setView(null)} initialAdmin={view === "admin"} onAdmin={(a) => setView(a ? "admin" : "settings")} />;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-display text-xl font-bold uppercase">Handbuch</h1>
        <Button kind="secondary" onClick={onClose}>Zurück</Button>
      </div>
      {/* Schnellzugriff: Fehler melden gut sichtbar ganz oben */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <QuickButton onClick={requestBugReport} mark="!" title="Fehler melden" accent />
        <QuickButton onClick={() => setView("settings")} icon="zahnrad" title="Einstellungen" />
        <QuickButton onClick={() => setNews(true)} icon="uhr" title="Was ist neu?" />
      </div>
      {/* Sprungleiste: klebt oben, ein Tipp öffnet das Kapitel und springt hin. */}
      <nav className="sticky -top-3 z-10 -mx-3 mb-2 px-3 py-1.5 bg-paper border-b border-rule" aria-label="Kapitel">
        <HScroll className="gap-1.5" watch={open}>
          {chapters.map((c) => (
            <button key={c.id} type="button" onClick={() => setOpen(c.id)} aria-current={open === c.id ? "true" : undefined}
              className={`shrink-0 h-8 rounded-full border px-3 text-[12.5px] whitespace-nowrap ${open === c.id ? "bg-ink text-paper border-ink" : "bg-card text-ink2 border-rule"}`}>
              {c.title}
            </button>
          ))}
        </HScroll>
      </nav>
      {chapters.map((c) => (
        <section key={c.id} id={`hb-${c.id}`} className="panel rounded-xl mb-2 overflow-hidden scroll-mt-14">
          <button type="button" className="tap w-full flex items-center gap-3 p-3 text-left" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
            <Icon id={c.icon} size={30} />
            <span className="font-serif text-[18px] flex-1">{c.title}</span>
            <span className="text-slate-400">{open === c.id ? "▴" : "▾"}</span>
          </button>
          {open === c.id && <div className="px-3 pb-3">{c.body}</div>}
        </section>
      ))}
      <div className="panel rounded-xl p-3 mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-slate-300 min-w-0 break-words">Angemeldet als <strong>{playerName}</strong></span>
        <div className="flex flex-wrap gap-2">
          <Button kind="secondary" onClick={() => setView("settings")}>Einstellungen</Button>
          <Button kind="secondary" onClick={onLogout}>Abmelden</Button>
        </div>
      </div>
      <div className="panel rounded-xl p-3 mt-3">
        <div className="flex items-center gap-3 mb-2">
          <span aria-hidden className="shrink-0 grid place-items-center w-10 h-10 rounded-full bg-siegel text-[#f6f1e5] font-serif text-xl font-bold">!</span>
          <div className="min-w-0">
            <div className="font-serif text-[17px] leading-tight">Etwas stimmt nicht?</div>
            <div className="text-xs text-slate-400">Screenshot und Protokoll werden automatisch angehängt.</div>
          </div>
        </div>
        <Button className="w-full" onClick={requestBugReport}>Fehler melden</Button>
      </div>
      <VersionLine onOpen={() => setNews(true)} />
      <ChangelogSheet open={news} onClose={() => setNews(false)} />
    </div>
  );
}
