// E-Mail-Vorlagen: tabellenbasiert mit Inline-CSS, hell und dunkel, mit Textversion.
// Das Erscheinungsbild hängt nur an MAIL_THEME; ein neues Design ändert hier Farben und Schrift.
import { blockDarkCss, blockHtml, blockText, type MailBlock } from "./mail-blocks.ts";
export type { Cell, MailBlock, Tone } from "./mail-blocks.ts";

export const MAIL_THEME = {
  brand: "TIDEFRONT",
  tagline: "Nordatlantik · Mittelmeer",
  /** Stil „Seekarte“: Papier, marineblaue Tinte, Siegelrot. Schriften nur als Wunsch, Rückfall auf Systemschriften. */
  font: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  headingFont: "Fraunces, Georgia, 'Times New Roman', serif",
  radius: "4px",
  /** Hell */
  page: "#f4eee1",
  panel: "#fffdf8",
  text: "#18273a",
  muted: "#4f5b69",
  line: "#d5cab2",
  header: "#18273a",
  headerText: "#f4eee1",
  headerMuted: "#c9cfd6",
  /** Knopf: Tinte mit Papierschrift */
  accent: "#18273a",
  accentText: "#f4eee1",
  /** Siegelrot für Aufzählungszeichen und Kennlinie */
  seal: "#a8331f",
  factBg: "#f7f2e7",
  /** Dunkel (prefers-color-scheme: dark) */
  darkPage: "#11161d",
  darkPanel: "#18202a",
  darkText: "#ede6d6",
  darkMuted: "#a9b2bd",
  darkLine: "#2e3946",
  darkFactBg: "#141b24",
  darkAccent: "#ede6d6",
  darkAccentText: "#11161d",
  darkSeal: "#e58a73",
  /** Ergebnisfarben (Banner, Kacheln, Zellen): Schrift kräftig, Grund hell getönt; dunkel umgekehrt. */
  win: "#2d6a3a",
  winBg: "#e5efe1",
  loss: "#a8331f",
  lossBg: "#f7e3dd",
  warn: "#8a5800",
  warnBg: "#f8ecd0",
  infoBg: "#ebeee9",
  /** Abgesetzte Tabellenzeilen. */
  stripe: "#faf6ed",
  darkWin: "#9fd3a8",
  darkWinBg: "#142619",
  darkLoss: "#f0a08c",
  darkLossBg: "#2d1612",
  darkWarn: "#e8c27a",
  darkWarnBg: "#2a2110",
  darkInfoBg: "#1a2430",
  darkStripe: "#1d2733",
};

export type MailTheme = typeof MAIL_THEME;

