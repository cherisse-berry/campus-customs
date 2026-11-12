// Independent WCAG contrast measurement for a specific element (WCAG 2.2
// SC 1.4.3 Contrast (Minimum), Level AA). Used to investigate automated
// colour-contrast findings rather than repeating them.

export function relLuminance([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrastRatio(fg, bg) {
  const a = relLuminance(fg), b = relLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
// Composite a (possibly translucent) colour over an opaque one.
export function over([r, g, b, a], [R, G, B]) {
  return [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)].map((x) => Math.round(x));
}
export const hex = (c) => "#" + c.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");

// Runs in the page. Converts every CSS colour (rgb, hex, oklch, color(), …)
// to sRGBA with a canvas, walks ancestors for the effective background, and
// reports anything that makes a measurement unreliable.
export async function measureElement(locator) {
  return locator.evaluate((el) => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const toRGBA = (css) => {
      if (!css || css === "transparent") return [0, 0, 0, 0];
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], Math.round((d[3] / 255) * 1000) / 1000];
    };
    const s = getComputedStyle(el);
    const layers = [], uncertain = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const bg = toRGBA(cs.backgroundColor);
      if (cs.backgroundImage && cs.backgroundImage !== "none") uncertain.push(`${e.tagName.toLowerCase()} has a background image/gradient`);
      if (parseFloat(cs.opacity) < 1) uncertain.push(`${e.tagName.toLowerCase()} has opacity ${cs.opacity}`);
      if (cs.mixBlendMode && cs.mixBlendMode !== "normal") uncertain.push(`${e.tagName.toLowerCase()} uses mix-blend-mode ${cs.mixBlendMode}`);
      if (bg[3] > 0) layers.push({ tag: e.tagName.toLowerCase(), cls: (e.className && typeof e.className === "string" ? e.className : "").slice(0, 80), css: cs.backgroundColor, rgba: bg });
      if (bg[3] >= 1) break;
    }
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      classes: (typeof el.className === "string" ? el.className : "").slice(0, 160),
      text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160),
      outerHTML: el.outerHTML.replace(/\s+/g, " ").slice(0, 400),
      rect: { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height) },
      color: { css: s.color, rgba: toRGBA(s.color) },
      backgroundLayers: layers,
      reachedOpaque: layers.length > 0 && layers[layers.length - 1].rgba[3] >= 1,
      fontSizePx: parseFloat(s.fontSize),
      fontWeight: Number(s.fontWeight) || 400,
      uncertain,
      landmark: (() => { const l = el.closest("header,nav,main,footer,aside,section,[role]"); return l ? `${l.tagName.toLowerCase()}${l.getAttribute("aria-label") ? `[aria-label="${l.getAttribute("aria-label")}"]` : ""}${l.id ? "#" + l.id : ""}` : "body"; })(),
      nearestHeading: (() => { let e = el; while (e && e !== document.body) { let p = e.previousElementSibling; while (p) { if (/^H[1-6]$/.test(p.tagName)) return p.innerText.trim().slice(0, 80); const h = p.querySelector?.("h1,h2,h3,h4,h5,h6"); if (h) return h.innerText.trim().slice(0, 80); p = p.previousElementSibling; } e = e.parentElement; } return null; })(),
    };
  });
}

// Turn the in-page measurement into a WCAG 1.4.3 assessment.
export function assessContrast(m) {
  // Composite background layers from the bottom up. If no opaque layer was
  // reached, the browser's default white canvas is assumed (and said so).
  const assumptions = [];
  let base = [255, 255, 255];
  if (!m.reachedOpaque) assumptions.push("no opaque background found on ancestors; assumed the default white page canvas");
  for (const l of [...m.backgroundLayers].reverse()) base = over(l.rgba, base);
  const fg = m.color.rgba[3] < 1 ? over(m.color.rgba, base) : m.color.rgba.slice(0, 3);
  if (m.color.rgba[3] < 1) assumptions.push(`text colour is ${m.color.rgba[3] * 100}% opaque; composited over the background`);
  const large = m.fontSizePx >= 24 || (m.fontSizePx >= 18.66 && m.fontWeight >= 700);
  const required = large ? 3 : 4.5;
  const ratio = Math.round(contrastRatio(fg, base) * 100) / 100;
  const reliable = m.uncertain.length === 0;
  return {
    foreground: hex(fg), background: hex(base),
    ratio: reliable ? ratio : null,
    estimatedRatio: ratio,
    requiredRatio: required,
    textSize: `${m.fontSizePx}px / weight ${m.fontWeight} (${large ? "large" : "normal"} text)`,
    wcag: "WCAG 2.2 SC 1.4.3 Contrast (Minimum), Level AA: at least 4.5:1 for normal text, 3:1 for large text (≥24px, or ≥18.66px bold).",
    passes: reliable ? ratio >= required : null,
    reliable,
    reliabilityNotes: [...m.uncertain, ...assumptions],
  };
}
