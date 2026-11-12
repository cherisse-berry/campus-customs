// Offline self-test: exercises every safety, evidence and reporting path
// against a local fixture site with scripted deciders and a fake Anthropic
// client. Never touches EQUITAS or the Anthropic API.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { ROOT, isMain, approvalProblems, scenarioProblems } from "../src/lib/manifest.js";
import { probePlan } from "../src/probe-plan.js";
import { runScenario, diffMiddle } from "../src/run-scenario.js";
import { makeGuard, STOP, acquireLock } from "../src/lib/safety.js";
import { redact, setRedactTerms } from "../src/lib/redact.js";
import { usageUsd } from "../src/lib/agent.js";
import { deploymentChanged } from "../src/lib/diagnostics.js";
import { buildReports, pageNode } from "../src/report.js";
import { purge } from "../src/purge-evidence.js";
import { AUTH, validateMarkersSignedOut, readMeta } from "../src/lib/auth.js";
import { diagnose } from "../src/auth-diagnose.js";
import { chromium } from "playwright";

const fx = path.join(ROOT, "selftest", "fixture");
// Fixture site with REAL cookie-based sign-in, shaped like the reported case:
//   /            public homepage for everyone (signed in or not)
//   /app         the product (plan screen) — needs the fx_session=valid cookie
//   other pages  need the cookie too; without it → 302 to /login.html
// Every request is logged (path, session cookie value class, user agent) so
// tests can prove when the harness did or did not contact the "site".
const PUBLIC = new Set(["/", "/login.html", "/pricing.html", "/app.v1.js"]);
const requests = [];
const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];
  const cookie = /(?:^|;\s*)fx_session=([^;]+)/.exec(req.headers.cookie || "")?.[1] || null;
  requests.push({ path: urlPath, session: cookie, ua: req.headers["user-agent"] || "" });
  if (!PUBLIC.has(urlPath) && cookie !== "valid") { res.writeHead(302, { location: "/login.html" }); return res.end(); }
  const file = urlPath === "/" ? "home.html" : urlPath === "/app" ? "index.html" : urlPath.replace(/^\//, "");
  const f = path.join(fx, file);
  if (!fs.existsSync(f) || !f.startsWith(fx)) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" }); res.end(fs.readFileSync(f));
}).listen(0);
const hits = () => requests.length;
const port = server.address().port;
const tmpRoot = fs.mkdtempSync(path.join(ROOT, "evidence-selftest-"));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "authorization-manifest.example.json"), "utf8"));
Object.assign(manifest, { _selftest: true, _root: tmpRoot });
manifest.authorization.approved = true;
manifest.target = { ...manifest.target, baseUrl: `http://127.0.0.1:${port}/`, allowedHosts: ["127.0.0.1"] };
manifest.limits.minDelayBetweenActionsMs = 10;
manifest.limits.maxAxeScansPerScenario = 5;
manifest.limits.maxScenariosPerDay = 1000; // the self-test runs many short scenarios
manifest.limits.maxEquitasAiSubmissionsPerDay = 1000;
manifest.permittedWorkflows.submitSyntheticResearchQuestions = true;
manifest.evidence.redactTerms = ["Founder Fixture"];
setRedactTerms(manifest.evidence.redactTerms);
// One saved session per authentication case (Section: authenticated-session regression tests).
const acct = (id) => ({ id, actualRole: "founder_admin", actualEntitlement: "fixture", accountState: "existing", approvedFor: ["*"], expectPlanScreen: false });
manifest.accounts = ["fixture", "missing", "oldsession", "cookieexpired", "revoked", "nomarkers", "nofounder", "wrongmarker"].map(acct);
const MARKERS = { signedIn: [{ role: "button", name: "Account menu" }], founder: [{ role: "link", name: "Admin console" }], signedOutAuto: [{ role: "link", name: "Log in" }] };
const cookie = (value, expires = -1) => ({ name: "fx_session", value, domain: "127.0.0.1", path: "/", expires, httpOnly: true, secure: false, sameSite: "Lax" });
fs.mkdirSync(path.join(tmpRoot, ".auth"), { recursive: true });
function saveSession(id, { value = "valid", expires = -1, savedAt = new Date().toISOString(), markers = MARKERS, ua = "FixtureSignInUA/1.0 (same browser as sign-in)" } = {}) {
  fs.writeFileSync(path.join(tmpRoot, ".auth", `${id}.json`), JSON.stringify({ cookies: [cookie(value, expires)], origins: [] }));
  const meta = { account: id, savedAt, landedOnPath: "/app", userAgent: ua };
  if (markers) meta.markers = markers;
  fs.writeFileSync(path.join(tmpRoot, ".auth", `${id}.meta.json`), JSON.stringify(meta));
}
saveSession("fixture");
saveSession("oldsession", { savedAt: new Date(Date.now() - 13 * 3.6e6).toISOString() });
saveSession("cookieexpired", { expires: Math.floor(Date.now() / 1000) - 3600 });
saveSession("revoked", { value: "revoked-by-server" });
saveSession("nomarkers", { markers: null });               // saved by the old harness (no markers)
saveSession("nofounder", { markers: { ...MARKERS, founder: [] } });
saveSession("wrongmarker", { markers: { ...MARKERS, signedIn: [{ role: "button", name: "Not on this page" }] } });
// "missing" has no saved files at all.

