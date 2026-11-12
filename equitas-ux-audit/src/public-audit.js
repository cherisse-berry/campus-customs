// Public (signed-out) website audit of EQUITAS Intelligence.
//
//   npm run public-audit -- --plan                 show scope, limits and authorization; contacts nothing
//   npm run public-audit                           run within the approved testing window
//   npm run public-audit -- --max-pages 20 --viewports desktop,mobile
//
// Signed-out visitor only: no saved session is loaded, no credentials are
// used, nothing is submitted (all non-GET requests are blocked in the
// browser), protected routes are never requested, one page at a time with a
// delay between loads.
import { chromium } from "playwright";
import { loadManifest, parseArgs, ROOT, isMain, AuthorizationError } from "./lib/manifest.js";
import { Evidence, runId, installNavigationGuard, contextOptions, VIEWPORTS } from "./lib/evidence.js";
import { acquireLock } from "./lib/safety.js";
import { publicAuditConfig, installPublicSafety, isProtectedPath } from "./lib/public-safety.js";
import { normalizeUrl, classifyLink, parseRobots, parseSitemap, extractLinks, crawl } from "./lib/crawl.js";
import { auditViewport } from "./lib/page-audit.js";
import { buildFingerprint, deploymentChanged } from "./lib/diagnostics.js";
import { makeFinding, axeFindings, normMessage } from "./lib/findings.js";
import { redact, redactUrl } from "./lib/redact.js";

