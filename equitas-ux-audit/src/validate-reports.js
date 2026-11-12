// Checks the generated reports against the evidence they were built from.
//   npm run validate-reports        (exit 0 = consistent, 1 = mismatch)
import fs from "node:fs";
import path from "node:path";
import { ROOT, isMain } from "./lib/manifest.js";
import { rawFindings, authRecord, loadRuns, loadInvestigations } from "./lib/collect.js";
import { consolidate, loadTriage } from "./lib/findings.js";
import { latestPublicAudit } from "./lib/public-reports.js";

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

export function validateReports(root = ROOT, configRoot = ROOT) {
  const problems = [], checks = [];
  const rep = (f) => { try { return fs.readFileSync(path.join(root, "reports", f), "utf8"); } catch { problems.push(`reports/${f} is missing — run npm run report`); return null; } };
  const runs = loadRuns(root);
  const raw = rawFindings(runs);
  const groups = consolidate(raw, { ...loadTriage(configRoot), ...loadTriage(root) });
  const rawIds = new Set(raw.map((f) => f.originalId || f.id));

  const csv = rep("defect-register-draft.csv");
  if (csv) {
    const rows = parseCsv(csv);
    checks.push(`register rows: ${rows.length} vs evidence groups: ${groups.length}`);
    if (rows.length !== groups.length) problems.push(`register has ${rows.length} issues but the evidence consolidates to ${groups.length}`);
    const byId = new Map(groups.map((g) => [g.groupId, g]));
    let occ = 0;
    for (const r of rows) {
      const g = byId.get(r.groupId);
      if (!g) { problems.push(`register issue ${r.groupId} does not exist in the evidence`); continue; }
      occ += Number(r.occurrences);
      if (Number(r.occurrences) !== g.occurrences) problems.push(`${r.groupId}: register says ${r.occurrences} occurrences, evidence has ${g.occurrences}`);
      if (r.category !== g.category) problems.push(`${r.groupId}: register category ${r.category} ≠ evidence-derived ${g.category}`);
      for (const id of (r.originalFindingIds || "").split(" ").filter(Boolean)) if (!rawIds.has(id)) problems.push(`${r.groupId}: original finding ${id} not found in evidence`);
      for (const e of (r.evidence || "").split(" ").filter(Boolean)) if (!fs.existsSync(path.join(root, e))) problems.push(`${r.groupId}: evidence file ${e} does not exist`);
    }
    checks.push(`occurrences in register: ${occ} vs raw observations: ${raw.length}`);
    if (occ !== raw.length) problems.push(`register accounts for ${occ} observations; evidence has ${raw.length}`);
  }
  const summary = rep("public-audit-summary.md");
  const pub = latestPublicAudit(runs);
  if (summary && pub) {
    const n = Number(/Pages discovered and audited: \*\*(\d+)\*\*/.exec(summary)?.[1]);
    const ok = (pub.pages || []).filter((p) => p.status && p.status < 400 && !p.error).length;
    checks.push(`summary pages audited: ${n} vs evidence: ${ok}`);
    if (n !== ok) problems.push(`summary says ${n} pages audited; evidence has ${ok}`);
    if (!summary.includes(pub.runId)) problems.push("summary does not cite the latest public audit run");
  }
  const results = rep("results.md");
  if (results) {
    const a = authRecord(runs);
    const claimed = Number(/Successful authentication tests: \*\*(\d+)\*\*/.exec(results)?.[1]);
    const real = a.filter((x) => x.countsAsAuthenticated).length;
    checks.push(`successful authentication tests: report ${claimed} vs evidence ${real}`);
    if (claimed !== real) problems.push(`results.md claims ${claimed} successful authentication tests; evidence supports ${real}`);
    for (const x of a.filter((y) => y.validity === "INVALID")) if (!new RegExp(`${x.runId}[^\\n]*INVALID`).test(results)) problems.push(`legacy probe ${x.runId} is not marked INVALID in results.md`);
    if (a.some((x) => x.validity === "INVALID" && x.countsAsAuthenticated)) problems.push("an INVALID probe is counted as authenticated");
  }
  const acc = rep("accessibility.md");
  if (acc) for (const i of loadInvestigations(root)) if (!acc.includes(i.investigationId)) problems.push(`investigation ${i.investigationId} missing from accessibility.md`);
  return { ok: problems.length === 0, problems, checks };
}

if (isMain(import.meta.url)) {
  const r = validateReports();
  for (const c of r.checks) console.log("  · " + c);
  if (r.ok) console.log("Reports are consistent with the evidence.");
  else { console.error("MISMATCHES:\n" + r.problems.map((p) => " - " + p).join("\n")); process.exit(1); }
}
