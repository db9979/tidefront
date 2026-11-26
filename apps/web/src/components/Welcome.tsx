// Begrüßung nach der Gründung des Hafens: einmal je Spieler und Gerät.
import { useState } from "react";
import { Icon } from "../icons.tsx";
import { Button } from "../ui.tsx";

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

const SLIDES = [
  { icon: "anker", title: "Dein Heimathafen steht", text: "Willkommen, Kommandant. Von hier aus baust du Wirtschaft und Flotte auf; später gründest du weitere Häfen. Alles läuft in Echtzeit weiter, auch wenn die App geschlossen ist." },
  { icon: "stahlwerk", title: "Erst die Wirtschaft", text: "Oben siehst du deine vier Ressourcen und ihre Stundenrate. Baue zuerst das Kraftwerk (ohne Strom liefern die Werke nichts), dann das Stahlwerk – das Auftragsbuch in der Basis sagt dir jeweils den nächsten Schritt." },
  { icon: "kartell", title: "Piraten an der Küste", text: "Das Freibeuter-Kartell hat Nester entlang der Küsten. Überfalle sie mit Korvetten, Landungsschiffen und Schützen – und halte Truppen daheim, denn das Kartell schlägt zurück, sobald dein Anfängerschutz endet." },
  { icon: "schild", title: "Sieben Tage Schonzeit", text: "In der ersten Woche bist du vor Angriffen geschützt. Danach schützt dich der Nachtschild jede Nacht acht Stunden – die Startzeit wählst du in der Basis. Fragen? Das „?“ oben rechts öffnet das Handbuch." },
];

/** Nur anzeigen, wenn welcomeSeen false lieferte; onDone nach dem Schließen. */
export function Welcome({ playerId, onDone }: { playerId: number; onDone: () => void }) {
  const [step, setStep] = useState(0);
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
          <Button className="flex-1 !px-2 !tracking-[0.06em]" onClick={() => (last ? close() : setStep(step + 1))}>{last ? "Los geht's" : "Weiter"}</Button>
        </div>
      </div>
    </div>
  );
}
