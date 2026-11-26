// Befehle mit Idempotenz-Schlüssel: frischer Schlüssel je Absicht, nach Netzfehler derselbe.
import { useRef, useState } from "react";
import { queryClient } from "./trpc.ts";
import { errorText, failText, isRejected } from "./names.ts";
import { activeBaseId, resetActiveBase } from "./active-base.ts";

type Res = { ok: boolean; code?: string };

export function useCommand<P extends { key: string }, O extends Res>(call: (input: P) => Promise<O>, invalidate: () => unknown[]) {
  const pending = useRef<{ sig: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(input: Omit<P, "key">): Promise<O | null> {
    // Mehrere Häfen: der aktive Hafen gehört zur Absicht (der Link setzt baseId erst beim Senden).
    const sig = JSON.stringify([input, activeBaseId()]);
    if (!pending.current || pending.current.sig !== sig) pending.current = { sig, key: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      const out = await call({ ...input, key: pending.current.key } as P);
      pending.current = null;
      if (!out.ok) setError(errorText(out.code ?? "?"));
      if (!out.ok && out.code === "no_base") resetActiveBase();
      for (const k of invalidate()) await queryClient.invalidateQueries({ queryKey: k as readonly unknown[] });
      return out;
    } catch (err) {
      // Netzfehler: Schlüssel behalten, damit eine Wiederholung nicht doppelt wirkt.
      // Abgelehnte Eingabe (HTTP 400): nichts ist geschehen, der nächste Versuch bekommt einen neuen Schlüssel.
      if (isRejected(err)) pending.current = null;
      setError(failText(err));
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, setError };
}
