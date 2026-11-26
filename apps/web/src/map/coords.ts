// Formatierung von Koordinaten (ohne PixiJS, damit die Karte nachgeladen bleibt).
export function fmtLat(lat: number): string {
  return `${Math.abs(lat)}°${lat >= 0 ? "N" : "S"}`;
}
export function fmtLon(lon: number): string {
  return `${String(Math.abs(lon)).padStart(3, "0")}°${lon < 0 ? "W" : "E"}`;
}

/** Grad, Minute und Halbkugel, z. B. 48°24'N 004°28'W. */
export function fmtPosition(lat: number, lon: number): string {
  const dm = (v: number, pad: number) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = Math.round((a - d) * 60);
    return `${String(d).padStart(pad, "0")}°${String(m === 60 ? 59 : m).padStart(2, "0")}'`;
  };
  return `${dm(lat, 2)}${lat >= 0 ? "N" : "S"} ${dm(lon, 3)}${lon < 0 ? "W" : "E"}`;
}