// Authorization for a LIVE public audit (Section 5): approved manifest,
// public browsing permitted, and now inside the approved testing window.
export function publicAuditAuthorization(manifest, now = new Date()) {
  const problems = [];
  if (!manifest.authorization?.approved) problems.push("authorization.approved is not true");
  if (!manifest.permittedWorkflows?.navigatePublicPages) problems.push("permittedWorkflows.navigatePublicPages is not true");
  const w = manifest.authorization?.testingWindow;
  const start = w?.start && !String(w.start).startsWith("YYYY") ? new Date(w.start) : null;
  const end = w?.end && !String(w.end).startsWith("YYYY") ? new Date(w.end) : null;
  if (!start || !end || isNaN(start) || isNaN(end)) { if (!manifest._selftest) problems.push("authorization.testingWindow is not set"); }
  else if (now < start || now > end) problems.push(`now (${now.toISOString()}) is outside the approved testing window ${w.start} – ${w.end}${w.timezone ? ` (${w.timezone})` : ""}`);
  return { ok: problems.length === 0, problems };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Reproduction steps from a keyboard-v2 transcript (consecutive keys grouped).
export function keyRepro(k) {
  const steps = [];
  let cur = null;
  for (const t of k.transcript || []) {
    if (cur && cur.key === t.key) { cur.n++; cur.last = t.focusText; continue; }
    if (cur) steps.push(cur);
    cur = { key: t.key, n: 1, first: t.focusText, last: t.focusText };
  }
  if (cur) steps.push(cur);
  return steps.map((s) => `Press ${s.key}${s.n > 1 ? ` ${s.n} times` : ""} — focus: ${s.n > 1 ? `${s.first} … ${s.last}` : s.first}.`);
}
const pathOf = (u) => { try { const x = new URL(u); return x.pathname + (x.search || ""); } catch { return u; } };
const GENERIC = /^(learn more|read more|click here|here|more|details|find out more|see more|continue|go)$/i;
const PROMISES_USE = /\b(start|try|get started|launch|use|begin|sign up|create|build|run)\b/i;

export async function publicAudit({ manifest, viewports, maxPages, log = () => {}, now = new Date() } = {}) {
  manifest ??= loadManifest({ allowUnapproved: true });
  manifest._root ??= ROOT;
  const cfg = publicAuditConfig(manifest);
  if (maxPages) cfg.maxPages = maxPages;
  if (viewports) cfg.viewports = viewports;
  const ev = new Evidence(manifest, runId("UXTEST-PUBLIC-AUDIT"), {
    kind: "public-audit", mode: "public-visitor (signed out)", harnessVersion: "public-audit-2", keyboardDetector: "keyboard-v2", target: manifest.target.baseUrl,
    account: { id: "public-visitor", actualRole: "none (signed out)", actualEntitlement: "none" },
    limits: { ...cfg, expectedPages: cfg.expectedPages.map((e) => e.name), allowedHosts: manifest.target.allowedHosts },
  });
  const auth = publicAuditAuthorization(manifest, now);
  ev.run.authorization = auth;
  if (!auth.ok) return ev.finish({ status: "BLOCKED", reason: `Live public audit not authorized: ${auth.problems.join("; ")}. EQUITAS was not contacted.` });
  const lock = acquireLock(manifest, "public-audit");
  if (!lock.ok) return ev.finish({ status: "BLOCKED", reason: `SESSION_LOCK: ${lock.reason}` });

  const blocked = [];
  const raw = [];
  let fid = 0;
  const base = (page, url, viewport, extra = {}) => ({ id: `${ev.id}-R${++fid}`, runId: ev.id, observedAt: new Date().toISOString(), source: "public-audit", page, url: redactUrl(url), viewport, ...extra });
  let pageLoads = 0;
  const pages = new Map(); // normalized url -> page record
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  ev.run.browser = { name: "chromium", version: browser.version(), headless: true };
  const contexts = {};
  const currentPath = {};

  async function contextFor(vp) {
    if (contexts[vp]) return contexts[vp];
    // Public visitor: no storageState is ever passed here.
    const context = await browser.newContext(contextOptions(vp));
    // Each blocked request records the page that was loading and the time
    // (public-audit-2), so its effect on that page can be assessed later.
    await installNavigationGuard(context, manifest, (b) => blocked.push({ kind: "off-domain-navigation", url: b.url, viewport: vp, page: currentPath[vp] || null, at: new Date().toISOString() }));
    await installPublicSafety(context, manifest, cfg, (b) => blocked.push({ ...b, url: redactUrl(b.url), viewport: vp, page: currentPath[vp] || null, at: new Date().toISOString() }));
    context.on("page", async (p) => { if (await p.opener().catch(() => null)) { blocked.push({ kind: "popup-closed", url: redactUrl(p.url()), viewport: vp }); await p.close().catch(() => {}); } });
    const page = await context.newPage();
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    contexts[vp] = { context, page };
    return contexts[vp];
  }

  // Load one URL at one viewport, collecting console/network observations.
  async function load(url, vp) {
    if (pageLoads >= cfg.maxPageLoads) return { skipped: `page-load limit (${cfg.maxPageLoads}) reached` };
    if (pageLoads > 0) await sleep(cfg.delayMs);
    pageLoads++;
    const { page } = await contextFor(vp);
    currentPath[vp] = pathOf(url);
    const obs = { console: [], exceptions: [], failed: [], httpErrors: [] };
    const host = new URL(manifest.target.baseUrl).hostname;
    const onC = (m) => { if (m.type() === "error") obs.console.push(redact(m.text()).slice(0, 300)); };
    const onE = (e) => obs.exceptions.push(redact(e.message).slice(0, 300));
    const onF = (r) => { const t = r.failure()?.errorText || ""; if (!/blockedbyclient|ERR_BLOCKED_BY_CLIENT|ABORTED/i.test(t)) obs.failed.push({ url: redactUrl(r.url()), type: r.resourceType(), error: t }); };
    const onR = (r) => { if (r.status() >= 400) obs.httpErrors.push({ url: redactUrl(r.url()), status: r.status(), type: r.request().resourceType(), sameSite: (() => { try { return manifest.target.allowedHosts.includes(new URL(r.url()).hostname); } catch { return false; } })() }); };
    page.on("console", onC); page.on("pageerror", onE); page.on("requestfailed", onF); page.on("response", onR);
    const started = Date.now();
    let resp = null, error = null;
    try {
      resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: cfg.navTimeoutMs });
      await page.waitForLoadState("networkidle", { timeout: Math.min(15000, cfg.navTimeoutMs) }).catch(() => {});
    } catch (e) { error = e.message.split("\n")[0]; }
    const chain = [];
    for (let r = resp?.request(); r; r = r.redirectedFrom()) chain.unshift(redactUrl(r.url()));
    page.off("console", onC); page.off("pageerror", onE); page.off("requestfailed", onF); page.off("response", onR);
    return { page, status: resp?.status() ?? null, finalUrl: page.url(), redirectChain: chain, error, loadMs: Date.now() - started, obs, host };
  }

  async function auditAt(rec, vp) {
    const L = await load(rec.url, vp);
    const vpRec = { viewport: vp, size: VIEWPORTS[vp] };
    rec.viewports[vp] = vpRec;
    if (L.skipped) { vpRec.skipped = L.skipped; return null; }
    Object.assign(vpRec, { status: L.status, finalUrl: redactUrl(L.finalUrl), redirectChain: L.redirectChain, error: L.error, loadMs: L.loadMs, console: L.obs.console, exceptions: L.obs.exceptions, failedRequests: L.obs.failed, httpErrors: L.obs.httpErrors });
    vpRec.screenshot = await ev.screenshot(L.page, `${String(pageLoads).padStart(3, "0")}-${vp}-${rec.path}`).catch(() => null);
    if (L.error || !L.status || L.status >= 400) return L;
    try {
      Object.assign(vpRec, await auditViewport(L.page, { viewportName: vp, tabStops: cfg.keyboardTabStops }));
    } catch (e) {
      vpRec.auditError = e.message.split("\n")[0];
    }
    if (!rec.build) rec.build = await buildFingerprint(L.page, manifest);
    return L;
  }

  try {
    // robots.txt and sitemap.xml (plain GETs of public files)
    const { context } = await contextFor("desktop");
    let robotsRules = [];
    try {
      const r = await context.request.get(new URL("/robots.txt", manifest.target.baseUrl).toString(), { timeout: cfg.navTimeoutMs });
      if (r.ok()) robotsRules = parseRobots(await r.text());
      ev.run.robots = { status: r.status(), rules: robotsRules };
    } catch (e) { ev.run.robots = { error: e.message.split("\n")[0] }; }
    const start = [normalizeUrl(manifest.target.baseUrl, manifest.target.baseUrl), ...cfg.seedPaths.map((p) => normalizeUrl(p, manifest.target.baseUrl))].filter(Boolean);
    const sitemapPages = [];
    if (cfg.useSitemap) {
      try {
        const r = await context.request.get(new URL("/sitemap.xml", manifest.target.baseUrl).toString(), { timeout: cfg.navTimeoutMs });
        if (r.ok()) for (const loc of parseSitemap(await r.text())) { const c = classifyLink(loc, manifest.target.baseUrl, manifest, cfg); if (c.kind === "page") sitemapPages.push(c.url); }
        ev.run.sitemap = { status: r.status(), pages: sitemapPages.map(pathOf) };
      } catch (e) { ev.run.sitemap = { error: e.message.split("\n")[0] }; }
    }
    ev.run.buildAtStart = null;

    // 1. Discovery + desktop audit
    const cr = await crawl({
      startUrls: [...new Set([...start, ...sitemapPages])], manifest, cfg, robotsRules, log,
      visit: async (url, meta) => {
        const rec = { url, path: pathOf(url), depth: meta.depth, foundOn: [...meta.foundOn].map(pathOf), linkTexts: [...meta.linkTexts], viewports: {}, links: [], fromSitemapOnly: sitemapPages.includes(url) && !meta.foundOn.size && !start.includes(url) };
        pages.set(url, rec);
        const L = await auditAt(rec, "desktop");
        if (!ev.run.buildAtStart && rec.build) ev.run.buildAtStart = rec.build;
        if (!L || L.skipped) return { status: null, error: L?.skipped || "skipped", links: [] };
        rec.status = L.status; rec.error = L.error; rec.finalUrl = normalizeUrl(L.finalUrl, url);
        if (L.error || !L.status || L.status >= 400) return { status: L.status, error: L.error, links: [] };
        const links = (await extractLinks(L.page)).map((l) => ({ ...l, ...classifyLink(l.href, L.finalUrl, manifest, cfg), text: redact(l.text) }));
        rec.links = links.map(({ href, ...l }) => l);
        return { status: L.status, links };
      },
    });
    ev.run.crawl = { visited: cr.visited.length, skipped: cr.skipped };

    // 2. Other viewports for every page that loaded
    for (const rec of pages.values()) {
      if (!rec.status || rec.status >= 400 || rec.error) continue;
      for (const vp of cfg.viewports.filter((v) => v !== "desktop")) await auditAt(rec, vp);
    }
    const lastPage = [...pages.values()].pop();
    if (lastPage) {
      const { page } = await contextFor("desktop");
      ev.run.buildAtEnd = await buildFingerprint(page, manifest);
    }
  } catch (e) {
    raw.push(makeFinding(base(null, manifest.target.baseUrl, null), "harness-error", { fingerprint: `harness|${normMessage(e.message)}`, title: "Public audit stopped by a harness error", observed: e.message.split("\n")[0] }));
  } finally {
    await browser.close().catch(() => {});
    lock.release();
  }

  // ---------- Findings ----------
  const vpSize = (vp) => VIEWPORTS[vp] ? `${VIEWPORTS[vp].width}×${VIEWPORTS[vp].height}` : "";
  const reproBase = (url, vp) => [`Open ${redactUrl(url)} in Chromium ${ev.run.browser.version} as a signed-out visitor, viewport ${vp} (${vpSize(vp)}).`];
  const statusOf = new Map([...pages.values()].map((p) => [p.url, p]));
  for (const rec of pages.values()) {
    for (const [vp, d] of Object.entries(rec.viewports)) {
      const b = (x = {}) => base(rec.path, rec.url, vp, { evidence: d.screenshot ? [`evidence/runs/${ev.id}/${d.screenshot}`] : [], ...x });
      if (d.skipped) { raw.push(makeFinding(b(), "not-tested", { fingerprint: `not-tested|${d.skipped}`, title: "Viewport not tested", observed: `${rec.path} at ${vp}: ${d.skipped}` })); continue; }
      if (d.error || !d.status) raw.push(makeFinding(b({ repro: reproBase(rec.url, vp) }), "page-load-failure", { fingerprint: `load|${rec.path}`, title: `Page failed to load: ${rec.path}`, observed: d.error || "no response" }));
      else if (d.status >= 400) raw.push(makeFinding(b({ repro: reproBase(rec.url, vp) }), "http-error-page", { fingerprint: `http|${rec.path}`, title: `HTTP ${d.status} for ${rec.path}`, observed: `${rec.path} returned HTTP ${d.status}${rec.foundOn.length ? `; linked from ${rec.foundOn.slice(0, 5).join(", ")}` : ""}.` }));
      for (const h of d.httpErrors || []) if (h.sameSite && h.type !== "document") raw.push(makeFinding(b({ repro: [...reproBase(rec.url, vp), "Open the browser's network panel and reload."] }), "missing-asset", { fingerprint: `asset|${pathOf(h.url)}`, title: `Missing asset (HTTP ${h.status}): ${pathOf(h.url)}`, observed: `${h.type} ${h.url} returned ${h.status} on ${rec.path}.` }));
      for (const f of d.failedRequests || []) raw.push(makeFinding(b(), "failed-request", { fingerprint: `failed|${pathOf(f.url)}|${f.error}`, title: `Request failed: ${pathOf(f.url).slice(0, 80)}`, observed: `${f.type} ${f.url} failed (${f.error}) on ${rec.path}.` }));
      for (const c of d.console || []) raw.push(makeFinding(b({ repro: [...reproBase(rec.url, vp), "Open the browser console."] }), "console-error", { fingerprint: `console|${normMessage(c)}`, title: `Console error: ${normMessage(c).slice(0, 80)}`, observed: c }));
      for (const x of d.exceptions || []) raw.push(makeFinding(b(), "page-exception", { fingerprint: `exception|${normMessage(x)}`, title: `Uncaught exception: ${normMessage(x).slice(0, 80)}`, observed: x }));
      if (!d.structure) continue;
      if (d.auditError) raw.push(makeFinding(b(), "harness-error", { fingerprint: `harness|audit|${normMessage(d.auditError)}`, title: "Page audit step failed", observed: d.auditError }));
      if (d.axe?.error) raw.push(makeFinding(b(), "harness-error", { fingerprint: `harness|axe|${normMessage(d.axe.error)}`, title: "Accessibility scanner failed on a page", observed: d.axe.error }));
      for (const f of axeFindings(b({ repro: reproBase(rec.url, vp) }), d.axe)) { f.id = `${ev.id}-R${++fid}`; f.repro = [...reproBase(rec.url, vp), `Find the element ${f.selector}${f.text ? ` (text "${f.text}")` : ""}.`, `Check: ${f.title.replace(/^(Accessibility|Best practice): /, "")}.`]; raw.push(f); }
      for (const v of d.axe?.incomplete || []) raw.push(makeFinding(b(), "axe-needs-review", { fingerprint: `axe-incomplete|${v.id}`, title: `Needs manual review: ${v.help}`, observed: `axe-core could not decide "${v.id}" for ${v.nodeCount} element(s) on ${rec.path} at ${vp}.`, wcag: v.wcag.map((t) => t.replace(/^wcag(\d)(\d)(\d+)$/, "$1.$2.$3")) }));
      if (["reflow320", "narrow320"].includes(vp) && d.reflow?.horizontalOverflowPx > 0) raw.push(makeFinding(b({ repro: [...reproBase(rec.url, vp), "Scroll horizontally."] }), "reflow-overflow", { fingerprint: `reflow|${d.reflow.widestElements?.[0] || rec.path}`, title: `Horizontal scrolling needed at 320 px${d.reflow.widestElements?.[0] ? ` (${d.reflow.widestElements[0]})` : ""}`, observed: `Page is ${d.reflow.scrollWidth}px wide in a ${d.reflow.viewportWidth}px viewport; widest elements: ${(d.reflow.widestElements || []).join(", ")}.` }));
      for (const o of d.layout?.offscreen || []) raw.push(makeFinding(b({ repro: reproBase(rec.url, vp) }), "offscreen-control", { fingerprint: `offscreen|${o.selector}`, selector: o.selector, title: `Control partly outside the screen: "${o.name}"`, observed: `${o.selector} spans ${o.left}–${o.right}px in a ${o.viewportWidth}px viewport.` }));
      for (const c of d.layout?.covered || []) raw.push(makeFinding(b({ repro: reproBase(rec.url, vp) }), "covered-control", { fingerprint: `covered|${c.selector}|${c.coveredBy}`, selector: c.selector, title: `Control covered by other content: "${c.name}"`, observed: `The centre of ${c.selector} is covered by ${c.coveredBy}.` }));
      for (const t of d.layout?.smallTargets || []) raw.push(makeFinding(b({ repro: reproBase(rec.url, vp) }), "small-target", { fingerprint: `target|${t.selector}`, selector: t.selector, text: t.name, title: `Small touch target: "${t.name || t.selector}"`, observed: `${t.selector} is ${t.width}×${t.height} CSS px (minimum 24×24).` }));
      if (d.textSpacing?.newlyClipped > 0) raw.push(makeFinding(b(), "text-spacing-clip", { fingerprint: `spacing|${rec.path}`, title: `Text clipped with increased text spacing on ${rec.path}`, observed: `${d.textSpacing.newlyClipped} element(s) clip text after WCAG 1.4.12 spacing is applied.` }));
      if (["mobile", "reflow320", "narrow320"].includes(vp) && d.layout?.tinyTextNodes > 0) raw.push(makeFinding(b(), "tiny-text", { fingerprint: `tiny|${rec.path}`, title: `Text smaller than 12px on ${rec.path}`, observed: `${d.layout.tinyTextNodes} of ${d.layout.textNodes} text blocks are below 12px at ${vp}.` }));
      for (const n of d.keyboard?.withoutVisibleFocus || []) raw.push(makeFinding(b({ repro: [...reproBase(rec.url, vp), "Press Tab until the control is focused."] }), "no-visible-focus", { fingerprint: `focus|${n}`, title: `No visible focus indicator: ${n}`, observed: `Focusing ${n} showed no outline or focus shadow (heuristic: outline/box-shadow only).` }));
      for (const n of d.keyboard?.obscured || []) raw.push(makeFinding(b({ repro: [...reproBase(rec.url, vp), "Press Tab until the control is focused."] }), "focus-obscured", { fingerprint: `obscured|${n}`, title: `Focused control hidden by other content: ${n}`, observed: `When focused, ${n} was covered at its centre.` }));
      if (d.keyboard?.classification === "TRAP") {
        const k = d.keyboard;
        raw.push(makeFinding(b({ repro: [...reproBase(rec.url, vp), ...keyRepro(k)] }), "keyboard-trap", {
          fingerprint: `trap|${(k.containment?.controls || []).join("|")}`,
          title: `Keyboard trap: focus held in ${k.containment?.controls?.join(", ")}`,
          observed: `${k.reason} Escape attempts: ${(k.escapeAttempts || []).map((x) => `${x.method}${x.presses ? ` ×${x.presses}` : ""}: ${x.escaped ? "escaped" : "did not escape"}`).join("; ")}. Component state: ${JSON.stringify(k.containment?.state || {})}.`,
          details: { detector: k.version, containment: k.containment, escapeAttempts: k.escapeAttempts, transcript: k.transcript },
        }));
      } else if (d.keyboard?.classification === "INCONCLUSIVE") {
        raw.push(makeFinding(b(), "keyboard-unobservable", { fingerprint: `kbd-unobservable|${d.keyboard.transcript?.findLast?.((t) => t.focus?.frameTitle)?.focus.frameTitle || rec.path}`, title: `Keyboard behaviour not observable on ${rec.path}`, observed: d.keyboard.reason, details: { detector: d.keyboard.version, transcript: d.keyboard.transcript } }));
      }
      if (vp === "desktop" && d.structure && !d.structure.skipLink && (d.structure.landmarks?.main ?? 0) === 0) raw.push(makeFinding(b(), "skip-link-missing", { fingerprint: "skip-link|site", title: "No skip link and no main landmark", observed: `${rec.path} has neither a skip link nor a <main> landmark.` }));
      if (vp === "desktop" && d.structure && (d.structure.h1Count !== 1 || d.structure.headingSkips.length)) raw.push(makeFinding(b(), "heading-structure", { fingerprint: `headings|${rec.path}`, title: `Heading structure on ${rec.path}`, observed: `${d.structure.h1Count} h1 element(s)${d.structure.headingSkips.length ? `; skipped levels: ${d.structure.headingSkips.slice(0, 3).join("; ")}` : ""}.` }));
      for (const dl of d.structure?.dialogs || []) if (!dl.name) raw.push(makeFinding(b(), "dialog-no-name", { fingerprint: `dialog|${dl.text.slice(0, 40)}`, title: "Dialog without an accessible name", observed: `A visible dialog ("${dl.text.slice(0, 60)}") has no aria-label/aria-labelledby.` }));
      if (d.menu?.found && !d.menu.stateExposed) raw.push(makeFinding(b({ repro: [...reproBase(rec.url, vp), `Activate the "${d.menu.name}" button.`] }), "menu-state-not-exposed", { fingerprint: "menu|state", title: "Mobile menu button does not expose its state", observed: `aria-expanded before: ${d.menu.ariaExpandedBefore}, after opening: ${d.menu.ariaExpandedAfter}.` }));
      if (d.menu?.found && !d.menu.closedByEscape) raw.push(makeFinding(b(), "menu-escape", { fingerprint: "menu|escape", title: "Mobile menu does not close with Escape", observed: `After Escape, "${d.menu.name}" still reported expanded.` }));
      if (d.menu && !d.menu.found && !d.menu.visibleNavLinks) raw.push(makeFinding(b(), "no-mobile-navigation", { fingerprint: "menu|missing", title: "No navigation found at phone width", observed: `At ${vp}, ${rec.path} showed no menu button and no visible navigation links.` }));
      for (const f of d.structure?.forms || []) if (vp === "desktop") raw.push(makeFinding(b(), "form-not-submitted", { fingerprint: `form|${rec.path}|${f.purpose}`, title: `Form not submitted (prohibited): ${f.purpose || "form"} on ${rec.path}`, observed: `${f.fields} field(s), method ${f.method}. Error identification, suggestions and prevention (3.3.x) were not evaluated because submitting would create production records.` }));
      for (const s of vp === "desktop" ? d.availability?.signals || [] : []) raw.push(makeFinding(b(), "feature-planned", { fingerprint: `planned|${rec.path}|${s.status}`, title: `${s.status === "planned" ? "Planned" : s.status === "preview" ? "Preview / early access" : "Unavailable"} capability described on ${rec.path}`, observed: `"…${s.context}…"` }));
    }
  }

  // ---------- Site-level navigation analysis (desktop link data) ----------
  const ok = [...pages.values()].filter((p) => p.status && p.status < 400 && !p.error);
  const linkStatus = (url) => statusOf.get(url) || null;
  const navSets = new Map(ok.map((p) => [p.path, [...new Set(p.links.filter((l) => l.inNav && l.kind === "page" && !l.inFooter).map((l) => pathOf(l.url)))].sort()]));
  const freq = new Map();
  for (const s of navSets.values()) { const k = s.join("|"); freq.set(k, (freq.get(k) || 0) + 1); }
  const modal = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]?.split("|").filter(Boolean) || [];
  const textDest = new Map();
  for (const p of ok) {
    const b = (x = {}) => base(p.path, p.url, "desktop", { evidence: p.viewports.desktop?.screenshot ? [`evidence/runs/${ev.id}/${p.viewports.desktop.screenshot}`] : [], ...x });
    const s = navSets.get(p.path);
    if (ok.length >= 3 && modal.length && s.join("|") !== modal.join("|")) {
      const missing = modal.filter((x) => !s.includes(x)), extra = s.filter((x) => !modal.includes(x));
      if (missing.length || extra.length) raw.push(makeFinding(b(), "nav-inconsistent", { fingerprint: `nav|${p.path}`, title: `Navigation differs on ${p.path}`, observed: `Compared with most pages, the navigation ${missing.length ? `lacks ${missing.join(", ")}` : ""}${missing.length && extra.length ? " and " : ""}${extra.length ? `adds ${extra.join(", ")}` : ""}.` }));
    }
    const internal = p.links.filter((l) => l.kind === "page" && pathOf(l.url) !== p.path);
    if (!internal.length) raw.push(makeFinding(b(), "dead-end", { fingerprint: `deadend|${p.path}`, title: `Dead end: ${p.path}`, observed: "The page links to no other public page." }));
    const outs = [...new Set(internal.map((l) => l.url))];
    if (outs.length === 1) { const t = pages.get(outs[0]); if (t && [...new Set(t.links.filter((l) => l.kind === "page").map((l) => l.url))].every((u) => u === p.url || u === t.url)) raw.push(makeFinding(b(), "navigation-loop", { fingerprint: `loop|${[p.path, t.path].sort().join("|")}`, title: `Navigation loop between ${p.path} and ${t.path}`, observed: "These pages only link to each other." })); }
    const segs = p.path.split("?")[0].split("/").filter(Boolean);
    if (segs.length >= 2 && !p.viewports.desktop?.structure?.breadcrumbs) {
      const parent = "/" + segs.slice(0, -1).join("/");
      if (!internal.some((l) => pathOf(l.url) === parent)) raw.push(makeFinding(b(), "no-return-navigation", { fingerprint: `return|${p.path}`, title: `No breadcrumb or parent link on ${p.path}`, observed: `${p.path} has no breadcrumbs and no link to ${parent}.` }));
    }
    for (const l of p.links) {
      if (l.kind === "protected") raw.push(makeFinding(b(), "not-tested", { fingerprint: `protected|${l.path}`, title: `Protected route not visited: ${l.path}`, observed: `"${l.text}" on ${p.path} links to ${l.path}, which the public audit does not request (sign-in/app/transactional route).` }));
      if (l.kind !== "page" || !l.visible) continue;
      const t = linkStatus(l.url);
      if (t && (t.error || (t.status && t.status >= 400))) raw.push(makeFinding(b({ repro: [...reproBase(p.url, "desktop"), `Click the link "${l.text}".`] }), "broken-internal-link", { fingerprint: `broken|${pathOf(l.url)}`, title: `Broken link to ${pathOf(l.url)}`, observed: `"${l.text}" on ${p.path} leads to ${pathOf(l.url)}, which returned ${t.status ?? t.error}.` }));
      if (t?.finalUrl && t.finalUrl !== l.url) {
        const fp = pathOf(t.finalUrl);
        if (isProtectedPath(new URL(t.finalUrl).pathname, cfg)) raw.push(makeFinding(b(), "link-to-sign-in", { fingerprint: `signin|${pathOf(l.url)}`, title: `Public link leads to a protected page: "${l.text}"`, observed: `${pathOf(l.url)} redirects to ${fp}.` }));
        else raw.push(makeFinding(b(), "unexpected-redirect", { fingerprint: `redirect|${pathOf(l.url)}`, title: `Link redirects: ${pathOf(l.url)} → ${fp}`, observed: `"${l.text}" on ${p.path} points to ${pathOf(l.url)} but ends at ${fp}.` }));
      }
      if (l.text && GENERIC.test(l.text) && l.inMain) raw.push(makeFinding(b(), "generic-link-text", { fingerprint: `generic|${l.text.toLowerCase()}`, title: `Generic link text: "${l.text}"`, observed: `"${l.text}" on ${p.path} → ${pathOf(l.url)}.` }));
      if (l.text && !GENERIC.test(l.text)) { const k = l.text.toLowerCase(); if (!textDest.has(k)) textDest.set(k, new Map()); textDest.get(k).set(pathOf(l.url), p.path); }
      const dest = pages.get(t?.finalUrl || l.url) || t;
      const destSignals = dest?.viewports?.desktop?.availability?.signals || [];
      if (l.text && PROMISES_USE.test(l.text) && (destSignals.some((s) => s.status !== "preview" || /waitlist|wait list|early access|request access/i.test(s.phrase)))) raw.push(makeFinding(b(), "availability-mismatch", { fingerprint: `availability|${l.text.toLowerCase()}|${pathOf(l.url)}`, title: `"${l.text}" leads to a page describing ${destSignals.map((s) => s.phrase).join(", ")}`, observed: `"${l.text}" on ${p.path} → ${pathOf(l.url)}, which says: "…${destSignals[0].context}…"` }));
    }
  }
  for (const [text, dests] of textDest) if (dests.size > 1) raw.push(makeFinding(base(null, manifest.target.baseUrl, "desktop"), "same-text-different-destination", { fingerprint: `sametext|${text}`, title: `"${text}" links to ${dests.size} different places`, observed: [...dests].map(([d, on]) => `${d} (e.g. on ${on})`).join("; ") }));
  for (const s of ev.run.crawl?.skipped || []) raw.push(makeFinding(base(pathOf(s.url), s.url, null), "not-tested", { fingerprint: `skipped|${s.reason}`, title: `Pages not audited: ${s.reason}`, observed: `${pathOf(s.url)} — ${s.reason}.` }));

  // Expected pages: found by path or link text; never guessed.
  ev.run.coverage = cfg.expectedPages.map((e) => {
    const hit = ok.find((p) => e.match.some((m) => new RegExp(m, "i").test(p.path) || p.linkTexts.some((t) => new RegExp(m, "i").test(t))));
    if (!hit) raw.push(makeFinding(base(null, manifest.target.baseUrl, null), "expected-page-not-found", { fingerprint: `expected|${e.name}`, title: `Expected page not found via navigation: ${e.name}`, observed: `No discovered public page matched "${e.name}". It may not exist, may be named differently, may be protected, or may be beyond the crawl limits.` }));
    return { name: e.name, found: !!hit, path: hit?.path || null };
  });

  if (deploymentChanged(ev.run.buildAtStart, ev.run.buildAtEnd)) {
    ev.run.validity = { warnings: ["deployment changed during run"] };
    raw.push(makeFinding(base(null, manifest.target.baseUrl, null), "harness-error", { fingerprint: "validity|deployment-changed", title: "EQUITAS appears to have been redeployed during the audit", observed: `${JSON.stringify(ev.run.buildAtStart)} → ${JSON.stringify(ev.run.buildAtEnd)}. Do not compare pages audited before and after.` }));
  }

  ev.run.pages = [...pages.values()].map((p) => ({ ...p, url: redactUrl(p.url), finalUrl: p.finalUrl ? redactUrl(p.finalUrl) : null }));
  ev.run.blockedRequests = blocked;
  ev.run.pageLoads = pageLoads;
  ev.run.rawFindings = raw;
  return ev.finish({ status: "COMPLETED", reason: `${ok.length} page(s) audited at ${cfg.viewports.length} viewport(s); ${raw.length} observation(s); ${blocked.filter((b) => b.kind === "write-request").length} write request(s) blocked.` });
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  let manifest;
  try { manifest = loadManifest({ allowUnapproved: true }); } catch (e) { console.error(e.message); process.exit(1); }
  manifest._root = ROOT;
  const cfg = publicAuditConfig(manifest);
  if (args["max-pages"]) cfg.maxPages = Number(args["max-pages"]);
  const viewports = args.viewports ? String(args.viewports).split(",") : cfg.viewports;
  const auth = publicAuditAuthorization(manifest);
  if (args.plan) {
    console.log(`Public audit plan for ${manifest.target.baseUrl}`);
    console.log(`Authorization for a live run: ${auth.ok ? "OK" : "NOT AUTHORIZED — " + auth.problems.join("; ")}`);
    console.log(`Viewports: ${viewports.join(", ")} · max pages ${cfg.maxPages} · max depth ${cfg.maxDepth} · max page loads ${cfg.maxPageLoads} · ${cfg.delayMs} ms between loads · timeout ${cfg.navTimeoutMs} ms`);
    console.log(`Never requested: paths matching ${cfg.protectedPathPatterns.length} protected patterns; hosts ${cfg.blockedHosts.join(", ")}`);
    console.log("Blocked in the browser: every non-GET request (forms, fetch/XHR posts, beacons). No saved session is loaded.");
    console.log(`Estimated maximum page loads: ${Math.min(cfg.maxPageLoads, cfg.maxPages * viewports.length)} (≈ ${Math.round((Math.min(cfg.maxPageLoads, cfg.maxPages * viewports.length) * (cfg.delayMs + 6000)) / 60000)} min).`);
    console.log("No request was made.");
    process.exit(0);
  }
  if (!auth.ok) { console.error(`Live public audit NOT run: ${auth.problems.join("; ")}.\nUpdate authorization.testingWindow (and approval) in config/authorization-manifest.json, then rerun.`); process.exit(3); }
  const run = await publicAudit({ manifest, viewports, maxPages: cfg.maxPages, log: (m) => console.log("  " + m) });
  console.log(`${run.outcome.status}: ${run.outcome.reason}\nEvidence: evidence/runs/${run.runId}/run.json\nNext: npm run report && npm run validate-reports`);
}
