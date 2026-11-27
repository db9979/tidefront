// Forschung in der Oberfläche: Namen, Texte, Symbole der Techniken und Wirkungen als lesbarer Text.
// Modifikatoren kommen vom Server (base.modifiers); hier wird nur angezeigt, nichts gerechnet, was zählt.
import type { BaseData } from "./trpc.ts";
import { countLabel, label } from "./names.ts";

export type Mods = BaseData["modifiers"];

export const BRANCHES: { id: string; name: string; icon: string }[] = [
  { id: "seefahrt", name: "Seefahrt", icon: "anker" },
  { id: "heer", name: "Heer", icon: "kampfpanzer" },
  { id: "luftfahrt", name: "Luftfahrt", icon: "abfangjaeger" },
  { id: "wirtschaft", name: "Wirtschaft", icon: "stahlwerk" },
  { id: "nachrichtendienst", name: "Nachrichtendienst", icon: "nachrichtendienst" },
  { id: "raumfahrt", name: "Raumfahrt", icon: "startrampe" }, // Lagebild Stufe 3
];

export const TECH: Record<string, { name: string; icon: string; text: string }> = {
  dampfturbinen: { name: "Dampfturbinen", icon: "turbine", text: "Leistungsstärkere Antriebe: alle Schiffe fahren schneller." },
  schiffspanzerung: { name: "Schiffspanzerung", icon: "panzerung", text: "Dickere Bordwände: Schiffe und U-Boote halten mehr aus." },
  sonar: { name: "Sonar", icon: "sonar", text: "Horchgeräte orten getauchte U-Boote: Wasserbomben treffen besser (U-Jagd)." },
  prisenrecht: { name: "Prisenrecht", icon: "transport", text: "Geübte Prisenkommandos: mehr Beute bei Überfällen auf Häfen (nicht bei Nestern)." },
  torpedoleitsysteme: { name: "Torpedoleitsysteme", icon: "torpedo", text: "Gelenkte Torpedos: U-Boote treffen härter." },
  infanteriewaffen: { name: "Infanteriewaffen", icon: "schuetzen", text: "Bessere Gewehre und Geschütze: Bodentruppen greifen stärker an." },
  drillausbildung: { name: "Drillausbildung", icon: "kaserne", text: "Straffer Drill: die Kaserne bildet schneller aus." },
  verbundpanzerung: { name: "Verbundpanzerung", icon: "kampfpanzer", text: "Schutzwesten und Verbundpanzer: Bodentruppen halten mehr aus." },
  pioniertechnik: { name: "Pioniertechnik", icon: "pioniere", text: "Minensucher und Räumgerät: Minensperren richten weniger Schaden an." },
  festungsbau: { name: "Festungsbau", icon: "bunkerlinie", text: "Stahlbeton und Erdwälle: Verteidigungsanlagen halten mehr aus." },
  tarnnetze: { name: "Tarnnetze", icon: "tarnnetz", text: "Ausguck und optische Satelliten erkennen deinen Hafen nur als Sichtung; Stufe 2 tarnt auch Felder und Radarposten." },
  funkmesstechnik: { name: "Funkmesstechnik", icon: "radarstation", text: "Empfindlichere Antennen: das Radar warnt früher vor Angriffen." },
  strahltriebwerke: { name: "Strahltriebwerke", icon: "abfangjaeger", text: "Schnellere Flugzeuge: Verbände nur aus Flugzeugen sind früher am Ziel." },
  luftkampftaktik: { name: "Luftkampftaktik", icon: "flakstellung", text: "Rotten und Sperrfeuer: Angriff gegen Luftziele steigt (Jäger, Flak, Bordflak)." },
  tarnanstrich: { name: "Tarnanstrich", icon: "tarnnetz", text: "Funkstille und Tarnung: das Ziel deiner Überfälle bemerkt dich später; fremde Sensoren sehen deine Flugzeuge 20 % je Stufe später." },
  praezisionsbomben: { name: "Präzisionsbomben", icon: "jagdbomber", text: "Bessere Zielgeräte: Jagdbomber treffen härter." },
  hochofen: { name: "Hochofen", icon: "stahlwerk", text: "Moderne Hochöfen: das Stahlwerk produziert mehr." },
  logistik: { name: "Logistik", icon: "zahnrad", text: "Bessere Stauung und Routen: weniger Treibstoff, mehr Ladung je Verband." },
  lagertechnik: { name: "Lagertechnik", icon: "lagerkomplex", text: "Hochregale: mehr Lagerplatz für jede Ressource." },
  fertigbau: { name: "Fertigbau", icon: "kran", text: "Vorgefertigte Teile: Gebäude werden schneller ausgebaut." },
  stahlbetonbunker: { name: "Stahlbetonbunker", icon: "tiefbunker", text: "Tiefere Bunker: mehr Ressourcen sind vor Plünderung geschützt." },
  verschluesselung: { name: "Verschlüsselung", icon: "nachrichtendienst", text: "Chiffren und Funkdisziplin: +1 Abwehr je Stufe gegen fremde Spione." },
  agentenschulung: { name: "Agentenschulung", icon: "spion", text: "Tarnidentitäten und Ausbildung: +1 auf den Erfolgswert eigener Spione je Stufe." },
  optischer_satellit: { name: "Optischer Satellit", icon: "satellit", text: "Start von der Startrampe: Erkennung in einem 600 km breiten Streifen alle 6 h, nicht unter Wolken. Ein Satellit gleichzeitig." },
  radarsatellit: { name: "Radarsatellit", icon: "satellit", text: "Sieht durch Wolken und Nebel, aber nur Sichtung (Verbände, Wracks). Erlaubt zwei Satelliten gleichzeitig." },
};

