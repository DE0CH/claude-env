// iOS Safari paints the status-bar strip itself — from <meta name="theme-color"> if present, else
// a sample of the page background — so a sheet's overlay never dims it and the strip stays page-
// coloured above a dimmed page. Keep the meta in step with what is on screen: the page background
// when nothing is open, the background as seen through the overlay while a sheet is up. Safari
// animates the change on its own. Called on sheet mount/unmount, theme (OS scheme) changes, and
// once the Theme root exists.

// rgb()/rgba() or Radix's P3 form `color(display-p3 r g b / a)` → [r, g, b, a] in 0–255 / 0–1
function parse(c: string): [number, number, number, number] {
  const p3 = c.startsWith("color(display-p3");
  const n = (p3 ? c.slice(16) : c).match(/[\d.]+/g)?.map(Number) ?? [];
  const k = p3 ? 255 : 1;
  return [(n[0] ?? 0) * k, (n[1] ?? 0) * k, (n[2] ?? 0) * k, n[3] ?? 1];
}

let meta: HTMLMetaElement | null = null;

export function syncStatusBar() {
  const root = document.querySelector<HTMLElement>(".radix-themes");
  if (!root) return;
  let [r, g, b] = parse(getComputedStyle(root).backgroundColor);
  const overlay = document.querySelector<HTMLElement>(".sheet-overlay");
  if (overlay) {
    const [or, og, ob, a] = parse(getComputedStyle(overlay).backgroundColor);
    r = r * (1 - a) + or * a; g = g * (1 - a) + og * a; b = b * (1 - a) + ob * a;
  }
  if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
  meta.content = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}