// Temporary config with short hook timings, for the failure-recovery tests.
const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxcfg-"));
const scen = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "scenarios.json"), "utf8"));
for (const s of scen.scenarios) {
  if (s.id === "K-offline-submission") s.hooks = [{ type: "offlineBeforeSubmission", durationSec: 2 }];
  if (s.id === "K-session-expiry") s.hooks = [{ type: "clearSession", afterStep: 1 }];
}
fs.writeFileSync(path.join(cfgDir, "scenarios.json"), JSON.stringify(scen));
fs.copyFileSync(path.join(ROOT, "config", "personas.json"), path.join(cfgDir, "personas.json"));

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log("  ✓ " + m); };
const scripted = (list) => { let i = 0; return async () => { const s = list[Math.min(i++, list.length - 1)]; return { observation: "x", whereAmI: "fixture", progress: s.progress || "some", rationale: "scripted", confusion: "", action: { role: "", name: "", index: 0, text: "", ...s.action } }; }; };
const Q = "UXTEST synthetic: I'm interested in whether community health workers could help people with high blood pressure. I don't know how to turn this into a research question yet. Can you help me?";
const toAdvisor = [{ action: { type: "click", role: "link", name: "Settings" } }, { action: { type: "click", role: "link", name: "Advisor" } }];
const agentSteps = (r) => r.steps.filter((s) => s.kind === "agent");

console.log("redaction");
ok(redact("mail me at a.b@uni.edu") === "mail me at [REDACTED_EMAIL]", "emails redacted");
ok(!redact("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij").includes("eyJ"), "JWTs redacted");
ok(redact("Signed in as Founder  Fixture") === "Signed in as [REDACTED_NAME]", "manifest redactTerms removed (names on screen)");

console.log("guard");
const g = makeGuard(manifest);
const ca = (n, role, extra = {}, type = "click") => g.checkAction({ type, name: n, role, ...(extra.text ? { text: extra.text } : {}) }, { actualName: n, actualText: n, ...extra });
ok((await ca("Select Pro", "button", { onPlanPage: true, containerText: "Pro $29 per month" })).stop === STOP.PLAN_SELECTION, "paid plan blocked");
ok((await ca("Start free", "button", { onPlanPage: true, containerText: "Free $0 forever" })).stop === STOP.PLAN_SELECTION, "free plan blocked when selectFreePlan=false");
ok((await ca("Delete project", "button")).stop === STOP.CONSEQUENTIAL_ACTION, "delete blocked");
ok((await ca("Partner site", "link", { href: "https://evil.example.org/" })).stop === STOP.OFF_DOMAIN, "off-domain link blocked");
ok((await ca("Password", "textbox", { inputType: "password", textIsSynthetic: true, text: "x" }, "fill")).stop === STOP.CREDENTIAL_FIELD, "password field blocked");
ok((await ca("Settings", "link", { href: `http://127.0.0.1:${port}/settings.html` })).ok, "settings navigation allowed");
ok((await ca("Display settings", "link")).ok && (await ca("Publications", "link")).ok, "word-start matching: 'Display settings' and 'Publications' allowed");
ok(!(await ca("Payment details", "link")).ok && !(await ca("Save and send invitations", "button")).ok, "word-start matching: 'Payment details' and 'invitations' still blocked");

