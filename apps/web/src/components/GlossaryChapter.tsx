// Handbuch-Kapitel „Begriffe“ (UX-0.43 C2): kurze Erklärungen aus lib/glossary.ts mit Ort im Spiel und einem Suchfeld.
import { useState } from "react";
import { GLOSSARY } from "../lib/glossary.ts";

export function GlossaryChapter() {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = GLOSSARY.filter((e) => !needle || [e.term, e.text, ...(e.not ?? [])].some((s) => s.toLowerCase().includes(needle)));
  return (
    <div data-testid="glossary">
      <p className="text-sm text-slate-200 mb-2 leading-relaxed">Die wichtigsten Begriffe des Spiels in einem Satz – und wo sie stehen. In Klammern: Namen, die nicht (mehr) benutzt werden.</p>
      <input type="search" aria-label="Begriff suchen" placeholder="Begriff suchen …" value={q} onChange={(e) => setQ(e.target.value)}
        className="w-full h-11 rounded-lg field px-3 mb-2 text-sm" />
      <dl className="divide-y divide-rule">
        {list.map((e) => (
          <div key={e.term} className="py-2" data-term={e.term}>
            <dt className="font-semibold text-sm">{e.term}{e.not?.length ? <span className="font-normal text-xs text-ink2"> (nicht: {e.not.join(", ")})</span> : null}</dt>
            <dd className="text-sm text-slate-200 leading-snug">{e.text}{e.where ? <span className="block text-xs text-ink2 mt-0.5">Steht unter: {e.where}</span> : null}</dd>
          </div>
        ))}
        {list.length === 0 && <p className="text-sm text-ink2 py-2">Kein Begriff gefunden.</p>}
      </dl>
    </div>
  );
}
