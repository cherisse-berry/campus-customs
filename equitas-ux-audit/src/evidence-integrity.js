// Evidence integrity: record and verify SHA-256 checksums of local evidence.
//
//   npm run evidence-snapshot                         → evidence/integrity/snapshot-<time>.json (+ .sha256)
//   npm run verify-evidence -- --against <file>       → compares current evidence with a snapshot
//
// <file> may be a snapshot JSON written by this tool, or a plain
// `shasum -a 256` listing (the format of the pre-update command in
// docs/evidence-integrity.md). Files added later are reported but are not
// errors; modified or missing files are.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { ROOT, isMain, parseArgs } from "./lib/manifest.js";

const EXCLUDE = /^evidence\/integrity\//;

export function listEvidence(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (!EXCLUDE.test(rel)) out.push(rel);
      }
    }
  };
  walk(path.join(root, "evidence"));
  return out.sort();
}

export const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function gitInfo(root = ROOT) {
  try {
    const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execFileSync("git", ["-C", root, "status", "--porcelain", "--", "."], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0;
    return { commit, dirty };
  } catch { return { commit: null, dirty: null, note: "not a Git checkout (e.g. a copied folder); record the deployed commit manually" }; }
}

export function snapshot(root = ROOT, { write = true, label = "" } = {}) {
  const files = listEvidence(root).map((p) => ({ path: p, sha256: sha256File(path.join(root, p)), bytes: fs.statSync(path.join(root, p)).size }));
  const snap = { at: new Date().toISOString(), label, git: gitInfo(root), fileCount: files.length, files };
  if (write) {
    const dir = path.join(root, "evidence", "integrity");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = snap.at.replace(/[-:]/g, "").replace(/\..+/, "");
    snap.file = path.join("evidence", "integrity", `snapshot-${stamp}.json`);
    fs.writeFileSync(path.join(root, snap.file), JSON.stringify(snap, null, 2));
    fs.writeFileSync(path.join(root, snap.file.replace(/\.json$/, ".sha256")), files.map((f) => `${f.sha256}  ${f.path}`).join("\n") + "\n");
  }
  return snap;
}

export function readSnapshot(file) {
  const text = fs.readFileSync(file, "utf8");
  if (text.trim().startsWith("{")) { const j = JSON.parse(text); return { git: j.git, files: new Map(j.files.map((f) => [f.path, f.sha256])) }; }
  const files = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m && !EXCLUDE.test(m[2].replace(/^\.\//, ""))) files.set(m[2].replace(/^\.\//, ""), m[1]);
  }
  return { git: null, files };
}

export function verify(root, against) {
  const snap = readSnapshot(against);
  const now = new Map(listEvidence(root).map((p) => [p, null]));
  const modified = [], missing = [], unchanged = [];
  for (const [p, h] of snap.files) {
    if (!now.has(p)) { missing.push(p); continue; }
    const cur = sha256File(path.join(root, p));
    (cur === h ? unchanged : modified).push(p);
  }
  const added = [...now.keys()].filter((p) => !snap.files.has(p));
  return { ok: modified.length === 0 && missing.length === 0, recorded: snap.files.size, unchanged: unchanged.length, modified, missing, added, snapshotGit: snap.git };
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  if (process.argv[1].includes("evidence-integrity") && args.against) {
    const r = verify(ROOT, path.resolve(String(args.against)));
    console.log(`Recorded files: ${r.recorded} · unchanged: ${r.unchanged} · modified: ${r.modified.length} · missing: ${r.missing.length} · added since: ${r.added.length}`);
    for (const p of r.modified) console.log(`  MODIFIED ${p}`);
    for (const p of r.missing) console.log(`  MISSING  ${p}`);
    if (r.added.length) console.log(`  (added since the snapshot, not an error: ${r.added.slice(0, 5).join(", ")}${r.added.length > 5 ? " …" : ""})`);
    console.log(r.ok ? "Original evidence is unchanged." : "ORIGINAL EVIDENCE CHANGED.");
    process.exit(r.ok ? 0 : 1);
  }
  const s = snapshot(ROOT, { label: args.label || "" });
  console.log(`Snapshot of ${s.fileCount} evidence file(s) at commit ${s.git.commit || "(not a Git checkout)"}${s.git.dirty ? " (with local changes)" : ""}: ${s.file}`);
}
