// Offline self-test for Section 11: independent keyboard-detector validation,
// historical evidence integrity, re-assessment and reconciliation, blocked-
// request analysis, and founder-decision separation. Never contacts EQUITAS.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { ROOT } from "../src/lib/manifest.js";
import { validateKeyboardDetectors, loadReference } from "../src/validate-keyboard-detector.js";
import { publicAudit } from "../src/public-audit.js";
import { effectiveFindings, SUFFICIENCY } from "../src/lib/historical.js";
import { rawFindings, loadRuns } from "../src/lib/collect.js";
import { reconcile } from "../src/reconcile.js";
import { buildReports } from "../src/report.js";
import { validateReports } from "../src/validate-reports.js";
import { snapshot, verify, listEvidence, sha256File } from "../src/evidence-integrity.js";
import { analyzeBlocked, blockedMarkdown } from "../src/lib/blocked.js";
import { CATEGORY } from "../src/lib/findings.js";

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log("  ✓ " + m); };
const tmpRoot = fs.mkdtempSync(path.join(ROOT, "evidence-selftest-"));
process.on("exit", () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

// ---------------- A. independent detector validation ----------------
console.log("A. keyboard detectors vs. the independent reference set");
const ref = loadReference();
ok(ref.intact, `reference set unchanged since its expected outcomes were recorded (sha256 ${ref.sha256.slice(0, 12)}…)`);
const tamperDir = fs.mkdtempSync(path.join(os.tmpdir(), "kref-"));
fs.writeFileSync(path.join(tamperDir, "cases.json"), fs.readFileSync(path.join(ROOT, "selftest", "keyboard-reference", "cases.json"), "utf8").replace('"expected": "VIOLATION"', '"expected": "NOT_A_VIOLATION"'));
fs.copyFileSync(path.join(ROOT, "selftest", "keyboard-reference", "EXPECTED_SHA256"), path.join(tamperDir, "EXPECTED_SHA256"));
ok(!loadReference(tamperDir).intact, "editing an expected outcome is detected (checksum mismatch)");
fs.rmSync(tamperDir, { recursive: true, force: true });
const refText = fs.readFileSync(path.join(ROOT, "selftest", "keyboard-reference", "cases.json"), "utf8");
ok(!/https?:\/\/(?!localhost|127\.0\.0\.1)[a-z]/i.test(refText.replace(/\{\{XORIGIN\}\}/g, "")), "reference scenarios reference no external hosts (validation is fully local)");
const cats = new Set(ref.cases.map((c) => c.category));
ok(["genuine keyboard trap", "normal document focus cycling", "long page", "modal dialog with escape mechanism", "dropdown menu", "shadow DOM", "iframe", "dynamically introduced controls", "focus not observable from the page"].every((c) => cats.has(c)), `reference set covers every required scenario type (${ref.cases.length} cases)`);
const val = await validateKeyboardDetectors({ outDir: path.join(tmpRoot, "reports") });
ok(val.v2.correct === ref.cases.length && val.v2["false positive"] === 0 && val.v2["false negative"] === 0, `keyboard-v2: ${val.v2.correct}/${ref.cases.length} correct, 0 false positives, 0 false negatives`);
ok(val.v2["overclaim (expected inconclusive)"] === 0 && val.v2["inconclusive (expected a determination)"] === 0 && val.results.find((r) => r.id === "K14-cross-origin-iframe-no-return").v2.predicted === "INCONCLUSIVE", "keyboard-v2 reports the unobservable cross-origin case as INCONCLUSIVE, and nothing else");
const v2c = (id) => val.results.find((r) => r.id === id).v2.classification;
ok(["K05-js-refocus-trap", "K06-js-cycling-widget-trap"].every((id) => v2c(id) === "TRAP"), "genuine traps detected only after Shift+Tab and Escape failed");
ok(["K07-modal-with-escape", "K18-shift-tab-exit", "K19-escape-releases"].every((id) => v2c(id) === "CONTAINED_WITH_ESCAPE"), "legitimate focus containment recognised, with the exit key recorded");
ok(["K01-normal-short", "K16-single-control", "K03-identical-markup", "K11-shadow-dom", "K12-same-origin-iframe"].every((id) => v2c(id) === "NO_TRAP"), "normal cycling, look-alike controls, shadow DOM and same-origin frames are not traps");
const v1o = (id) => val.results.find((r) => r.id === id).v1.outcome;
ok(["K03-identical-markup", "K04-identical-adjacent-links", "K11-shadow-dom", "K12-same-origin-iframe"].every((id) => v1o(id) === "false positive") && v1o("K06-js-cycling-widget-trap") === "false negative" && v1o("K14-cross-origin-iframe-no-return") === "overclaim (expected inconclusive)", `keyboard-v1 defects demonstrated: ${val.v1["false positive"]} false positives, ${val.v1["false negative"]} false negative, ${val.v1["overclaim (expected inconclusive)"]} overclaim`);
ok(/statistical performance has NOT been established/.test(val.statisticalNote) && fs.existsSync(path.join(tmpRoot, "reports", "keyboard-detector-validation.md")), "report states case counts and that statistical performance is not established");
const t5 = val.results.find((r) => r.id === "K05-js-refocus-trap").v2.transcript;
ok(t5.some((x) => x.startsWith("Shift+Tab")) && t5.some((x) => x.startsWith("Escape")), "transcripts record every key pressed and every focus transition");

// ---------------- B. integration: public audit uses keyboard-v2 ----------------
console.log("B. public audit with keyboard-v2 (fixture site)");
const PAGES = {
  "/": `<!doctype html><html lang="en"><head><title>Home</title></head><body><header><nav><a href="/trap">Trap demo</a> <a href="/modal">Modal demo</a></nav></header><main><h1>Home</h1></main></body></html>`,
  "/trap": `<!doctype html><html lang="en"><head><title>Trap</title></head><body><header><nav><a href="/">Home</a> <a href="/modal">Modal demo</a></nav></header><main><h1>Trap</h1><input id="t" aria-label="Search"> <a href="/">After</a></main><script>document.getElementById('t').addEventListener('keydown',e=>{if(e.key==='Tab'||e.key==='Escape')e.preventDefault();});fetch('/api/beacon',{method:'POST'}).catch(()=>{});</script></body></html>`,
  "/modal": `<!doctype html><html lang="en"><head><title>Modal</title></head><body><header><nav><a href="/">Home</a> <a id="opener" href="/trap">Trap demo</a></nav></header><main><h1>Modal</h1></main><div id="d" role="dialog" aria-modal="true" aria-label="Notice"><button>Accept</button><button>Decline</button></div><script>const d=document.getElementById('d'),b=[...d.querySelectorAll('button')];d.addEventListener('keydown',e=>{if(e.key==='Escape'){d.hidden=true;document.getElementById('opener').focus();}if(e.key==='Tab'){e.preventDefault();b[(b.indexOf(document.activeElement)+1)%2].focus();}});window.addEventListener('load',()=>b[0].focus());</script></body></html>`,
};
const requests = [];
const server = http.createServer((req, res) => { requests.push(req.method + " " + req.url); const p = req.url.split("?")[0]; if (PAGES[p]) { res.writeHead(200, { "content-type": "text/html" }); return res.end(PAGES[p]); } res.writeHead(404); res.end("nf"); }).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}/`;
const m = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "authorization-manifest.example.json"), "utf8"));
Object.assign(m, { _selftest: true, _root: tmpRoot });
m.authorization.approved = true;
m.authorization.testingWindow = { start: new Date(Date.now() - 3.6e6).toISOString(), end: new Date(Date.now() + 3.6e6).toISOString() };
m.target = { ...m.target, baseUrl: BASE, allowedHosts: ["127.0.0.1"] };
m.publicAudit = { ...m.publicAudit, maxPages: 5, delayMs: 10, viewports: ["desktop"], keyboardTabStops: 20, useSitemap: false };
m.accounts = [];
const run = await publicAudit({ manifest: m });
ok(run.outcome.status === "COMPLETED" && run.harnessVersion === "public-audit-2" && run.keyboardDetector === "keyboard-v2", "new runs are labelled public-audit-2 / keyboard-v2");
const traps = run.rawFindings.filter((f) => f.ruleId === "keyboard-trap");
ok(traps.length === 1 && traps[0].page === "/trap", "only the genuine trap page produces a keyboard-trap finding (the modal page does not)");
ok(traps[0].details.escapeAttempts.every((a) => !a.escaped) && traps[0].details.transcript.length > 3 && traps[0].repro.some((s) => /Shift\+Tab/.test(s)) && traps[0].repro.some((s) => /Escape/.test(s)), "trap finding carries escape attempts, the key-press transcript and reproduction steps");
ok(traps[0].category === CATEGORY.AWAITING, "even a v2 trap stays 'awaiting human confirmation'");
const modalKb = run.pages.find((p) => p.path === "/modal").viewports.desktop.keyboard;
ok(modalKb.classification === "CONTAINED_WITH_ESCAPE" && /Escape/.test(modalKb.escapedBy.method), "modal with Escape recorded as legitimate containment");
ok(run.blockedRequests.filter((b) => b.kind === "write-request").every((b) => b.page && b.at), "blocked requests now record the page and time (public-audit-2)");
ok(!requests.some((r) => r.startsWith("POST")), "no write request reached the server");
server.close();

// ---------------- C/D. historical evidence: integrity, re-assessment, reconciliation ----------------
console.log("C/D. historical evidence re-assessment and reconciliation");
// A synthetic public-audit-1 run with keyboard-v1 records, shaped exactly as v1 stored them.
const hRun = "UXTEST-PUBLIC-AUDIT-20261112T200000-hist";
const v1 = (stops) => ({ stops, reachable: new Set(stops.map((s) => s.tag + s.name)).size, withoutVisibleFocus: [], obscured: [], trap: true });
const S = (tag, name) => ({ tag, name, visibleFocus: true, obscured: false });
const actions = [S("a", "Home"), ...Array.from({ length: 9 }, (_, i) => S("button", `Action ${i + 1}`))];
const pages = [
  { path: "/a", kb: { desktop: v1(actions), mobile: v1(actions) } },
  { path: "/b", kb: { desktop: v1(actions), mobile: v1(actions) } },
  { path: "/c", kb: { desktop: v1([S("a", "Before"), S("iframe", "Embedded"), S("iframe", "Embedded"), S("iframe", "Embedded"), S("a", "After")]) } },
  { path: "/d", kb: { desktop: v1([S("a", "Before"), S("x-toolbar", ""), S("x-toolbar", ""), S("x-toolbar", ""), S("a", "After")]) } },
  { path: "/e", kb: { desktop: v1([S("a", "Home"), S("button", "Menu"), S("button", "Menu"), S("button", "Menu"), S("a", "Next")]) } },
  { path: "/f", kb: { desktop: v1([S("a", "Home"), S("button", "Menu"), S("button", "Menu"), S("button", "Menu"), S("a", "Next")]) } },
  { path: "/g", kb: { desktop: v1(Array.from({ length: 40 }, (_, i) => S("button", i % 2 ? "Cancel" : "Save"))) }, dialogs: [{ name: "Settings", modal: true, text: "Settings" }] },
  { path: "/h", kb: { desktop: null } },
];
const rawF = [];
let n = 0;
const runPages = pages.map((p) => ({ url: `https://www.equitasintelligence.com${p.path}`, path: p.path, status: 200, depth: 1, foundOn: ["/"], linkTexts: [], links: [], viewports: Object.fromEntries(Object.entries(p.kb).map(([vp, k]) => [vp, { viewport: vp, status: 200, ...(k ? { keyboard: k } : {}), structure: { dialogs: p.dialogs || [], forms: [], headings: [] }, layout: { interactiveCount: 10 } }])) }));
for (const p of pages) for (const vp of Object.keys(p.kb)) rawF.push({ id: `${hRun}-R${++n}`, runId: hRun, observedAt: "2026-11-12T20:00:00Z", source: "public-audit", page: p.path, url: `https://www.equitasintelligence.com${p.path}`, viewport: vp, ruleId: "keyboard-trap", category: CATEGORY.AWAITING, proposedSeverity: "P1", wcag: ["2.1.2"], objective: false, fingerprint: `trap|${p.path}`, title: `Possible keyboard trap on ${p.path}`, observed: "Focus stopped moving.", expected: "", acceptance: "", evidence: [] });
// Some non-keyboard findings, including a founder-decision one.
rawF.push({ id: `${hRun}-R${++n}`, runId: hRun, observedAt: "2026-11-12T20:00:00Z", source: "public-audit", page: "/", viewport: "desktop", ruleId: "axe:color-contrast", category: CATEGORY.AWAITING, proposedSeverity: "P2", wcag: ["1.4.3"], fingerprint: "axe:color-contrast|.bg-gold\\/15.gap-1.py-0\\.5", title: "Accessibility: Elements must meet minimum color contrast ratio thresholds", observed: "contrast", selector: ".bg-gold\\/15.gap-1.py-0\\.5", evidence: [] });
rawF.push({ id: `${hRun}-R${++n}`, runId: hRun, observedAt: "2026-11-12T20:00:00Z", source: "public-audit", page: "/", viewport: "desktop", ruleId: "availability-mismatch", category: CATEGORY.USABILITY, proposedSeverity: "P2", wcag: [], fingerprint: "availability|start now|/early-access", title: `"Start now" leads to a page describing waitlist`, observed: "x", evidence: [] });
const blockedReqs = [
  ...Array.from({ length: 60 }, () => ({ kind: "write-request", method: "POST", url: "https://www.google-analytics.com/g/collect?v=REDACTED", resourceType: "ping", viewport: "desktop" })),
  ...Array.from({ length: 10 }, () => ({ kind: "write-request", method: "POST", url: "https://eu.i.posthog.com/decide/", resourceType: "fetch", viewport: "mobile" })),
  ...Array.from({ length: 20 }, () => ({ kind: "write-request", method: "POST", url: "https://o1.ingest.sentry.io/api/5/envelope/", resourceType: "fetch", viewport: "desktop" })),
  ...Array.from({ length: 4 }, () => ({ kind: "write-request", method: "FORM-SUBMIT", url: "/early-access/submit", resourceType: "form", viewport: "desktop" })),
  ...Array.from({ length: 10 }, () => ({ kind: "write-request", method: "POST", url: "https://www.equitasintelligence.com/early-access", resourceType: "fetch", viewport: "desktop" })),
  ...Array.from({ length: 5 }, () => ({ kind: "write-request", method: "POST", url: "https://consent.cookiebot.com/logconsent", resourceType: "xhr", viewport: "desktop" })),
  ...Array.from({ length: 35 }, () => ({ kind: "write-request", method: "POST", url: "https://unknown.example.net/v1/x", resourceType: "fetch", viewport: "tablet" })),
];
const histRunObj = { runId: hRun, kind: "public-audit", harnessVersion: "public-audit-1", startedAt: "2026-11-12T20:00:00Z", endedAt: "2026-11-12T21:00:00Z", target: "https://www.equitasintelligence.com", limits: { keyboardTabStops: 40, maxPages: 40 }, browser: { version: "153" }, pages: runPages, rawFindings: rawF, blockedRequests: blockedReqs, steps: [], findings: [], navigationPath: [], network: { consoleErrors: [], httpErrors: [], offDomainRequests: [] }, coverage: [], crawl: { skipped: [] }, outcome: { status: "COMPLETED", reason: "historical fixture" }, pageLoads: 100 };
const hDir = path.join(tmpRoot, "evidence", "runs", hRun);
fs.mkdirSync(path.join(hDir, "steps"), { recursive: true });
fs.writeFileSync(path.join(hDir, "run.json"), JSON.stringify(histRunObj, null, 2));
fs.writeFileSync(path.join(hDir, "steps", "000-desktop-_.png"), "fake screenshot bytes");

