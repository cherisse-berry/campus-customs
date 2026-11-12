// Before-and-after reconciliation of findings (Section 11C/D).
//
//   npm run reconcile -- --expect-observations 7655 --expect-groups 420
//
// "Before" = the consolidation as the live audit's reports produced it
// (original observations, original grouping rules). "After" = the same
// observations with historical keyboard-v1 trap warnings re-assessed
// (src/lib/historical.js). Every observation appears exactly once in
// reports/reconciliation-observations.csv with its before and after issue.
import fs from "node:fs";
import path from "node:path";
import { ROOT, isMain, parseArgs } from "./lib/manifest.js";
import { loadRuns, rawFindings } from "./lib/collect.js";
import { consolidate, loadTriage } from "./lib/findings.js";
import { effectiveFindings, SUFFICIENCY, ROOT_CAUSES } from "./lib/historical.js";

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// Stable per-observation key: the original finding ID, with ~2, ~3 … when an
// older run's single finding expanded into several observations (one per selector).
export function observationKeys(raw) {
  const seen = new Map();
  return raw.map((f) => { const id = f.originalId || f.id; const n = (seen.get(id) || 0) + 1; seen.set(id, n); return n === 1 ? id : `${id}~${n}`; });
}

export function reconcile(root = ROOT, configRoot = ROOT, { expectObservations = null, expectGroups = null, write = true } = {}) {
  const runs = loadRuns(root);
  const raw = rawFindings(runs);
  const triage = { ...loadTriage(configRoot), ...loadTriage(root) };
  const before = consolidate(raw, triage);
  const eff = effectiveFindings(raw, runs);
  const after = consolidate(eff, triage);
  const keys = observationKeys(raw);
  const gBefore = new Map(before.map((g) => [g.fingerprint, g]));
  const gAfter = new Map(after.map((g) => [g.fingerprint, g]));
  const rows = raw.map((f, i) => {
    const b = gBefore.get(f.fingerprint), a = gAfter.get(eff[i].fingerprint), h = eff[i].historical;
    return {
      observation: keys[i], runId: f.runId, ruleId: f.ruleId, page: f.page || "", viewport: f.viewport || "",
      beforeGroup: b.groupId, beforeCategory: b.category, beforeSeverity: b.proposedSeverity || "",
      afterGroup: a.groupId, afterCategory: a.category, afterSeverity: a.proposedSeverity || "",
      sufficiency: h?.sufficiency || "", rootCause: h?.rootCause || "", retest: h ? (h.retestRecommended ? "yes" : "no") : "",
      change: h ? "re-assessed (historical keyboard-v1 trap warning)" : b.groupId === a.groupId && b.category === a.category ? "unchanged" : "regrouped",
      evidence: h?.evidence || "",
    };
  });
  // Group-level: where did each before-group's observations go?
  const flows = new Map();
  for (const r of rows) {
    const k = `${r.beforeGroup}→${r.afterGroup}`;
    const e = flows.get(k) || { beforeGroup: r.beforeGroup, afterGroup: r.afterGroup, count: 0, beforeCategory: r.beforeCategory, afterCategory: r.afterCategory, beforeSeverity: r.beforeSeverity, afterSeverity: r.afterSeverity };
    e.count++; flows.set(k, e);
  }
  const trapRows = rows.filter((r) => r.sufficiency);
  const bySuff = Object.fromEntries(Object.values(SUFFICIENCY).map((s) => [s, trapRows.filter((r) => r.sufficiency === s).length]));
  const byCause = {};
  for (const r of trapRows) {
    const c = (byCause[r.rootCause] ??= { rootCause: r.rootCause, observations: 0, pages: new Set(), viewports: new Set(), runs: new Set(), afterGroups: new Set(), ids: [] });
    c.observations++; c.pages.add(r.page); c.viewports.add(r.viewport); c.runs.add(r.runId); c.afterGroups.add(r.afterGroup); c.ids.push(r.observation);
  }
  const checks = [];
  const problems = [];
  const uniqueKeys = new Set(keys).size;
  checks.push(`observations: before ${raw.length}, after ${eff.length}, unique keys ${uniqueKeys}`);
  if (raw.length !== eff.length || uniqueKeys !== raw.length) problems.push("observation counts differ between before and after, or keys are not unique");
  const beforeTotal = before.reduce((n, g) => n + g.occurrences, 0), afterTotal = after.reduce((n, g) => n + g.occurrences, 0);
  checks.push(`occurrences summed over groups: before ${beforeTotal}, after ${afterTotal}`);
  if (beforeTotal !== raw.length || afterTotal !== raw.length) problems.push("group occurrences do not sum to the observation count");
  if (expectObservations != null) { checks.push(`expected original observations ${expectObservations}: found ${raw.length}`); if (raw.length !== Number(expectObservations)) problems.push(`expected ${expectObservations} original observations, evidence has ${raw.length}`); }
  if (expectGroups != null) { checks.push(`expected original issue groups ${expectGroups}: found ${before.length}`); if (before.length !== Number(expectGroups)) problems.push(`expected ${expectGroups} original issue groups, evidence consolidates to ${before.length}`); }
  const summary = {
    at: new Date().toISOString(), observations: raw.length, groupsBefore: before.length, groupsAfter: after.length,
    expectObservations, expectGroups, checks, problems, ok: problems.length === 0,
    keyboardTrap: { historicalObservations: trapRows.length, bySufficiency: bySuff, byRootCause: Object.values(byCause).map((c) => ({ ...c, pages: [...c.pages].sort(), viewports: [...c.viewports].sort(), runs: [...c.runs], afterGroups: [...c.afterGroups], ids: c.ids, text: ROOT_CAUSES[c.rootCause].text, kind: ROOT_CAUSES[c.rootCause].kind, referenceCases: ROOT_CAUSES[c.rootCause].referenceCases })) },
    categoryTotals: { before: tally(before), after: tally(after) },
  };
  if (write) {
    const out = path.join(root, "reports");
    fs.mkdirSync(out, { recursive: true });
    const cols = Object.keys(rows[0] || { observation: "" });
    fs.writeFileSync(path.join(out, "reconciliation-observations.csv"), [cols.join(",")].concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))).join("\n"));
    const fcols = ["beforeGroup", "afterGroup", "count", "beforeCategory", "afterCategory", "beforeSeverity", "afterSeverity"];
    fs.writeFileSync(path.join(out, "reconciliation-groups.csv"), [fcols.join(",")].concat([...flows.values()].map((r) => fcols.map((c) => csvCell(r[c])).join(","))).join("\n"));
    fs.writeFileSync(path.join(out, "reconciliation.json"), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(out, "reconciliation.md"), markdown(summary, [...flows.values()].filter((f) => f.beforeGroup !== f.afterGroup || f.beforeCategory !== f.afterCategory)));
  }
  return { summary, rows, before, after };
}

