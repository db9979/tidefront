// Web-Push im Browser: Fähigkeiten prüfen, Abo anlegen und an den Server melden.
import { trpcClient } from "./trpc.ts";

export const KIND_LABEL: Record<string, string> = {
  attack: "Angriff erkannt",
  report: "Kampfberichte",
  build: "Ausbau fertig",
  training: "Ausbildung fertig",
  fleet: "Verband zurück",
  delivery: "Lieferung angekommen",
  ops: "Betriebsalarm (Verwaltung)",
  market: "Marktnachricht",
  // UX-0.43 B8: nur als Push.
  storage: "Lager fast voll (je Rohstoff 1× am Tag)",
  overtaken: "Du wurdest überholt (höchstens 1× am Tag)",
  council: "Seerat-Ergebnis",
};

/** Arten nur als Push (keine E-Mail): Marktnachricht und die neuen Arten aus UX-0.43 B8. */
export const PUSH_ONLY = new Set(["market", "storage", "overtaken", "council"]);

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js").catch(() => null);
}

/** Endpunkt des Abos dieses Geräts, falls vorhanden. */
export async function currentEndpoint(): Promise<string | null> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}

/** Hinweis, wenn der Browser Benachrichtigungen für diese Seite blockiert. */
export const DENIED_HINT =
  "Benachrichtigungen sind für diese Seite im Browser blockiert. Erlaube sie in den Website-Einstellungen " +
  "(Schloss-Symbol neben der Adresse bzw. Einstellungen → Benachrichtigungen) und tippe dann erneut auf „Aktivieren“.";