// Integrity: record checksums BEFORE any re-assessment or reporting.
const shaListing = path.join(tmpRoot, "before.sha256");
fs.writeFileSync(shaListing, listEvidence(tmpRoot).map((p) => `${sha256File(path.join(tmpRoot, p))}  ./${p}`).join("\n") + "\n");
const snap = snapshot(tmpRoot, { label: "before re-assessment" });
ok(snap.fileCount === listEvidence(tmpRoot).length && snap.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)) && "commit" in snap.git, "checksums and Git commit recorded before re-assessment");

const runs = loadRuns(tmpRoot);
const raw = rawFindings(runs);
const eff = effectiveFindings(raw, runs);
const hist = (page, vp = "desktop") => eff.find((f) => f.ruleId === "keyboard-trap" && f.page === page && f.viewport === vp)?.historical;
ok(hist("/a").sufficiency === SUFFICIENCY.SUPERSEDED && hist("/a").rootCause === "V1_IDENTITY_COLLISION", "distinct controls flagged by v1 → superseded: identity collision");
ok(hist("/c").rootCause === "V1_FRAME_FOCUS" && hist("/c").retestRecommended && hist("/d").rootCause === "V1_SHADOW_HOST", "iframe and shadow-host repeats → superseded with retest recommended");
ok(hist("/e").sufficiency === SUFFICIENCY.RETEST && hist("/e").rootCause === "REPEATED_IDENTICAL_CONTROL", "a repeated identical control → requires targeted live retest (could be real)");
ok(hist("/g").sufficiency === SUFFICIENCY.RETEST && hist("/g").rootCause === "CONTAINMENT_NO_ESCAPE_TEST" && /dialog/.test(hist("/g").evidence), "≤3-control cycle → requires retest; open dialog noted");
ok(hist("/h").sufficiency === SUFFICIENCY.INSUFFICIENT, "missing keyboard record → insufficient evidence");
ok(!eff.some((f) => f.historical?.sufficiency === SUFFICIENCY.SUPPORTED), "no v1 observation is 'supported' (v1 recorded no escape attempts)");
ok(eff.filter((f) => f.historical).every((f) => f.historical.originalCategory === CATEGORY.AWAITING && f.historical.originalSeverity === "P1" && f.historical.originalFingerprint.startsWith("trap|") && (f.originalId || f.id)), "original category, severity, fingerprint and ID kept on every re-assessed observation");
ok(eff.filter((f) => f.historical).every((f) => f.category !== CATEGORY.REJECTED), "no historical observation is rejected");