console.log("probe-plan");
const probe = await probePlan({ manifest, accountId: "fixture", viewports: ["desktop", "reflow320"] });
const r = probe.probe[0];
ok(r.landing.onPlanPage, "plan screen detected");
ok(r.classification.planCtas.length === 2, "two plan CTAs found");
ok(r.moduleFromSettings && !r.moduleFromSettings.onPlanPage, "Settings → Advisor bypass detected");
ok(probe.findings.some((f) => /Settings is the observed workaround/.test(f.title)), "draft finding created");
ok(fs.readdirSync(path.join(tmpRoot, "evidence", "runs", probe.runId, "steps")).some((f) => f.endsWith(".png")), "screenshots saved");
ok(probe.regression.status === "FAIL" && probe.regression.checks.every((c) => c.pass === false), "regression check FAILs: expectPlanScreen=false but plan screen has no way forward");
ok(/^\d+\./.test(probe.browser?.version || ""), `browser version recorded (${probe.browser?.version})`);
ok(r.build?.buildId === "1.4.2" && r.build?.assetHash, "build identifier and asset fingerprint recorded");
ok(r.accessibility?.violations && !r.accessibility.error, `axe scan ran on landing (${r.accessibility?.violations?.length ?? r.accessibility?.error} violation types)`);
ok(probe.probe[1].reflow?.horizontalOverflowPx > 0 && probe.findings.some((f) => /reflow/i.test(f.title)), "320 px reflow overflow detected and reported");
ok(fs.existsSync(path.join(tmpRoot, "evidence", "runs", probe.runId, r.landingSnapshot)), "landing accessibility text saved");
const newAcct = structuredClone(manifest); newAcct.accounts[0].serverSideNewUser = true;
const probeNew = await probePlan({ manifest: newAcct, accountId: "fixture", viewports: ["desktop"] });
ok(probeNew.findings.some((f) => /prior use/.test(f.title)), "account labelled new but showing 'Recent projects' is flagged");

console.log("scenario loop (scripted decider)");
const run = await runScenario({ scenarioId: "P01-doctoral-idea", accountId: "fixture", manifest, decider: scripted([...toAdvisor, { action: { type: "fill", role: "textbox", name: "Describe your research idea", text: Q } }, { action: { type: "click", role: "button", name: "Ask advisor" } }, { action: { type: "click", role: "button", name: "Delete project" } }]) });
ok(run.equitasResponses.length === 1 && /Clarifying question/.test(run.equitasResponses[0].newText), "response captured after submission");
ok(run.outcome.status === "STOPPED_SAFETY" && /CONSEQUENTIAL/.test(run.outcome.reason), "run stopped at Delete project");
ok(run.science?.deterministic?.coveredCount >= 1 && run.science.deterministic.concepts.some((c) => c.snippets?.length), `science coverage computed with quoted snippets (${run.science.deterministic.coveredCount}/${run.science.deterministic.total})`);
const stepDir = path.join(tmpRoot, "evidence", "runs", run.runId);
ok(agentSteps(run).every((s) => s.snapshot && fs.existsSync(path.join(stepDir, s.snapshot))), "accessibility text the agent saw is saved for every step");
ok(!fs.readFileSync(path.join(stepDir, "run.json"), "utf8").includes("Founder Fixture") && fs.readdirSync(path.join(stepDir, "steps")).filter((f) => f.endsWith(".txt")).every((f) => !fs.readFileSync(path.join(stepDir, "steps", f), "utf8").includes("Founder Fixture")), "on-screen name never stored in run record or snapshots");
ok(run.createdRecords.some((c) => c.kind === "new-id-in-url") && run.createdRecords.some((c) => c.kind === "listed-test-record"), "records EQUITAS creates itself (new ID in URL, listed UXTEST item) go to the cleanup list");
ok(run.browser?.version && run.buildAtStart?.buildId === "1.4.2", "scenario records browser version and build");
ok(run.accessibility.length >= 1 && run.findings.some((f) => /axe: Buttons must have discernible text/.test(f.title)), "axe scan in scenario reports the unnamed icon button");
ok(run.auth?.status === AUTH.FOUNDER_VERIFIED && /after sign-in/.test(run.entry.note), "normal run verified by markers and starts on the post-sign-in page");
ok(run.finalPageText?.includes("Clarifying question"), "final page text kept as context for the science judge");