export function pushDenied(): boolean {
  return "Notification" in window && Notification.permission === "denied";
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/** Fragt die Erlaubnis an (muss aus einem Tipp heraus laufen) und meldet das Abo beim Server an. */
export async function enablePush(publicKey: string): Promise<{ ok: true; endpoint: string } | { ok: false; error: string }> {
  if (!pushSupported()) return { ok: false, error: "Dieser Browser unterstützt keine Push-Benachrichtigungen." };
  if (pushDenied()) return { ok: false, error: DENIED_HINT };
  let reg: ServiceWorkerRegistration | null = null;
  let regError = "";
  try {
    reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  } catch (err) {
    regError = err instanceof Error ? ` (${err.message})` : "";
  }
  if (!reg) {
    return { ok: false, error: `Der Hintergrunddienst der App (Service Worker) ließ sich nicht starten${regError}. Seite neu laden und erneut versuchen; im privaten Modus geht es oft nicht.` };
  }
  const perm = await Notification.requestPermission();
  if (perm === "denied") return { ok: false, error: DENIED_HINT };
  if (perm !== "granted") return { ok: false, error: "Benachrichtigungen wurden nicht erlaubt. Tippe erneut auf „Aktivieren“ und bestätige die Abfrage." };
  if (!(await withTimeout(navigator.serviceWorker.ready, 10000))) {
    return { ok: false, error: "Der Hintergrunddienst der App antwortet nicht. Seite neu laden und erneut versuchen." };
  }
  let sub: PushSubscription | null;
  try {
    sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  } catch (err) {
    return { ok: false, error: `Das Abo ließ sich nicht anlegen${err instanceof Error ? ` (${err.message})` : ""}. Später erneut versuchen.` };
  }
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return { ok: false, error: "Das Abo ist unvollständig." };
  const r = await trpcClient.push.subscribe.mutate({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
  if (!r.ok) return { ok: false, error: "Der Server hat das Abo abgelehnt." };
  return { ok: true, endpoint: json.endpoint };
}

export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await trpcClient.push.unsubscribe.mutate({ endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export type OpenTarget = {
  tab?: "basis" | "karte" | "truppen" | "berichte" | "boerse";
  /** Unterreiter: Basis lage|hafen, Meldungen berichte|nachrichten (Post)|allianz|saison|rangliste|bilanz|erfolge|welt, Karte sichtungen. */
  sub?: string;
  view?: "settings" | "admin";
  /** Mehrere Häfen: diesen Hafen aktiv machen. */ base?: number;
  /** E-Mail-Link: diesen Bericht öffnen. */ report?: number;
  /** E-Mail-Link „Im Kampfsimulator öffnen“ (&sim=1, nur mit bericht). */ sim?: boolean;
};

const TABS = ["basis", "karte", "truppen", "berichte", "boerse"] as const;
/** Ältere und sprechende Adressen (Server-Benachrichtigungen): ?tab=meldungen, ?tab=allianz, ?tab=lage, ?tab=sichtungen. */
const ALIAS: Record<string, { tab: NonNullable<OpenTarget["tab"]>; sub?: string }> = {
  meldungen: { tab: "berichte" },
  allianz: { tab: "berichte", sub: "allianz" },
  nachrichten: { tab: "berichte", sub: "nachrichten" },
  rangliste: { tab: "berichte", sub: "rangliste" },
  erfolge: { tab: "berichte", sub: "erfolge" },
  post: { tab: "berichte", sub: "nachrichten" }, // UX 0.43: Reiter „Post“
  saison: { tab: "berichte", sub: "saison" }, // UX 0.43: Reiter „Saison“
  welt: { tab: "berichte", sub: "welt" },
  weltpolitik: { tab: "berichte", sub: "welt" },
  lage: { tab: "basis", sub: "lage" },
  hafen: { tab: "basis", sub: "hafen" },
  sichtungen: { tab: "karte", sub: "sichtungen" },
  lagebild: { tab: "karte", sub: "sichtungen" },
};
const SUBS = new Set(["lage", "hafen", "berichte", "nachrichten", "post", "allianz", "saison", "rangliste", "bilanz", "erfolge", "welt", "sichtungen", "lagebild"]);

/** Ziel aus einer App-Adresse (Benachrichtigung): ?tab=berichte&sub=nachrichten, ?view=admin, ?base=12 (Hafen). */
export function parseOpenUrl(url: string): OpenTarget {
  const q = new URL(url, location.origin).searchParams;
  const raw = q.get("tab") ?? "";
  const alias = ALIAS[raw];
  const tab = alias?.tab ?? ((TABS as readonly string[]).includes(raw) ? (raw as OpenTarget["tab"]) : undefined);
  const subRaw = q.get("sub");
  const sub = subRaw && SUBS.has(subRaw) ? (subRaw === "lagebild" ? "sichtungen" : subRaw === "post" ? "nachrichten" : subRaw) : alias?.sub;
  const view = q.get("view");
  return {
    tab,
    sub, // ohne tab gilt der Unterreiter der Basis (Startreiter), z. B. ?sub=hafen
    view: view === "admin" || view === "settings" ? view : undefined,
    base: /^\d{1,9}$/.test(q.get("base") ?? "") ? Number(q.get("base")) : undefined,
    report: /^\d{1,9}$/.test(q.get("bericht") ?? "") ? Number(q.get("bericht")) : undefined,
    sim: q.get("sim") === "1" && /^\d{1,9}$/.test(q.get("bericht") ?? "") ? true : undefined,
  };
}

/** Bericht aus dem Start-Link (?bericht=ID, z. B. aus einer E-Mail; &sim=1: gleich im Kampfsimulator); wird einmal abgeholt. */
let openReport: { id: number; sim: boolean } | undefined = (() => {
  if (typeof location === "undefined") return undefined;
  const t = parseOpenUrl(location.href);
  return t.report !== undefined ? { id: t.report, sim: !!t.sim } : undefined;
})();
/** Ohne Verbrauch lesen (Zustands-Initialisierer laufen im Entwicklungsmodus doppelt); verbraucht wird per clearOpenReport. */
export function peekOpenReport(): { id: number; sim: boolean } | null {
  return openReport ?? null;
}
export function clearOpenReport(): void {
  openReport = undefined;
}
/** Lagezentrum: diesen Bericht beim nächsten Öffnen der Berichte zeigen. */
export function setOpenReport(id: number): void {
  openReport = { id, sim: false };
}
