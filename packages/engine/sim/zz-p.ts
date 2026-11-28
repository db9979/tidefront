import { nestProbeOk, probe, strikeForce } from "../src/bots-war.ts";
import { nestDefenders, fleetTotals } from "@tidefront/game-core";
import { balance } from "../src/context.ts";
const st = { buildings: { kommandozentrale: Number(process.argv[3]) }, units: JSON.parse(process.argv[2]) } as never;
const f = strikeForce(st, 0, 0);
console.log(JSON.stringify(f), fleetTotals(f, balance).commandPointsUsed);
console.log("ok", nestProbeOk({ units: f }, { level: 6 }, 0, 12, 0.75));
console.log("worst", JSON.stringify(probe({ units: f }, nestDefenders(6, balance, "worst")[0], 12)));