console.log("fix 1 + 4: real names, ambiguity, unnamed controls, submission counting");
const run2 = await runScenario({ scenarioId: "P01-doctoral-idea", accountId: "fixture", manifest, decider: scripted([...toAdvisor,
  { action: { type: "fill", role: "textbox", name: "Describe your research idea", text: Q } },
  { action: { type: "click", role: "button", name: "Continue" } },
  { action: { type: "click", role: "button", name: "Save" } },
  { action: { type: "click", role: "button", name: "" } },
  { action: { type: "click", role: "button", name: "Save and send" } }]) });
const res = (n) => agentSteps(run2)[n]?.result || "";
ok(run2.metrics.aiSubmissions === 1 && run2.equitasResponses.length === 1, "submission via a button named 'Continue' is counted and captured");
ok(/refused/.test(res(4)) && /partly matches 2/.test(res(4)), "ambiguous partial name 'Save' refused");
ok(/refused/.test(res(5)), "unnamed control refused");
ok(run2.outcome.status === "STOPPED_SAFETY" && /send invitation/.test(run2.outcome.reason) && /Save and send invitations/.test(run2.outcome.reason), "partial name checked against real name and stopped");

console.log("fix 3: manifest workflow permissions enforced");
const goNew = [...toAdvisor, { action: { type: "click", role: "button", name: "New project" } }];
const run3 = await runScenario({ scenarioId: "P05-cross-module", accountId: "fixture", manifest, decider: scripted(goNew) });
ok(/PROJECT_CREATION_NOT_AUTHORIZED/.test(run3.outcome.reason), "'New project' blocked while createSyntheticProjects=false");
const noAuthNav = structuredClone(manifest); noAuthNav.permittedWorkflows.navigateAuthenticatedPages = false;
ok((await runScenario({ scenarioId: "P05-cross-module", accountId: "fixture", manifest: noAuthNav, decider: scripted(goNew) })).outcome.status === "BLOCKED", "signed-in scenario BLOCKED when navigateAuthenticatedPages=false");
const noSubmit = structuredClone(manifest); noSubmit.permittedWorkflows.submitSyntheticResearchQuestions = false;
ok(!(await makeGuard(noSubmit).checkAction({ type: "click", name: "Next", role: "button" }, { actualName: "Next", actualText: "Next", pendingTextLength: 50 })).ok, "submission refused when submitSyntheticResearchQuestions=false");

console.log("authenticated session: missing / expired / rejected / valid (regression for the reported defect)");
// Reproduces the founder's report with the OLD meta shape: valid cookie, root is a
// public homepage, no markers. Old harness: PASS. New harness: never PASS.
let before = hits();
const pNoMarkers = await probePlan({ manifest, accountId: "nomarkers", viewports: ["desktop", "mobile"] });
ok(pNoMarkers.regression.status === "INCONCLUSIVE" && pNoMarkers.probe.every((r) => r.auth.status === AUTH.NO_MARKERS), "reported case (public homepage, no markers): INCONCLUSIVE, never PASS");
ok(pNoMarkers.probe[0].root.headings.some((h) => /reimagined/.test(h)) && pNoMarkers.probe[0].landing.url.endsWith("/app"), "root (public homepage) and post-sign-in page (/app) are observed separately");
ok(pNoMarkers.findings.some((f) => /Authentication not established/.test(f.title)) && !pNoMarkers.findings.some((f) => /Settings is the observed workaround/.test(f.title)), "no plan finding is drawn while authentication is unestablished");

before = hits();
const pMissing = await probePlan({ manifest, accountId: "missing", viewports: ["desktop"] });
ok(pMissing.outcome.status === "BLOCKED" && /SESSION_MISSING/.test(pMissing.outcome.reason) && pMissing.regression.status === "BLOCKED" && hits() === before, "missing session: BLOCKED, site not contacted");
before = hits();
const pOld = await probePlan({ manifest, accountId: "oldsession", viewports: ["desktop"] });
ok(pOld.regression.status === "BLOCKED" && /SESSION_EXPIRED/.test(pOld.outcome.reason) && hits() === before, "session older than sessionReuseMaxHours: BLOCKED, site not contacted");
before = hits();
const pCookieExp = await probePlan({ manifest, accountId: "cookieexpired", viewports: ["desktop"] });
ok(pCookieExp.regression.status === "BLOCKED" && /cookies have expired/.test(pCookieExp.outcome.reason) && hits() === before, "all saved cookies expired: BLOCKED, site not contacted");

