// Lektorat: Keine Kennung darf als Rohschlüssel bei Spielern ankommen. Jede ID aus der Balance (Gebäude, Einheiten,
// Anlagen, Techniken, Felder, Weltereignisse, Ressourcen, Sabotageziele) und jede Missionsart braucht einen deutschen
// Namen in den Namens-Tabellen der Oberfläche (apps/web/src/lib/names.ts, research.ts) und des Servers
// (packages/engine/src/names.ts); jeder Fehlercode aus Engine, Regelkern und API braucht einen Text in ERRORS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasErrorText, hasLabel } from "../../../apps/web/src/lib/names.ts";
import { BRANCHES, TECH, pathLabel, shy } from "../../../apps/web/src/lib/research.ts";
import { countName, countsText, hasName, nameOf, nOf } from "../../engine/src/names.ts";
import { loadBalance } from "./helpers.ts";

const balance = loadBalance() as unknown as Record<string, any>;
const root = fileURLToPath(new URL("../../../", import.meta.url));

/** Missionsarten aus der Typdefinition (MissionType in types.ts), damit neue Arten automatisch geprüft werden. */
function missionTypes(): string[] {
  const src = readFileSync(join(root, "packages/game-core/src/types.ts"), "utf8");
  const m = /export type MissionType =([\s\S]*?);/.exec(src);
  assert.ok(m, "MissionType nicht gefunden");
  return [...m[1].replace(/\/\/.*$/gm, "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

function ids(): Record<string, string[]> {
  return {
    Gebäude: Object.keys(balance.buildings),
    Einheiten: Object.keys(balance.units),
    "Kartell-Einheiten": Object.keys(balance.npcUnits ?? {}),
    Anlagen: Object.keys(balance.defenses ?? {}),
    Ressourcen: [...balance.resources, "credits"],
    Felder: Object.keys(balance.fields?.kinds ?? {}),
    Weltereignisse: Object.keys(balance.worldEvents?.kindWeights ?? {}),
    Sabotageziele: balance.espionage?.sabotage?.targets ?? [],
    Missionsarten: missionTypes(),
  };
}

test("Oberfläche: jede ID aus Balance und Missionsarten hat einen deutschen Namen", () => {
  for (const [what, list] of Object.entries(ids())) {
    const missing = list.filter((id: string) => !hasLabel(id));
    assert.deepEqual(missing, [], `${what} ohne Namen in apps/web/src/lib/names.ts`);
  }
  const techs = Object.keys(balance.research?.techs ?? {});
  assert.deepEqual(techs.filter((id) => !TECH[id]), [], "Techniken ohne Eintrag in apps/web/src/lib/research.ts TECH");
  const branches = new Set(BRANCHES.map((b) => b.id));
  assert.deepEqual((balance.research?.branches ?? []).filter((id: string) => !branches.has(id)), [], "Forschungszweige ohne Namen");
});

test("Server: jede ID aus Balance und Missionsarten hat einen deutschen Namen (Push, E-Mail, KI-Protokoll)", () => {
  const all = { ...ids(), Techniken: Object.keys(balance.research?.techs ?? {}) };
  for (const [what, list] of Object.entries(all)) {
    const missing = list.filter((id: string) => !hasName(id));
    assert.deepEqual(missing, [], `${what} ohne Namen in packages/engine/src/names.ts`);
  }
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Fehlercodes, wie sie Engine, Regelkern und API zurückgeben (GameError, fail, need, reject, { ok: false, code }). */
function errorCodes(): string[] {
  const codes = new Set<string>();
  const pattern = /(?:GameError|fail|need|reject)\("([a-z_]+)"|ok: false(?: as const)?, code: "([a-z_]+)"|\bneed\([^,()]+, "([a-z_]+)"\)/g;
  for (const dir of ["packages/engine/src", "packages/game-core/src", "apps/api/src"]) {
    for (const file of sourceFiles(join(root, dir))) {
      for (const m of readFileSync(file, "utf8").matchAll(pattern)) codes.add(m[1] ?? m[2] ?? m[3]);
    }
  }
  // Standardcode von need() in intel-ops.ts
  codes.add("bad_input");
  return [...codes].sort();
}

test("Jeder Fehlercode hat einen Text (sonst zeigt die Oberfläche „Abgelehnt (code).“)", () => {
  const codes = errorCodes();
  assert.ok(codes.length > 100, `nur ${codes.length} Codes gefunden – Muster prüfen`);
  assert.deepEqual(codes.filter((c) => !hasErrorText(c)), [], "Fehlercodes ohne Text in apps/web/src/lib/names.ts ERRORS");
});

test("Mehrzahl und Rückfall: Engine wie Oberfläche", () => {
  assert.equal(countName("korvette", 12), "Korvetten");
  assert.equal(countName("korvette", 1), "Korvette");
  assert.equal(countsText({ korvette: 12, landungsschiff: 1 }), "12 Korvetten, 1 Landungsschiff");
  assert.equal(nOf(1, "Sichtung", "Sichtungen"), "1 Sichtung");
  assert.equal(nOf(1200, "Sichtung", "Sichtungen"), "1.200 Sichtungen");
  assert.equal(nameOf("grossflotte"), "Großflotte");
  assert.equal(nameOf("unbekannte_kraeuterkueche"), "Unbekannte kräuterküche");
  assert.equal(pathLabel("attackUnit.korvette"), "Angriff Korvetten");
  assert.equal(pathLabel("trainingTime.nachrichtendienst"), "Ausbildungszeit Nachrichtendienst");
  assert.equal(shy("Chipfabrik"), "Chip­fabrik");
});