const rec = reconcile(tmpRoot, ROOT, { expectObservations: raw.length, expectGroups: null });
ok(rec.summary.ok && rec.summary.observations === raw.length && rec.rows.length === raw.length, `reconciliation maps all ${raw.length} observations; totals agree`);
const collision = rec.summary.keyboardTrap.byRootCause.find((c) => c.rootCause === "V1_IDENTITY_COLLISION");
ok(collision.observations === 4 && collision.pages.join() === "/a,/b" && collision.viewports.join() === "desktop,mobile" && collision.afterGroups.length === 1, "detector-defect root cause consolidates 4 observations on 2 pages and 2 viewports into one issue");
const comp = rec.after.filter((g) => g.fingerprint.startsWith("trap-v1|retest|REPEATED_IDENTICAL_CONTROL"));
ok(comp.length === 1 && comp[0].pages.join() === "/e,/f", "the same component on two pages consolidates into one retest issue");
ok(rec.after.filter((g) => g.fingerprint.startsWith("trap-v1|retest|CONTAINMENT")).length === 1 && rec.after.some((g) => g.fingerprint === "trap-v1|insufficient|/h"), "page-level behaviours stay separate from detector defects");
const before8 = rec.rows.filter((r) => r.ruleId === "keyboard-trap" && r.runId === hRun);
ok(rec.rows.filter((r) => r.ruleId === "keyboard-trap" && r.runId !== hRun).every((r) => !r.sufficiency && r.change !== "re-assessed (historical keyboard-v1 trap warning)"), "keyboard-v2 findings from new runs are not re-assessed as historical");
ok(before8.length === 10 && before8.every((r) => r.beforeCategory === CATEGORY.AWAITING && r.beforeSeverity === "P1" && r.afterSeverity === "" && r.sufficiency), "each trap row shows category and severity before and after, with its sufficiency class");
const wrong = reconcile(tmpRoot, ROOT, { expectObservations: raw.length + 1, write: false });
ok(!wrong.summary.ok && /expected/.test(wrong.summary.problems.join()), "a mismatch with the expected original totals is reported");

