// Offline self-test: runs the probe and the scenario loop against a local
// fixture site with a scripted (non-AI) decider. Never touches EQUITAS.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { ROOT } from "../src/lib/manifest.js";
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
fs.writeFileSync(path.join(tmpRoot, ".auth", "fixture.meta.json"), JSON.stringify({ savedAt: new Date().toISOString() }));

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log("  ✓ " + m); };

console.log("redaction");
ok(redact("mail me at a.b@uni.edu") === "mail me at [REDACTED_EMAIL]", "emails redacted");
ok(!redact("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij").includes("eyJ"), "JWTs redacted");

console.log("guard");
const g = makeGuard(manifest);
ok((await g.checkAction({ type: "click", name: "Select Pro", role: "button" }, { onPlanPage: true, containerText: "Pro $29 per month" })).stop === STOP.PLAN_SELECTION, "paid plan blocked");
ok((await g.checkAction({ type: "click", name: "Start free", role: "button" }, { onPlanPage: true, containerText: "Free $0 forever" })).stop === STOP.PLAN_SELECTION, "free plan blocked when selectFreePlan=false");
ok((await g.checkAction({ type: "click", name: "Delete project", role: "button" }, {})).stop === STOP.CONSEQUENTIAL_ACTION, "delete blocked");
ok((await g.checkAction({ type: "click", name: "Partner site", role: "link" }, { href: "https://evil.example.org/" })).stop === STOP.OFF_DOMAIN, "off-domain link blocked");
ok((await g.checkAction({ type: "fill", name: "Password", role: "textbox", text: "x" }, { inputType: "password", textIsSynthetic: true })).stop === STOP.CREDENTIAL_FIELD, "password field blocked");
ok((await g.checkAction({ type: "click", name: "Settings", role: "link" }, { href: `http://127.0.0.1:${port}/settings.html` })).ok, "settings navigation allowed");

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

console.log("blocked scenario");
const blocked = await runScenario({ scenarioId: "P19-funder", accountId: "fixture", manifest, decider });
ok(blocked.outcome.status === "BLOCKED", "funder scenario BLOCKED without funder role");

server.close();
fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(`\n${pass} checks passed.`);
