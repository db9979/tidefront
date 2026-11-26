// Beschriftungen und Schnellwahl-Regionen der Karte (reine Daten, Längengrad/Breitengrad).

export interface MapLabel {
  name: string;
  lon: number;
  lat: number;
  /** "sea" für Meere (kursiv, blau), "region" für Länder und Regionen (Versal). */
  kind: "sea" | "region";
  /** Relative Größe: 1 = normal, 1.6 = Ozean. */
  size: number;
}

export const MAP_LABELS: readonly MapLabel[] = [
  { name: "Nordatlantik", lon: -38, lat: 47, kind: "sea", size: 1.7 },
  { name: "Labradorsee", lon: -55, lat: 58.5, kind: "sea", size: 1.1 },
  { name: "Grönlandsee", lon: -12, lat: 70.5, kind: "sea", size: 1 },
  { name: "Europäisches Nordmeer", lon: 2, lat: 67, kind: "sea", size: 1.1 },
  { name: "Nordsee", lon: 3, lat: 56, kind: "sea", size: 1 },
  { name: "Ostsee", lon: 19.5, lat: 57, kind: "sea", size: 0.9 },
  { name: "Biskaya", lon: -5.5, lat: 45.3, kind: "sea", size: 0.9 },
  { name: "Mittelmeer", lon: 18, lat: 34.5, kind: "sea", size: 1.3 },
  { name: "Tyrrhenisches Meer", lon: 12, lat: 39.8, kind: "sea", size: 0.75 },
  { name: "Ägäis", lon: 25, lat: 38.8, kind: "sea", size: 0.75 },
  { name: "Schwarzes Meer", lon: 34, lat: 43.3, kind: "sea", size: 0.9 },
  { name: "Sargassosee", lon: -62, lat: 28, kind: "sea", size: 1.1 },
  { name: "Golf von St. Lorenz", lon: -61.5, lat: 48.6, kind: "sea", size: 0.7 },
  { name: "Grönland", lon: -42, lat: 66.5, kind: "region", size: 1.1 },
  { name: "Island", lon: -19, lat: 64.9, kind: "region", size: 0.85 },
  { name: "Nordamerika", lon: -73, lat: 44, kind: "region", size: 1.2 },
  { name: "Labrador", lon: -64, lat: 54, kind: "region", size: 0.85 },
  { name: "Neufundland", lon: -56, lat: 48.8, kind: "region", size: 0.7 },
  { name: "Britische Inseln", lon: -3.5, lat: 53.3, kind: "region", size: 0.8 },
  { name: "Skandinavien", lon: 14.5, lat: 63.5, kind: "region", size: 1 },
  { name: "Iberien", lon: -4.2, lat: 40, kind: "region", size: 0.95 },
  { name: "Frankreich", lon: 2.5, lat: 46.8, kind: "region", size: 0.9 },
  { name: "Mitteleuropa", lon: 13, lat: 50.5, kind: "region", size: 0.9 },
  { name: "Italien", lon: 13.5, lat: 42.6, kind: "region", size: 0.75 },
  { name: "Balkan", lon: 22, lat: 43, kind: "region", size: 0.8 },
  { name: "Anatolien", lon: 33, lat: 39, kind: "region", size: 0.85 },
  { name: "Nordafrika", lon: 4, lat: 29, kind: "region", size: 1.2 },
  { name: "Levante", lon: 38, lat: 33, kind: "region", size: 0.75 },
  { name: "Osteuropa", lon: 30, lat: 54, kind: "region", size: 1 },
];

export interface QuickPick {
  name: string;
  hint: string;
  lon: number;
  lat: number;
}

/** Vorschläge für die Wahl des ersten Küstenfelds. */
export const QUICK_PICKS: readonly QuickPick[] = [
  { name: "Bretagne", hint: "zwischen Atlantik und Ärmelkanal", lon: -4.4, lat: 48.4 },
  { name: "Cornwall", hint: "Südwestspitze Englands", lon: -5.2, lat: 50.2 },
  { name: "Norwegen", hint: "Fjorde am Nordmeer", lon: 5.3, lat: 60.4 },
  { name: "Dänemark", hint: "Tor zur Ostsee", lon: 8.3, lat: 56.5 },
  { name: "Biskaya", hint: "Nordküste Spaniens", lon: -3.8, lat: 43.4 },
  { name: "Portugal", hint: "nahe Lissabon", lon: -9.2, lat: 39.5 },
  { name: "Sizilien", hint: "Mitte des Mittelmeers", lon: 13.5, lat: 37.9 },
  { name: "Neuengland", hint: "Ostküste Nordamerikas", lon: -70.5, lat: 42.5 },
];
