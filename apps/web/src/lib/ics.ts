// Kalenderdatei (iCalendar, RFC 5545) für „Erinnern“ ohne Push (UX-0.43 B8): ein Termin von 15 Minuten mit Alarm zur
// Startzeit. Funktioniert auch auf dem iPhone ohne Home-Bildschirm-App (Safari öffnet .ics im Kalender).

/** 20261128T135200Z */
export function icsTime(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Text für ein iCalendar-Feld: Backslash, Komma, Semikolon und Zeilenumbruch maskiert. */
export function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
}

export function icsEvent(e: { startMs: number; title: string; description: string; url?: string; nowMs?: number }): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TIDEFRONT//Besuch//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:tidefront-${e.startMs}@tidefront`,
    `DTSTAMP:${icsTime(e.nowMs ?? Date.now())}`,
    `DTSTART:${icsTime(e.startMs)}`,
    `DTEND:${icsTime(e.startMs + 15 * 60_000)}`,
    `SUMMARY:${icsText(e.title)}`,
    `DESCRIPTION:${icsText(e.description)}`,
    ...(e.url ? [`URL:${e.url}`] : []),
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(e.title)}`, "TRIGGER:PT0M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

/** Als Datei anbieten (Download bzw. „Im Kalender öffnen“). */
export function downloadIcs(name: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
