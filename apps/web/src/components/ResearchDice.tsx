// Durchbruch-Würfel: kurze W100-Animation beim Abschluss einer Forschung (ohne Bewegung bei
// prefers-reduced-motion), Ergebnis und bei Durchbruch die Wahl der Belohnung.
import { useEffect, useState } from "react";
import { trpc, trpcClient, type BaseData } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { techName } from "../lib/research.ts";
import { Icon } from "../icons.tsx";
import { Button, ErrorLine, Sheet } from "../ui.tsx";

type Research = NonNullable<BaseData["research"]>;
type Roll = NonNullable<Research["lastRoll"]>;

const SEEN_KEY = "tf-research-roll-seen";
const two = (n: number) => (n === 100 ? "100" : String(n).padStart(2, "0"));

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Der Wurf: rollt kurz durch (rein optisch) und bleibt auf dem gespeicherten Ergebnis stehen. */
export function DiceRoll({ roll, animate }: { roll: Roll; animate: boolean }) {
  const [shown, setShown] = useState(animate && !reducedMotion() ? 0 : roll.roll);
  const rolling = shown !== roll.roll;
  useEffect(() => {
    if (!animate || reducedMotion()) return;
    const start = Date.now();
    const t = setInterval(() => {
      if (Date.now() - start > 900) {
        setShown(roll.roll);
        clearInterval(t);
      } else setShown(1 + Math.floor(Math.random() * 100));
    }, 70);
    return () => clearInterval(t);
  }, [animate, roll.roll]);
  const threshold = Math.round(roll.chance * 100);
  return (
    <div className="flex items-center gap-3 rounded-xl bg-paper border-[3px] border-double border-ink p-3" aria-live="polite">
      <Icon id="wuerfel" size={52} className={rolling ? "animate-spin motion-reduce:animate-none" : ""} />
      <div className="min-w-0">
        <div className="font-display text-[11px] uppercase tracking-[0.2em] text-ink2">Prozentwurf W100 · Durchbruch bei 01–{two(threshold)}</div>
        {rolling ? (
          <div className="mono text-2xl">Wurf {two(shown)} …</div>
        ) : (
          <div className={`font-serif text-xl ${roll.breakthrough ? "text-siegel" : ""}`}>
            Wurf <span className="mono">{two(roll.roll)}</span> – {roll.breakthrough ? "Durchbruch!" : "kein Durchbruch"}
          </div>
        )}
        <div className="text-xs text-ink2">{techName(roll.techId)} Stufe {roll.level}</div>
      </div>
    </div>
  );
}

/** Wahl der Belohnung nach einem Durchbruch (a: eine Stufe mehr, b: nächste Forschung halb so lang). */
export function BreakthroughChoice({ research, onDone }: { research: Research; onDone?: () => void }) {
  const cmd = useCommand((i: { key: string; choice: "level" | "speed" }) => trpcClient.research.choose.mutate(i), () => [trpc.base.pathFilter().queryKey]);
  const roll = research.lastRoll;
  if (!roll || !research.pendingChoice) return null;
  const tech = techName(roll.techId);
  const pick = async (choice: "level" | "speed") => {
    const r = await cmd.run({ choice });
    if (r?.ok) onDone?.();
  };
  return (
    <div className="mt-3">
      <p className="text-sm mb-2">Wähle deine Belohnung:</p>
      <div className="grid grid-cols-2 gap-2">
        <Button disabled={cmd.busy} onClick={() => void pick("level")}>a) {tech} +1 Stufe</Button>
        <Button kind="secondary" disabled={cmd.busy} onClick={() => void pick("speed")}>b) Nächste Forschung halb so lang</Button>
      </div>
      <ErrorLine text={cmd.error} code={cmd.code} />
    </div>
  );
}

/** Blatt beim ersten Anblick eines neuen Wurfs (gleich auf welchem Bildschirm). */
export function ResearchRollPopup({ base }: { base: BaseData }) {
  const r = base.research;
  const roll = r?.lastRoll ?? null;
  const [seen, setSeen] = useState(() => Number(localStorage.getItem(SEEN_KEY) ?? 0));
  if (!r || !roll || roll.atMs <= seen) return null;
  const close = () => {
    localStorage.setItem(SEEN_KEY, String(roll.atMs));
    setSeen(roll.atMs);
  };
  return (
    <Sheet open onClose={close} title="Forschung abgeschlossen" icon={<Icon id="forschungsamt" size={48} />}>
      <DiceRoll roll={roll} animate />
      {roll.breakthrough && roll.choice === "speed" && !r.pendingChoice && (
        <p className="text-sm mt-3">{techName(roll.techId)} ist auf Höchststufe – deine nächste Forschung dauert nur halb so lange.</p>
      )}
      <BreakthroughChoice research={r} onDone={close} />
      {!r.pendingChoice && <div className="mt-3"><Button kind="secondary" className="w-full" onClick={close}>Weiter</Button></div>}
    </Sheet>
  );
}
