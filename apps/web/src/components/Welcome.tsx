// Begrüßung nach der Gründung des Hafens: einmal je Spieler und Gerät.
import { useState } from "react";
import { Icon } from "../icons.tsx";
import { Button } from "../ui.tsx";
import { useNav } from "../lib/nav.ts";

const key = (playerId: number) => `tf-welcome-v1:${playerId}`;
/** Früherer, geräteweiter Merker: übernimmt der erste Spieler, danach wird er gelöscht. */
const LEGACY_KEY = "tf-welcome-v1";

/** Hat dieser Spieler die Begrüßung schon gesehen? Übernimmt dabei den alten Merker. */
export function welcomeSeen(playerId: number): boolean {
  if (localStorage.getItem(key(playerId))) return true;
  if (!localStorage.getItem(LEGACY_KEY)) return false;
  localStorage.setItem(key(playerId), "1");
  localStorage.removeItem(LEGACY_KEY);
  return true;
}

// UX 0.43 (O-2): zwei Seiten statt vier; die letzte endet mit „Kraftwerk bauen“ und öffnet das Gebäudeblatt.
// Nachtschild: die Startzeit wurde bei der Hafenwahl schon gewählt – änderbar unter Einstellungen.
const SLIDES = [
  { icon: "anker", title: "Dein Heimathafen steht", text: "Willkommen, Kommandant. Alles läuft in Echtzeit weiter, auch wenn die App geschlossen ist. Die erste Woche bist du vor Angriffen geschützt; danach schützt dich jede Nacht acht Stunden der Nachtschild – die Startzeit hast du eben gewählt, ändern kannst du sie unter Menü → Einstellungen." },
  { icon: "kraftwerk", title: "Erst der Strom", text: "Ohne Strom liefern Stahlwerk, Raffinerie und Chipfabrik nichts. Baue zuerst das Kraftwerk – die Lage zeigt dir danach unter „Erste Schritte“ jeweils den nächsten Auftrag. Fragen? Menü → Handbuch." },
];

/** Nur anzeigen, wenn welcomeSeen false lieferte; onDone nach dem Schließen. */
export function Welcome({ playerId, onDone }: { playerId: number; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const nav = useNav();
  if (step < 0) return null;
  const s = SLIDES[step];
  const last = step === SLIDES.length - 1;
  const close = () => {
    localStorage.setItem(key(playerId), "1");
    setStep(-1);
    onDone();
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-ink/50" role="dialog" aria-modal="true">
      <div className="panel rounded-[6px] border-ink p-5 max-w-sm w-full text-center sheet-in">
        <div className="mx-auto mb-3 w-24 h-24 bg-[#f6f1e5] border border-ink grid place-items-center">
          <Icon id={s.icon} size={64} />
        </div>
        <h2 className="font-serif text-2xl mb-2">{s.title}</h2>
        <p className="text-ink2 leading-relaxed">{s.text}</p>
        <div className="flex justify-center gap-1.5 my-4">
          {SLIDES.map((_, i) => <span key={i} className={`diamond ${i === step ? "bg-siegel" : "bg-rule"}`} />)}
        </div>
        <div className="flex gap-2">
          <Button kind="secondary" className="flex-1 !px-2 !tracking-[0.06em]" onClick={close}>Überspringen</Button>
          <Button className="flex-1 !px-2 !tracking-[0.06em]" onClick={() => { if (!last) { setStep(step + 1); return; } close(); nav.go({ to: "building", id: "kraftwerk" }); }}>{last ? "Kraftwerk bauen" : "Weiter"}</Button>
        </div>
      </div>
    </div>
  );
}
