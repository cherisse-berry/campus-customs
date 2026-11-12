// Section 18 — evidence retention. Lists local run folders older than the
// manifest's evidence.retainDays. Deletes them only with --confirm.
// Only folders inside evidence/runs whose names start with "UXTEST-" are touched.
//
//   npm run purge-evidence              (list only)
//   npm run purge-evidence -- --confirm (delete)
import fs from "node:fs";
import path from "node:path";
import { loadManifest, parseArgs, ROOT, isMain } from "./lib/manifest.js";

export function expiredRuns(manifest, now = Date.now()) {
  const days = manifest.evidence?.retainDays ?? 30;
  const dir = path.join(manifest._root || ROOT, manifest.evidence?.storeDirectory || "evidence", "runs");
  if (!fs.existsSync(dir)) return { dir, days, expired: [] };
  const expired = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("UXTEST-"))
    .map((e) => ({ name: e.name, full: path.join(dir, e.name), mtime: fs.statSync(path.join(dir, e.name)).mtimeMs }))
    .filter((e) => now - e.mtime > days * 86_400_000);
  return { dir, days, expired };
}

export function purge(manifest, { confirm = false } = {}) {
  const { dir, days, expired } = expiredRuns(manifest);
  const resolvedDir = path.resolve(dir);
  const removed = [];
  for (const e of expired) {
    const full = path.resolve(e.full);
    // Defence in depth: never delete anything outside evidence/runs.
    if (path.dirname(full) !== resolvedDir) continue;
    if (confirm) fs.rmSync(full, { recursive: true, force: true });
    removed.push(e.name);
  }
  return { dir, days, removed, deleted: confirm };
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  const manifest = loadManifest({ allowUnapproved: true });
  manifest._root = ROOT;
  const r = purge(manifest, { confirm: !!args.confirm });
  if (!r.removed.length) console.log(`No runs older than ${r.days} days in ${r.dir}.`);
  else console.log(`${r.deleted ? "Deleted" : "Would delete (add --confirm)"} ${r.removed.length} run(s) older than ${r.days} days:\n${r.removed.map((n) => "  " + n).join("\n")}`);
  console.log("Also delete any copies you made elsewhere, and sign out / run `npm run login -- --account <id> --forget` for saved logins.");
}
