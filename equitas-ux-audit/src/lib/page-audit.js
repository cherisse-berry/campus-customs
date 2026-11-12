// Per-page, per-viewport checks for the public audit. Read-only: the only
// interaction is keyboard Tab traversal and opening/closing a navigation menu
// that passes isSafeMenuToggle(). Forms are inspected, never submitted.
import AxeBuilder from "@axe-core/playwright";
import { redact } from "./redact.js";
import { reflowCheck } from "./diagnostics.js";
import { isSafeMenuToggle } from "./public-safety.js";
import { keyboardV2 } from "./keyboard.js";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

// Words that signal a capability is not (yet) available to visitors.
const AVAILABILITY = [
  { status: "planned", re: /\b(coming soon|planned|on (our|the) roadmap|launching (soon|in)|future release|not yet available|in development)\b/i },
  { status: "preview", re: /\b(preview|beta|early access|pilot|waitlist|wait list|join the list|request access|by invitation)\b/i },
  { status: "unavailable", re: /\b(currently unavailable|temporarily unavailable|no longer available|disabled)\b/i },
];

export async function axeDetailed(page) {
  try {
    const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    const mapNode = (n) => {
      const data = (n.any || []).concat(n.all || [], n.none || []).map((c) => c.data).find((d) => d && (d.contrastRatio !== undefined || d.fgColor)) || null;
      return {
        target: n.target.join(" "),
        html: redact(n.html || "").replace(/\s+/g, " ").slice(0, 300),
        failureSummary: redact(n.failureSummary || "").slice(0, 400),
        contrast: data ? { fgColor: data.fgColor, bgColor: data.bgColor, ratio: data.contrastRatio, expected: data.expectedContrastRatio, fontSize: data.fontSize, fontWeight: data.fontWeight } : null,
      };
    };
    const conv = (v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags, wcag: v.tags.filter((t) => /^wcag\d{3,4}$/.test(t)), bestPractice: v.tags.includes("best-practice") && !v.tags.some((t) => /^wcag\d/.test(t)), nodes: v.nodes.slice(0, 25).map(mapNode), nodeCount: v.nodes.length });
    const out = { engine: `axe-core ${r.testEngine?.version || ""}`.trim(), violations: r.violations.map(conv), incomplete: r.incomplete.map(conv), passes: r.passes.map((p) => p.id), inapplicable: r.inapplicable.map((p) => p.id) };
    // Visible text for contrast nodes, so a reviewer can find the element.
    for (const v of out.violations.filter((x) => x.id === "color-contrast")) {
      for (const n of v.nodes.slice(0, 10)) n.text = redact(await page.locator(n.target).first().innerText({ timeout: 2000 }).catch(() => "")).slice(0, 120);
    }
    return out;
  } catch (e) {
    return { error: `axe failed: ${e.message.split("\n")[0]}` };
  }
}

