// Offline self-test for the PUBLIC website audit. A local fixture site
// reproduces the situations the audit must handle; the server logs every
// request so the tests can prove what was (and was not) touched.
// Never contacts EQUITAS or the Anthropic API.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { ROOT } from "../src/lib/manifest.js";
import { publicAudit, publicAuditAuthorization } from "../src/public-audit.js";
import { investigate } from "../src/investigate-finding.js";
import { buildReports } from "../src/report.js";
import { validateReports } from "../src/validate-reports.js";
import { collect } from "../src/lib/collect.js";
import { CATEGORY } from "../src/lib/findings.js";
import { contrastRatio, over } from "../src/lib/contrast.js";
import { normalizeUrl, classifyLink, parseRobots, robotsAllows } from "../src/lib/crawl.js";
import { publicAuditConfig, installPublicSafety, isSafeMenuToggle } from "../src/lib/public-safety.js";
import { contextOptions } from "../src/lib/evidence.js";

// ---------------- fixture site ----------------
const GOLD = [201, 162, 39], GOLD15 = [212, 175, 55, 0.15];
const css = `body{font-family:sans-serif;margin:0} header{display:flex;gap:12px;padding:8px} .bg-gold\\/15{background-color:rgb(212 175 55 / 0.15)} .gap-1{gap:4px} .py-0\\.5{padding:2px 0} .badge-text{color:rgb(${GOLD.join(",")});font-size:14px}
 @media (max-width:600px){ #site-nav{display:none} #site-nav.open{display:flex;flex-direction:column} }`;
