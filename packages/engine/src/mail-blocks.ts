// Bausteine für ausführliche E-Mails: Ergebnis-Banner, Kennzahlen-Kacheln, Abschnittstitel, Tabellen, Listen.
// Jeder Baustein hat eine HTML-Form (Tabellen-Layout, Inline-Styles, Klassen für Dunkelmodus) und eine Textform.
import type { MailTheme } from "./mail-templates.ts";

/** Färbung: Sieg (grün), Niederlage (siegelrot), Warnung (bernstein), Hinweis (tinte). */
export type Tone = "win" | "loss" | "warn" | "info";

/** Zelle einer Tabelle: Text oder Text mit Färbung/Hervorhebung. */
export type Cell = string | { v: string; tone?: Tone; bold?: boolean; muted?: boolean };

export type MailBlock =
  | { type: "banner"; tone: Tone; kicker?: string; title: string; sub?: string }
  | { type: "tiles"; tiles: { label: string; value: string; tone?: Tone }[] }
  | { type: "section"; title: string }
  | {
      type: "table";
      head: string[];
      rows: Cell[][];
      /** Ausrichtung je Spalte; Vorgabe: erste links, übrige rechts. */
      align?: ("left" | "right")[];
      /** Summenzeile (abgesetzt). */
      foot?: Cell[];
      /** Höchstzahl Zeilen (Vorgabe 20); weitere werden gekürzt und mit Hinweis erwähnt. */
      maxRows?: number;
      caption?: string;
    }
  | { type: "facts"; facts: [string, string][] }
  | { type: "list"; items: string[] }
  | { type: "text"; text: string; tone?: "muted" | Tone };

export const MAX_TABLE_ROWS = 20;

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const cellText = (c: Cell): string => (typeof c === "string" ? c : c.v);

function toneColors(t: MailTheme, tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case "win": return { fg: t.win, bg: t.winBg };
    case "loss": return { fg: t.loss, bg: t.lossBg };
    case "warn": return { fg: t.warn, bg: t.warnBg };
    default: return { fg: t.text, bg: t.infoBg };
  }
}

/** Zusätzliche Regeln im <style>-Block für den Dunkelmodus der Bausteine. */
export function blockDarkCss(t: MailTheme): string {
  return [
    `.tf-tone-win{background:${t.darkWinBg}!important;border-color:${t.darkWin}!important;} .tf-c-win{color:${t.darkWin}!important;}`,
    `.tf-tone-loss{background:${t.darkLossBg}!important;border-color:${t.darkLoss}!important;} .tf-c-loss{color:${t.darkLoss}!important;}`,
    `.tf-tone-warn{background:${t.darkWarnBg}!important;border-color:${t.darkWarn}!important;} .tf-c-warn{color:${t.darkWarn}!important;}`,
    `.tf-tone-info{background:${t.darkInfoBg}!important;border-color:${t.darkLine}!important;} .tf-c-info{color:${t.darkText}!important;}`,
    `.tf-tile{background:${t.darkFactBg}!important;border-color:${t.darkLine}!important;}`,
    `.tf-row-alt td{background:${t.darkStripe}!important;} .tf-tbl,.tf-tbl td,.tf-tbl th{border-color:${t.darkLine}!important;}`,
    `.tf-th{color:${t.darkMuted}!important;} .tf-foot td{background:${t.darkFactBg}!important;} .tf-rule{border-color:${t.darkLine}!important;}`,
  ].join("\n ");
}

