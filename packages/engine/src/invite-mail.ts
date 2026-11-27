// Einladungs-Mail an einen Freund (Stil „Seekarte“ über renderMail und MAIL_THEME, hell/dunkel, mit Textversion).
import type { MailContent } from "./mail-templates.ts";
import { publicUrl } from "./settings.ts";
import { gameTimeZone } from "@tidefront/game-core";

export interface InviteMailInput {
  code: string;
  inviterName: string;
  friendName: string | null;
  message: string | null;
  expiresAt: Date;
  blockToken: string | null;
}

function dateDe(d: Date): string {
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: gameTimeZone() });
}

export function inviteMail(i: InviteMailInput): MailContent {
  const base = publicUrl();
  const url = `${base}/?invite=${encodeURIComponent(i.code)}`;
  const paragraphs = [
    i.friendName ? `Hallo ${i.friendName},` : "Hallo,",
    `${i.inviterName} lädt dich zu TIDEFRONT ein und möchte dich als Mitspieler dabeihaben.`,
    "TIDEFRONT ist ein Strategiespiel im Browser für einen kleinen Freundeskreis: Du führst einen Hafen an der Küste von Nordatlantik oder Mittelmeer, baust Wirtschaft und Flotte auf, überfällst die Nester des Freibeuter-Kartells und misst dich in Saisons von einigen Wochen mit den anderen. Es läuft auf dem Handy, ohne Installation und ohne Kosten, und braucht nur ein paar Minuten am Tag.",
  ];
  if (i.message) paragraphs.push(`${i.inviterName} schreibt dir:`, `„${i.message}“`);
  paragraphs.push(`Tippe auf „Einladung annehmen“, wähle einen Namen und ein Passwort – der Einladungscode ist schon eingetragen. Du kannst ihn auch selbst auf ${base} unter „Registrieren“ eingeben.`);
  return {
    subject: `${i.inviterName} lädt dich ein`,
    heading: "Einladung in den Nordatlantik",
    paragraphs,
    facts: [
      ["Eingeladen von", i.inviterName],
      ["Einladungscode", i.code],
      ["Gültig bis", dateDe(i.expiresAt)],
    ],
    button: { label: "Einladung annehmen", url },
    footerNote: "Du kennst den Absender nicht? Ignoriere diese Mail – ohne Annahme passiert nichts, und die Einladung verfällt von selbst.",
    unsubscribeUrl: i.blockToken ? `${base}/api/mail/invite-block?t=${i.blockToken}` : undefined,
    unsubscribeLabel: "Keine Einladungen mehr an diese Adresse",
  };
}