function tally(groups) {
  const t = {};
  for (const g of groups) { t[g.category] ??= { issues: 0, observations: 0 }; t[g.category].issues++; t[g.category].observations += g.occurrences; }
  return t;
}

function markdown(s, changedFlows) {
  const k = s.keyboardTrap;
  let md = `# Reconciliation: before and after re-assessment\n\nGenerated ${s.at}. Every one of the **${s.observations}** original observations is mapped in \`reconciliation-observations.csv\` (one row each, with its original finding ID, run, page, viewport, before and after issue group, category and severity). Original evidence files are not modified.\n\n## Totals\n\n| | Before | After |\n|---|---|---|\n| Observations | ${s.observations} | ${s.observations} |\n| Issue groups | ${s.groupsBefore} | ${s.groupsAfter} |\n`;
  const cats = [...new Set([...Object.keys(s.categoryTotals.before), ...Object.keys(s.categoryTotals.after)])];
  for (const c of cats) md += `| ${c} (issues / observations) | ${s.categoryTotals.before[c]?.issues ?? 0} / ${s.categoryTotals.before[c]?.observations ?? 0} | ${s.categoryTotals.after[c]?.issues ?? 0} / ${s.categoryTotals.after[c]?.observations ?? 0} |\n`;
  md += `\n**Checks:** ${s.checks.join("; ")}. ${s.ok ? "All consistent." : `**PROBLEMS:** ${s.problems.join("; ")}`}\n`;
  md += `\n## Historical keyboard-trap warnings (keyboard-v1)\n\n${k.historicalObservations} observation(s) re-assessed from the evidence each original run stored. Nothing was rejected; each keeps its original ID, category and severity in the CSV.\n\n| Evidence sufficiency | Observations |\n|---|---|\n${Object.entries(k.bySufficiency).map(([a, b]) => `| ${a} | ${b} |`).join("\n")}\n\n**Why none is "supported by existing evidence":** a 2.1.2 failure requires that focus cannot be moved away by Tab, Shift+Tab or Escape. keyboard-v1 never pressed Shift+Tab or Escape and recorded no escape attempts, so no historical observation contains the evidence that would support a trap. This does not show that no trap exists.\n\n## Root causes (consolidated)\n\n`;
  for (const c of k.byRootCause) md += `### ${c.rootCause} — ${c.kind}\n${c.text}\n- Observations: ${c.observations} · Pages: ${c.pages.length} (${c.pages.slice(0, 12).join(", ")}${c.pages.length > 12 ? " …" : ""}) · Viewports: ${c.viewports.join(", ")} · Runs: ${c.runs.length}\n- After-groups: ${c.afterGroups.join(", ")}\n- Demonstrated by reference cases: ${c.referenceCases.join(", ") || "—"} (see keyboard-detector-validation.md)\n- Original observation IDs: ${c.ids.slice(0, 20).join(", ")}${c.ids.length > 20 ? ` … (+${c.ids.length - 20}; all in the CSV)` : ""}\n\n`;
  md += `Similar warnings were not assumed to share a cause. Each observation was classified on its own stored focus sequence. A shared cause is claimed only where that sequence shows the specific v1 defect, or the same element type and name, across pages.\n\n## Changed groups (before → after)\n\n| Before group | After group | Observations | Category before → after | Severity before → after |\n|---|---|---|---|---|\n${changedFlows.map((f) => `| ${f.beforeGroup} | ${f.afterGroup} | ${f.count} | ${f.beforeCategory} → ${f.afterCategory} | ${f.beforeSeverity || "—"} → ${f.afterSeverity || "—"} |`).join("\n") || "| — | | | | |"}\n`;
  return md;
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  const r = reconcile(ROOT, ROOT, { expectObservations: a["expect-observations"] ?? null, expectGroups: a["expect-groups"] ?? null });
  const s = r.summary;
  console.log(`Observations ${s.observations} · groups ${s.groupsBefore} → ${s.groupsAfter} · historical keyboard-trap observations ${s.keyboardTrap.historicalObservations}`);
  console.log("By evidence sufficiency: " + Object.entries(s.keyboardTrap.bySufficiency).map(([k, v]) => `${k} ${v}`).join(", "));
  for (const c of s.checks) console.log("  · " + c);
  if (!s.ok) { console.error("PROBLEMS:\n" + s.problems.map((p) => " - " + p).join("\n")); process.exit(1); }
  console.log("Wrote reports/reconciliation.md, reconciliation-observations.csv, reconciliation-groups.csv");
}
