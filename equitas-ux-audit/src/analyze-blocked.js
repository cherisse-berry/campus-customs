// Classify the requests the public audit blocked (never replayed).
//   npm run analyze-blocked   → reports/blocked-requests.md
import fs from "node:fs";
import path from "node:path";
import { ROOT, isMain } from "./lib/manifest.js";
import { loadRuns } from "./lib/collect.js";
import { analyzeBlocked, blockedMarkdown } from "./lib/blocked.js";

if (isMain(import.meta.url)) {
  const a = analyzeBlocked(loadRuns(ROOT));
  fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "reports", "blocked-requests.md"), blockedMarkdown(a));
  for (const r of a) console.log(`${r.runId}: ${r.writeRequests} write request(s) blocked — ${r.groups.map((g) => `${g.count} ${g.purpose} (${g.effect})`).join(", ") || "none"}`);
  console.log("Wrote reports/blocked-requests.md (no request was sent or replayed).");
}
