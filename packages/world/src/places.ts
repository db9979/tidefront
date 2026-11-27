// Küstenorte der Karte (reine Daten, Längengrad/Breitengrad) für die Namen neuer Häfen (Mehrere Häfen: Gründung).
// Ohne die Handelshäfen (TRADE_PORTS), damit ein Außenposten nicht wie ein Handelshafen heißt.
import { MAP_LABELS } from "./labels.ts";

export interface Place {
  name: string;
  lon: number;
  lat: number;
}

export const COAST_PLACES: readonly Place[] = [
  // Nordamerika
  { name: "Charleston", lon: -79.9, lat: 32.8 }, { name: "Myrtle Beach", lon: -78.9, lat: 33.7 }, { name: "Wilmington", lon: -77.9, lat: 34.2 }, { name: "Cape Hatteras", lon: -75.5, lat: 35.2 },
  { name: "Norfolk", lon: -76.3, lat: 36.9 }, { name: "Cape May", lon: -74.9, lat: 38.9 }, { name: "Montauk", lon: -71.9, lat: 41.0 },
  { name: "Boston", lon: -71.0, lat: 42.4 }, { name: "Portland", lon: -70.2, lat: 43.7 }, { name: "Bar Harbor", lon: -68.2, lat: 44.4 },
  { name: "Saint John", lon: -66.1, lat: 45.3 }, { name: "Yarmouth", lon: -66.1, lat: 43.8 }, { name: "Sydney", lon: -60.2, lat: 46.1 },
  { name: "Gaspé", lon: -64.5, lat: 48.8 }, { name: "Québec", lon: -71.2, lat: 46.8 }, { name: "Sept-Îles", lon: -66.4, lat: 50.2 },
  { name: "Charlottetown", lon: -63.1, lat: 46.2 }, { name: "St. John's", lon: -52.7, lat: 47.6 }, { name: "Corner Brook", lon: -57.9, lat: 48.9 },
  { name: "Goose Bay", lon: -60.4, lat: 53.3 }, { name: "Nain", lon: -61.7, lat: 56.5 }, { name: "Bermuda", lon: -64.8, lat: 32.3 },
  { name: "Nassau", lon: -77.3, lat: 25.1 },
  // Grönland, Island, Färöer
  { name: "Nuuk", lon: -51.7, lat: 64.2 }, { name: "Qaqortoq", lon: -46.0, lat: 60.7 }, { name: "Tasiilaq", lon: -37.6, lat: 65.6 },
  { name: "Sisimiut", lon: -53.7, lat: 66.9 }, { name: "Ilulissat", lon: -51.1, lat: 69.2 }, { name: "Ittoqqortoormiit", lon: -22.0, lat: 70.5 },
  { name: "Akureyri", lon: -18.1, lat: 65.7 }, { name: "Ísafjörður", lon: -23.1, lat: 66.1 }, { name: "Seyðisfjörður", lon: -14.0, lat: 65.3 },
  { name: "Vestmannaeyjar", lon: -20.3, lat: 63.4 }, { name: "Tórshavn", lon: -6.8, lat: 62.0 },
  // Britische Inseln
  { name: "Lerwick", lon: -1.1, lat: 60.2 }, { name: "Kirkwall", lon: -3.0, lat: 59.0 }, { name: "Stornoway", lon: -6.4, lat: 58.2 },
  { name: "Aberdeen", lon: -2.1, lat: 57.1 }, { name: "Leith", lon: -3.2, lat: 56.0 }, { name: "Newcastle", lon: -1.6, lat: 55.0 },
  { name: "Hull", lon: -0.3, lat: 53.7 }, { name: "Harwich", lon: 1.3, lat: 51.9 }, { name: "Dover", lon: 1.3, lat: 51.1 },
  { name: "Portsmouth", lon: -1.1, lat: 50.8 }, { name: "Plymouth", lon: -4.1, lat: 50.4 }, { name: "Falmouth", lon: -5.1, lat: 50.2 },
  { name: "Cardiff", lon: -3.2, lat: 51.5 }, { name: "Liverpool", lon: -3.0, lat: 53.4 }, { name: "Glasgow", lon: -4.3, lat: 55.9 },
  { name: "Belfast", lon: -5.9, lat: 54.6 }, { name: "Dublin", lon: -6.3, lat: 53.3 }, { name: "Cork", lon: -8.5, lat: 51.9 },
  { name: "Galway", lon: -9.1, lat: 53.3 },
  // Skandinavien
  { name: "Hammerfest", lon: 23.7, lat: 70.7 }, { name: "Tromsø", lon: 18.9, lat: 69.6 }, { name: "Narvik", lon: 17.4, lat: 68.4 },
  { name: "Bodø", lon: 14.4, lat: 67.3 }, { name: "Trondheim", lon: 10.4, lat: 63.4 }, { name: "Ålesund", lon: 6.2, lat: 62.5 },
  { name: "Bergen", lon: 5.3, lat: 60.4 }, { name: "Stavanger", lon: 5.7, lat: 59.0 }, { name: "Kristiansand", lon: 8.0, lat: 58.1 },
  { name: "Oslo", lon: 10.7, lat: 59.9 }, { name: "Göteborg", lon: 11.9, lat: 57.7 }, { name: "Malmö", lon: 13.0, lat: 55.6 },
  { name: "Karlskrona", lon: 15.6, lat: 56.2 }, { name: "Visby", lon: 18.3, lat: 57.6 }, { name: "Stockholm", lon: 18.1, lat: 59.3 },
  { name: "Sundsvall", lon: 17.3, lat: 62.4 }, { name: "Luleå", lon: 22.2, lat: 65.6 }, { name: "Oulu", lon: 25.5, lat: 65.0 },
  { name: "Vaasa", lon: 21.6, lat: 63.1 }, { name: "Turku", lon: 22.3, lat: 60.5 }, { name: "Helsinki", lon: 25.0, lat: 60.2 },
  { name: "Skagen", lon: 10.6, lat: 57.7 }, { name: "Esbjerg", lon: 8.5, lat: 55.5 }, { name: "Kopenhagen", lon: 12.6, lat: 55.7 },
  // Ostsee-Süd und Nordsee-Ost
  { name: "Kiel", lon: 10.1, lat: 54.3 }, { name: "Rostock", lon: 12.1, lat: 54.1 }, { name: "Stettin", lon: 14.6, lat: 53.4 },
  { name: "Danzig", lon: 18.6, lat: 54.4 }, { name: "Königsberg", lon: 20.5, lat: 54.7 }, { name: "Riga", lon: 24.1, lat: 57.0 },
  { name: "Tallinn", lon: 24.8, lat: 59.4 }, { name: "Sankt Petersburg", lon: 30.3, lat: 59.9 }, { name: "Bremerhaven", lon: 8.6, lat: 53.5 },
  { name: "Wilhelmshaven", lon: 8.1, lat: 53.5 }, { name: "Helgoland", lon: 7.9, lat: 54.2 }, { name: "Den Helder", lon: 4.8, lat: 52.9 },
  { name: "Antwerpen", lon: 4.4, lat: 51.2 }, { name: "Ostende", lon: 2.9, lat: 51.2 },
  // Frankreich, Iberien
  { name: "Calais", lon: 1.9, lat: 50.95 }, { name: "Le Havre", lon: 0.1, lat: 49.5 }, { name: "Cherbourg", lon: -1.6, lat: 49.6 },
  { name: "Saint-Malo", lon: -2.0, lat: 48.6 }, { name: "Brest", lon: -4.5, lat: 48.4 }, { name: "Lorient", lon: -3.4, lat: 47.7 },
  { name: "Saint-Nazaire", lon: -2.2, lat: 47.3 }, { name: "La Rochelle", lon: -1.2, lat: 46.2 }, { name: "Bordeaux", lon: -0.6, lat: 44.8 },
  { name: "Bayonne", lon: -1.5, lat: 43.5 }, { name: "Bilbao", lon: -2.9, lat: 43.3 }, { name: "Gijón", lon: -5.7, lat: 43.5 },
  { name: "A Coruña", lon: -8.4, lat: 43.4 }, { name: "Vigo", lon: -8.7, lat: 42.2 }, { name: "Porto", lon: -8.6, lat: 41.1 },
  { name: "Sines", lon: -8.9, lat: 37.95 }, { name: "Faro", lon: -7.9, lat: 37.0 }, { name: "Cádiz", lon: -6.3, lat: 36.5 },
  { name: "Málaga", lon: -4.4, lat: 36.7 }, { name: "Cartagena", lon: -1.0, lat: 37.6 }, { name: "Valencia", lon: -0.3, lat: 39.5 },
  { name: "Barcelona", lon: 2.2, lat: 41.4 }, { name: "Palma", lon: 2.65, lat: 39.6 }, { name: "Marseille", lon: 5.4, lat: 43.3 },
  { name: "Toulon", lon: 5.9, lat: 43.1 }, { name: "Nizza", lon: 7.3, lat: 43.7 }, { name: "Ajaccio", lon: 8.7, lat: 41.9 },
  // Atlantische Inseln, Nordafrika
  { name: "Ponta Delgada", lon: -25.7, lat: 37.7 }, { name: "Horta", lon: -28.6, lat: 38.5 }, { name: "Funchal", lon: -16.9, lat: 32.6 },
  { name: "Las Palmas", lon: -15.4, lat: 28.1 }, { name: "Santa Cruz", lon: -16.25, lat: 28.5 }, { name: "Agadir", lon: -9.6, lat: 30.4 },
  { name: "Essaouira", lon: -9.8, lat: 31.5 }, { name: "Rabat", lon: -6.8, lat: 34.0 }, { name: "Tanger", lon: -5.8, lat: 35.8 },
  { name: "Oran", lon: -0.6, lat: 35.7 }, { name: "Algier", lon: 3.1, lat: 36.8 }, { name: "Annaba", lon: 7.8, lat: 36.9 },
  { name: "Tunis", lon: 10.2, lat: 36.8 }, { name: "Sfax", lon: 10.8, lat: 34.7 }, { name: "Tripolis", lon: 13.2, lat: 32.9 },
  { name: "Bengasi", lon: 20.1, lat: 32.1 }, { name: "Tobruk", lon: 24.0, lat: 32.1 }, { name: "Alexandria", lon: 29.9, lat: 31.2 },
  { name: "Port Said", lon: 32.3, lat: 31.3 },
  // Italien, Adria, Griechenland, Levante
  { name: "La Spezia", lon: 9.8, lat: 44.1 }, { name: "Livorno", lon: 10.3, lat: 43.55 }, { name: "Neapel", lon: 14.25, lat: 40.85 },
  { name: "Cagliari", lon: 9.1, lat: 39.2 }, { name: "Palermo", lon: 13.35, lat: 38.1 }, { name: "Messina", lon: 15.55, lat: 38.2 },
  { name: "Tarent", lon: 17.2, lat: 40.5 }, { name: "Valletta", lon: 14.5, lat: 35.9 }, { name: "Bari", lon: 16.9, lat: 41.1 },
  { name: "Ancona", lon: 13.5, lat: 43.6 }, { name: "Venedig", lon: 12.3, lat: 45.4 }, { name: "Triest", lon: 13.8, lat: 45.65 },
  { name: "Split", lon: 16.4, lat: 43.5 }, { name: "Dubrovnik", lon: 18.1, lat: 42.65 }, { name: "Durrës", lon: 19.45, lat: 41.3 },
  { name: "Korfu", lon: 19.9, lat: 39.6 }, { name: "Patras", lon: 21.7, lat: 38.25 }, { name: "Thessaloniki", lon: 22.9, lat: 40.6 },
  { name: "Chania", lon: 24.0, lat: 35.5 }, { name: "Heraklion", lon: 25.1, lat: 35.3 }, { name: "Rhodos", lon: 28.2, lat: 36.45 },
  { name: "Izmir", lon: 27.1, lat: 38.4 }, { name: "Antalya", lon: 30.7, lat: 36.9 }, { name: "Mersin", lon: 34.6, lat: 36.8 },
  { name: "Famagusta", lon: 33.9, lat: 35.1 }, { name: "Beirut", lon: 35.5, lat: 33.9 }, { name: "Haifa", lon: 35.0, lat: 32.8 },
  { name: "Latakia", lon: 35.8, lat: 35.5 },
  // Marmara und Schwarzes Meer
  { name: "Istanbul", lon: 29.0, lat: 41.0 }, { name: "Varna", lon: 27.9, lat: 43.2 }, { name: "Constanța", lon: 28.65, lat: 44.2 },
  { name: "Odessa", lon: 30.7, lat: 46.5 }, { name: "Sewastopol", lon: 33.5, lat: 44.6 }, { name: "Noworossijsk", lon: 37.8, lat: 44.7 },
  { name: "Batumi", lon: 41.6, lat: 41.65 }, { name: "Trabzon", lon: 39.7, lat: 41.0 }, { name: "Samsun", lon: 36.3, lat: 41.3 },
  { name: "Sinop", lon: 35.15, lat: 42.0 },
  // Nordmeer, Spitzbergen-Weg
  { name: "Murmansk", lon: 33.1, lat: 68.97 }, { name: "Archangelsk", lon: 40.5, lat: 64.55 }, { name: "Jan Mayen", lon: -8.5, lat: 71.0 },
];

