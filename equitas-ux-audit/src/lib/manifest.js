// Loads and validates the founder-approved authorization manifest.
// The harness refuses to run without an approved, in-window manifest.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// fileURLToPath handles Windows drive letters and percent-encoded spaces.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// True when the module is the script node was started with (works on Windows
// and in folders whose names contain spaces).
export function isMain(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return path.resolve(fileURLToPath(moduleUrl)).toLowerCase() === path.resolve(process.argv[1]).toLowerCase() ||
      moduleUrl === pathToFileURL(path.resolve(process.argv[1])).href;
  } catch { return false; }
}
const MANIFEST = path.join(ROOT, "config", "authorization-manifest.json");

export class AuthorizationError extends Error {}

export function loadManifest({ allowUnapproved = false, manifestPath = MANIFEST } = {}) {
  if (!fs.existsSync(manifestPath)) {
    throw new AuthorizationError(
      `No manifest at ${manifestPath}. Copy config/authorization-manifest.example.json to that path and fill it in.`
    );
  }
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const problems = [];
  if (!m.authorization?.approved) problems.push("authorization.approved is not true");
  if (!m.authorization?.approvedBy || m.authorization.approvedBy.includes("FOUNDER NAME")) problems.push("authorization.approvedBy is not filled in");
  let base;
  try { base = new URL(m.target.baseUrl); } catch { problems.push("target.baseUrl is not a valid URL"); }
  if (base && base.protocol !== "https:" && !m._selftest) problems.push("target.baseUrl must be https");
  if (base && !m.target.allowedHosts?.includes(base.hostname)) problems.push("target.baseUrl host is not in target.allowedHosts");
  if (!Array.isArray(m.accounts) || m.accounts.length === 0) problems.push("no accounts listed");
  problems.push(...approvalProblems(m));
  const w = m.authorization?.testingWindow;
  if (w?.start && w?.end && !w.start.startsWith("YYYY")) {
    const now = new Date();
    if (now < new Date(w.start) || now > new Date(w.end)) problems.push(`current time is outside the testing window ${w.start} – ${w.end}`);
  } else if (!m._selftest) {
    problems.push("authorization.testingWindow is not filled in");
  }
  if (problems.length && !allowUnapproved) {
    throw new AuthorizationError("Manifest not ready:\n - " + problems.join("\n - "));
  }
  m._problems = problems;
  return m;
}

// Every approvedFor entry must name a real scenario, "probe-plan", or "*".
// A typo would otherwise silently BLOCK the scenario the founder meant to approve.
export function approvalProblems(m, scenariosPath = path.join(ROOT, "config", "scenarios.json")) {
  let ids = [];
  try { ids = JSON.parse(fs.readFileSync(scenariosPath, "utf8")).scenarios.map((s) => s.id); } catch { return ["config/scenarios.json could not be read"]; }
  const valid = new Set([...ids, "probe-plan", "*"]);
  const out = [];
  for (const a of m.accounts || []) {
    for (const x of a.approvedFor || []) {
      if (!valid.has(x)) {
        const near = ids.find((id) => id.toLowerCase().includes(String(x).split("-").slice(1).join("-").toLowerCase()) && String(x).includes("-"));
        out.push(`account "${a.id}" approves unknown scenario "${x}"${near ? ` (did you mean "${near}"?)` : ""}`);
      }
    }
  }
  return out;
}

export function getAccount(manifest, accountId) {
  const a = manifest.accounts.find((x) => x.id === accountId);
  if (!a) throw new AuthorizationError(`Account "${accountId}" is not in the manifest.`);
  return a;
}

export function accountApprovedFor(account, scenarioId) {
  return account.approvedFor?.includes(scenarioId) || account.approvedFor?.includes("*");
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[k] = v;
    }
  }
  return out;
}
