// Runs scenarios one at a time (never concurrently), in Section 27 phase order.
//   npm run batch -- --account founder-admin --phase 4
//   npm run batch -- --account founder-admin --scenarios P01-doctoral-idea,P06-senior-critique
//   add --mobile to also run P01, P06, P13, P18 on a phone, and P01 on tablet and 320 px reflow (Journey L)
import fs from "node:fs";
import path from "node:path";
import { parseArgs, ROOT, loadManifest } from "./lib/manifest.js";
import { runScenario } from "./run-scenario.js";

const args = parseArgs();
if (!args.account) { console.error("Usage: npm run batch -- --account <id> (--phase 4 | --scenarios a,b) [--mobile]"); process.exit(2); }
const manifest = loadManifest();
manifest._root = ROOT;
const { scenarios } = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "scenarios.json"), "utf8"));
let list = args.scenarios ? args.scenarios.split(",") : scenarios.filter((s) => String(s.phase) === String(args.phase || 4)).map((s) => s.id);
const jobs = list.map((id) => ({ id, viewport: "desktop" }));
// Journey L: responsive coverage across user types, not only the trainee.
if (args.mobile) {
  for (const id of ["P01-doctoral-idea", "P06-senior-critique", "P13-intl-constrained", "P18-returning-resume"]) jobs.push({ id, viewport: "mobile" });
  jobs.push({ id: "P01-doctoral-idea", viewport: "tablet" }, { id: "P01-doctoral-idea", viewport: "reflow320" });
}

console.log(`Running ${jobs.length} scenario(s) sequentially as ${args.account}.`);
for (const j of jobs) {
  try {
    const run = await runScenario({ scenarioId: j.id, accountId: args.account, viewport: j.viewport, manifest });
    console.log(`  ${j.id} [${j.viewport}]: ${run.outcome.status} — ${run.outcome.reason?.slice(0, 140)}`);
    if (run.outcome.status === "STOPPED_SAFETY" && /OFF_DOMAIN|CONSEQUENTIAL/.test(run.outcome.reason)) {
      console.log("    (safety stop recorded; continuing with the next independent scenario)");
    }
    if (/DAILY_/.test(run.outcome.reason || "")) { console.log("Daily limit reached; stopping batch."); break; }
  } catch (e) {
    console.log(`  ${j.id} [${j.viewport}]: ERROR — ${e.message.split("\n")[0]}`);
  }
}
console.log("Done. Build the report with: npm run report");