// Structure: title, language, headings, landmarks, breadcrumbs, skip link,
// media, forms (never submitted), dialogs, images.
export async function structure(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const text = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")].filter(vis).map((h) => ({ level: Number(h.getAttribute("aria-level") || h.tagName.slice(1)) || 2, text: text(h).slice(0, 120) }));
    const skips = [];
    for (let i = 1; i < headings.length; i++) if (headings[i].level > headings[i - 1].level + 1) skips.push(`h${headings[i - 1].level} "${headings[i - 1].text.slice(0, 40)}" → h${headings[i].level} "${headings[i].text.slice(0, 40)}"`);
    const bc = document.querySelector('nav[aria-label*="breadcrumb" i], [aria-label*="breadcrumb" i], .breadcrumb, .breadcrumbs, [class*="breadcrumb"]');
    const firstLink = [...document.querySelectorAll("a[href^='#']")].find((a) => /skip|main content/i.test(text(a) || a.getAttribute("aria-label") || ""));
    const dialogs = [...document.querySelectorAll("[role=dialog],[role=alertdialog],dialog[open]")].filter(vis).map((d) => ({ name: d.getAttribute("aria-label") || (d.getAttribute("aria-labelledby") ? text(document.getElementById(d.getAttribute("aria-labelledby"))) : ""), modal: d.getAttribute("aria-modal") === "true" || d.tagName === "DIALOG", text: text(d).slice(0, 120) }));
    const forms = [...document.querySelectorAll("form")].map((f) => ({ method: (f.getAttribute("method") || "get").toLowerCase(), hasAction: !!f.getAttribute("action"), fields: f.querySelectorAll("input:not([type=hidden]),select,textarea").length, purpose: text(f.querySelector("h1,h2,h3,legend,button[type=submit],button:not([type])")).slice(0, 60) }));
    return {
      title: document.title,
      lang: document.documentElement.getAttribute("lang") || null,
      headings,
      h1Count: headings.filter((h) => h.level === 1).length,
      headingSkips: skips,
      landmarks: { main: document.querySelectorAll("main,[role=main]").length, nav: document.querySelectorAll("nav,[role=navigation]").length, header: document.querySelectorAll("header,[role=banner]").length, footer: document.querySelectorAll("footer,[role=contentinfo]").length },
      breadcrumbs: bc ? [...bc.querySelectorAll("a, [aria-current]")].map((a) => text(a)).filter(Boolean).slice(0, 8) : null,
      skipLink: !!firstLink,
      media: { video: document.querySelectorAll("video").length, audio: document.querySelectorAll("audio").length, embeds: [...document.querySelectorAll("iframe")].filter((f) => /youtube|vimeo|wistia|loom/i.test(f.src)).length, autoplay: document.querySelectorAll("video[autoplay],audio[autoplay]").length },
      forms,
      dialogs,
      imagesWithoutAlt: [...document.querySelectorAll("img")].filter((i) => vis(i) && !i.hasAttribute("alt")).length,
      metaViewport: document.querySelector("meta[name=viewport]")?.getAttribute("content") || null,
    };
  }).then((s) => ({ ...s, title: redact(s.title), headings: s.headings.map((h) => ({ ...h, text: redact(h.text) })) })).catch((e) => ({ error: e.message.split("\n")[0] }));
}

// Layout: touch targets (WCAG 2.5.8 ≥24×24 CSS px unless inline), controls
// off-screen or covered by another element, small text.
export async function layout(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0"; };
    const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.value || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const sel = (el) => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts = [];
      for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
        let p = e.tagName.toLowerCase();
        const cls = [...e.classList].slice(0, 3).map((c) => "." + CSS.escape(c)).join("");
        p += cls;
        const sib = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
        if (sib.length > 1 && !cls) p += `:nth-of-type(${sib.indexOf(e) + 1})`;
        parts.unshift(p);
      }
      return parts.join(" > ");
    };
    const interactive = [...document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[tabindex]:not([tabindex='-1'])")].filter(vis);
    const small = [], offscreen = [], covered = [];
    for (const el of interactive) {
      const r = el.getBoundingClientRect();
      const inlineLink = el.tagName === "A" && ["P", "LI", "SPAN", "TD", "DD"].includes(el.parentElement?.tagName) && (el.parentElement.innerText || "").trim().length > label(el).length + 15;
      if ((r.width < 24 || r.height < 24) && !inlineLink) small.push({ selector: sel(el), name: label(el), width: Math.round(r.width), height: Math.round(r.height) });
      if (r.right > vw + 1 || r.left < -1) offscreen.push({ selector: sel(el), name: label(el), left: Math.round(r.left), right: Math.round(r.right), viewportWidth: vw });
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cy > 0 && cy < window.innerHeight && cx > 0 && cx < vw) {
        const top = document.elementFromPoint(cx, cy);
        if (top && top !== el && !el.contains(top) && !top.contains(el)) covered.push({ selector: sel(el), name: label(el), coveredBy: sel(top) });
      }
    }
    let tinyText = 0, total = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && total < 3000; n = walker.nextNode()) {
      if (!n.textContent.trim() || !n.parentElement || !vis(n.parentElement)) continue;
      total++;
      if (parseFloat(getComputedStyle(n.parentElement).fontSize) < 12) tinyText++;
    }
    return { interactiveCount: interactive.length, smallTargets: small.slice(0, 40), smallTargetCount: small.length, offscreen: offscreen.slice(0, 20), covered: covered.slice(0, 20), textNodes: total, tinyTextNodes: tinyText };
  }).then((x) => ({ ...x, smallTargets: x.smallTargets.map((t) => ({ ...t, name: redact(t.name) })) })).catch((e) => ({ error: e.message.split("\n")[0] }));
}