const RAD = Math.PI / 180;

function km(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const s = Math.sin(((b.lat - a.lat) * RAD) / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(((b.lon - a.lon) * RAD) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Nächster Küstenort zu einem Punkt (Länge/Breite) mit Entfernung in km. */
export function nearestPlace(p: { lon: number; lat: number }): { name: string; distanceKm: number } {
  let best = { name: "", distanceKm: Infinity };
  for (const q of COAST_PLACES) {
    const d = km(p, q);
    if (d < best.distanceKm) best = { name: q.name, distanceKm: d };
  }
  return best;
}

/** Nächste Kartenbeschriftung (Meer oder Region) zu einem Punkt. */
export function nearestLabel(p: { lon: number; lat: number }): { name: string; distanceKm: number } {
  let best = { name: "", distanceKm: Infinity };
  for (const q of MAP_LABELS) {
    const d = km(p, q);
    if (d < best.distanceKm) best = { name: q.name, distanceKm: d };
  }
  return best;
}

/** Ortsnah: bis hier heißt der Hafen wie der Ort, danach „Küste bei <Ort>“. */
export const PLACE_NEAR_KM = 120;
/** Weiter entfernt als hier: Name nach der nächsten Kartenbeschriftung („Posten <Meer/Region>“). */
export const PLACE_FAR_KM = 450;

/**
 * Vorschlag für den Namen eines Hafens an einem Punkt: Ortsname (≤ 120 km), „Küste bei <Ort>“ (≤ 450 km),
 * sonst „Posten <Meer/Region>“; null, wenn nichts in der Nähe liegt.
 */
export function placeNameAt(p: { lon: number; lat: number }): string | null {
  const place = nearestPlace(p);
  if (place.distanceKm <= PLACE_NEAR_KM) return place.name;
  if (place.distanceKm <= PLACE_FAR_KM) return `Küste bei ${place.name}`;
  const label = nearestLabel(p);
  return label.name ? `Posten ${label.name}` : null;
}
