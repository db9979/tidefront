// Einfache Aktionen ohne Idempotenz-Schlüssel (Allianz, Chat, Diplomatie): Fehlertext und Neuladen danach.
import { useState } from "react";
import { queryClient, trpc } from "./trpc.ts";
import { errorText } from "./names.ts";

type Res = { ok: boolean; code?: string };

export function useAct() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<O extends Res>(fn: () => Promise<O>): Promise<O | null> {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      if (!out.ok) setError(errorText(out.code ?? "?"));
      await Promise.all([
        queryClient.invalidateQueries(trpc.alliance.pathFilter()),
        queryClient.invalidateQueries(trpc.social.messages.pathFilter()),
      ]);
      return out;
    } catch {
      setError(errorText("network"));
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, setError };
}

export const ROLE_TEXT: Record<string, string> = { fuehrung: "Führung", offizier: "Offizier", mitglied: "Mitglied" };

export const RELATION_TEXT: Record<string, { text: string; tone: "green" | "sea" | "brass" | "red" | "slate" }> = {
  verbuendet: { text: "Verbündet", tone: "green" },
  pakt: { text: "Nichtangriffspakt", tone: "sea" },
  pakt_gekuendigt: { text: "Pakt gekündigt", tone: "brass" },
  pakt_angeboten: { text: "Pakt angeboten", tone: "slate" },
  krieg_angekuendigt: { text: "Krieg erklärt", tone: "brass" },
  krieg: { text: "Krieg", tone: "red" },
};
