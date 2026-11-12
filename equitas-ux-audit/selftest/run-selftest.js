// Offline self-test: runs the probe and the scenario loop against a local
// fixture site with a scripted (non-AI) decider. Never touches EQUITAS.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { ROOT, isMain, approvalProblems } from "../src/lib/manifest.js";
import { pathToFileURL } from "node:url";
import os from "node:os";
import { probePlan } from "../src/probe-plan.js";
import { runScenario } from "../src/run-scenario.js";
import { makeGuard, STOP } from "../src/lib/safety.js";
import { redact } from "../src/lib/redact.js";

const fx = path.join(ROOT, "selftest", "fixture");
const server = http.createServer((req, res) => {
  const f = path.join(fx, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": "text/html" }); res.end(fs.readFileSync(f));
}).listen(0);
const port = server.address().port;
const tmpRoot = fs.mkdtempSync(path.join(ROOT, "evidence-selftest-"));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "authorization-manifest.example.json"), "utf8"));
Object.assign(manifest, { _selftest: true, _root: tmpRoot });
manifest.authorization.approved = true;
manifest.target = { baseUrl: `http://127.0.0.1:${port}/`, allowedHosts: ["127.0.0.1"] };
manifest.limits.minDelayBetweenActionsMs = 10;
manifest.permittedWorkflows.submitSyntheticResearchQuestions = true;
manifest.accounts = [{ id: "fixture", actualRole: "founder_admin", actualEntitlement: "fixture", accountState: "existing", approvedFor: ["*"] }];
// fake saved login
fs.mkdirSync(path.join(tmpRoot, ".auth"), { recursive: true });
fs.writeFileSync(path.join(tmpRoot, ".auth", "fixture.json"), JSON.stringify({ cookies: [], origins: [] }));
fs.writeFileSync(path.join(tmpRoot, ".auth", "fixture.meta.json"), JSON.stringify({ savedAt: new Date().toISOString(), signedInFingerprint: ["Settings", "Partner site", "Start free", "Select Pro"] }));

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log("  ✓ " + m); };

console.log("redaction");
ok(redact("mail me at a.b@uni.edu") === "mail me at [REDACTED_EMAIL]", "emails redacted");
ok(!redact("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij").includes("eyJ"), "JWTs redacted");

console.log("guard");
const g = makeGuard(manifest);
ok((await g.checkAction({ type: "click", name: "Select Pro", role: "button" }, { actualName: "Select Pro", actualText: "Select Pro", onPlanPage: true, containerText: "Pro $29 per month" })).stop === STOP.PLAN_SELECTION, "paid plan blocked");
ok((await g.checkAction({ type: "click", name: "Start free", role: "button" }, { actualName: "Start free", actualText: "Start free", onPlanPage: true, containerText: "Free $0 forever" })).stop === STOP.PLAN_SELECTION, "free plan blocked when selectFreePlan=false");
ok((await g.checkAction({ type: "click", name: "Delete project", role: "button" }, { actualName: "Delete project", actualText: "Delete project",})).stop === STOP.CONSEQUENTIAL_ACTION, "delete blocked");
ok((await g.checkAction({ type: "click", name: "Partner site", role: "link" }, { actualName: "Partner site", actualText: "Partner site", href: "https://evil.example.org/" })).stop === STOP.OFF_DOMAIN, "off-domain link blocked");
ok((await g.checkAction({ type: "fill", name: "Password", role: "textbox", text: "x" }, { actualName: "Password", actualText: "Password", inputType: "password", textIsSynthetic: true })).stop === STOP.CREDENTIAL_FIELD, "password field blocked");
ok((await g.checkAction({ type: "click", name: "Settings", role: "link" }, { actualName: "Settings", actualText: "Settings", href: `http://127.0.0.1:${port}/settings.html` })).ok, "settings navigation allowed");

console.log("probe-plan");
const probe = await probePlan({ manifest, accountId: "fixture", viewports: ["desktop"] });
const r = probe.probe[0];
ok(r.landing.onPlanPage, "plan screen detected");
ok(r.classification.planCtas.length === 2, "two plan CTAs found");
ok(r.classification.escapeCtas.length === 0, "no non-plan exit found");
ok(r.moduleFromSettings && !r.moduleFromSettings.onPlanPage, "Settings → Advisor bypass detected");
ok(probe.findings.some((f) => /Settings is the observed workaround/.test(f.title)), "draft finding created");
ok(fs.readdirSync(path.join(tmpRoot, "evidence", "runs", probe.runId, "steps")).some((f) => f.endsWith(".png")), "screenshots saved");

console.log("scenario loop (scripted decider)");
const script = [
  { action: { type: "click", role: "link", name: "Settings" } },
  { action: { type: "click", role: "link", name: "Advisor" } },
  { action: { type: "fill", role: "textbox", name: "Describe your research idea", text: "I'm interested in whether community health workers could help people with high blood pressure. I don't know how to turn this into a research question yet. Can you help me?" } },
  { action: { type: "click", role: "button", name: "Ask advisor" } },
  { action: { type: "click", role: "button", name: "Delete project" } },
];
let i = 0;
const decider = async () => ({ observation: "x", whereAmI: "fixture", progress: "some", rationale: "scripted", confusion: "", ...script[i++], action: { role: "", name: "", index: 0, text: "", ...script[i - 1].action } });
const run = await runScenario({ scenarioId: "P01-doctoral-idea", accountId: "fixture", manifest, decider });
ok(run.equitasResponses.length === 1 && /Clarifying question/.test(run.equitasResponses[0].newText), "response captured after submission");
ok(run.outcome.status === "STOPPED_SAFETY" && /CONSEQUENTIAL/.test(run.outcome.reason), "run stopped at Delete project");
ok(run.science?.deterministic?.coveredCount >= 2, `deterministic science coverage computed (${run.science.deterministic.coveredCount}/${run.science.deterministic.total})`);

