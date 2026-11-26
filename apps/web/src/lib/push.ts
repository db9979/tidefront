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
};

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

/** Fragt die Erlaubnis an (muss aus einem Tipp heraus laufen) und meldet das Abo beim Server an. */
export async function enablePush(publicKey: string): Promise<{ ok: true; endpoint: string } | { ok: false; error: string }> {
  const reg = await registration();
  if (!reg) return { ok: false, error: "Dieser Browser unterstützt keine Push-Benachrichtigungen." };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, error: "Benachrichtigungen wurden nicht erlaubt. Das lässt sich in den Einstellungen des Browsers ändern." };
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
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

export type OpenTarget = { tab?: "basis" | "karte" | "truppen" | "berichte" | "boerse"; view?: "settings" | "admin" };

/** Ziel aus einer App-Adresse (Benachrichtigung): ?tab=berichte oder ?view=admin. */
export function parseOpenUrl(url: string): OpenTarget {
  const q = new URL(url, location.origin).searchParams;
  const tab = q.get("tab");
  const view = q.get("view");
  return {
    tab: tab && ["basis", "karte", "truppen", "berichte", "boerse"].includes(tab) ? (tab as OpenTarget["tab"]) : undefined,
    view: view === "admin" || view === "settings" ? view : undefined,
  };
}
