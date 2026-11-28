// Eine Zählung für „Meldungen“ (UX 0.43, A8 / N-4): die Zahl an der Navigation und die Zeile in der Lage nennen
// dieselben Posten – ungelesene Berichte und ungelesene Post. Allianz-Chat zählt ausdrücklich NICHT mit (er hat im
// Reiter Allianz seine eigene Markierung; sonst stiege die Zahl bei jeder Chatzeile).

/** Gesamtzahl für das Navigationszeichen. */
export function meldungenCount(reports: number, messages: number): number {
  return Math.max(0, reports) + Math.max(0, messages);
}

/** Zeile der Lage („1 neuer Bericht · 2 neue Nachrichten“); null, wenn nichts Neues da ist. */
export function meldungenText(reports: number, messages: number): string | null {
  const parts: string[] = [];
  if (reports > 0) parts.push(reports === 1 ? "1 neuer Bericht" : `${reports} neue Berichte`);
  if (messages > 0) parts.push(messages === 1 ? "1 neue Nachricht" : `${messages} neue Nachrichten`);
  return parts.length ? parts.join(" · ") : null;
}