console.log("fix 1 + 4: real names, ambiguity, unnamed controls, submission counting");
const script2 = [
  { action: { type: "click", role: "link", name: "Settings" } },
  { action: { type: "click", role: "link", name: "Advisor" } },
  { action: { type: "fill", role: "textbox", name: "Describe your research idea", text: "I'm interested in whether community health workers could help people with high blood pressure. I don't know how to turn this into a research question yet. Can you help me?" } },
  { action: { type: "click", role: "button", name: "Continue" } },     // submit button with a non-submit name
  { action: { type: "click", role: "button", name: "Save" } },         // partial: matches 2 buttons → refused
  { action: { type: "click", role: "button", name: "" } },             // unnamed icon button → refused
  { action: { type: "click", role: "button", name: "Save and send" } }, // single partial → real name checked
];
let j = 0;
const decider2 = async () => { const s = script2[j++]; return { observation: "x", whereAmI: "fixture", progress: "some", rationale: "scripted", confusion: "", action: { role: "", name: "", index: 0, text: "", ...s.action } }; };
const run2 = await runScenario({ scenarioId: "P01-doctoral-idea", accountId: "fixture", manifest, decider: decider2 });
const res = (n) => run2.steps.filter((s) => s.kind === "agent")[n]?.result || "";
ok(run2.metrics.aiSubmissions === 1 && run2.equitasResponses.length === 1, "submission via a button named 'Continue' is counted and captured");
ok(/refused/.test(res(4)) && /partly matches 2/.test(res(4)), "ambiguous partial name 'Save' refused (matches Save draft + Save and send invitations)");
ok(/refused/.test(res(5)), "unnamed control refused");
ok(run2.outcome.status === "STOPPED_SAFETY" && /send invitation/.test(run2.outcome.reason) && /Save and send invitations/.test(run2.outcome.reason), "partial name 'Save and send' checked against real name 'Save and send invitations' and stopped");

console.log("fix 3: manifest workflow permissions enforced");
let k = 0;
const script3 = [{ action: { type: "click", role: "link", name: "Settings" } }, { action: { type: "click", role: "link", name: "Advisor" } }, { action: { type: "click", role: "button", name: "New project" } }];
const decider3 = async () => { const s = script3[k++]; return { observation: "x", whereAmI: "fixture", progress: "some", rationale: "scripted", confusion: "", action: { role: "", name: "", index: 0, text: "", ...s.action } }; };
const run3 = await runScenario({ scenarioId: "P05-cross-module", accountId: "fixture", manifest, decider: decider3 });
ok(/PROJECT_CREATION_NOT_AUTHORIZED/.test(run3.outcome.reason), "'New project' blocked while createSyntheticProjects=false");
const noAuthNav = structuredClone(manifest); noAuthNav.permittedWorkflows.navigateAuthenticatedPages = false;
const run4 = await runScenario({ scenarioId: "P05-cross-module", accountId: "fixture", manifest: noAuthNav, decider: decider3 });
ok(run4.outcome.status === "BLOCKED" && /navigateAuthenticatedPages/.test(run4.outcome.reason), "signed-in scenario BLOCKED when navigateAuthenticatedPages=false");
const g2 = makeGuard(manifest);
ok((await g2.checkAction({ type: "click", name: "Ask", role: "button" }, { actualName: "Ask", actualText: "Ask", pendingTextLength: 50 })).countsAsAiSubmission, "pending text + click counts as submission");
const noSubmit = structuredClone(manifest); noSubmit.permittedWorkflows.submitSyntheticResearchQuestions = false;
ok(!(await makeGuard(noSubmit).checkAction({ type: "click", name: "Next", role: "button" }, { actualName: "Next", actualText: "Next", pendingTextLength: 50 })).ok, "submission refused when submitSyntheticResearchQuestions=false");

console.log("fix 2: saved login that doesn't work is detected");
const signedOut = structuredClone(manifest); signedOut.target.baseUrl = `http://127.0.0.1:${port}/login.html`;
const run5 = await runScenario({ scenarioId: "P05-cross-module", accountId: "fixture", manifest: signedOut, decider: decider3 });
ok(run5.outcome.status === "BLOCKED" && /SAVED_LOGIN_NOT_ACCEPTED/.test(run5.outcome.reason) && run5.metrics.actions === 0, "scenario BLOCKED on a sign-in page, nothing clicked");
const probe2 = await probePlan({ manifest: signedOut, accountId: "fixture", viewports: ["desktop"] });
ok(/SAVED_LOGIN_NOT_ACCEPTED/.test(probe2.probe[0].error || "") && !probe2.probe[0].landing, "plan probe refuses to report a signed-out page");
ok(run.authCheck?.status === "signed_in", "normal run recorded as signed in");

console.log("fix 5: approval IDs validated");
ok(approvalProblems({ accounts: [{ id: "a", approvedFor: ["J-cross-module"] }] })[0]?.includes("P05-cross-module"), "unknown ID 'J-cross-module' rejected with suggestion");
const example = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "authorization-manifest.example.json"), "utf8"));
ok(approvalProblems(example).length === 0 && example.accounts[0].approvedFor.includes("P06-senior-critique"), "example manifest approves real phase-4 scenario IDs");

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

console.log("blocked scenario");
const blocked = await runScenario({ scenarioId: "P19-funder", accountId: "fixture", manifest, decider });
ok(blocked.outcome.status === "BLOCKED", "funder scenario BLOCKED without funder role");

server.close();
fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(`\n${pass} checks passed.`);