before = hits();
const pRevoked = await probePlan({ manifest, accountId: "revoked", viewports: ["desktop", "mobile", "reflow320"] });
const revokedHits = requests.slice(before).filter((r) => r.session === "revoked-by-server" && r.path === "/app").length;
ok(pRevoked.regression.status === "BLOCKED" && pRevoked.probe.length === 1 && pRevoked.probe[0].auth.status === AUTH.REJECTED, "rejected session: BLOCKED after the first viewport (no further attempts)");
ok(revokedHits === 1 && readMeta(tmpRoot, "revoked").rejectedAt, "rejected session presented to the protected page exactly once, then marked rejected");
before = hits();
const pRevoked2 = await probePlan({ manifest, accountId: "revoked", viewports: ["desktop"] });
ok(/SESSION_REJECTED_EARLIER/.test(pRevoked2.outcome.reason) && hits() === before, "previously rejected session is never presented again (no repeated attempts)");
const sRevoked = await runScenario({ scenarioId: "P05-cross-module", accountId: "revoked", manifest, decider: scripted(goNew) });
ok(sRevoked.outcome.status === "BLOCKED" && /SESSION_REJECTED_EARLIER/.test(sRevoked.outcome.reason), "scenario with a rejected session is BLOCKED before launch");

const pNoFounder = await probePlan({ manifest, accountId: "nofounder", viewports: ["desktop"] });
ok(pNoFounder.probe[0].auth.status === AUTH.AUTHENTICATED && pNoFounder.regression.status === "INCONCLUSIVE", "signed in but founder access not verified: INCONCLUSIVE");
const pWrong = await probePlan({ manifest, accountId: "wrongmarker", viewports: ["desktop"] });
ok(pWrong.probe[0].auth.status === AUTH.UNVERIFIED && pWrong.regression.status === "INCONCLUSIVE", "valid cookie but marker absent: UNVERIFIED → INCONCLUSIVE");
const sWrong = await runScenario({ scenarioId: "P05-cross-module", accountId: "wrongmarker", manifest, decider: scripted(goNew) });
ok(sWrong.outcome.status === "BLOCKED" && /UNVERIFIED/.test(sWrong.outcome.reason) && sWrong.metrics.actions === 0, "scenario with unverified sign-in BLOCKED, nothing clicked");

before = hits();
const pValid = await probePlan({ manifest, accountId: "fixture", viewports: ["desktop"] });
ok(pValid.probe[0].auth.status === AUTH.FOUNDER_VERIFIED && pValid.probe[0].authConclusive, "valid session: FOUNDER_VERIFIED from application markers");
ok(pValid.regression.status === "FAIL" && /Verified FOUNDER_VERIFIED/.test(pValid.regression.checks[0].reason), "verdict is drawn only on the verified post-sign-in page (fixture plan screen → FAIL)");
ok(requests.slice(before).filter((r) => r.path === "/app").every((r) => r.ua.startsWith("FixtureSignInUA")), "test browser reuses the user agent recorded at sign-in");
ok(pValid.interpretation.hypotheses.some((h) => /site root .* shows no signed-in markers/.test(h)), "public homepage at root with a verified session is reported as a separate EQUITAS question");

let attendedCalled = false;
const statBefore = fs.statSync(path.join(tmpRoot, ".auth", "fixture.json")).mtimeMs;
const pAttended = await probePlan({ manifest, accountId: "fixture", viewports: ["desktop", "mobile"], attended: true, attendedLogin: async (page) => {
  attendedCalled = true;
  await page.context().addCookies([cookie("valid")]); // stands in for the founder signing in by hand
  await page.goto(new URL("/app", manifest.target.baseUrl).toString());
  return { ok: true, landedOnPath: "/app" };
} });
ok(attendedCalled && pAttended.probe.every((r) => r.auth.status === AUTH.FOUNDER_VERIFIED) && pAttended.regression.status === "FAIL", "attended mode: one sign-in, probe in the same window, verified for both viewports");
ok(fs.statSync(path.join(tmpRoot, ".auth", "fixture.json")).mtimeMs === statBefore, "attended mode saves nothing");

const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const vm = await validateMarkersSignedOut(b, manifest, "/", { signedIn: [{ role: "button", name: "Account menu" }, { role: "link", name: "Log in" }], founder: [] });
await b.close();
ok(vm.kept.signedIn.length === 1 && vm.rejected.some((r) => r.marker.name === "Log in") && vm.signedOutOnly.some((m) => m.name === "Log in"), "sign-in rejects markers that are also visible when signed out");

