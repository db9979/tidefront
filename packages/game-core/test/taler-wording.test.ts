// Sprachprüfung: Die Währung heißt für Spieler „Taler“ (Kurzform „T“), nicht „Kredite“ / „Kr“ (seit 0.35).
// Geprüft werden spielersichtbare Texte: Zeichenketten, Vorlagen und JSX-Text in Web, API und Engine (ohne
// Kommentare; Bezeichner wie credits/creditLimit treffen die Muster nicht), Texte der Balance und die Regelwerke docs/REGELN*.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const WORD = /[Kk]redit/;
const ABBR = /(?<![\p{L}\p{N}_])Kr(?![\p{L}\p{N}_])/u;

function bad(text: string): string | null {
  const m = WORD.exec(text) ?? ABBR.exec(text);
  return m ? m[0] : null;
}

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, ext));
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

/**
 * Quelltext ohne Kommentare (durch Leerzeichen ersetzt, Zeilen bleiben): Zeichenketten, Vorlagen, JSX-Text und Code
 * bleiben stehen. Bezeichner sind englisch (credits, creditLimit) und treffen die Muster nicht. Kleiner Lexer:
 * Zeichenketten, Vorlagen mit ${…}, Regex-Literale (nach Operator oder Klammer), Zeilen- und Blockkommentare.
 */
function stripComments(code: string): string {
  const out = code.split("");
  const blank = (a: number, b: number) => { for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " "; };
  const tpl: number[] = []; // offene ${ je Vorlage: Klammertiefe
  let i = 0;
  let prev = ""; // letztes bedeutsames Zeichen im Code (Regex-Erkennung)
  const inTemplate = () => {
    while (i < code.length) {
      const c = code[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { i++; return; }
      if (c === "$" && code[i + 1] === "{") { i += 2; tpl.push(0); return; }
      i++;
    }
  };
  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];
    if (c === "/" && n === "/") { const e = code.indexOf("\n", i); const j = e < 0 ? code.length : e; blank(i, j); i = j; continue; }
    if (c === "/" && n === "*") { const e = code.indexOf("*/", i + 2); const j = e < 0 ? code.length : e + 2; blank(i, j); i = j; continue; }
    if (c === "'" || c === '"') {
      i++;
      while (i < code.length && code[i] !== c && code[i] !== "\n") i += code[i] === "\\" ? 2 : 1;
      i++; prev = "a"; continue;
    }
    if (c === "`") { i++; inTemplate(); prev = "a"; continue; }
    if (c === "{" && tpl.length) tpl[tpl.length - 1]++;
    if (c === "}" && tpl.length) {
      if (tpl[tpl.length - 1] === 0) { tpl.pop(); i++; inTemplate(); prev = "a"; continue; }
      tpl[tpl.length - 1]--;
    }
    if (c === "/" && (prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev))) {
      i++;
      let cls = false;
      while (i < code.length && code[i] !== "\n" && (cls || code[i] !== "/")) {
        if (code[i] === "\\") i++;
        else if (code[i] === "[") cls = true;
        else if (code[i] === "]") cls = false;
        i++;
      }
      i++; prev = "a"; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join("");
}

function jsonStrings(v: unknown, path: string, out: { line: string; text: string }[]): void {
  if (typeof v === "string") out.push({ line: path, text: v });
  else if (Array.isArray(v)) v.forEach((x, i) => jsonStrings(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) jsonStrings(x, `${path}.${k}`, out);
}

test("Prüfer erkennt Kredite und Kr, aber keine Bezeichner und Kommentare", () => {
  const lines = stripComments('const creditLimit = 1; // Kredite\nconst u = "https://x" /* Kredite */;\nconst a = `${creditLimit} Kr`;\nconst e = <p>Zu wenig Kredite</p>; const k = "Kräftig";\nconst r = /["]/; // Kr\n').split("\n");
  assert.deepEqual(lines.map((l) => bad(l)), [null, null, "Kr", "Kredit", null, null]);
  assert.equal(bad("Kraftwerk, Krieg, 2.000 Taler, 5 T"), null);
});

test("spielersichtbare Texte nennen die Währung Taler (nicht Kredite / Kr)", () => {
  const hits: string[] = [];
  const dirs = ["apps/web/src", "apps/api/src", "apps/worker/src", "packages/engine/src"];
  for (const d of dirs) {
    for (const f of files(join(ROOT, d), /\.tsx?$/)) {
      stripComments(readFileSync(f, "utf8")).split("\n").forEach((l, i) => {
        const b = bad(l);
        if (b) hits.push(`${relative(ROOT, f)}:${i + 1}: „${b}“ in ${l.trim().slice(0, 100)}`);
      });
    }
  }
  const balance: { line: string; text: string }[] = [];
  jsonStrings(JSON.parse(readFileSync(join(ROOT, "packages/balance/v1/balance.json"), "utf8")), "balance", balance);
  for (const t of balance) if (bad(t.text)) hits.push(`balance.json ${t.line}: ${JSON.stringify(t.text)}`);
  for (const f of readdirSync(join(ROOT, "docs")).filter((n) => /^REGELN.*\.md$/.test(n))) {
    readFileSync(join(ROOT, "docs", f), "utf8").split("\n").forEach((l, i) => {
      if (bad(l)) hits.push(`docs/${f}:${i + 1}: ${l.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(hits, [], `„Kredite“/„Kr“ statt „Taler“/„T“:\n${hits.join("\n")}`);
});