// WCAG 1.4.12: apply the text-spacing overrides and count newly clipped text.
export async function textSpacing(page) {
  const count = () => page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => {
    const s = getComputedStyle(el);
    return (s.overflow === "hidden" || s.overflowY === "hidden" || s.overflowX === "hidden" || s.textOverflow === "ellipsis") && el.innerText?.trim() && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2);
  }).length);
  try {
    const before = await count();
    await page.addStyleTag({ content: "*{line-height:1.5!important;letter-spacing:0.12em!important;word-spacing:0.16em!important}p{margin-bottom:2em!important}", }).then((h) => h.evaluate((el) => el.setAttribute("data-uxaudit-spacing", "1")));
    const after = await count();
    await page.evaluate(() => document.querySelector("[data-uxaudit-spacing]")?.remove());
    return { clippedBefore: before, clippedAfter: after, newlyClipped: Math.max(0, after - before) };
  } catch (e) { return { error: e.message.split("\n")[0] }; }
}

// Keyboard: see src/lib/keyboard.js. The public audit uses keyboardV2
// (validated against selftest/keyboard-reference); keyboardV1 is kept only to
// measure the detector used before commit b2c5c6a.
export async function keyboard(page, maxStops = 40) {
  return keyboardV2(page, maxStops, { redact });
}

// Mobile navigation menu: find a safe disclosure toggle, open it, check state
// and that links appear, then close it with Escape (or the toggle).
export async function mobileMenu(page) {
  const candidates = page.locator("header button, nav button, [role=banner] button, header [role=button], nav [role=button]").filter({ visible: true });
  const n = Math.min(await candidates.count().catch(() => 0), 6);
  for (let i = 0; i < n; i++) {
    const el = candidates.nth(i);
    const safe = await isSafeMenuToggle(el);
    if (!safe.ok) continue;
    const before = await el.getAttribute("aria-expanded").catch(() => null);
    const linksBefore = await page.locator("nav a[href]").filter({ visible: true }).count().catch(() => 0);
    await el.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    const after = await el.getAttribute("aria-expanded").catch(() => null);
    const linksAfter = await page.locator("nav a[href], [role=dialog] a[href], [role=menu] a[href], header a[href]").filter({ visible: true }).count().catch(() => 0);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
    let closedByEscape = (await el.getAttribute("aria-expanded").catch(() => null)) !== "true";
    if (!closedByEscape) await el.click({ timeout: 5000 }).catch(() => {});
    return { found: true, name: redact(safe.name), ariaExpandedBefore: before, ariaExpandedAfter: after, stateExposed: before === "false" && after === "true", linksVisibleBefore: linksBefore, linksVisibleAfter: linksAfter, opensLinks: linksAfter > linksBefore, closedByEscape };
  }
  const anyVisibleNavLinks = await page.locator("nav a[href], header a[href]").filter({ visible: true }).count().catch(() => 0);
  return { found: false, visibleNavLinks: anyVisibleNavLinks };
}

export async function availability(page) {
  const main = page.locator("main, [role=main]").first();
  const t = await ((await main.count().catch(() => 0)) ? main : page.locator("body")).innerText({ timeout: 5000 }).catch(() => "");
  const hits = [];
  for (const a of AVAILABILITY) {
    const m = a.re.exec(t);
    if (m) hits.push({ status: a.status, phrase: m[0], context: redact(t.slice(Math.max(0, m.index - 70), m.index + m[0].length + 70).replace(/\s+/g, " ").trim()) });
  }
  const disabled = await page.locator("button[disabled], [aria-disabled=true]").filter({ visible: true }).allInnerTexts().catch(() => []);
  return { signals: hits, disabledControls: disabled.map((x) => redact(x.trim())).filter(Boolean).slice(0, 10) };
}

export async function auditViewport(page, { viewportName, tabStops = 40 }) {
  const out = { viewport: viewportName };
  out.structure = await structure(page);
  out.axe = await axeDetailed(page);
  out.layout = await layout(page);
  out.reflow = await reflowCheck(page);
  out.textSpacing = await textSpacing(page);
  out.availability = await availability(page);
  if (["mobile", "reflow320", "narrow320"].includes(viewportName)) out.menu = await mobileMenu(page);
  out.keyboard = await keyboard(page, tabStops);
  return out;
}
