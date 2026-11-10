// Loads and validates the founder-approved authorization manifest.
// The harness refuses to run without an approved, in-window manifest.
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
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