export interface MailContent {
  /** Betreff; ohne Spielnamen (wird vorangestellt). */
  subject: string;
  heading: string;
  /** Absätze. */
  paragraphs: string[];
  /** Kennzahlen als Paare (Bezeichnung, Wert). */
  facts?: [string, string][];
  /** Aufzählung (z. B. gebündelte Meldungen). */
  items?: string[];
  /** Ausführlicher Inhalt (Banner, Kacheln, Tabellen …), steht nach den Absätzen und vor facts/items. */
  blocks?: MailBlock[];
  /** Vorschauzeile im Posteingang; Vorgabe: erster Absatz bzw. Überschrift. */
  preheader?: string;
  button?: { label: string; url: string };
  /** Zusätzlicher Link unter dem Knopf (z. B. „Im Kampfsimulator öffnen“). */
  link?: { label: string; url: string };
  /** Abmeldelink in der Fußzeile; fehlt er, steht dort nur der Hinweis. */
  unsubscribeUrl?: string;
  /** Beschriftung des Links in der Fußzeile; Vorgabe „E-Mail-Benachrichtigungen abbestellen“. */
  unsubscribeLabel?: string;
  footerNote?: string;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderMail(c: MailContent, theme: MailTheme = MAIL_THEME): RenderedMail {
  const t = theme;
  const subject = `${t.brand}: ${c.subject}`;
  const p = (s: string) =>
    `<p class="tf-text" style="margin:0 0 14px 0;font-size:16px;line-height:24px;color:${t.text};">${esc(s)}</p>`;
  const facts = (c.facts ?? []).length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tf-facts" style="margin:6px 0 18px 0;background:${t.factBg};border:1px solid ${t.line};border-radius:${t.radius};border-collapse:separate;">
${(c.facts ?? []).map(([k, v], i) => `<tr><td class="tf-muted" style="padding:10px 14px;font-size:13px;color:${t.muted};${i ? `border-top:1px solid ${t.line};` : ""}">${esc(k)}</td><td class="tf-text" align="right" style="padding:10px 14px;font-family:'IBM Plex Mono',Menlo,Consolas,monospace;font-size:15px;font-weight:600;color:${t.text};${i ? `border-top:1px solid ${t.line};` : ""}">${esc(v)}</td></tr>`).join("\n")}
</table>`
    : "";
  const items = (c.items ?? []).length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px 0;">
${(c.items ?? []).map((s) => `<tr><td width="18" valign="top" class="tf-seal" style="padding:4px 0;color:${t.seal};font-size:13px;line-height:22px;">&#9670;</td><td class="tf-text" style="padding:4px 0;font-size:15px;line-height:22px;color:${t.text};">${esc(s)}</td></tr>`).join("\n")}
</table>`
    : "";
  const blocks = (c.blocks ?? []).map((b) => blockHtml(b, t)).filter(Boolean).join("\n");
  const button = c.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px 0;"><tr><td class="tf-btn" style="border-radius:${t.radius};background:${t.accent};">
<a href="${esc(c.button.url)}" class="tf-btn-a" style="display:inline-block;padding:14px 26px;font-size:14px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${t.accentText};text-decoration:none;border-radius:${t.radius};font-family:${t.font};">${esc(c.button.label)}</a>
</td></tr></table>`
    : "";
  const link = c.link
    ? `<p style="margin:10px 0 0 0;font-size:14px;line-height:20px;"><a href="${esc(c.link.url)}" class="tf-text" style="color:${t.text};text-decoration:underline;font-weight:600;">${esc(c.link.label)} &#8250;</a></p>`
    : "";
  const footer = [
    c.footerNote ? esc(c.footerNote) : "Du erhältst diese Nachricht, weil du E-Mail-Benachrichtigungen für TIDEFRONT eingeschaltet hast.",
    c.unsubscribeUrl ? `<a href="${esc(c.unsubscribeUrl)}" class="tf-muted" style="color:${t.muted};text-decoration:underline;">${esc(c.unsubscribeLabel ?? "E-Mail-Benachrichtigungen abbestellen")}</a>` : "",
  ].filter(Boolean).join("<br>");

  const html = `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark;}
@media (prefers-color-scheme: dark){
 .tf-page{background:${t.darkPage}!important;} .tf-panel{background:${t.darkPanel}!important;}
 .tf-text{color:${t.darkText}!important;} .tf-muted{color:${t.darkMuted}!important;}
 .tf-facts{background:${t.darkFactBg}!important;border-color:${t.darkLine}!important;} .tf-facts td{border-color:${t.darkLine}!important;}
 .tf-btn{background:${t.darkAccent}!important;} .tf-btn-a{color:${t.darkAccentText}!important;} .tf-seal{color:${t.darkSeal}!important;}
 .tf-panel{border-color:${t.darkLine}!important;}
 ${blockDarkCss(t)}
}
@media only screen and (max-width:620px){ .tf-wrap{width:100%!important;} .tf-pad{padding:20px 16px!important;} .tf-h1{font-size:22px!important;line-height:28px!important;} }
@media only screen and (max-width:480px){ .tf-tag{display:none!important;} }
</style></head>
<body class="tf-page" style="margin:0;padding:0;background:${t.page};font-family:${t.font};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(c.preheader ?? c.paragraphs[0] ?? c.heading)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tf-page" style="background:${t.page};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" class="tf-wrap" style="width:600px;max-width:600px;">
<tr><td style="background:${t.header};border-radius:${t.radius} ${t.radius} 0 0;padding:18px 28px;font-family:${t.font};">
<span style="font-family:${t.headingFont};font-size:19px;font-weight:600;letter-spacing:5px;color:${t.headerText};">${esc(t.brand)}</span>
<span class="tf-tag" style="font-size:12px;color:${t.headerMuted};padding-left:10px;">${esc(t.tagline)}</span>
</td></tr>
<tr><td style="background:${t.header};padding:0 28px 12px 28px;font-size:0;line-height:0;"><div style="border-top:3px double ${t.headerText};opacity:0.55;">&nbsp;</div></td></tr>
<tr><td class="tf-panel tf-pad" style="background:${t.panel};padding:28px;border:1px solid ${t.line};border-top:0;border-left:4px solid ${t.seal};border-radius:0 0 ${t.radius} ${t.radius};font-family:${t.font};">
<h1 class="tf-text tf-h1" style="margin:0 0 14px 0;font-family:${t.headingFont};font-size:25px;line-height:31px;font-weight:600;color:${t.text};">${esc(c.heading)}</h1>
${c.paragraphs.map(p).join("\n")}
${blocks}
${facts}
${items}
${button}
${link}
</td></tr>
<tr><td class="tf-muted" style="padding:18px 28px;font-size:12px;line-height:18px;color:${t.muted};font-family:${t.font};" align="center">${footer}</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    t.brand,
    "",
    c.heading,
    "",
    ...c.paragraphs.flatMap((s) => [s, ""]),
    ...(c.blocks ?? []).flatMap((b) => blockText(b)),
    ...(c.facts ?? []).map(([k, v]) => `${k}: ${v}`),
    ...((c.facts ?? []).length ? [""] : []),
    ...(c.items ?? []).map((s) => `- ${s}`),
    ...((c.items ?? []).length ? [""] : []),
    ...(c.button ? [`${c.button.label}: ${c.button.url}`, ""] : []),
    ...(c.link ? [`${c.link.label}: ${c.link.url}`, ""] : []),
    "--",
    c.footerNote ?? "Du erhältst diese Nachricht, weil du E-Mail-Benachrichtigungen für TIDEFRONT eingeschaltet hast.",
    ...(c.unsubscribeUrl ? [`${c.unsubscribeLabel ?? "Abbestellen"}: ${c.unsubscribeUrl}`] : []),
  ].join("\n");

  return { subject, html, text };
}