/**
 * Weiche Trennstellen (U+00AD) an den Wortfugen langer Namen: Safari trennt deutsch nach lang="de", andere Browser
 * nicht immer – so wird nie mitten in einer Silbe ohne Trennstrich umbrochen. Nur für die Anzeige.
 */
const FUGEN = [
  "Dampf|turbinen", "Schiffs|panzerung", "Prisen|recht", "Torpedo|leit|systeme", "Infanterie|waffen", "Drill|ausbildung",
  "Verbund|panzerung", "Pionier|technik", "Festungs|bau", "Funkmess|technik", "Strahl|triebwerke", "Luftkampf|taktik",
  "Tarn|anstrich", "Präzisions|bomben", "Lager|technik", "Stahlbeton|bunker", "Verschlüs|selung", "Agenten|schulung",
  "Hafen|kommandantur", "Kommando|zentrale", "Nachrichten|dienst", "Versorgungs|hof", "Lager|komplex", "Speicher|werk",
  "Radar|station", "Forschungs|amt", "Aufklärungs|drohne", "Landungs|schiff", "Kolonie|schiff", "Minen|räumer",
  "Minen|leger", "Abfang|jäger", "Jagd|bomber", "Kampf|panzer", "Küsten|batterie", "Flak|stellung", "Bunker|linie",
  "Start|rampe", "Stör|sender", "Radar|satellit", "Tarn|netze", "Chip|fabrik", "Tief|bunker", "Minen|sperre", "Piraten|miliz",
];
const FUGE = new Map(FUGEN.map((f) => [f.replaceAll("|", ""), f.replaceAll("|", "\u00AD")]));

/** Name mit weichen Trennstellen für enge Kacheln. */
export function shy(text: string): string {
  return FUGE.get(text) ?? text;
}

export function techName(id: string): string {
  return TECH[id]?.name ?? id;
}

const PATH_LABEL: Record<string, string> = {
  "speed.see": "Tempo Schiffe",
  "speed.luft": "Tempo Flugzeuge",
  "hp.see": "Lebenspunkte Schiffe",
  "hp.land": "Lebenspunkte Bodentruppen",
  "hp.luft": "Lebenspunkte Flugzeuge",
  "hp.anlage": "Lebenspunkte Anlagen",
  "attack.see": "Angriff Schiffe",
  "attack.land": "Angriff Bodentruppen",
  "attack.luft": "Angriff Flugzeuge",
  "attack.anlage": "Angriff Anlagen",
  "attackVs.uboot": "U-Jagd",
  "attackVs.luft": "Angriff gegen Luftziele",
  "attackVs.see": "Angriff gegen Schiffe",
  "attackVs.land": "Angriff gegen Bodentruppen",
  "attackVs.anlage": "Angriff gegen Anlagen",
  "attackUnit.uboot": "Angriff U-Boote",
  "attackUnit.jagdbomber": "Angriff Jagdbomber",
  "trainingTime.kaserne": "Ausbildungszeit Kaserne",
  "trainingTime.werft": "Bauzeit Werft",
  "trainingTime.flugfeld": "Ausbildungszeit Flugfeld",
  "trainingTime.anlagen": "Bauzeit Anlagen",
  "production.stahl": "Stahlproduktion",
  "production.treibstoff": "Treibstoffproduktion",
  "production.elektronik": "Elektronikproduktion",
  "production.proviant": "Proviantproduktion",
  mineDamage: "Schaden durch Minen",
  radarWarning: "Radar-Vorwarnzeit",
  stealth: "Vorwarnzeit des Gegners",
  loot: "Beute-Anteil",
  fuel: "Treibstoffverbrauch",
  cargo: "Ladekapazität",
  storage: "Lagerkapazität",
  buildTime: "Bauzeit Gebäude",
  bunker: "Bunkerschutz",
  researchTime: "Forschungsdauer",
  spyAttack: "Erfolgswert Spione",
  spyDefense: "Abwehr gegen Spione",
};