// ---------------- E. blocked requests ----------------
console.log("E. blocked requests (never replayed)");
const realFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("network use is not allowed in blocked-request analysis"); };
const ba = analyzeBlocked(runs).find((a) => a.runId === hRun);
globalThis.fetch = realFetch;
const P = (name) => ba.groups.find((g) => g.purpose === name);
ok(ba.writeRequests === 144 && ba.groups.reduce((n2, g) => n2 + g.count, 0) === 144, "all 144 blocked write requests classified, none lost (analysis made no network call)");
ok(P("analytics").count === 60 && P("analytics").effect === "none" && P("error monitoring").count === 20 && P("feature flags / remote configuration").count === 10 && P("form submission").effect === "intended" && P("consent management").count === 5, "purposes inferred from host and path");
ok(P("application API / server action (same site)").effect === "high" && P("unknown").count === 35, "same-site writes flagged as possibly affecting content; unrecognised ones stay 'unknown'");
ok(ba.limitations.some((l) => /feature flags/.test(l)) && ba.limitations.some((l) => /same site/.test(l)) && ba.limitations.some((l) => /not recorded with the page/.test(l)), "validity limitations stated, including missing page attribution in public-audit-1");
ok(/never sent to EQUITAS and are not replayed/.test(blockedMarkdown([ba])), "report states blocked requests were never sent or replayed");

