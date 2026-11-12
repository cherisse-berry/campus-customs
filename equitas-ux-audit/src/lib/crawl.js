// Controlled, same-origin page discovery for the public audit.
// Discovery reads links that are present in the rendered pages (plus the
// site's own sitemap.xml, if it publishes one). It never guesses URLs.
import { isProtectedPath } from "./public-safety.js";
import { redactUrl } from "./redact.js";

const ASSET_EXT = /\.(pdf|png|jpe?g|gif|svg|webp|ico|css|js|json|xml|txt|zip|mp4|mp3|woff2?|ttf|docx?|xlsx?|pptx?)$/i;

// Canonical form used for de-duplication: same host, no fragment, no
// tracking parameters, no trailing slash (except root).
export function normalizeUrl(href, base) {
  let u;
  try { u = new URL(href, base); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|_hs)/i.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  u.hostname = u.hostname.toLowerCase();
  return u.toString();
}

export function classifyLink(href, base, manifest, cfg) {
  const raw = (href || "").trim();
  if (!raw) return { kind: "empty" };
  if (/^(mailto|tel|sms):/i.test(raw)) return { kind: "contact", href: raw.replace(/^(mailto:)[^?]*/i, "$1[address]") };
  if (/^javascript:/i.test(raw)) return { kind: "javascript" };
  if (raw.startsWith("#")) return { kind: "in-page-anchor", href: raw };
  const url = normalizeUrl(raw, base);
  if (!url) return { kind: "unsupported", href: raw.slice(0, 80) };
  const u = new URL(url);
  const internal = manifest.target.allowedHosts.map((h) => h.toLowerCase()).includes(u.hostname);
  if (!internal) return { kind: "external", url, host: u.hostname };
  if (ASSET_EXT.test(u.pathname)) return { kind: "asset", url, path: u.pathname };
  if (isProtectedPath(u.pathname, cfg)) return { kind: "protected", url, path: u.pathname };
  return { kind: "page", url, path: u.pathname + (u.search || "") };
}

// robots.txt rules for user-agent * (and any group naming "equitas-ux-audit").
export function parseRobots(text = "") {
  const groups = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*(#.*)?$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2];
    if (k === "user-agent") {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
    } else if (cur && (k === "disallow" || k === "allow")) cur.rules.push({ type: k, path: v });
  }
  const applicable = groups.filter((g) => g.agents.includes("*") || g.agents.some((a) => a.includes("equitas-ux-audit")));
  return applicable.flatMap((g) => g.rules).filter((r) => r.path);
}

export function robotsAllows(pathname, rules) {
  let best = null;
  for (const r of rules) {
    const pat = "^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
    if (new RegExp(pat).test(pathname) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.type === "allow"))) best = r;
  }
  return !best || best.type === "allow";
}

export function parseSitemap(xml = "") {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]).slice(0, 500);
}

// Links as a visitor sees them, with the context needed for navigation checks.
export async function extractLinks(page) {
  return page
    .evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      };
      return [...document.querySelectorAll("a[href], area[href]")].map((a) => ({
        href: a.getAttribute("href"),
        text: (a.getAttribute("aria-label") || a.innerText || a.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 120),
        visible: vis(a),
        inNav: !!a.closest("nav, [role=navigation], header, [role=banner]"),
        inFooter: !!a.closest("footer, [role=contentinfo]"),
        inBreadcrumb: !!a.closest('[aria-label*="breadcrumb" i], .breadcrumb, .breadcrumbs, [class*="breadcrumb"]'),
        inMain: !!a.closest("main, [role=main]"),
        isButtonStyled: /\b(btn|button|cta)\b/i.test(a.className || "") || a.getAttribute("role") === "button",
        target: a.getAttribute("target"),
      }));
    })
    .catch(() => []);
}

// Breadth-first, same-origin crawl plan. `visit(url)` performs the actual
// page work and returns { finalUrl, status, links }. All limits are hard.
export async function crawl({ startUrls, manifest, cfg, visit, robotsRules = [], log = () => {} }) {
  const seen = new Map(); // url -> { depth, foundOn: Set, linkTexts: Set }
  const queue = [];
  const skipped = [];
  const add = (url, depth, from, text) => {
    const e = seen.get(url);
    if (e) { if (from) e.foundOn.add(from); if (text) e.linkTexts.add(text); return; }
    seen.set(url, { depth, foundOn: new Set(from ? [from] : []), linkTexts: new Set(text ? [text] : []) });
    queue.push(url);
  };
  for (const s of startUrls) add(s, 0, null, null);
  const visited = [];
  while (queue.length && visited.length < cfg.maxPages) {
    const url = queue.shift();
    const meta = seen.get(url);
    const path = new URL(url).pathname;
    if (cfg.respectRobots && !robotsAllows(path, robotsRules)) { skipped.push({ url: redactUrl(url), reason: "disallowed by robots.txt" }); continue; }
    if (meta.depth > cfg.maxDepth) { skipped.push({ url: redactUrl(url), reason: `deeper than maxDepth ${cfg.maxDepth}` }); continue; }
    const res = await visit(url, meta);
    visited.push({ url, ...res, depth: meta.depth });
    log(`visited ${visited.length}/${cfg.maxPages}: ${new URL(url).pathname} → ${res.status ?? res.error}`);
    for (const l of res.links || []) {
      if (l.kind === "page") add(l.url, meta.depth + 1, url, l.text);
    }
  }
  for (const u of queue) skipped.push({ url: redactUrl(u), reason: `page limit (${cfg.maxPages}) reached` });
  return { visited, skipped, seen };
}