function renderTable(b: Extract<MailBlock, { type: "table" }>, t: MailTheme): string {
  const max = b.maxRows ?? MAX_TABLE_ROWS;
  const rows = b.rows.slice(0, max);
  const cut = b.rows.length - rows.length;
  const align = (i: number) => b.align?.[i] ?? (i === 0 ? "left" : "right");
  const td = (c: Cell, i: number, extra = "") => {
    const o = typeof c === "string" ? { v: c } : c;
    const right = align(i) === "right";
    const color = o.tone ? toneColors(t, o.tone).fg : o.muted ? t.muted : t.text;
    const cls = o.tone ? `tf-c-${o.tone}` : o.muted ? "tf-muted" : "tf-text";
    const font = right ? "font-family:'IBM Plex Mono',Menlo,Consolas,monospace;font-size:14px;" : "font-size:14px;";
    return `<td class="${cls}" align="${right ? "right" : "left"}" valign="top" style="padding:7px 8px;${font}line-height:19px;color:${color};border-top:1px solid ${t.line};${o.bold ? "font-weight:700;" : ""}${right ? "white-space:nowrap;" : ""}${extra}">${escHtml(o.v)}</td>`;
  };
  const head = b.head.length
    ? `<tr>${b.head.map((h, i) => `<th class="tf-th" align="${align(i) === "right" ? "right" : "left"}" style="padding:6px 8px;font-size:11px;line-height:14px;letter-spacing:1px;text-transform:uppercase;font-weight:600;color:${t.muted};">${escHtml(h)}</th>`).join("")}</tr>`
    : "";
  const body = rows.map((r, k) => `<tr${k % 2 ? ` class="tf-row-alt"` : ""}>${r.map((c, i) => td(c, i, k % 2 ? `background:${t.stripe};` : "")).join("")}</tr>`).join("\n");
  const foot = b.foot ? `<tr class="tf-foot">${b.foot.map((c, i) => td(typeof c === "string" ? { v: c, bold: true } : { bold: true, ...c }, i, `background:${t.factBg};`)).join("")}</tr>` : "";
  const more = cut > 0
    ? `<tr><td colspan="${Math.max(1, b.head.length || (b.rows[0]?.length ?? 1))}" class="tf-muted" style="padding:7px 8px;font-size:12px;color:${t.muted};border-top:1px solid ${t.line};">… und ${cut} weitere ${cut === 1 ? "Zeile" : "Zeilen"} – vollständig im Spiel.</td></tr>`
    : "";
  const caption = b.caption ? `<div class="tf-muted" style="font-size:12px;line-height:17px;color:${t.muted};margin:0 0 4px 0;">${escHtml(b.caption)}</div>` : "";
  return `${caption}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tf-tbl" style="margin:0 0 16px 0;border:1px solid ${t.line};border-radius:${t.radius};border-collapse:separate;font-family:${t.font};">
${head}
${body}
${foot}${more}
</table>`;
}

