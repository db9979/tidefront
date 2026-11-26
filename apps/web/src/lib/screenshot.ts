// Screenshot der aktuellen Ansicht für „Fehler melden“. Die Bibliothek (modern-screenshot) wird erst beim Melden
// geladen. WebGL-Flächen (PixiJS-Karte) melden sich hier an: direkt vor der Aufnahme wird neu gezeichnet und das Bild
// im selben Takt gelesen (ohne preserveDrawingBuffer wäre die Fläche sonst leer) und vorübergehend als <img> eingesetzt.

interface Surface { canvas: HTMLCanvasElement | null; render: (() => void) | null }

const surfaces = new Set<Surface>();
const MAX_WIDTH = 1600;
const TARGET_BYTES = 900_000;

/** Fläche anmelden (beim Einhängen); ready() sobald gezeichnet werden kann, dispose() beim Aushängen. */
export function registerSnapshotSurface() {
  const s: Surface = { canvas: null, render: null };
  surfaces.add(s);
  return {
    ready(canvas: HTMLCanvasElement, render: () => void) {
      s.canvas = canvas;
      s.render = render;
    },
    dispose() {
      surfaces.delete(s);
    },
  };
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wartet, bis die Ansicht steht: zwei Bilder, eingehängte Flächen bereit, keine Ladeanzeige (höchstens ~3 s). */
export async function waitForSettled(maxMs = 3000): Promise<void> {
  const until = Date.now() + maxMs;
  await frame();
  await frame();
  while (Date.now() < until) {
    const pending = [...surfaces].some((s) => !s.canvas);
    const loading = !!document.querySelector("[data-loading]");
    if (!pending && !loading) break;
    await sleep(100);
  }
  await frame();
}

/** WebGL-Flächen als Bild einsetzen; Rückgabe stellt den alten Zustand wieder her. */
function freezeSurfaces(): () => void {
  const undo: (() => void)[] = [];
  for (const s of surfaces) {
    const c = s.canvas;
    if (!c || !c.isConnected || !s.render) continue;
    try {
      s.render();
      const url = c.toDataURL("image/png");
      const img = document.createElement("img");
      img.src = url;
      img.style.cssText = `display:block;width:${c.clientWidth}px;height:${c.clientHeight}px`;
      const display = c.style.display;
      c.style.display = "none";
      c.after(img);
      undo.push(() => {
        img.remove();
        c.style.display = display;
      });
    } catch {
      // Ohne Kartenbild weiter.
    }
  }
  return () => undo.forEach((u) => u());
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(b);
  });
}

/** Aufnahme des Bildschirms als JPEG-Data-URL (höchstens 1600 px breit, Ziel unter ~0,9 MB); null bei Fehler. */
export async function captureScreen(root: HTMLElement = document.getElementById("root") ?? document.body): Promise<string | null> {
  try {
    const { domToCanvas } = await import("modern-screenshot");
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const scale = Math.min(window.devicePixelRatio || 1, MAX_WIDTH / width);
    const bg = getComputedStyle(document.body).backgroundColor || "#f4eee1";
    const thaw = freezeSurfaces();
    let canvas: HTMLCanvasElement;
    try {
      canvas = await domToCanvas(root, { width, height, scale, backgroundColor: bg, timeout: 8000 });
    } finally {
      thaw();
    }
    for (const q of [0.82, 0.68, 0.5, 0.35]) {
      const b = await toBlob(canvas, q);
      if (b && (b.size <= TARGET_BYTES || q === 0.35)) return b.size <= 1_150_000 ? blobToDataUrl(b) : null;
    }
    return null;
  } catch (err) {
    console.warn("Screenshot fehlgeschlagen", err);
    return null;
  }
}