const dValid = await diagnose({ manifest, accountId: "fixture" });
ok(dValid.live.postSignIn.status === AUTH.FOUNDER_VERIFIED && dValid.diagnosis.some((x) => /HARNESS DEFECT CONFIRMED/.test(x)), "auth-diagnose separates a harness cause (root-only check) from the session state");
ok(!JSON.stringify(dValid).includes("\"valid\"") && JSON.stringify(dValid).includes("fx_session"), "auth-diagnose reports cookie names, never values");
before = hits();
const dMissing = await diagnose({ manifest, accountId: "missing" });
ok(dMissing.preflight.status === AUTH.MISSING && hits() === before, "auth-diagnose on a missing session does not contact the site");

console.log("pop-ups, redirects, stuck pages");
const runPop = await runScenario({ scenarioId: "P05-cross-module", accountId: "fixture", manifest, decider: scripted([{ action: { type: "click", role: "button", name: "Open partner window" } }, { action: { type: "done" } }]) });
ok(runPop.steps.some((s) => s.kind === "guard" && s.popup === true) && runPop.findings.some((f) => /pop-up/.test(f.title)), "off-domain pop-up blocked before it loaded");
const tightRedirect = structuredClone(manifest); tightRedirect.limits.maxUnexpectedRedirects = 0;
const runRed = await runScenario({ scenarioId: "P05-cross-module", accountId: "fixture", manifest: tightRedirect, decider: scripted([{ action: { type: "click", role: "link", name: "Slow page" } }, { action: { type: "scroll" } }, { action: { type: "scroll" } }]) });
ok(runRed.outcome.status === "LIMIT" && /UNEXPECTED_REDIRECT/.test(runRed.outcome.reason) && runRed.metrics.unexpectedRedirects >= 1, "URL change not caused by the agent counted; redirect limit enforced");
const runStuck = await runScenario({ scenarioId: "P05-cross-module", accountId: "fixture", manifest, decider: scripted([...toAdvisor, { action: { type: "scroll" } }]) });
ok(runStuck.outcome.status === "ABANDONED" && /page unchanged/.test(runStuck.outcome.reason), "objective no-progress: unchanged page ends the run even though the agent claims progress");

console.log("limits: session lock, tester spend");
const held = acquireLock(manifest, "test-holder");
ok(held.ok, "lock acquired");
const runLocked = await runScenario({ scenarioId: "P05-cross-module", accountId: "fixture", manifest, decider: scripted(goNew) });
ok(runLocked.outcome.status === "BLOCKED" && /SESSION_LOCK/.test(runLocked.outcome.reason), "second concurrent session BLOCKED by lock");
held.release();
// Fake Anthropic client: scripted decisions; a judge answer for the science prompt.
const fakeClient = (decisions, usage) => {
  let i = 0;
  return { beta: { messages: { parse: async (req) => {
    const prompt = JSON.stringify(req.messages);
    if (prompt.includes("research-methods reviewer")) {
      return { stop_reason: "end_turn", model: "claude-opus-5-5", usage: { input_tokens: 1000, output_tokens: 200 }, parsed_output: { questionRecognizedCorrectly: "partly", questionRecognitionNote: "n", conceptsAddressed: [], criticalErrors: [], overclaims: [], uncertaintyCommunicated: "some", evidenceSourcesShown: "none", modelServiceStatusVisible: "none visible", actionability: "generic", levelFitForPersona: "appropriate", levelFitNote: "", summary: "fake" } };
    }
    const d = decisions[Math.min(i++, decisions.length - 1)];
    return { stop_reason: "end_turn", model: "claude-opus-5-5", usage, parsed_output: { observation: "x", whereAmI: "fixture", progress: "some", rationale: "fake", confusion: "", action: { role: "", name: "", index: 0, text: "", ...d.action } } };
  } } } };
};
const aiManifest = structuredClone(manifest); aiManifest.testerAi = { ...aiManifest.testerAi, approved: true, maxTesterSpendUsdPerScenario: 3, maxTesterSpendUsdPerDay: 1000 };
const runSpend = await runScenario({ scenarioId: "P05-cross-module", accountId: "fixture", manifest: aiManifest, aiClient: fakeClient([...toAdvisor], { input_tokens: 1_000_000, output_tokens: 0 }) });
ok(runSpend.outcome.status === "LIMIT" && /TESTER_SPEND_LIMIT_SCENARIO/.test(runSpend.outcome.reason) && runSpend.metrics.actions === 1, "per-scenario tester spend cap stops the run mid-way");
const runJudge = await runScenario({ scenarioId: "P01-doctoral-idea", accountId: "fixture", manifest: aiManifest, aiClient: fakeClient([...toAdvisor, { action: { type: "fill", role: "textbox", name: "Describe your research idea", text: Q } }, { action: { type: "click", role: "button", name: "Ask advisor" } }, { action: { type: "done" } }], { input_tokens: 100, output_tokens: 50 }) });
ok(runJudge.outcome.status === "COMPLETED" && runJudge.science?.aiJudge?.label === "PROVISIONAL_AI_JUDGMENT", "tester AI + provisional AI judge path runs end to end (fake client)");
ok(usageUsd({ input_tokens: 1e6, output_tokens: 0 }, "claude-unknown-x") === 10 && usageUsd({ input_tokens: 1e6, output_tokens: 0 }, "claude-sonnet-5-5") === 2, "cost uses the answering model; unknown models priced at the highest rate");

