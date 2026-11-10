// Prints whether the manifest is ready and which scenarios each account may run.
import { loadManifest } from "./lib/manifest.js";
import { readAuthMeta } from "./lib/evidence.js";
import { ROOT } from "./lib/manifest.js";
import fs from "node:fs";
import path from "node:path";

let m;
try { m = loadManifest({ allowUnapproved: true }); } catch (e) { console.error(e.message); process.exit(1); }
const scenarios = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "scenarios.json"), "utf8")).scenarios;
console.log(m._problems.length ? "NOT READY:\n - " + m._problems.join("\n - ") : "Manifest approved.");
console.log(`\nTarget: ${m.target.baseUrl}  hosts: ${m.target.allowedHosts.join(", ")}`);
console.log(`Tester AI approved: ${!!m.testerAi?.approved}   Free-plan selection approved: ${!!m.permittedWorkflows.selectFreePlan}\n`);
for (const a of m.accounts) {
  const meta = readAuthMeta(ROOT, a.id);
  console.log(`Account ${a.id}  role=${a.actualRole}  entitlement=${a.actualEntitlement}  state=${a.accountState}  login=${meta ? "saved " + meta.savedAt : "none"}`);
}
console.log("\nScenario eligibility:");
for (const s of scenarios) {
  const ok = m.accounts.filter((a) => (a.approvedFor || []).some((x) => x === s.id || x === "*") && (!s.requiresRole || s.requiresRole.includes(a.actualRole)));
  console.log(`  ${s.id.padEnd(30)} ${ok.length ? "→ " + ok.map((a) => a.id).join(", ") : "BLOCKED (no approved account with role " + (s.requiresRole || ["any"]).join("/") + ")"}`);
}