const NAV = (omit = []) => [["For Researchers", "/for-researchers"], ["For Institutions", "/for-institutions"], ["Pricing", "/pricing"], ["How It Works", "/how-it-works"], ["About", "/about"], ["Log in", "/login"]].filter(([t]) => !omit.includes(t)).map(([t, h]) => `<a href="${h}">${t}</a>`).join(" ");
const page = (title, body, { nav = NAV(), main = true, scripts = "" } = {}) => `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${css}</style></head><body>
<a href="#main" class="skip">Skip to main content</a>
<header><button id="menu-btn" aria-expanded="false" aria-controls="site-nav" aria-label="Open menu" onclick="const n=document.getElementById('site-nav');const o=this.getAttribute('aria-expanded')==='true';this.setAttribute('aria-expanded',String(!o));n.classList.toggle('open',!o)">☰</button>
<nav id="site-nav" aria-label="Main">${nav}</nav></header>
${main ? `<main id="main">${body}</main>` : body}
<footer><a href="/privacy">Privacy Policy</a> <a href="/terms">Terms of Service</a> <a href="/accessibility">Accessibility</a> <a href="/security">Data Security</a></footer>${scripts}</body></html>`;
const PAGES = {
  "/": page("EQUITAS — Home", `<h1>Research development for every investigator</h1>
    <span class="bg-gold/15 gap-1 py-0.5"><span class="badge-text">New: research journey</span></span>
    <p><a class="btn" href="/early-access">Start now</a> <a href="/how-it-works">Learn more</a></p>
    <p><a href="/old-page">Old resources page</a> · <a href="/about-us">About us (old link)</a> · <a href="/internal/secret">Internal</a> · <a href="https://example.org/partner">Partner</a> · <a href="/app/projects">Open the app</a></p>
    <div role="dialog" style="position:fixed;bottom:0;left:0;background:#fff;border:1px solid #000">We use cookies. <button aria-label="Close banner" style="width:16px;height:16px;padding:0">x</button></div>`),
  "/for-researchers": page("For Researchers", `<h1>For researchers</h1><h3>Jump straight to h3</h3><p><a href="/research-journey/imagine">Imagine</a> <a href="/research-journey/transform">Transform</a></p>`),
  "/for-institutions": page("For Institutions", `<h1>For institutions</h1><p>Licensing for research offices.</p>`, { nav: NAV(["Pricing"]) }),
  "/pricing": page("Pricing", `<h1>Pricing</h1><section><h2>Pro</h2><p>$29 per month</p><button>Choose Pro</button> <a href="https://checkout.stripe.com/c/pay/test">Subscribe</a></section>`),
  "/how-it-works": page("How It Works", `<h1>How it works</h1><img src="/img/missing.png" alt="Diagram">`, { scripts: `<script>console.error("boom: widget failed");setTimeout(()=>{throw new Error("kaboom")},50)</script>` }),
  "/research-journey/imagine": page("Imagine", `<h1>Imagine</h1><p>The Imagine studio is coming soon.</p>`),
  "/research-journey/transform": page("Transform", `<nav aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/for-researchers">Research journey</a> › <span aria-current="page">Transform</span></nav><h1>Transform</h1>`),
  "/early-access": page("Early Access", `<h1>Early access</h1><p>Join the waitlist.</p><form id="ea" method="post" action="/early-access/submit"><label>Name <input name="name"></label><label>Email <input type="email" name="email"></label><button type="submit">Request access</button></form>`,
    { scripts: `<script>fetch("/api/track",{method:"POST",body:"x"}).catch(()=>{});setTimeout(()=>{try{document.getElementById("ea").requestSubmit()}catch(e){}},300)</script>` }),
  "/about": page("About", `<h1>About</h1><p><a href="/mission">Our mission</a></p><div style="width:600px;background:#eee">Wide comparison table</div>`),
  "/mission": page("Mission", `<h1>Mission</h1><p><a href="/dead-end">A page with nowhere to go</a> <a href="/loop-a">Loop</a></p>`),
  "/dead-end": `<!doctype html><html lang="en"><head><title>Dead end</title></head><body><main><h1>Dead end</h1><p>Nothing else here.</p></main></body></html>`,
  "/loop-a": `<!doctype html><html lang="en"><head><title>Loop A</title></head><body><main><h1>Loop A</h1><a href="/loop-b">Next</a></main></body></html>`,
  "/loop-b": `<!doctype html><html lang="en"><head><title>Loop B</title></head><body><main><h1>Loop B</h1><a href="/loop-a">Back</a></main></body></html>`,
  "/privacy": page("Privacy Policy", "<h1>Privacy policy</h1>"),
  "/terms": page("Terms of Service", "<h1>Terms of service</h1>"),
  "/accessibility": page("Accessibility", "<h1>Accessibility statement</h1>"),
  "/security": page("Data Security", "<h1>Data security</h1>"),
  "/sitemap-only": page("Sitemap only", "<h1>Only in the sitemap</h1>"),
};
const requests = [];
const server = http.createServer((req, res) => {
  const p = req.url.split("?")[0];
  requests.push({ method: req.method, path: p });
  if (p === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("User-agent: *\nDisallow: /internal/\n"); }
  if (p === "/sitemap.xml") { res.writeHead(200, { "content-type": "application/xml" }); return res.end(`<urlset><url><loc>http://127.0.0.1:${server.address().port}/</loc></url><url><loc>http://127.0.0.1:${server.address().port}/sitemap-only</loc></url></urlset>`); }
  if (p === "/about-us") { res.writeHead(301, { location: "/about" }); return res.end(); }
  if (PAGES[p] && req.method === "GET") { res.writeHead(200, { "content-type": "text/html" }); return res.end(PAGES[p]); }
  res.writeHead(404, { "content-type": "text/html" }); res.end("<!doctype html><title>Not found</title><h1>Not found</h1>");
}).listen(0);
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}/`;

const tmpRoot = fs.mkdtempSync(path.join(ROOT, "evidence-selftest-"));
const exampleManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "authorization-manifest.example.json"), "utf8"));
const mkManifest = (over = {}) => {
  const m = structuredClone(exampleManifest);
  Object.assign(m, { _selftest: true, _root: tmpRoot });
  m.authorization.approved = true;
  m.authorization.testingWindow = { start: new Date(Date.now() - 3.6e6).toISOString(), end: new Date(Date.now() + 3.6e6).toISOString(), timezone: "UTC" };
  m.target = { ...m.target, baseUrl: BASE, allowedHosts: ["127.0.0.1"] };
  m.publicAudit = { ...m.publicAudit, maxPages: 30, delayMs: 20, navTimeoutMs: 15000, viewports: ["desktop", "mobile", "reflow320"], keyboardTabStops: 15 };
  m.accounts = [];
  return Object.assign(m, over);
};

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log("  ✓ " + m); };
const posts = () => requests.filter((r) => r.method !== "GET" && r.method !== "HEAD").length;

try {
  console.log("units: URLs, robots, link classification, safety predicates");
  const cfg = publicAuditConfig(mkManifest());
  ok(normalizeUrl("/pricing/?utm_source=x#plans", BASE) === `${BASE}pricing`, "URL normalisation drops tracking parameters, fragments and trailing slashes");
  const rules = parseRobots("User-agent: *\nDisallow: /internal/\nAllow: /internal/public\nUser-agent: other\nDisallow: /");
  ok(!robotsAllows("/internal/x", rules) && robotsAllows("/internal/public", rules) && robotsAllows("/about", rules), "robots.txt rules for * are applied (longest match, Allow wins ties)");
  const m0 = mkManifest();
  ok(classifyLink("/login", BASE, m0, cfg).kind === "protected" && classifyLink("/app/projects", BASE, m0, cfg).kind === "protected" && classifyLink("/admin", BASE, m0, cfg).kind === "protected", "sign-in, app and admin links are classified protected (never requested)");
  ok(classifyLink("https://example.org", BASE, m0, cfg).kind === "external" && classifyLink("mailto:a@b.org", BASE, m0, cfg).kind === "contact" && classifyLink("/files/x.pdf", BASE, m0, cfg).kind === "asset", "external, contact and asset links are not crawled");
  ok(!publicAuditAuthorization(mkManifest({ authorization: { approved: true, testingWindow: { start: "2026-11-01T09:00", end: "2026-11-01T17:00" } } }), new Date("2026-11-20T10:00:00Z")).ok, "an expired testing window refuses live testing");
  const b0 = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const ctx0 = await b0.newContext();
  const p0 = await ctx0.newPage();
  await p0.setContent(`<header><button aria-expanded="false" aria-controls="n" aria-label="Open menu">☰</button></header><form><header><button type="submit" aria-expanded="false" aria-label="Menu">go</button></header></form><header><a href="/x" aria-expanded="false" aria-label="Menu">m</a></header>`);
  ok((await isSafeMenuToggle(p0.locator("button").first())).ok && !(await isSafeMenuToggle(p0.locator("button").nth(1))).ok && !(await isSafeMenuToggle(p0.locator("a"))).ok, "only real menu disclosures are clickable; submit buttons, form controls and links are not");
  await ctx0.close();
  const ctx1 = await b0.newContext(contextOptions("desktop"));
  const blockedUnit = [];
  await installPublicSafety(ctx1, m0, cfg, (b) => blockedUnit.push(b));
  const p1 = await ctx1.newPage();
  await p1.goto(BASE);
  const before = posts();
  await p1.evaluate(async (base) => { for (const method of ["POST", "PUT", "PATCH", "DELETE"]) await fetch(base + "api/x", { method }).catch(() => {}); navigator.sendBeacon?.(base + "beacon", "x"); }, BASE);
  await p1.waitForTimeout(300);
  ok(posts() === before && blockedUnit.filter((b) => b.kind === "write-request").length >= 4, "POST, PUT, PATCH, DELETE and beacons are blocked inside the browser");
  await p1.goto(BASE + "login").catch(() => {});
  ok(!requests.some((r) => r.path === "/login") && blockedUnit.some((b) => b.kind === "protected-route"), "navigation to a protected route is blocked before any request");
  await b0.close();

  console.log("authorization: expired window contacts nothing");
  let n = requests.length;
  const expired = await publicAudit({ manifest: mkManifest({ authorization: { approved: true, testingWindow: { start: "2026-11-01T09:00:00Z", end: "2026-11-01T17:00:00Z" } } }) });
  ok(expired.outcome.status === "BLOCKED" && /outside the approved testing window/.test(expired.outcome.reason) && requests.length === n, "public audit BLOCKED outside the window; no request made");
  const inv0 = await investigate({ manifest: mkManifest({ authorization: { approved: true, testingWindow: { start: "2026-11-01T09:00:00Z", end: "2026-11-01T17:00:00Z" } } }), selector: ".x" });
  ok(inv0.status === "BLOCKED" && requests.length === n, "investigation BLOCKED outside the window; no request made");
  const noPublic = mkManifest(); noPublic.permittedWorkflows = { ...noPublic.permittedWorkflows, navigatePublicPages: false };
  ok((await publicAudit({ manifest: noPublic })).outcome.status === "BLOCKED" && requests.length === n, "public audit BLOCKED when public browsing is not permitted");

  console.log("public audit run 1 (desktop, mobile, 320 px)");
  n = requests.length;
  const run1 = await publicAudit({ manifest: mkManifest() });
  const r1 = requests.slice(n);
  const paths = new Set((run1.pages || []).map((p) => p.path));
  const F = (rule) => run1.rawFindings.filter((f) => f.ruleId === rule);
  ok(run1.outcome.status === "COMPLETED", `audit completed: ${run1.outcome.reason}`);
  ok(["/", "/for-researchers", "/for-institutions", "/pricing", "/how-it-works", "/research-journey/imagine", "/research-journey/transform", "/early-access", "/about", "/mission", "/privacy", "/terms", "/accessibility", "/security"].every((p) => paths.has(p)), "discovery reaches every linked public page");
  ok(paths.has("/sitemap-only") && run1.pages.find((p) => p.path === "/sitemap-only").fromSitemapOnly, "page listed only in sitemap.xml is discovered and labelled");
  ok(!r1.some((r) => r.path.startsWith("/internal/")) && run1.crawl.skipped.some((s) => /robots/.test(s.reason)), "robots.txt-disallowed page never requested");
  ok(!r1.some((r) => r.path === "/login" || r.path.startsWith("/app")), "protected routes (sign-in, app) never requested");
  ok(F("not-tested").some((f) => /Protected route not visited: \/login/.test(f.title)), "protected links recorded as not tested");
  ok(r1.every((r) => r.method === "GET" || r.method === "HEAD") && !r1.some((r) => r.path === "/early-access/submit" || r.path === "/api/track"), "no form or POST reached the server (early-access auto-submit and tracking post blocked)");
  ok(run1.blockedRequests.filter((b) => b.kind === "write-request").length >= 2 && run1.blockedRequests.some((b) => b.method === "FORM-SUBMIT"), "blocked write attempts (including the in-page form submit) are recorded in the evidence");
  ok(run1.pages.find((p) => p.path === "/early-access").viewports.desktop.structure?.forms?.length === 1, "a page that tries to auto-submit stays intact and is fully audited");
  ok(!run1.pages.some((p) => /stripe|example\.org/.test(p.url)), "payment and external links are not crawled");
  ok(F("broken-internal-link").some((f) => f.fingerprint === "broken|/old-page") && F("http-error-page").some((f) => f.page === "/old-page"), "broken internal link (/old-page → 404) found");
  ok(F("unexpected-redirect").some((f) => f.fingerprint === "redirect|/about-us"), "redirecting link (/about-us → /about) found");
  ok(F("console-error").length && F("page-exception").length && F("missing-asset").some((f) => /missing\.png/.test(f.title)), "console error, uncaught exception and missing image recorded");
  const contrast = run1.rawFindings.filter((f) => f.ruleId === "axe:color-contrast" && /bg-gold|badge-text/.test(f.selector));
  ok(contrast.length === 3 && contrast.every((f) => f.details.contrast?.ratio < 4.5), "low-contrast badge found at all 3 viewports with measured ratio");
  ok(F("small-target").some((f) => f.text === "Close banner") && F("dialog-no-name").length, "small touch target and unnamed dialog found");
  ok(F("reflow-overflow").some((f) => f.page === "/about" && f.viewport === "reflow320"), "horizontal overflow at 320 px found on /about");
  const home320 = run1.pages.find((p) => p.path === "/").viewports.reflow320;
  ok(home320.menu?.found && home320.menu.stateExposed && home320.menu.opensLinks && !F("menu-state-not-exposed").length, "mobile menu opened, aria-expanded exposed, links shown, closed again");
  ok(F("heading-structure").some((f) => f.page === "/for-researchers"), "skipped heading level found");
  ok(F("nav-inconsistent").some((f) => f.page === "/for-institutions" && /lacks \/pricing/.test(f.observed)), "inconsistent navigation found (/for-institutions lacks Pricing)");
  ok(F("no-return-navigation").some((f) => f.page === "/research-journey/imagine") && !F("no-return-navigation").some((f) => f.page === "/research-journey/transform"), "missing breadcrumb/parent link found; breadcrumb page not flagged");
  ok(F("dead-end").some((f) => f.page === "/dead-end") && F("navigation-loop").some((f) => /loop-a/.test(f.fingerprint)), "dead end and navigation loop found");
  ok(F("generic-link-text").some((f) => /learn more/.test(f.fingerprint)), "generic link text found");
  ok(F("feature-planned").some((f) => f.page === "/research-journey/imagine") && F("feature-planned").some((f) => f.page === "/early-access"), "planned / early-access capabilities recorded separately");
  ok(F("availability-mismatch").some((f) => /start now/.test(f.fingerprint)), "'Start now' leading to a waitlist page flagged as an availability mismatch");
  ok(F("form-not-submitted").some((f) => f.page === "/early-access"), "early-access form recorded as not submitted (3.3.x not evaluated)");
  ok(run1.coverage.find((c) => c.name === "Pricing").found && !run1.coverage.find((c) => c.name === "Resources").found && F("expected-page-not-found").some((f) => /Resources/.test(f.title)), "expected-page coverage: found and not-found pages reported");
  const shots = run1.pages.flatMap((p) => Object.values(p.viewports).map((v) => v.screenshot)).filter(Boolean);
  ok(shots.length >= 3 * 14 && shots.every((s) => fs.existsSync(path.join(tmpRoot, "evidence", "runs", run1.runId, s))) && new Set(shots).size === shots.length, "one distinct screenshot per page and viewport, all on disk");
  ok(run1.browser.version && run1.buildAtStart && run1.rawFindings.every((f) => f.runId && f.observedAt && (f.viewport !== undefined)), "run ID, timestamp, browser version, build fingerprint and viewport recorded");
  ok(contrast[0].repro?.length >= 2 && contrast[0].expected && contrast[0].acceptance, "findings carry reproduction steps, expected behaviour and acceptance criteria");

  console.log("investigation of the contrast finding");
  const sel = contrast[0].selector;
  const inv = await investigate({ manifest: mkManifest(), selector: sel, paths: ["/"], viewports: ["desktop", "mobile", "reflow320"] });
  const e = inv.viewports[0].elements[0];
  const expected = Math.round(contrastRatio(GOLD, over(GOLD15, [255, 255, 255])) * 100) / 100;
  ok(e.visible && /New: research journey/.test(e.text) && e.location.landmark.startsWith("main"), `exact element, text and location captured (${e.tag}, "${e.text}")`);
  ok(Math.abs(e.contrast.ratio - expected) < 0.03 && e.contrast.passes === false, `independent contrast ${e.contrast.ratio}:1 matches the fixture's true ${expected}:1 and fails 1.4.3`);
  ok(e.axe && Math.abs(e.axe.ratio - e.contrast.ratio) < 0.1, `axe-core's ratio (${e.axe?.ratio}:1) agrees with the independent measurement`);
  ok(e.contrast.background === "#f9f3e1" && /1\.4\.3/.test(e.contrast.wcag), "translucent gold background composited correctly; WCAG 1.4.3 cited");
  ok(inv.reproducible.acrossAllViewports && e.screenshots.length === 2 && e.screenshots.every((s) => fs.existsSync(path.join(tmpRoot, "evidence", "investigations", inv.investigationId, s))), "reproducible at all viewports; highlighted screenshots saved");

  console.log("consolidation, triage and historical findings");
  const run2 = await publicAudit({ manifest: mkManifest({ publicAudit: { ...mkManifest().publicAudit, viewports: ["desktop"] } }) });
  ok(run2.outcome.status === "COMPLETED", "second audit run completed");
  // Recreate the founder's November 12 situation: two pre-v2 founder probes
  // and one public probe, each reporting the same contrast element at three
  // viewports = nine draft findings.
  const legacySel = ".bg-gold\\/15.gap-1.py-0\\.5";
  const legacyIds = [];
  for (const [i, acct] of ["founder-admin", "founder-admin", "public-visitor"].entries()) {
    const id = `UXTEST-PLANPROBE-${acct}-2026111215${15 + i}00-leg${i}`;
    const vps = ["desktop", "mobile", "reflow320"];
    const findings = vps.map((vp, k) => { const fid = `${id}-F${k + 1}`; legacyIds.push(fid); return { id: fid, category: "ACCESSIBILITY_FINDING", title: "axe: Elements must meet minimum color contrast ratio thresholds", observed: `color-contrast (serious, wcag2aa, wcag143) on the landing screen at ${vp}: 1 element(s)`, observedAt: "2026-11-12T15:20:00Z" }; });
    const run = { runId: id, kind: "probe-plan", startedAt: `2026-11-12T15:${15 + i}:00Z`, account: { id: acct, actualRole: acct === "public-visitor" ? "none (signed out)" : "founder_admin" }, ...(acct === "public-visitor" ? {} : {}), regression: { status: acct === "public-visitor" ? "NOT_APPLICABLE" : "PASS", checks: [] }, probe: vps.map((vp) => ({ viewport: vp, landing: { url: "https://www.equitasintelligence.com/" }, accessibility: { url: "https://www.equitasintelligence.com/", violations: [{ id: "color-contrast", impact: "serious", wcag: ["wcag2aa", "wcag143"], nodes: 1, examples: [legacySel] }] } })), interpretation: { observations: [], hypotheses: [], questionsForAppifest: [] }, findings, steps: [], navigationPath: [], network: { consoleErrors: [], httpErrors: [], offDomainRequests: [] }, outcome: { status: "COMPLETED" } };
    fs.mkdirSync(path.join(tmpRoot, "evidence", "runs", id), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "evidence", "runs", id, "run.json"), JSON.stringify(run));
  }
  const originalBytes = legacyIds.map(() => null);
  const legacyFiles = fs.readdirSync(path.join(tmpRoot, "evidence", "runs")).filter((d) => d.includes("-leg")).map((d) => path.join(tmpRoot, "evidence", "runs", d, "run.json"));
  const legacyBefore = legacyFiles.map((f) => fs.readFileSync(f, "utf8"));
  let { groups } = collect(tmpRoot);
  const legacyGroup = groups.find((g) => g.originalIds.includes(legacyIds[0]));
  ok(legacyGroup && legacyIds.every((id) => legacyGroup.originalIds.includes(id)), "the nine November-12-style draft findings consolidate into ONE issue");
  ok(legacyGroup.viewports.join(",") === "desktop,mobile,reflow320" && legacyGroup.notes.some((x) => /INVALID/.test(x)), "consolidated issue keeps all three viewports and notes the INVALID founder-probe origin");
  ok(legacyGroup.category === CATEGORY.AWAITING, "an automated contrast result alone stays 'awaiting confirmation'");
  const brokenG = groups.find((g) => g.fingerprint === "broken|/old-page");
  ok(brokenG.category === CATEGORY.CONFIRMED && brokenG.runs.length === 2 && /reproduced in 2 separate runs/.test(brokenG.basis), "broken link reproduced in two runs → confirmed (objective measurement)");
  const contrastG = groups.find((g) => g.fingerprint.startsWith("axe:color-contrast") && g.runs.includes(run1.runId) && /bg-gold|badge/.test(g.fingerprint));
  ok(contrastG.occurrences === 4 && contrastG.runs.length === 2 && contrastG.viewports.length === 3 && contrastG.category === CATEGORY.AWAITING, "contrast seen 4 times (3 viewports, 2 runs) = 1 issue, still awaiting human confirmation");
  ok(groups.filter((g) => g.fingerprint === contrastG.fingerprint).length === 1 && groups.filter((g) => g.fingerprint === "broken|/old-page").length === 1, "no duplicate issues across runs and viewports");
  ok(groups.find((g) => g.ruleId === "feature-planned").category === CATEGORY.PLANNED && groups.find((g) => g.ruleId === "nav-inconsistent").category === CATEGORY.USABILITY && groups.find((g) => g.ruleId === "expected-page-not-found").category === CATEGORY.INCONCLUSIVE, "planned features, usability concerns and inconclusive tests are kept separate from defects");
  fs.mkdirSync(path.join(tmpRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, "config", "triage.json"), JSON.stringify({ decisions: { [contrastG.groupId]: { decision: "confirmed", by: "founder", date: "2026-11-20", note: "checked with colour picker" }, [groups.find((g) => g.ruleId === "generic-link-text").groupId]: { decision: "rejected", by: "founder", note: "context makes purpose clear" } } }));
  ({ groups } = collect(tmpRoot));
  ok(groups.find((g) => g.groupId === contrastG.groupId).category === CATEGORY.CONFIRMED && groups.find((g) => g.ruleId === "generic-link-text").category === CATEGORY.REJECTED, "a person's triage decision confirms or rejects an issue");

  console.log("reports and validation");
  const rep = buildReports(tmpRoot, ROOT);
  const read = (f) => fs.readFileSync(path.join(tmpRoot, "reports", f), "utf8");
  for (const f of ["results.md", "navigation-map.md", "accessibility.md", "defect-register-draft.md", "defect-register-draft.csv", "evidence-index.md", "public-audit-summary.md", "consolidation.md"]) assert.ok(fs.existsSync(path.join(tmpRoot, "reports", f)), f);
  ok(true, "all required report files generated (existing six + public-audit-summary.md + consolidation.md)");
  const sum = read("public-audit-summary.md");
  ok(sum.includes(run2.runId) && /Pages discovered and audited: \*\*\d+\*\*/.test(sum) && /Expected pages/.test(sum) && /Recommended remediation priorities/.test(sum) && /Limitations/.test(sum), "summary covers coverage, principal findings, priorities and limitations");
  const reg = read("defect-register-draft.md");
  ok(["1. Confirmed defects", "2. Automated findings awaiting human confirmation", "3. Potential usability concerns", "4. Inconclusive or blocked tests", "5. Features intentionally unavailable or planned", "6. Testing-harness defects"].every((h) => reg.includes(h)), "register separates the six categories");
  ok(reg.includes(`### ${contrastG.groupId}`) && /Acceptance criteria:/.test(reg) && /Reproduction steps \(generated/.test(reg) && /Affected pages:/.test(reg), "each issue has severity, pages, repro steps, expected/observed, evidence and acceptance criteria");
  ok(legacyIds.every((id) => read("consolidation.md").includes(id)), "consolidation.md lists every original finding ID");
  const res = read("results.md");
  ok(/Successful authentication tests: \*\*0\*\* of 2/.test(res) && /leg0[^\n]*INVALID/.test(res) && /Regression check: INVALID/.test(res), "historical founder probes stay INVALID and are never counted as authenticated");
  const acc = read("accessibility.md");
  ok((acc.match(/^\| \d\.\d\.\d+ \|/gm) || []).length === 55 && acc.includes(inv.investigationId), "accessibility report lists all 55 WCAG 2.2 A/AA criteria and the investigation");
  ok(/Public website \(crawl/.test(read("navigation-map.md")) && /flowchart LR/.test(read("navigation-map.md")), "navigation map includes the public crawl graph");
  ok(legacyFiles.every((f, i) => fs.readFileSync(f, "utf8") === legacyBefore[i]), "original evidence files are unchanged by reporting");
  const v = validateReports(tmpRoot, ROOT);
  ok(v.ok, `reports validate against the evidence (${v.checks.join("; ")})`);
  const csvPath = path.join(tmpRoot, "reports", "defect-register-draft.csv");
  const csv = fs.readFileSync(csvPath, "utf8");
  fs.writeFileSync(csvPath, csv.replace(/"(\d+)","(axe:|broken)/, (m, n, r) => `"${Number(n) + 5}","${r}`).replace(`"${contrastG.groupId}","${CATEGORY.CONFIRMED}"`, `"${contrastG.groupId}","${CATEGORY.AWAITING}"`));
  const v2 = validateReports(tmpRoot, ROOT);
  ok(!v2.ok && v2.problems.some((p) => /category|occurrences/.test(p)), "validator detects a report that disagrees with the evidence");
  console.log(`\n${pass} public-audit checks passed. (${rep.findings} observations → ${rep.groups} issues in the fixture.)`);
} finally {
  server.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