console.log("Journey I and K");
const emptyEvidence = structuredClone(manifest); emptyEvidence.evidence.storeDirectory = "evidence-empty";
const freshSignIn = async (page) => { await page.context().addCookies([cookie("valid")]); return { ok: true }; };
const runNoPrior = await runScenario({ scenarioId: "P18-returning-resume", accountId: "fixture", manifest: emptyEvidence, decider: scripted(goNew), relogin: freshSignIn });
ok(runNoPrior.outcome.status === "BLOCKED" && /Precondition not met/.test(runNoPrior.outcome.reason), "returning-user journey BLOCKED without an earlier test record");
const runWithRecord = await runScenario({ scenarioId: "P01-doctoral-idea", accountId: "fixture", manifest, decider: scripted([...toAdvisor, { action: { type: "fill", role: "textbox", name: "Describe your research idea", text: "UXTEST-H2-revision" } }, { action: { type: "done" } }]) });
ok(runWithRecord.createdRecords.some((c) => c.value === "UXTEST-H2-revision"), "typed UXTEST record recorded");
let reloginCalled = false;
const runFresh = await runScenario({ scenarioId: "P18-returning-resume", accountId: "fixture", manifest, decider: scripted([{ action: { type: "done" } }]), relogin: async (page) => { reloginCalled = true; return freshSignIn(page); } });
ok(reloginCalled && runFresh.freshLogin?.performed && runFresh.outcome.status === "COMPLETED" && runFresh.auth.status === AUTH.FOUNDER_VERIFIED, "returning-user journey uses a fresh sign-in, verified by markers");
const runExpiry = await runScenario({ scenarioId: "K-session-expiry", accountId: "fixture", manifest, configDir: cfgDir, decider: scripted([{ action: { type: "click", role: "link", name: "Settings" } }, { action: { type: "done" } }]) });
ok(runExpiry.steps.some((s) => s.kind === "hook" && s.hook === "clearSession"), "session-expiry hook clears the session mid-run");
const runOffline = await runScenario({ scenarioId: "K-offline-submission", accountId: "fixture", manifest, configDir: cfgDir, decider: scripted([...toAdvisor, { action: { type: "fill", role: "textbox", name: "Describe your research idea", text: scen.scenarios.find((s) => s.id === "K-offline-submission").question } }, { action: { type: "click", role: "button", name: "Ask advisor" } }, { action: { type: "done" } }]) });
ok(runOffline.offlineObservation?.alerts?.some((a) => /offline/i.test(a)) && runOffline.equitasResponses.length === 0, "offline-submission hook observes the site's error message; nothing reaches the server");

console.log("fix 5: approval IDs and markers validated");
ok(approvalProblems({ accounts: [{ id: "a", approvedFor: ["J-cross-module"] }] })[0]?.includes("P05-cross-module"), "unknown ID 'J-cross-module' rejected with suggestion");
const example = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "authorization-manifest.example.json"), "utf8"));
ok(approvalProblems(example).length === 0 && example.accounts[0].approvedFor.includes("P06-senior-critique"), "example manifest approves real scenario IDs");
ok(scenarioProblems({ syntheticData: { recordPrefix: "UXTEST" } }).length === 0, "every scenario question carries the UXTEST marker");

