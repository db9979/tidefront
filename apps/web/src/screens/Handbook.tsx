// Handbuch: Spielziel, Ablauf und Regeln in kurzen Kapiteln; Einheitentabelle aus der Balance.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useBackLayer } from "../lib/back.ts";
import { ChangelogSheet, VersionLine } from "../components/Changelog.tsx";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { label, fmtNum } from "../lib/names.ts";
import { BRANCHES } from "../lib/research.ts";
import { buildingText, unitText, unitTone } from "../lib/info.ts";
import { Icon, IconTile } from "../icons.tsx";
import { Button, BackButton } from "../ui.tsx";
import { SettingsScreen } from "./Settings.tsx";
import { IntelChapter } from "../components/IntelChapter.tsx";
import { AdmiralChapter } from "../components/AdmiralChapter.tsx"; // Admirale
import { AchievementsChapter } from "../components/AchievementsChapter.tsx"; // Erfolge
import { AllianceOpsChapter } from "../components/AllianceOps.tsx"; // Allianz-Ops
import { NavalChapter } from "../components/NavalChapter.tsx"; // See: Minen/Blockade/Konvoi
import { FieldsChapter } from "../components/FieldsChapter.tsx"; // Felder
import { HarborsChapter } from "../components/HarborsChapter.tsx"; // Mehrere Häfen
import { BotsChapter } from "../components/BotsChapter.tsx"; // KI-Spieler
import { LagebildChapter } from "../components/LagebildChapter.tsx"; // Lagebild
import { FinaleChapter } from "../components/FinaleChapter.tsx"; // Saisonfinale
import { CatchUpChapter } from "../components/CatchUpChapter.tsx"; // Aufholhilfe
import { ContractsChapter } from "../components/ContractsChapter.tsx"; // Lieferverträge (v1.31)
import { PolitikChapter } from "../components/PolitikChapter.tsx"; // Weltpolitik
import { requestBugReport } from "../lib/bug-log.ts";
import { HScroll } from "../components/HScroll.tsx";

