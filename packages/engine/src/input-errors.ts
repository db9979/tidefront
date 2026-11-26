// Eingabefehler (Zod-Prüfung im API-Router, HTTP 400) als deutsche Kurztexte für die Oberfläche.

/** Ausschnitt eines Zod-Befunds; bewusst ohne Zod-Typen, damit die Funktion rein bleibt. */
export interface InputIssue {
  code: string;
  path: readonly PropertyKey[];
  minimum?: number | bigint;
  maximum?: number | bigint;
  origin?: string;
  expected?: string;
  format?: string;
}

const FIELDS: Record<string, string> = {
  name: "Name", password: "Passwort", oldPassword: "Bisheriges Passwort", newPassword: "Neues Passwort",
  inviteCode: "Einladungscode", code: "Code", email: "E-Mail-Adresse", subject: "Betreff", body: "Text", message: "Nachricht",
  qty: "Menge", count: "Anzahl", units: "Einheiten", cargo: "Ladung", col: "Feld", row: "Feld", maxUses: "Nutzungen",
  maxOpen: "Offene Einladungen", maxWeek: "Einladungen je Woche", days: "Tage", host: "Server (Host)", port: "Port",
  user: "Benutzer", fromAddress: "Absenderadresse", fromName: "Absendername", startHour: "Startstunde",
  nightShieldStartHour: "Startstunde", tzOffsetMinutes: "Zeitzone", minuteOfDay: "Uhrzeit", timeZone: "Zeitzone",
  expectedPrice: "Kurs", targetLevel: "Stufe", toPlayerId: "Empfänger", playerId: "Spieler", resource: "Ressource",
};

const num = (n: number | bigint) => Number(n).toLocaleString("de-DE");

/** Feldname zum Pfad: der innerste bekannte Schlüssel (bei Zuordnungen wie Einheiten der Behälter). */
function fieldName(path: readonly PropertyKey[]): string {
  for (let i = path.length - 1; i >= 0; i--) {
    const k = path[i];
    if (typeof k === "string" && FIELDS[k]) return FIELDS[k];
  }
  return "Eingabe";
}

/** Ein Befund als Satz, z. B. „Name zu lang (höchstens 32 Zeichen).“ */
export function inputIssueText(issue: InputIssue): string {
  const f = fieldName(issue.path);
  const text = issue.origin === "string" || issue.origin === "array";
  const unit = issue.origin === "array" ? "Einträge" : "Zeichen";
  switch (issue.code) {
    case "too_big":
      if (text) return `${f} zu lang (höchstens ${num(issue.maximum ?? 0)} ${unit}).`;
      return `${f} zu groß (höchstens ${num(issue.maximum ?? 0)}).`;
    case "too_small":
      if (text) return Number(issue.minimum ?? 0) <= 1 ? `${f} fehlt.` : `${f} zu kurz (mindestens ${num(issue.minimum ?? 0)} ${unit}).`;
      return `${f} zu klein (mindestens ${num(issue.minimum ?? 0)}).`;
    case "invalid_type":
      if (issue.expected === "int" || issue.expected === "number") return `${f}: bitte eine ganze Zahl eingeben.`;
      return `${f} fehlt oder ist ungültig.`;
    case "invalid_format":
      if (issue.format === "email") return "Bitte eine gültige E-Mail-Adresse eingeben.";
      return `${f} enthält unerlaubte Zeichen.`;
    case "not_multiple_of":
      return `${f}: nur ganze Zahlen.`;
    case "invalid_value":
      return `${f}: ungültige Auswahl.`;
    default:
      return `${f} ist ungültig.`;
  }
}

/** Erster Befund als Text (ein Satz reicht für ein Formular); null ohne Befund. */
export function inputErrorText(issues: readonly InputIssue[] | undefined): string | null {
  if (!issues || issues.length === 0) return null;
  return inputIssueText(issues[0]);
}