console.log("fix 6: paths with spaces / entry-point detection");
const spaced = fs.mkdtempSync(path.join(os.tmpdir(), "my projects "));
const fakeScript = path.join(spaced, "run scenario.js");
fs.writeFileSync(fakeScript, "");
const savedArgv = process.argv[1];
process.argv[1] = fakeScript;
ok(isMain(pathToFileURL(fakeScript).href), "entry point detected in a folder with spaces");
process.argv[1] = path.join(spaced, "other.js");
ok(!isMain(pathToFileURL(fakeScript).href), "non-entry module not treated as entry point");
process.argv[1] = savedArgv;
fs.rmSync(spaced, { recursive: true, force: true });
ok(!ROOT.includes("%20") && fs.existsSync(path.join(ROOT, "config", "scenarios.json")), "ROOT resolves to a real folder");

console.log("measurement helpers");
ok(diffMiddle("Intro\nAsk", "Intro\nresult\nresult\nAsk") === "result\nresult", "answer capture keeps repeated lines");
ok(deploymentChanged({ buildId: "1.0", assetHash: "a" }, { buildId: "1.1", assetHash: "a" }) && !deploymentChanged({ assetHash: "a" }, { assetHash: "a" }), "mid-run deployment detection");
ok(pageNode("https://x/projects/0123456789abcdef/edit") === "/projects/{id}/edit", "navigation map normalises IDs");

console.log("blocked scenario");
ok((await runScenario({ scenarioId: "P19-funder", accountId: "fixture", manifest, decider: scripted(goNew) })).outcome.status === "BLOCKED", "funder scenario BLOCKED without funder role");

console.log("reports and retention");
const legacyDir = path.join(tmpRoot, "evidence", "runs", "UXTEST-PLANPROBE-founder-admin-legacy");
fs.mkdirSync(legacyDir, { recursive: true });
fs.writeFileSync(path.join(legacyDir, "run.json"), JSON.stringify({ runId: "UXTEST-PLANPROBE-founder-admin-legacy", kind: "probe-plan", startedAt: new Date().toISOString(), account: { id: "founder-admin", actualRole: "founder_admin" }, regression: { status: "PASS", checks: [] }, interpretation: { observations: [], hypotheses: [], questionsForAppifest: [] }, steps: [], findings: [], navigationPath: [], network: { consoleErrors: [], httpErrors: [], offDomainRequests: [] }, outcome: { status: "COMPLETED" } }));
const rep = buildReports(tmpRoot, ROOT);
ok(/Regression check: INVALID\*\* — recorded by an older harness that did not verify sign-in \(originally reported PASS\)/.test(fs.readFileSync(path.join(tmpRoot, "reports", "results.md"), "utf8")), "report marks the earlier unverified PASS probes as INVALID (evidence file untouched)");
const read = (f) => fs.readFileSync(path.join(tmpRoot, "reports", f), "utf8");
ok(read("navigation-map.md").includes("flowchart LR") && /\/settings\.html/.test(read("navigation-map.md")), "navigation map built from observed runs");
ok(read("persona-comparison.md").includes("BENCH-CHW-HTN") && /Doctoral trainee \| P01-doctoral-idea/.test(read("persona-comparison.md")), "persona comparison table for the shared benchmark");
ok(/Reproduction steps \(generated/.test(read("defect-register-draft.md")) && /click the link "Settings"/.test(read("defect-register-draft.md")), "defect register includes generated reproduction steps");
ok(read("accessibility.md").includes("button-name") && read("accessibility.md").includes("Reflow at 320 px"), "accessibility report aggregates axe and reflow results");
ok(read("cleanup-manifest.md").includes("new-id-in-url") && rep.findings > 0, "cleanup manifest lists site-created records");
const oldRun = path.join(tmpRoot, "evidence", "runs", "UXTEST-OLD-run");
fs.mkdirSync(oldRun, { recursive: true });
const keep = path.join(tmpRoot, "evidence", "runs", "not-a-test-folder");
fs.mkdirSync(keep, { recursive: true });
const longAgo = new Date(Date.now() - 400 * 86_400_000);
fs.utimesSync(oldRun, longAgo, longAgo); fs.utimesSync(keep, longAgo, longAgo);
ok(purge(manifest).removed.includes("UXTEST-OLD-run") && fs.existsSync(oldRun), "purge without --confirm only lists");
purge(manifest, { confirm: true });
ok(!fs.existsSync(oldRun) && fs.existsSync(keep), "purge --confirm deletes expired UXTEST runs only");

server.close();
fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.rmSync(cfgDir, { recursive: true, force: true });
console.log(`\n${pass} checks passed.`);