export function pathLabel(path: string): string {
  if (PATH_LABEL[path]) return PATH_LABEL[path];
  // Rückfall für Pfade ohne eigenen Text (z. B. Veteranen-Boni je Einheit): nie die Rohkennung zeigen.
  const [k, e] = path.split(".");
  if (k === "attackUnit" && e) return `Angriff ${countLabel(e, 2)}`;
  if (k === "trainingTime" && e) return `Ausbildungszeit ${label(e)}`;
  if (k === "speed" && e === "land") return "Tempo Bodentruppen";
  if (k === "production" && e) return `Produktion ${label(e)}`;
  return label(path.replace(/\./g, " "));
}

/** Faktor als Prozent mit Vorzeichen, z. B. „+8 %“ oder „−10 %“. */
export function pctText(factor: number, path?: string): string {
  // Spionage-Werte zählen in Würfelpunkten (Faktor 1,1 = +1), nicht in Prozent.
  if (path === "spyAttack" || path === "spyDefense") return `+${Math.round((factor - 1) * 10)} Punkte`;
  const p = Math.round((factor - 1) * 1000) / 10;
  return `${p >= 0 ? "+" : "−"}${String(Math.abs(p)).replace(".", ",")} %`;
}

/** Faktor eines Pfads in den Modifikatoren (1, wenn nicht gesetzt). */
export function modFactor(mods: Mods | null | undefined, path: string): number {
  if (!mods) return 1;
  const [k, e] = path.split(".");
  const v = (mods as Record<string, unknown>)[k];
  if (e === undefined) return typeof v === "number" ? v : 1;
  return (v as Record<string, number> | undefined)?.[e] ?? 1;
}

/** Hinweis für Info-Blätter, z. B. „+24 % durch Forschung“; null ohne Wirkung. */
export function researchNote(mods: Mods | null | undefined, path: string): string | null {
  const f = modFactor(mods, path);
  return Math.abs(f - 1) < 1e-9 ? null : `${pctText(f)} durch Forschung`;
}

/** Alle wirksamen Boni als Zeilen [Bezeichnung, Prozent]. */
export function modRows(mods: Mods | null | undefined): [string, string][] {
  const rows: [string, string][] = [];
  if (!mods) return rows;
  for (const [k, v] of Object.entries(mods)) {
    if (typeof v === "number") rows.push([pathLabel(k), pctText(v, k)]);
    else for (const [e, f] of Object.entries((v ?? {}) as Record<string, number>)) rows.push([pathLabel(`${k}.${e}`), pctText(f)]);
  }
  return rows;
}

/** Forschungsboni einer Einheit (Gattung und Typ) als Zeilen für ihr Info-Blatt. */
export function unitResearchRows(mods: Mods | null | undefined, branch: string, id: string): [string, string][] {
  const out: [string, string][] = [];
  const add = (labelText: string, path: string) => {
    const f = modFactor(mods, path);
    if (Math.abs(f - 1) > 1e-9) out.push([labelText, `${pctText(f)} durch Forschung`]);
  };
  add("Lebenspunkte", `hp.${branch}`);
  add("Angriff", `attack.${branch}`);
  add("Angriff", `attackUnit.${id}`);
  if (branch !== "anlage") add("Tempo", `speed.${branch}`);
  return out;
}

/** Wirkung einer Technik auf Stufe L als Text („Stahlproduktion +16 %“); Stufe 0: „noch keine Wirkung“. */
export function techEffectText(effects: { path: string; perLevel: number }[], level: number): string {
  if (level <= 0) return "noch keine Wirkung";
  return effects.map((e) => `${pathLabel(e.path)} ${pctText(1 + e.perLevel * level, e.path)}`).join(", ");
}

const ROMAN = ["0", "I", "II", "III", "IV", "V"];
export function roman(n: number): string {
  return ROMAN[n] ?? String(n);
}