// ---------------- F/G. reports, founder decisions, validation, integrity ----------------
console.log("F/G. reports, founder decisions, validation and evidence integrity");
buildReports(tmpRoot, ROOT);
const read = (f) => fs.readFileSync(path.join(tmpRoot, "reports", f), "utf8");
const sum = read("public-audit-summary.md");
ok(/## For founder review/.test(sum) && /feature availability[\s\S]*"Start now"/.test(sum.split("## For founder review")[1]) && !/"Start now"/.test(sum.split("## Principal technical findings")[1].split("##")[0]), "product/availability matters appear only under 'For founder review', not among technical findings");
ok(/recommends \*\*no\*\* change/.test(sum) && /Founder decision \(feature availability\)/.test(read("defect-register-draft.md")), "the audit explicitly recommends no product, pricing or content change");
ok(/Keyboard-trap re-assessment/.test(sum) && /No historical keyboard-trap warning is confirmed/.test(sum) && /Validity limitation/.test(sum), "summary reports the keyboard re-assessment and blocked-request validity limits");
ok(/Why none is "supported by existing evidence"/.test(read("reconciliation.md")) && /Similar warnings were not assumed to share a cause/.test(read("reconciliation.md")), "reconciliation explains the classifications and the root-cause method");
const v = validateReports(tmpRoot, ROOT);
ok(v.ok, `reports reconcile with source observations (${v.checks.filter((c) => /reconciliation|register rows/.test(c)).join("; ")})`);
const rcsvPath = path.join(tmpRoot, "reports", "reconciliation-observations.csv");
fs.writeFileSync(rcsvPath, fs.readFileSync(rcsvPath, "utf8").split("\n").slice(0, -1).join("\n"));
ok(!validateReports(tmpRoot, ROOT).ok, "a reconciliation missing one observation is detected");
const vr = verify(tmpRoot, path.join(tmpRoot, snap.file));
const vs = verify(tmpRoot, shaListing);
ok(vr.ok && vr.unchanged === snap.fileCount && vs.ok && vs.unchanged === snap.fileCount, "original evidence unchanged after re-assessment and reporting (JSON snapshot and shasum listing)");
fs.appendFileSync(path.join(hDir, "steps", "000-desktop-_.png"), "x");
const vbad = verify(tmpRoot, shaListing);
ok(!vbad.ok && vbad.modified.length === 1, "a modified evidence file is detected");
fs.rmSync(path.join(hDir, "steps", "000-desktop-_.png"));
ok(verify(tmpRoot, shaListing).missing.length === 1, "a missing evidence file is detected");
console.log(`\n${pass} integrity checks passed.`);