function renderTiles(b: Extract<MailBlock, { type: "tiles" }>, t: MailTheme): string {
  const per = b.tiles.length === 4 ? 2 : Math.min(3, b.tiles.length);
  const rows: (typeof b.tiles)[] = [];
  for (let i = 0; i < b.tiles.length; i += per) rows.push(b.tiles.slice(i, i + per));
  const width = `${Math.floor(100 / per)}%`;
  const cell = (x: (typeof b.tiles)[number], last: boolean) => {
    const color = x.tone ? toneColors(t, x.tone).fg : t.text;
    return `<td width="${width}" valign="top" style="padding:0 ${last ? 0 : 8}px 8px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tf-tile" style="background:${t.factBg};border:1px solid ${t.line};border-radius:${t.radius};border-collapse:separate;"><tr><td style="padding:10px 12px;">
<div class="tf-muted" style="font-size:11px;line-height:14px;letter-spacing:1px;text-transform:uppercase;color:${t.muted};">${escHtml(x.label)}</div>
<div class="${x.tone ? `tf-c-${x.tone}` : "tf-text"}" style="margin-top:3px;font-family:'IBM Plex Mono',Menlo,Consolas,monospace;font-size:18px;line-height:23px;font-weight:700;color:${color};">${escHtml(x.value)}</div>
</td></tr></table></td>`;
  };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px 0;">
${rows.map((r) => `<tr>${r.map((x, i) => cell(x, i === r.length - 1)).join("")}${r.length < per ? `<td width="${width}"></td>`.repeat(per - r.length) : ""}</tr>`).join("\n")}
</table>`;
}

/** HTML eines Bausteins. */
export function blockHtml(b: MailBlock, t: MailTheme): string {
  switch (b.type) {
    case "banner": {
      const c = toneColors(t, b.tone);
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tf-tone-${b.tone}" style="margin:0 0 16px 0;background:${c.bg};border-left:5px solid ${c.fg};border-radius:${t.radius};"><tr><td style="padding:14px 16px;font-family:${t.font};">
${b.kicker ? `<div class="tf-c-${b.tone}" style="font-size:11px;line-height:14px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:${c.fg};">${escHtml(b.kicker)}</div>` : ""}
<div class="tf-c-${b.tone}" style="font-family:${t.headingFont};font-size:28px;line-height:33px;font-weight:600;color:${c.fg};margin-top:2px;">${escHtml(b.title)}</div>
${b.sub ? `<div class="tf-text" style="font-size:14px;line-height:20px;color:${t.text};margin-top:4px;">${escHtml(b.sub)}</div>` : ""}
</td></tr></table>`;
    }
    case "tiles":
      return b.tiles.length ? renderTiles(b, t) : "";
    case "section":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 8px 0;"><tr><td class="tf-text tf-rule" style="padding:0 0 5px 0;border-bottom:1px solid ${t.line};font-family:${t.headingFont};font-size:18px;line-height:23px;font-weight:600;color:${t.text};"><span class="tf-seal" style="color:${t.seal};font-size:12px;">&#9670;</span>&nbsp;${escHtml(b.title)}</td></tr></table>`;
    case "table":
      return renderTable(b, t);
    case "facts":
      return b.facts.length
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="tf-facts" style="margin:0 0 16px 0;background:${t.factBg};border:1px solid ${t.line};border-radius:${t.radius};border-collapse:separate;">
${b.facts.map(([k, v], i) => `<tr><td class="tf-muted" style="padding:8px 12px;font-size:13px;line-height:18px;color:${t.muted};${i ? `border-top:1px solid ${t.line};` : ""}">${escHtml(k)}</td><td class="tf-text" align="right" style="padding:8px 12px;font-size:14px;line-height:19px;font-weight:600;color:${t.text};${i ? `border-top:1px solid ${t.line};` : ""}">${escHtml(v)}</td></tr>`).join("\n")}
</table>`
        : "";
    case "list":
      return b.items.length
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;">
${b.items.map((s) => `<tr><td width="18" valign="top" class="tf-seal" style="padding:4px 0;color:${t.seal};font-size:12px;line-height:21px;">&#9670;</td><td class="tf-text" style="padding:4px 0;font-size:15px;line-height:21px;color:${t.text};">${escHtml(s)}</td></tr>`).join("\n")}
</table>`
        : "";
    case "text": {
      const tone = b.tone && b.tone !== "muted" ? b.tone : null;
      const color = tone ? toneColors(t, tone).fg : b.tone === "muted" ? t.muted : t.text;
      const cls = tone ? `tf-c-${tone}` : b.tone === "muted" ? "tf-muted" : "tf-text";
      const size = b.tone === "muted" ? "13px;line-height:19px" : "15px;line-height:22px";
      return `<p class="${cls}" style="margin:0 0 12px 0;font-size:${size};color:${color};">${escHtml(b.text)}</p>`;
    }
  }
}

/** Spalten auf gleiche Breite auffüllen (Textversion). */
function textTable(head: string[], rows: string[][], align: (i: number) => "left" | "right"): string[] {
  const all = head.length ? [head, ...rows] : rows;
  const w = all.reduce<number[]>((acc, r) => r.map((c, i) => Math.max(acc[i] ?? 0, c.length)), []);
  const line = (r: string[]) => r.map((c, i) => (align(i) === "right" ? c.padStart(w[i]) : c.padEnd(w[i]))).join("  ").trimEnd();
  return [...(head.length ? [line(head), w.map((n) => "-".repeat(n)).join("  ")] : []), ...rows.map(line)];
}

/** Textform eines Bausteins (Zeilen). */
export function blockText(b: MailBlock): string[] {
  switch (b.type) {
    case "banner":
      return [`${b.kicker ? `${b.kicker} – ` : ""}${b.title}`, ...(b.sub ? [b.sub] : []), ""];
    case "tiles":
      return [...b.tiles.map((x) => `${x.label}: ${x.value}`), ""];
    case "section":
      return [b.title, "-".repeat(Math.min(40, b.title.length))];
    case "table": {
      const max = b.maxRows ?? MAX_TABLE_ROWS;
      const rows = b.rows.slice(0, max).map((r) => r.map(cellText));
      if (b.foot) rows.push(b.foot.map(cellText));
      const align = (i: number) => b.align?.[i] ?? (i === 0 ? "left" : "right");
      const cut = b.rows.length - Math.min(b.rows.length, max);
      return [
        ...(b.caption ? [b.caption] : []),
        ...textTable(b.head, rows, align),
        ...(cut > 0 ? [`… und ${cut} weitere ${cut === 1 ? "Zeile" : "Zeilen"} – vollständig im Spiel.`] : []),
        "",
      ];
    }
    case "facts":
      return [...b.facts.map(([k, v]) => `${k}: ${v}`), ""];
    case "list":
      return [...b.items.map((s) => `- ${s}`), ""];
    case "text":
      return [b.text, ""];
  }
}
