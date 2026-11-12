// One loader for every consumer (reports, investigation, validation), so all
// of them see the same evidence and the same consolidated groups.
import fs from "node:fs";
import path from "node:path";
import { legacyFindings, consolidate, loadTriage } from "./findings.js";

export function loadRuns(root) {
  const dir = path.join(root, "evidence", "runs");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map((d) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, d, "run.json"), "utf8")); } catch { return null; }
  }).filter(Boolean);
}

export function loadInvestigations(root) {
  const dir = path.join(root, "evidence", "investigations");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map((d) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, d, "investigation.json"), "utf8")); } catch { return null; }
  }).filter(Boolean);
}

// Raw findings from all runs: public-audit runs store theirs directly; older
// runs are translated (original IDs kept) by legacyFindings().
export function rawFindings(runs) {
  const raw = [];
  for (const r of runs) {
    if (r.kind === "public-audit") raw.push(...(r.rawFindings || []));
    else raw.push(...legacyFindings(r));
  }
  return raw;
}

export function collect(root) {
  const runs = loadRuns(root);
  const raw = rawFindings(runs);
  const triage = loadTriage(root);
  const groups = consolidate(raw, triage);
  return { runs, raw, triage, groups, investigations: loadInvestigations(root) };
}

// Authentication validity of founder/authenticated probes. Pre-v2 probes are
// INVALID and never count as successful authentication tests.
export function authRecord(runs) {
  return runs.filter((r) => r.kind === "probe-plan" && r.account?.id !== "public-visitor").map((r) => {
    if (!r.harnessAuthVersion) return { runId: r.runId, at: r.startedAt, validity: "INVALID", detail: `pre-v2 harness did not verify sign-in (originally reported ${r.regression?.status || "n/a"})`, countsAsAuthenticated: false };
    const vps = r.auth?.perViewport || [];
    const verified = vps.length > 0 && vps.every((v) => v.conclusive);
    return { runId: r.runId, at: r.startedAt, validity: verified ? "VERIFIED" : r.auth?.preflight && r.auth.preflight !== "READY" ? "BLOCKED" : "NOT_ESTABLISHED", detail: vps.length ? vps.map((v) => `${v.viewport}: ${v.status}`).join(", ") : `${r.auth?.preflight || r.outcome?.status}`, countsAsAuthenticated: verified };
  });
}