const ZAHLWORT = ["keinem", "einem", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn"];

/** „sechs Zweigen: Seefahrt, Heer, …, Nachrichtendienst und Raumfahrt“ aus balance.research.branches. */
function branchText(ids: readonly string[] | undefined): string {
  const names = (ids ?? BRANCHES.map((x) => x.id)).map((id) => BRANCHES.find((x) => x.id === id)?.name ?? label(id));
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}` : names.join("");
  return `${ZAHLWORT[names.length] ?? names.length} ${names.length === 1 ? "Zweig" : "Zweigen"}: ${list}`;
}

/** Spanne der verlangten Forschungsamt-Stufen, z. B. „Stufe 2 bis 6“, aus balance.research.techs. */
function labLevelsText(techs: Record<string, { requiresBuildingLevel?: number }> | undefined): string {
  const lv = Object.values(techs ?? {}).map((t) => t.requiresBuildingLevel ?? 1).filter((l) => l > 1);
  if (!lv.length) return "je nach Technik";
  const lo = Math.min(...lv), hi = Math.max(...lv);
  return lo === hi ? `Stufe ${lo}` : `Stufe ${lo} bis ${hi}`;
}

/** Kachel im Schnellzugriff oben im Handbuch. */
const EVENT_NAME: Record<string, string> = { schatzschiff: "das Schatzschiff", grossflotte: "die Großflotte", belagerung: "den Belagerungsring" };

/** Wertung eigener Angriffe auf Weltereignisse aus balance.scoring.npcWorldEventKinds (Hotfix 0.38.1, TX-01). */
function npcEventText(kinds: string[] | undefined, factor: string): string {
  const list = (kinds ?? []).map((k) => EVENT_NAME[k] ?? k);
  if (list.length === 0) return "Eigene Angriffe auf Schatzschiff, Großflotte und Belagerungsring zählen voll.";
  return `Eigene Angriffe auf ${list.join(" und ")} zählen ebenfalls nur zu ${factor}.`;
}

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
  // Regeln nennen die Grundwerte, nicht die gerade wirksamen (Weltpolitik: Gezeit, Beschlüsse).
  const b = meta.data?.baseBalance ?? meta.data?.balance;
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
          <P><strong>Wo was steht:</strong> Die App öffnet mit <strong>Basis → Lage</strong> – „Was steht an?“: Belohnungen (mit „Alle abholen“), Aufträge, was gleich fertig wird, was unterwegs ist und was zuletzt passiert ist. Gebäude und Bauhof liegen unter <strong>Basis → Hafen</strong>. Die <strong>Karte</strong> zeigt mit dem Knopf <strong>Sichtungen</strong> Sensoren, fremde Verbände, Satelliten und Radarposten. <strong>Truppen</strong> hat Einsatz, Ausbilden und Abwehr; <strong>Meldungen</strong> hat Berichte, Nachrichten, Allianz und Rangliste (mit Bilanz und Erfolgen). Die Zahl an „Basis“ zählt Neues in der Lage, die an „Meldungen“ Ungelesenes. Auf breiten Bildschirmen steht die Karte immer links, der gewählte Reiter rechts daneben.</P>
          <P>Das <strong>Auftragsbuch</strong> auf der Basis (Lage) führt dich Schritt für Schritt durch die ersten Tage. Jeder erfüllte Auftrag bringt ein Ressourcenpaket für den nächsten Schritt – tippe auf <strong>Abholen</strong>, auch für Aufträge, die du schon früher erledigt hast. Belohnungen füllen das Lager höchstens bis zur Lagergrenze; ist es zu voll, warnt das Auftragsbuch – baue dann erst den Lagerkomplex aus, die Belohnung bleibt die ganze Saison abholbar. Nach allen elf gibt es ein großes Paket, einmalig eine Stunde weniger Bauzeit für den laufenden (sonst den nächsten) Ausbau und das Abzeichen <strong>Hafenmeister</strong>, das diese Saison in der Rangliste neben deinem Namen steht. In jeder neuen Saison beginnt das Auftragsbuch von vorn.</P>
        </>
      ),
    },
    {
      id: "wirtschaft", icon: "stahlwerk", title: "Ressourcen, Strom, Lager",
      body: (
        <>
          <P>Vier Ressourcen: Stahl, Treibstoff, Elektronik und Proviant. Jeder Hafen erzeugt eine kleine Grundmenge; den Großteil liefern Stahlwerk, Raffinerie, Chipfabrik und Versorgungshof.</P>
          <P>Diese Gebäude brauchen <strong>Strom</strong> von Kraftwerk, Windpark oder Solarfeld. Reicht er nicht, sinkt ihre Produktion anteilig – die Versorgung in der Basis zeigt Angebot, Bedarf und die Kurve der nächsten 24 Stunden (Kapitel „Wetter und Strom“).</P>
          <P>Produktion füllt nur bis zur <strong>Lagerkapazität</strong> (Lagerkomplex). Beute und Lieferungen dürfen darüber liegen. Einheiten essen <strong>Proviant</strong>. Versorgungsmangel herrscht erst, wenn der Bestand auf 0 fällt <em>und</em> die Netto-Rate (Produktion minus Unterhalt) negativ ist: keine Ausbildung, Angriff −20 %.</P>
        </>
      ),
    },
    {
      id: "wetter", icon: "windpark", title: "Wetter und Strom",
      body: (
        <>
          <P>Über der Karte ziehen <strong>Wettersysteme</strong>: Tiefs ziehen vom Westatlantik nach Nordost und bringen Wind, Wolken und Sturm – am stärksten weht es im Ring um den Kern und an ihrer Südflanke, im Winter kräftiger als im Sommer. Hochs wandern langsam und bringen ruhiges, klares Wetter. Der Nordatlantik und die Nordsee sind windiger und wolkiger, das Mittelmeer ist sonniger; dort wehen eigene Winde: Mistral im Golf von Lion und Bora in der Adria (Winter), Meltemi in der Ägäis (Sommer), Levante in der Straße von Gibraltar. <strong>Nebel</strong> liegt gern über der Neufundlandbank, in der Nordsee, im Ärmelkanal und vor Portugal, vor allem im Sommer, nachts und bei Flaute; bei Sturm nie. Das Tageslicht folgt dem Sonnenstand. Das Wetter selbst steht fest und gilt für Reise, Kampf und Strom.</P>
          <P><strong>Vorhersage:</strong> Was die Basis und die Missionsplanung für die Zukunft zeigen (Stromkurve, Wettervorhersage am Hafen, Sturmwarnung, Wetter am Ziel bei Ankunft), ist eine <strong>Vorhersage</strong> und wird mit dem Vorlauf unsicherer: Wind bis zu ±{pct(b?.weather?.forecast?.windPer3h, 0.05)} je 3 Stunden Vorlauf (höchstens ±{pct(b?.weather?.forecast?.windMax, 0.3)}), Bewölkung bis zu ±{Math.round((b?.weather?.forecast?.cloudsPer3h ?? 0.04) * 100)} Punkte je 3 Stunden (höchstens ±{Math.round((b?.weather?.forecast?.cloudsMax ?? 0.25) * 100)}), und Wettersysteme kommen bis zu {b?.weather?.forecast?.shiftMaxHours ?? 3} Stunden früher oder später. Alle {b?.weather?.forecast?.issueEveryHours ?? 3} Stunden wird die Vorhersage neu ausgegeben. Deshalb zeigen Kurve und Planung eine <strong>Spannbreite</strong> (Band um das Angebot, Wind von–bis, „Sturm möglich“); das tatsächliche Wetter liegt meist darin. Jede Stufe <strong>Funkmesstechnik</strong> senkt die Unsicherheit um {pct(b?.weather?.forecast?.skillPerLevel, 0.15)}, eine <strong>Radarstation</strong> um weitere {pct(b?.weather?.forecast?.radarBonus, 0.1)}. Das Wetter, das gerade herrscht (Kärtchen „Am Hafen“, Wetterkarte, Route bei Abfahrt), ist gemessen und stimmt.</P>
          <P><strong>Wetterkarte:</strong> Die abschaltbare Wetterschicht zeigt Isobaren um Tiefs (T) und Hochs (H), Windfahnen (Pfeil in Windrichtung; je mehr Striche, desto stärker – zwei Striche ab 6 Bft, dann sind Schiffe langsamer; ein Wimpel heißt Sturm ab 9 Bft), Wolken mit Regenstrichen, Sturmwimpel und Nebel (gestrichelt). Kräftige Tiefs tragen <strong>Fronten</strong>: Die <strong>Warmfront</strong> (rot, Halbkreise) läuft vom Tief nach Osten bis Südosten, vor ihr liegt ein breiter Wolkenschirm mit Regen; die <strong>Kaltfront</strong> (blau, Dreiecke) läuft nach Süden bis Südwesten und bringt ein schmales Schauerband, dahinter wird es klarer. Dazwischen liegt der lichtere Warmsektor. Altert das Tief, holt die Kaltfront die Warmfront ein: Die <strong>Okklusion</strong> (violett, Dreiecke und Halbkreise im Wechsel) bringt dichte Wolken nahe am Kern. Die Zeichen zeigen, wohin die Front zieht. Nah herangezoomt hat jedes Feld sein eigenes Zeichen; ein rötlicher Ton heißt: Schiffe werden hier gebremst. Wind wird in Beaufort angegeben (Sturm = 9 Bft).</P>
          <P><strong>Stromquellen:</strong> Das <strong>Kraftwerk</strong> liefert {fmtNum(b?.buildings.kraftwerk?.powerSupplyPerLevel ?? 60)} Strom je Stufe bei jedem Wetter, verbrennt bei Volllast {fmtNum(b?.buildings.kraftwerk?.fuelPerHourPerLevel ?? 3)} Treibstoff je Stunde und Stufe. Es <strong>regelt nach</strong>: Es liefert nur, was Wind, Sonne, Seekabel und Speicher offen lassen, und verbrennt entsprechend weniger; ist kein Treibstoff da, verbrennt es nur, was nachkommt. Der <strong>Windpark</strong> liefert bis zu {fmtNum(b?.buildings.windpark?.windPowerPerLevel ?? 0)} je Stufe im Verhältnis zum Wind und schaltet bei Orkan ab. Das <strong>Solarfeld</strong> liefert bis zu {fmtNum(b?.buildings.solarfeld?.solarPowerPerLevel ?? 0)} je Stufe bei hoher Sonne, Wolken kosten bis zu {pct(b?.buildings.solarfeld?.cloudLoss, 0.7)}, nachts nichts. Das <strong>Speicherwerk</strong> lädt Ökostrom-Überschuss ({fmtNum(b?.buildings.speicherwerk?.storagePerLevel ?? 0)} je Stufe, höchstens {fmtNum(b?.buildings.speicherwerk?.storageRatePerLevel ?? 0)} je Stunde) und gibt ihn bei Flaute oder nachts wieder ab.</P>
          <P><strong>Ökostrom und Überschuss:</strong> Wind und Sonne decken den Bedarf zuerst, dann laden sie den Speicher; das Kraftwerk deckt den Rest. Was danach übrig ist, ist <strong>Überschuss</strong>. Die <strong>Elektrolyse</strong> wandelt Ökostrom-Überschuss in Treibstoff ({fmtNum(b?.buildings.elektrolyse?.electrolysisRatio ?? 10)} Strom-Stunden → 1 Treibstoff, je Stufe bis zu {fmtNum(b?.buildings.elektrolyse?.electrolysisPerLevel ?? 40)} Strom je Stunde); Kraftwerksstrom nimmt sie nie. Was weder Elektrolyse noch Seekabel aufnehmen, verfällt – die Stromkurve zeigt es als Streifen unter der Achse („→ Treibstoff“, „→ Partner“, „verfällt“).</P>
          <P><strong>Seekabel:</strong> Mit dem Gebäude Seekabel verbindest du einen Hafen mit einem eigenen Hafen oder dem eines Allianzmitglieds (höchstens {fmtNum(b?.power?.cable?.maxKm ?? 600)} km, ein Kabel je Hafen; beide brauchen eine Station; fremde Häfen müssen zustimmen). Der abgebende Hafen schickt seinen Ökostrom-Überschuss nach der Elektrolyse ins Kabel, bis {fmtNum(b?.buildings.seekabel?.cablePerLevel ?? 30)} Strom je Stunde und Stufe; unterwegs gehen {pct(b?.power?.cable?.lossPer100Km, 0.1)} je 100 km verloren. Alle {b?.power?.cable?.tickMinutes ?? 10} Minuten wird abgerechnet: Der Strom landet im Kabelpuffer des Empfängers ({b?.power?.cable?.bufferHours ?? 2} Stunden Stationsleistung), der ihn bei Mangel vor dem Speicher nutzt. Der Abgebende legt einen Preis fest (0 bis {fmtNum(b?.power?.cable?.maxPrice ?? 2, 2)} Taler je Strom-Stunde, 0 = Allianzhilfe; eigene Häfen kostenlos); geliefert wird nur, was der Empfänger bezahlen kann. Kabelstrom wird weder gespeichert noch elektrolysiert noch weitergeleitet. Kriegsgegner können eine Station sabotieren: Für die Dauer der Sabotage ist das Kabel unterbrochen, gesendeter Strom geht verloren. Wer die Allianz verlässt, verliert das Kabel bei der nächsten Abrechnung.</P>
          <P><strong>Grüner Hafen:</strong> Stammen in den letzten {b?.power?.green?.windowHours ?? 24} Stunden mindestens {pct(b?.power?.green?.shareMin, 0.6)} des gedeckten Bedarfs aus Ökostrom (Wind, Sonne, Kabel und Speicherladung aus Ökostrom), produzieren alle Gebäude {pct(b?.power?.green?.bonus, 0.03)} mehr – im Info-Blatt als Quelle „Ökostrom“. Genutzter Ökostrom zählt für den Erfolg „Grüner Hafen“, ein Wochenziel und die Saisonauszeichnung „Grünster Hafen“. Ein Kraftwerkshafen bleibt voll versorgt; ihm fehlen nur diese {pct(b?.power?.green?.bonus, 0.03)}.</P>
          <P><strong>Rangfolge bei Mangel:</strong> 1. Radar (ohne volle Versorgung schrumpft die Vorwarnzeit anteilig, ohne Strom gibt es keine), 2. Produktion (gedrosselt), 3. Werft, Kaserne und Flugfeld während der Ausbildung, 4. Forschung. Ausbildung und Forschung laufen bei Mangel langsamer (mindestens mit {pct(b?.power?.minSpeed, 0.25)} Tempo); ihre Fertigstellung wird beim Start mit der Stromprognose festgelegt und ändert sich danach nicht mehr. Die Basis warnt, wann und wie viel Strom fehlt.</P>
          <P><strong>Wetter im Einsatz:</strong> Sturm auf der Route verlängert die Reisezeit der Schiffe um bis zu {pct(b?.weather?.shipSlowMax, 0.3)} (bestimmt bei Abfahrt); die Missionsplanung zeigt Wetter und Zuschlag. Bei Sturm am Hafen starten reine Luftmissionen nicht, und im Kampf treffen Flugzeuge im Sturm schwächer (bis −{pct(b?.weather?.airStormPenalty, 0.6)}); Wolken am Kampfort schwächen den Luftschlag (bis −{pct(b?.weather?.cloudStrikePenalty, 0.3)}). Nebel am eigenen Hafen kürzt die Radar-Vorwarnzeit (bis −{pct(b?.weather?.fogRadarMax, 0.3)}), Nebel am Ziel macht Aufklärung unsicher: Bestände und Truppen erscheinen gerundet. Die Missionsplanung zeigt auch die Vorhersage für das Ziel zur Ankunft – mit Spannbreite; bei Ankunft gilt das tatsächliche Wetter.</P>
        </>
      ),
    },
    {
      id: "bauen", icon: "kommandozentrale", title: "Bauen und Ausbilden",
      body: (
        <>
          <P><strong>Grüne Raute</strong> an einem Gebäude: Es lässt sich jetzt ausbauen – die Rohstoffe reichen, in der Bauschlange ist Platz und die Höchststufe ist nicht erreicht.</P>
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
          <P><strong>Piratennester</strong> haben die Stufen I bis V, verteilt über alle Küsten, und sind nach einem Sieg {b?.pirates.nestRespawnHours ?? 12} Stunden verlassen. Bei der Hafenwahl liegt immer ein Nest der Stufe I in höchstens 300 km (fehlt eins, entsteht es vor der Küste); seine Stufe kennst du von Anfang an. Unter Truppen → Einsatz → „Nester in der Nähe“ steht je Nest der kleinste Verband aus deinem Bestand, der im Probekampf mindestens 9 von 10 Kämpfen gewinnt. Dazu kommen wenige <strong>Inselfestungen der Stufe VI</strong> auf abgelegenen Inseln (Bermuda, Azoren, Jan Mayen, Balearen, Rhodos) – das Ziel für die letzten Saisonwochen: Ein voller Verband schafft sie etwa ab Tag 35 bis 38, vorher kaum. Sie geben die größte Beute ({fmtNum(Object.values(b?.pirates.nestLevels["6"]?.loot ?? {}).reduce((a, n) => a + Number(n), 0))} Einheiten, vor allem Elektronik; der Probekampf zeigt, wie viel davon in deinen Laderaum passt – nimm genug Landungsschiffe mit) und sind nach einem Sieg {Number(b?.pirates.nestLevels["6"]?.respawnHours ?? 24)} Stunden verlassen.</P>
          {b?.pirates.living && <P><strong>Lebendige Nester:</strong> Bei jeder Besetzung würfelt ein Nest (ab Stufe II) seine Stärke neu: Besatzung {Math.round((1 - b.pirates.living.spread) * 100)}–{Math.round((1 + b.pirates.living.spread) * 100)} % der Stufe, jede Anlagenart eine mehr oder weniger. Stufe I schwankt nicht. Wer ein Nest nur <em>erkennt</em> (Ausguck, Radar, Bordsicht, Satellit), sieht die Stufe, die Besatzung als Spanne, „Anlagen unbekannt“ und Beute {Math.round(100)}–{Math.round(b.pirates.living.lootMax * 100)} %; erst ein <em>Lagebild</em> (Aufklärung oder Kampfbericht) zeigt das Nest genau – {b.intel?.staleHours ?? 24} Stunden lang und nur bis zur nächsten Wiederbesetzung. Die Beute wächst ab der Besetzung um {Math.round(b.pirates.living.lootPerHour * 100)} % je Stunde bis {Math.round(b.pirates.living.lootMax * 100)} %. Wehrt ein Nest einen Überfall ab, ist es geschwächt: sofort wieder mindestens {Math.round(b.pirates.living.recoverMin * 100)} %, dann {Math.round(b.pirates.living.recoverPerHour * 100)} % je Stunde; zerstörte Anlagen sind nach {b.pirates.living.defenseReturnHours} Stunden zurück. Ohne Lagebild rechnet der Probekampf über die Spanne („Siegchance 22–100 %, im Mittel 90 %“) – eine Drohne vorweg spart oft die Hälfte des Verbands.</P>}
          <P><strong>Transport:</strong> Ladung an einen anderen Spielerhafen.</P>
          <P>Treibstoff für Hin- und Rückweg wird beim Auslaufen bezahlt. Die Reisezeit richtet sich nach dem langsamsten Schiff. Schiffe fahren über Wasser: Die Route führt um Land herum, durch die Meerengen (Gibraltar, Ärmelkanal, Bosporus, Suezkanal …) und ist oft länger als die Luftlinie; Reisezeit und Treibstoff richten sich nach ihr. Die Planung zeigt Seeweg und Route auf der Karte. Reine Flugzeug- und Drohnenverbände fliegen Luftlinie. Wie viele Missionen gleichzeitig laufen, bestimmt die Hafenkommandantur; wie groß ein Verband sein darf, die Kommandopunkte.</P>
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
            <li><strong>Seegefecht:</strong> Schiffe gegeneinander, Küstenbatterien feuern mit. U-Boote schießen weiter, können aber nur von Schiffen mit <strong>U-Jagd</strong> (Korvette, Zerstörer) getroffen werden – nicht von Bombern, Batterien oder dem Kartell. Einen Konvoi oder ein Feld halten sie aber nicht: Bleiben dort nur U-Boote übrig, ist es verloren.</li>
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
          <P>Das <strong>Freibeuter-Kartell</strong> greift jeden Hafen etwa alle {b?.pirates.raidIntervalHours ?? 18} Stunden an. Seine Schnellboote laufen vom nächsten Nest über Wasser aus: meist eine Stunde vor dem Angriff, bei Häfen hinter Land (Umweg um eine Halbinsel) bis zu drei Stunden. Seine Stärke beträgt etwa {pct(b?.pirates.raidStrengthShareOfDefense, 0.2)} der Lebenspunkte deiner Bodentruppen, Anlagen und Schiffe daheim und schwankt von Überfall zu Überfall um bis zu ±{pct(b?.pirates.raidStrengthSpread, 0.3)}. Kriegsschiffe zählen zu {pct(b?.pirates.raidHpWeights?.see, 0.5)}, weil sie an Land nicht mitkämpfen; Landungsschiffe, Kolonieschiffe, Minenleger und Flugzeuge zählen nicht. Eine Flotte daheim macht die Überfälle also etwas stärker: Sie versenkt Schnellboote, bevor die Miliz landet, verliert dabei aber selbst Schiffe – bei jedem Überfall. Der Kampfbericht nennt diesen bleibenden Verlust (Plünderung und Einheiten) in Stunden Produktion deines Hafens; mit einem Verband daheim sind es meist nur wenige Stunden je Überfall. Getauchte U-Boote kann das Kartell nicht treffen. Wer seine Flotte auf Feldern oder auf See hat, verliert daheim weniger Schiffe, braucht dann aber Bodentruppen und Anlagen. Die Miliz landet von den Schnellbooten und greift Bodentruppen und Bunkerlinie gleich hart an: Eine Bunkerlinie ist ein starker Schutz, hält aber nicht jeden Überfall auf. Bodentruppen, Bunkerlinie und Küstenbatterien sind die beste Abwehr. Das Wetter am Hafen gilt auch hier: Das Kartell hat keine Flugzeuge, aber deine Jäger und Bomber treffen bei Sturm schwächer und der Luftschlag leidet unter Wolken.</P>
          <P><strong>Anfängerschutz:</strong> {b?.protection.beginnerDays ?? 7} Tage nach der Gründung – er endet vorzeitig, sobald du selbst einen Spielerhafen überfällst (auch im Sammelangriff; Nester, Felder und Weltereignisse nicht). Die Missionsplanung warnt vorher. <strong>Nachtschild:</strong> täglich {b?.protection.nightShieldHours ?? 8} Stunden ab der Startstunde, die du in der Basis wählst; ohne gewählte Stunde ist er aus. Eine Änderung gilt erst nach {b?.protection.nightShieldChangeHours ?? 24} Stunden und ist so lange auch gesperrt – den Schild gegen einen schon gemeldeten Angriff einzuschalten geht nicht. Ein eigener Überfall hebt ihn für diese Nacht auf. <strong>Nach einer Niederlage:</strong> {b?.protection.afterDefeatShieldHours ?? 8} Stunden Schutz.</P>
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
          <P><strong>Großflotte:</strong> wird {we?.grossflotte.announceHours ?? 12} Stunden vorher angekündigt, mit Zielregion und Zielhäfen. Ihre Stärke richtet sich nach den Zielhäfen; wie beim Kartell zählen Kriegsschiffe daheim nur halb und Landungsschiffe gar nicht, denn ihre Miliz landet. Dann greift sie die Häfen nacheinander an, alle {we?.grossflotte.attackIntervalHours ?? 3} Stunden einen. Nachtschild, Anfängerschutz und Schutz nach Niederlage gelten: ein geschützter Hafen wird übersprungen. Jeder kann sie vorher und zwischendurch auf See angreifen – ihre Verluste bleiben, und du erhältst Beute anteilig zu deinem Schaden sowie Kampfpunkte.</P>
          <P><strong>Belagerung:</strong> ein Ring aus Schnellbooten um einen Hafen für {we?.belagerung.durationHours ?? 24} Stunden: keine Börsenkäufe, Produktion −{Math.round((we?.belagerung.productionPenalty ?? 0.3) * 100)} %. Brechen können ihn nur die anderen – Verbündete und Mitspieler schicken einen Überfall auf den Ring und teilen sich den Beutepool nach Schaden.</P>
          <P>Auf See gibt es keine Landung: Sinken alle Boote, ertrinkt die Miliz an Bord. Kampfberichte gegen Ereignisse findest du wie gewohnt unter Meldungen.</P>
        </>
      ),
    },
    { id: "saisonfinale", icon: "kartell", title: "Saisonfinale: Leviathan", body: <FinaleChapter b={b} /> }, // Saisonfinale
    {
      id: "boerse", icon: "credits", title: "Börse",
      body: (
        <>
          <P>Ab Hafenkommandantur Stufe 3. Verkaufen bringt sofort Taler, gekaufte Ware kommt per Konvoi vom nächsten Handelshafen. Gebühr {Math.round((b?.market.fee ?? 0.04) * 100)} % je Geschäft.</P>
          <P>Große Mengen bewegen den Kurs; der Kurs kehrt langsam zum Richtwert zurück (nach {b?.market.reversionHalfLifeHours ?? 24} Stunden ist die Hälfte des Abstands geschafft). Die Kasse (höchstens so viele Taler auf dem Konto) wächst mit der Stufe der Hafenkommandantur. Bei einem erkannten Angriff sind Verkäufe gesperrt.</P>
          <P><strong>Tageslimit:</strong> Je Ressource lassen sich in 24 Stunden {Math.round((b?.market.dailyLimitShareOfStorage ?? 0.2) * 100)} % der Lagergröße handeln, Kauf und Verkauf zusammen. Das Limit gleitet: Was du handelst, wird 24 Stunden nach der vollen Stunde des Handels wieder frei (ein Kauf um 13:40 also ab 13:00 am nächsten Tag). An der Order steht, wann wie viel wieder frei wird.</P>
          <P><strong>Kursverlauf:</strong> Unter der Order zeigt das Diagramm die letzte Stunde, 24 Stunden, 7 Tage oder die ganze Saison (Schlusskurs jeder vollen Stunde) mit Grund- und aktuellem Richtwert. Zum Saisonende beginnt der Verlauf neu.</P>
          <P><strong>Lieferzeit:</strong> Jeder Börsenkauf kommt nach genau {(b?.market as { deliveryHours?: number } | undefined)?.deliveryHours ?? 4} Stunden an, egal wie weit der Handelshafen entfernt ist – der Konvoi fährt den Seeweg entsprechend schneller oder langsamer. Auch das Kartellrisiko ist dadurch für alle gleich und hängt nur vom Warenwert ab. Lieferverträge behalten ihre eigene Fälligkeit.</P>
          <P><strong>Marktnachrichten:</strong> Die Welt verschiebt den Richtwert vorübergehend – eine Großflotte macht Treibstoff und Proviant teurer, eine Belagerung Proviant, ein erbeutetes Schatzschiff drückt Stahl und Elektronik, Kriege und Kartell-Überfälle heben Treibstoff, volle oder leere Lager aller Häfen wirken einmal am Tag, und in der letzten Saisonwoche steigen Stahl und Elektronik. Die <strong>Handelsbilanz</strong> folgt den Börsengeschäften aller Häfen der letzten {b?.market.news?.tradeBalance?.windowHours ?? 72} Stunden: Wird eine Ressource mehr gekauft als verkauft, steigt ihr Richtwert, im umgekehrten Fall fällt er – höchstens ±{Math.round((b?.market.news?.tradeBalance?.max ?? 0.15) * 100)} %, erst ab {b?.market.news?.tradeBalance?.minPorts ?? 3} aktiven Häfen, und ein einzelner Händler zählt höchstens zu einem Drittel. Zusammen höchstens ±{Math.round((b?.market.news?.maxTotal ?? 0.25) * 100)} %, und der Richtwert bewegt sich höchstens {Math.round((b?.market.news?.maxChangePerHour ?? 0.05) * 100)} % je Stunde. Der Kurs springt nicht, er folgt dem neuen Richtwert langsam. Nach dem Anlass klingt die Wirkung über ein bis zwei Tage ab. Als Push „Marktnachricht“ abonnierbar (Einstellungen).</P>
        </>
      ),
    },
    { id: "vertraege", icon: "credits", title: "Lieferverträge", body: <ContractsChapter b={b} /> }, // Lieferverträge (v1.31)
    { id: "weltpolitik", icon: "wind", title: "Weltpolitik: Gezeit, Seerat, Ansehen", body: <PolitikChapter b={b} /> }, // Weltpolitik
    {
      id: "forschung", icon: "forschungsamt", title: "Forschung",
      body: (
        <>
          <P>Im <strong>Forschungsamt</strong> (Basis → Hafen → Führung und Schutz) erforschst du Techniken in {branchText(b?.research?.branches)}. Es läuft immer <strong>eine</strong> Forschung; sie kostet Ressourcen und Zeit. Abbrechen erstattet den Anteil der Restzeit.</P>
          <P>Jede Technik hat 1 bis 3 Stufen mit je 5 bis 12 % Wirkung, zum Beispiel Dampfturbinen +8 % Tempo der Schiffe, Sonar +10 % U-Jagd, Hochofen +8 % Stahl oder Logistik −8 % Treibstoff und +8 % Ladung. Voll erforscht bringt kein Bereich mehr als 25 %. Fortgeschrittene Techniken brauchen eine höhere Stufe des Forschungsamts ({labLevelsText(b?.research?.techs)}) und meist eine Vorgänger-Technik. Jede Stufe des Forschungsamts über 1 forscht 10 % schneller.</P>
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
    { id: "lagebild", icon: "radarstation", title: "Lagebild", body: <LagebildChapter b={b} /> }, // Lagebild: Kartennebel, Sensoren
    { id: "see", icon: "mine", title: "Minen, Blockade, Konvois", body: <NavalChapter b={b} /> }, // See
    { id: "felder", icon: "oelfeld", title: "Rohstofffelder", body: <FieldsChapter b={b} /> }, // Felder
    { id: "haefen", icon: "gruendung", title: "Mehrere Häfen", body: <HarborsChapter b={b} /> }, // Mehrere Häfen
    {
      id: "tagesbefehle", icon: "uhr", title: "Tagesbefehle",
      body: (
        <>
          <P>Jeden Tag um <strong>0:00 Uhr</strong> (deutsche Zeit) erhältst du auf der Basis drei <strong>Tagesbefehle</strong>: einen leichten, einen mittleren und einen schweren. Sie passen zu deinem Stand – ein Nest-Überfall wird erst verlangt, wenn du Werft und Kaserne hast, und die Ziele wachsen mit deiner Kommandozentrale.</P>
          <P>Mögliche Befehle: Ausbauten abschließen, die Bauschlange füllen, Bodentruppen, Schiffe oder Flugzeuge ausbilden, Anlagen errichten, einen Vorrat anlegen, die Produktion steigern, die Kommandozentrale ausbauen, ein Nest besiegen, einen Kartell-Überfall abwehren, eine Forschung abschließen, Aufklärung, Transporte, Börsenhandel, Wrackgut bergen, Beute machen, ohne Verluste siegen oder einem Mitspieler schreiben. Zu Wetter und Strom: Speicherwerk ausbauen, einen Stromüberschuss im Speicher halten, Windpark oder Solarfeld ausbauen, gleichzeitig viel Strom aus Wind und Sonne erzeugen (geprüft alle 10 Minuten, auch wenn du nicht nachsiehst; es zählt der beste Stand des Tages) und eine Mission trotz Sturm auf der Route erfolgreich beenden; mit Nachrichtendienst auch Ziele erkunden.</P>
          <P>Der Balken zeigt den Fortschritt. Ist ein Befehl erfüllt, holst du die Belohnung mit <strong>Abholen</strong> ab: Ressourcen (in den Heimathafen, höchstens bis zur Lagergrenze – ist das Lager zu voll, warnt der Befehl vorher und nennt, was verfiele; das gilt auch für Wochenziele und Erfolge) und Punkte für die Kategorie Befehle – leicht 3, mittel 6, schwer 12{b?.scoring?.ordersMaxShare !== undefined ? ` (sie zählen höchstens ${pct(b.scoring.ordersMaxShare, 0.05)} deines Gesamtrangs, siehe Saison und Wertung)` : ""}. Erfüllte Befehle kannst du auch später noch abholen, bis die Saison endet. Die Zahl an der Basis zeigt, was bereitliegt; „Alle abholen“ in der Lage holt alles auf einmal.</P>
          <P>Einmal am Tag darfst du einen offenen Befehl kostenlos <strong>neu würfeln</strong>; der neue hat dieselbe Schwierigkeit, sein Fortschritt beginnt bei null.</P>
          <P>Ein angenommenes <strong>Gesuch</strong> eines KI-Spielers belegt einen der drei Plätze (meist den schweren) und ist erfüllt, sobald sein Liefervertrag erfüllt ist; es lässt sich nicht neu würfeln (Kapitel Weltpolitik).</P>
          <P><strong>Serie:</strong> Holst du an aufeinanderfolgenden Tagen alle drei Befehle ab, wächst deine Serie. Am 3. Tag gibt es 10 Punkte Bonus, am 7. Tag 25, an jedem weiteren 7. Tag 10 mehr – jeweils mit Nachschub. Ein ausgelassener Tag beginnt die Serie von vorn. Zum Saisonende verfallen Befehle und Serie.</P>
        </>
      ),
    },
    // Erfolge (Abzeichen) und Wochenziele (components/AchievementsChapter.tsx)
    { id: "erfolge", icon: "hafenmeister", title: "Erfolge und Wochenziele", body: <AchievementsChapter b={b} /> },
    { id: "aufholhilfe", icon: "lagerkomplex", title: "Aufholhilfe", body: <CatchUpChapter b={b} /> }, // Baugutschrift
    {
      id: "saison", icon: "nav-bericht", title: "Saison und Wertung",
      body: (
        <>
          <P>Gespielt wird in <strong>Saisons</strong> von einigen Wochen. Unter Meldungen → Rangliste siehst du, welche Saison läuft und wie viele Tage bleiben. In den letzten drei Tagen erscheint zusätzlich ein Hinweis auf der Basis.</P>
          <P>Die <strong>Rangliste</strong> zählt fünf Kategorien; in den ersten vier ergibt je 100 Kostenwert ein Punkt. Der Kostenwert bewertet Ressourcen zum Richtpreis der Börse (Stahl {fmtNum(b?.market?.refPrice?.stahl ?? 1, 1)}, Treibstoff {fmtNum(b?.market?.refPrice?.treibstoff ?? 1.8, 1)}, Elektronik {fmtNum(b?.market?.refPrice?.elektronik ?? 3, 1)}, Proviant {fmtNum(b?.market?.refPrice?.proviant ?? 0.6, 1)}).</P>
          <ul className="text-sm list-disc pl-5 space-y-1 mb-2 text-slate-200">
            <li><strong>Ausbau:</strong> Kosten aller gebauten Gebäudestufen.</li>
            <li><strong>Militär:</strong> Kosten deiner Einheiten und Anlagen, auch der Verbände unterwegs.</li>
            <li><strong>Kampf:</strong> Kostenwert der gegnerischen Einheiten und Anlagen, die du im Kampf vernichtest – auch Kartell und Nester.{(b?.scoring?.nestFactor ?? 1) !== 1 ? ` Überfälle auf Piratennester zählen zu ${pct(b?.scoring?.nestFactor, 0.5)} (Kampf und Beute); Kämpfe gegen Mitspieler und Weltereignisse zählen voll.` : ""} Die Abwehr von Kartell-Überfällen (auch Großflotte, Konvoi, Feld) zählt nur zu {pct(b?.scoring?.npcDefenseFactor, 0.25)}. {npcEventText(b?.scoring?.npcWorldEventKinds, pct(b?.scoring?.npcDefenseFactor, 0.25))}{(b?.scoring?.armadaFactor ?? 1) !== 1 ? ` Kämpfe gegen die Armada des Saisonfinales zählen zu ${pct(b?.scoring?.armadaFactor, 0.5)}.` : ""}</li>
            <li><strong>Beute:</strong> Wert aller Ressourcen, die du erbeutest{(b?.scoring?.nestFactor ?? 1) !== 1 ? ` – aus Nestern zu ${pct(b?.scoring?.nestFactor, 0.5)}` : ""}.</li>
            <li><strong>Befehle:</strong> Punkte aus abgeholten Tagesbefehlen samt Serienbonus{b?.scoring?.ordersMaxShare !== undefined ? ` – höchstens ${pct(b.scoring.ordersMaxShare, 0.05)} deines Gesamtrangs; was darüber liegt, zählt nicht` : ""}.</li>
          </ul>
          <P><strong>Spieler gegen Spieler:</strong> Bei Kämpfen zwischen Spielern zählt die Wertung zusätzlich so (Ressourcen, Beute und Verluste bleiben, wie der Kampf sie ergibt):</P>
          <ul className="text-sm list-disc pl-5 space-y-1 mb-2 text-slate-200">
            <li><strong>Kopfgeld:</strong> Auf Platz 1, 2 und 3 der Rangliste (Stand zum Tagesbeginn) liegt ein Kopfgeld von +{pct(b?.pvp?.bountyByRank[0], 0.5)}, +{pct(b?.pvp?.bountyByRank[1], 0.35)} und +{pct(b?.pvp?.bountyByRank[2], 0.2)} auf deine Kampfpunkte aus diesem Kampf – nur, wenn du selbst schlechter platziert bist, und nicht auf Beute. Die Rangliste zeigt es neben dem Namen, die Missionsplanung und die Karte beim Ziel. Die Kampfpunkte, die die Spitze aus der Verteidigung erhält, zählen nur zu {pct(b?.pvp?.bountyDefenseFactor, 0.5)}.</li>
            <li><strong>Mutfaktor:</strong> Kampf- und Beutepunkte des Angreifers × √(Punkte Ziel ÷ eigene Punkte), zwischen ×{fmtNum(b?.pvp?.mutMin ?? 0.5, 1)} und ×{fmtNum(b?.pvp?.mutMax ?? 1.5, 1)}: gegen einen doppelt so starken Gegner ×1,41, gegen einen halb so starken ×0,71. Mit Kopfgeld zusammen höchstens ×{fmtNum(b?.pvp?.maxFactor ?? 2)}.</li>
            <li><strong>Paarbremse:</strong> Kämpfe derselben zwei Spieler (beide Richtungen, auch Sammelangriffe) innerhalb von {b?.pvp?.pairWindowHours ?? 72} Stunden zählen für beide nur ×1, ×0,5, ×0,25, danach gar nicht.</li>
            <li><strong>Absprachen:</strong> Wer in den letzten {b?.pvp?.collusionDays ?? 7} Tagen miteinander gehandelt, sich etwas transportiert oder stationiert hat oder in derselben Allianz bzw. im Pakt war, bekommt kein Kopfgeld und keinen Mutfaktor über ×1. Die Verwaltung sieht auffällige Paare und kann einzelne Berichte aus der Wertung nehmen.</li>
          </ul>
          <P>Am Saisonende wird der Endstand festgehalten: Gold, Silber und Bronze für die ersten drei Plätze, dazu je eine Auszeichnung für den Besten jeder Kategorie. Jeder erhält eine Nachricht mit seinem Platz; die <strong>Ruhmeshalle</strong> zeigt alle vergangenen Saisons.</P>
          <P>Danach beginnt die Welt neu: Häfen, Flotten, Berichte, Lieferungen und Taler verfallen, Nester und Börse starten frisch. Dein Konto und deine Nachrichten bleiben – du wählst einfach einen neuen Hafen und hast wieder Anfängerschutz.</P>
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
          <P><strong>Probekampf:</strong> In der Missionsplanung rechnet „Probekampf“ einen Überfall 50-mal durch und zeigt Siegchance, erwartete Verluste, Beute, die Spannweite und je Phase (Luftkampf, Luftschlag, U-Boot, Seegefecht, Landung, Bodenkampf), wie oft sie stattfand, wie oft du vorn lagst und wo eine Niederlage entschieden wurde. Er rechnet mit dem <em>vorhergesagten Wetter am Ziel zur Ankunft</em> (Mitte der Vorhersage: Wolken schwächen den Luftschlag, Sturm alle Flugzeuge) und mit deinen Modifikatoren samt Admiral; die „Einschätzung“ darüber nennt dieselbe Siegchance. Gegen Nester mit Lagebild zählt ihre genaue (hochgerechnete) Besatzung, gegen nur erkannte die Spanne ihrer Stufe (ohne Sicht: Lage unbekannt, kein Probekampf); gegen Spielerhäfen nur das Lagebild deiner letzten Aufklärung – ohne Aufklärung heißt es: erst aufklären. „Nester in der Nähe“ rechnet ebenso mit dem Wetter am Nest zur Ankunft und prüft jeden Vorschlag gegen 200 weitere Würfe, damit „9 von 10“ auch im echten Kampf hält.</P>
          <P><strong>Kampfsimulator:</strong> Unter Truppen → Kampfsimulator stellst du beide Seiten frei zusammen, mit Vorlagen „Mitte“, „ungünstig“ und „aus Lagebild“ für Nester. „Eigener Hafen“ verteidigt wie im echten Kampf: mit deinen Modifikatoren, dem Hafenkommandanten (wenn er bereit ist) und – zuschaltbar – stationierten Verbündeten. „Kartell“ stellt den Überfall so zusammen wie der Server gegen deine Verteidigung; ein Regler zeigt die Schwankung der Kartellstärke. Das Ergebnis steht immer aus deiner Sicht: Verteidigst du, ist es die Abwehrchance. Ein Hinweis „Nicht berücksichtigt: …“ erscheint nur, wenn für dieses Ziel wirklich etwas fehlt (etwa das Wetter oder der Abschlag für wiederholte Angriffe auf einen Spielerhafen).</P>
          <P><strong>Was fehlt zum Sieg?</strong> Der Knopf im Probekampf, im Kampfsimulator und an verlorenen Kampfberichten („Was hätte gefehlt?“) sucht den günstigsten Verband zum Richtpreis, der das Ziel mit der gewählten Sicherheit (70, 90 oder 99 %) schlägt – mit allen Anlagen, Modifikatoren, Wetter und der Siegregel wie im echten Kampf, gegen Nester ohne Lagebild im Mittel über die Spanne. Dein Bestand daheim kommt zuerst (er kostet nichts); was fehlt, steht mit Kosten und Ausbildungszeit da („+8 Schützen, +1 Landungsschiff“), dazu erwartete Verluste und Beute. Die Suche beachtet Truppenplatz auf Landungsschiffen, Kommandopunkte, freie Stellplätze und nur Einheiten, die du heute ausbilden kannst; geprüft wird gegen 300 weitere Würfe. „Ausbilden“ öffnet Truppen → Ausbilden mit den fehlenden Mengen, „Mit diesem Verband planen“ die Planung. Reicht nichts, heißt es ehrlich „nicht erreichbar mit heutigen Einheiten“. Die Rechnung läuft im Hintergrund (meist 1–3 s).</P>
          <P><strong>Bericht im Simulator:</strong> Jeder Kampfbericht (auch der Link in der Bericht-E-Mail) lässt sich mit „Im Kampfsimulator öffnen“ nachstellen: beide Verbände vor dem Kampf, Anlagen, Wetter am Kampfort, die Siegregel der Kampfart (gegen Weltereignisse, Saisonfinale, Felder, Konvois und Blockaden gilt wie im echten Kampf „Gegner vernichtet“ – Truppen ohne Schiffe ertrinken) und deine gespeicherten Modifikatoren. Die Boni eines gegnerischen Spielers (Forschung, Admiral, Veteranen) bleiben für beide Seiten geheim und zählen neutral; das Kartell hat keine. Ist die Beute nicht ableitbar (verlorener Angriff auf einen Hafen), steht sie als „unbekannt“ da statt 0. Daneben steht das Kriegsglück des echten Kampfs; danach änderst du frei, etwa „mit fünf Korvetten mehr?“. An Aufklärungsberichten rechnet derselbe Knopf deinen Bestand daheim gegen das aufgeklärte Ziel.</P>
          <P><strong>Vorlagen:</strong> Speichere einen Verband unter einem Namen (z. B. „Nestjäger“). Ein Tipp setzt ihn in der Planung ein; fehlen Einheiten daheim, wird auf das Verfügbare gekürzt. <strong>Wiederholen</strong> an einem eigenen Bericht oder unter „Zuletzt heimgekehrt“ öffnet die Planung mit demselben Ziel und Verband.</P>
          <P><strong>Als Nächstes:</strong> Die Zeitleiste auf der Basis zeigt Ausbauten, Ausbildungen, Ankunft und Rückkehr deiner Verbände, erkannte Angriffe, Lieferungen, Nachtschild und Saisonende mit Countdown. Der <strong>Morgenbericht</strong> (Einstellungen) fasst einmal am Tag zusammen, was über Nacht geschah.</P>
          <P><strong>Was hilft?</strong> Lehnt das Spiel etwas ab („Alle Missionsplätze sind belegt.“, „Nicht genug Ressourcen.“), steht unter der Meldung meist „Was hilft?“. Ein Tipp klappt auf, was fehlt und wie viel – etwa welches Gebäude auf welche Stufe muss, wie viel Treibstoff fehlt oder wann die nächste Mission zurück ist – und Knöpfe springen direkt dorthin: zum Gebäude-Blatt, zur Börse mit der fehlenden Ressource, zur Forschung oder zu den laufenden Missionen. Auch ein grauer Knopf wie „Auslaufen“ zeigt beim Antippen, was ihn freigibt.</P>
        </>
      ),
    },
    {
      id: "allianz", icon: "transport", title: "Allianzen, Diplomatie, Handel",
      body: (
        <>
          <P>Unter Meldungen → <strong>Allianz</strong> gründest du eine Allianz (Name und Kürzel aus 2–4 Zeichen) oder fragst bei einer an. Führung und Offiziere laden ein und nehmen Anfragen an; die Führung vergibt Rollen und kann die Allianz auflösen. Das Kürzel steht in der Rangliste vor deinem Namen, die <strong>Allianzwertung</strong> zählt den Durchschnitt der Mitgliederpunkte (geteilt durch mindestens zwei – allein zählst du nur halb), damit Größe allein nicht gewinnt. Wie viele Mitglieder eine Allianz haben darf, richtet sich nach der Rundengröße (die Hälfte der Menschen, mindestens drei); die Verwaltung kann es ändern. Allianzen bleiben über das Saisonende bestehen.</P>
          <P><strong>Verbündete</strong> können sich nicht überfallen. Im Allianz-Chat sprecht ihr euch ab. Auf der Karte erscheinen ihre Häfen grün mit Doppelring, die von Paktpartnern ocker und die von Kriegsgegnern rot mit Peilstrichen (weit herausgezoomt als farbige Punkte); antippen zeigt das Verhältnis. Die Legende erklärt die Zeichen.</P>
          <P><strong>Diplomatie</strong> gibt es zwischen Allianzen und Spielern ohne Allianz. Ein <strong>Nichtangriffspakt</strong> gilt, wenn beide Seiten zustimmen; danach sind gegenseitige Überfälle ausgeschlossen. Kündigen kann jede Seite, der Pakt gilt dann noch 24 Stunden. Eine <strong>Kriegserklärung</strong> wirkt nach 12 Stunden Vorlauf; während des Vorlaufs kann die erklärende Seite sie noch zurückziehen. Im Krieg entfällt die Schwachziel-Kürzung der Beute. Frieden gibt es, wenn beide Seiten ihn wollen.</P>
          <P>In der Börse findest du den <strong>Handel mit Spielern</strong>: Biete eine Ressource oder Taler gegen eine andere an, für alle oder nur für deine Allianz. Die Ware geht beim Einstellen in Treuhand und kommt beim Zurückziehen sofort zurück. Wer annimmt, zahlt sofort; Ressourcen reisen auf beiden Seiten per Konvoi nach Entfernung der Häfen, Taler kommen sofort. Je Seite wird eine kleine Gebühr einbehalten. Offene Angebote verfallen am Saisonende.</P>
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
        <BackButton onClick={onClose} />
      </div>
      {/* Schnellzugriff: Fehler melden gut sichtbar ganz oben */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <QuickButton onClick={requestBugReport} mark="!" title="Fehler melden" accent />
        <QuickButton onClick={() => setView("settings")} icon="zahnrad" title="Einstellungen" />
        <QuickButton onClick={() => setNews(true)} icon="uhr" title="Was ist neu?" />
      </div>
      {/* Sprungleiste: klebt oben, ein Tipp öffnet das Kapitel und springt hin. */}
      <nav className="sticky -top-3 z-10 -mx-3 mb-2 px-3 bg-paper border-b border-rule" aria-label="Kapitel">
        <HScroll className="gap-1.5" watch={open}>
          {chapters.map((c) => (
            // Tippfläche 44 px hoch, die Pille darin bleibt schmal.
            <button key={c.id} type="button" onClick={() => setOpen(c.id)} aria-current={open === c.id ? "true" : undefined} className="shrink-0 h-11 flex items-center">
              <span className={`h-8 flex items-center rounded-full border px-3 text-[12.5px] whitespace-nowrap ${open === c.id ? "bg-ink text-paper border-ink" : "bg-card text-ink2 border-rule"}`}>{c.title}</span>
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
