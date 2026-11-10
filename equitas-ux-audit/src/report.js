// Aggregates every run into founder- and vendor-facing reports (Sections 21–22, 26).
// Draft findings from automation stay "triage: pending" until a person reviews
// them; severity is proposed, never final.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/manifest.js";

const runsDir = path.join(ROOT, "evidence", "runs");
const outDir = path.join(ROOT, "reports");
fs.mkdirSync(outDir, { recursive: true });
const runs = fs.existsSync(runsDir)
  ? fs.readdirSync(runsDir).map((d) => { try { return JSON.parse(fs.readFileSync(path.join(runsDir, d, "run.json"), "utf8")); } catch { return null; } }).filter(Boolean)
  : [];
const { scenarios } = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "scenarios.json"), "utf8"));
const { personas } = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "personas.json"), "utf8"));

const STATUS = {
  COMPLETED: "Tested — navigation task completed (science assessed separately)",
  ABANDONED: "Tested — failed (task abandoned under stopping rules)",
  STOPPED_SAFETY: "Partially tested — stopped at a consequential or off-domain action",
  LIMIT: "Partially tested — run limit reached",
  ERROR: "Partially tested — harness or site error; rerun needed",
  BLOCKED: "Blocked — no authorized account/permission",
};
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const latest = {};
for (const r of runs.filter((r) => r.scenarioId).sort((a, b) => a.startedAt.localeCompare(b.startedAt))) latest[`${r.scenarioId}|${r.viewport}`] = r;

// 1. Status by scenario
let md = `# EQUITAS black-box test results\n\nGenerated ${new Date().toISOString()} from ${runs.length} run(s) in evidence/runs.\n\n> Automated persona runs are simulations. They are not real-user findings. Scientific judgments are PROVISIONAL unless the criteria are marked expert-reviewed.\n\n## Scenario status\n\n| Scenario | Persona | Viewport | Account (actual role / entitlement) | Status | Actions | Failed lookups | AI submissions | Science coverage | Run |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const s of scenarios) {
  const rs = Object.values(latest).filter((r) => r.scenarioId === s.id);
  if (!rs.length) { md += `| ${s.id} | ${s.persona} | — | — | Not yet run | | | | | |\n`; continue; }
  for (const r of rs) {
    const sci = r.science?.deterministic ? `${r.science.deterministic.coveredCount}/${r.science.deterministic.total} concepts (${r.science.label})` : r.science?.status || "n/a";
    md += `| ${s.id} | ${s.persona} | ${r.viewport} | ${esc(r.account.id)} (${esc(r.account.actualRole)} / ${esc(r.account.actualEntitlement)}) | ${STATUS[r.outcome.status] || r.outcome.status}: ${esc(r.outcome.reason).slice(0, 120)} | ${r.metrics?.actions ?? ""} | ${r.metrics?.failedLookups ?? ""} | ${r.metrics?.aiSubmissions ?? ""} | ${esc(sci)} | ${r.runId} |\n`;
  }
}

// 2. Plan probe
const probes = runs.filter((r) => r.kind === "probe-plan");
md += `\n## Choose Your Plan probe (deterministic, not blinded)\n\n`;
if (!probes.length) md += "Not yet run.\n";
for (const p of probes) {
  md += `### ${p.runId} — account ${p.account.id} (${p.account.actualRole} / ${p.account.actualEntitlement}, state ${p.account.accountState}, server-side new user: ${p.account.serverSideNewUser})\n\n**Observed**\n${p.interpretation.observations.map((o) => "- " + o).join("\n")}\n\n**Hypotheses (inferred, not confirmed)**\n${(p.interpretation.hypotheses.map((o) => "- " + o).join("\n")) || "- none"}\n\n**Questions for Appifest**\n${p.interpretation.questionsForAppifest.map((o) => "- " + o).join("\n")}\n\n`;
}

// 3. Persona narratives
md += `\n## Persona-by-persona\n\n`;
for (const r of Object.values(latest)) {
  const persona = personas.find((p) => p.id === r.personaId);
  md += `### ${r.scenarioId} · ${persona?.label} · ${r.viewport}\n- Outcome: **${r.outcome.status}** — ${esc(r.outcome.reason)}\n- First action succeeded: ${r.metrics?.firstActionSucceeded}\n- Path: ${r.navigationPath.map((n) => n.url).filter((u, i, a) => u !== a[i - 1]).join(" → ")}\n`;
  const steps = r.steps.filter((s) => s.kind === "agent");
  md += `- Steps:\n${steps.map((s) => `  ${s.decision ? `- [${esc(s.decision.whereAmI)}] ${s.decision.action.type} ${s.decision.action.role} "${esc(s.decision.action.name)}" → ${esc(s.result)}` : ""}`).join("\n")}\n`;
  if (r.science?.aiJudge && typeof r.science.aiJudge === "object") {
    const j = r.science.aiJudge;
    md += `- Provisional AI judge: question recognized=${j.questionRecognizedCorrectly}; uncertainty=${j.uncertaintyCommunicated}; sources=${j.evidenceSourcesShown}; actionability=${j.actionability}; level fit=${j.levelFitForPersona}. Critical errors: ${j.criticalErrors.map((e) => esc(e.description)).join("; ") || "none flagged"}. Overclaims: ${j.overclaims.map((e) => esc(e.description)).join("; ") || "none flagged"}.\n`;
  }
  if (r.science?.deterministic?.overclaims?.length) md += `- Overclaim patterns matched: ${r.science.deterministic.overclaims.map((o) => o.label).join("; ")}\n`;
  if (r.science?.deterministic?.staleTerms) md += `- Old-question terms after revision: ${r.science.deterministic.staleTerms.map((t) => `${t.term}×${t.occurrences}`).join(", ")}\n`;
  md += "\n";
}
fs.writeFileSync(path.join(outDir, "results.md"), md);

// 4. Defect register (drafts)
const findings = runs.flatMap((r) => r.findings.map((f) => ({ ...f, runId: r.runId, scenarioId: r.scenarioId || r.kind, account: r.account, viewport: r.viewport || "multiple", target: r.target, at: r.startedAt })));
const cols = ["id", "category", "severity", "title", "scenarioId", "accountRole", "entitlement", "viewport", "observed", "expected", "suspectedCause", "triage", "evidence", "runId"];
const csv = [cols.join(",")].concat(findings.map((f) => cols.map((c) => {
  const v = { accountRole: f.account?.actualRole, entitlement: f.account?.actualEntitlement, evidence: [f.screenshot, ...(f.evidence || [])].filter(Boolean).join(" ") }[c] ?? f[c];
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}).join(","))).join("\n");
fs.writeFileSync(path.join(outDir, "defect-register-draft.csv"), csv);
let dr = `# Defect register — DRAFT (automated observations awaiting human triage)\n\nEach entry needs: confirmed severity, exact reproduction steps checked by a person, expected behavior, acceptance criteria, regression test, and SOW mapping (if supported by the contract text). See docs/defect-register-template.md.\n\n`;
for (const f of findings) dr += `## ${f.id} — ${f.title}\n- Category: ${f.category} · Proposed severity: ${f.severity || "untriaged"} · Triage: ${f.triage || "pending"}\n- Scenario: ${f.scenarioId} · Account: ${f.account?.id} (${f.account?.actualRole}/${f.account?.actualEntitlement}) · Viewport: ${f.viewport} · Run: ${f.runId} · ${f.at}\n- Observed: ${f.observed}\n${f.expected ? `- Expected: ${f.expected}\n` : ""}${f.suspectedCause ? `- Suspected cause (unconfirmed): ${f.suspectedCause}\n` : ""}- Evidence: ${[f.screenshot, ...(f.evidence || [])].filter(Boolean).map((e) => `evidence/runs/${f.runId}/${e}`).join(", ") || "run.json"}\n\n`;
fs.writeFileSync(path.join(outDir, "defect-register-draft.md"), dr);

// 5. Cleanup manifest + evidence index
const created = runs.flatMap((r) => r.createdRecords.map((c) => ({ ...c, runId: r.runId, account: r.account?.id })));
fs.writeFileSync(path.join(outDir, "cleanup-manifest.md"), `# Test-created records (for authorized manual cleanup — nothing is deleted automatically)\n\n| Value | Kind | Account | Run | When | Page |\n|---|---|---|---|---|---|\n${created.map((c) => `| ${esc(c.value)} | ${c.kind} | ${c.account} | ${c.runId} | ${c.at} | ${c.url} |`).join("\n")}\n\nAlso search the site for any record whose name starts with UXTEST.\n`);
fs.writeFileSync(path.join(outDir, "evidence-index.md"), `# Evidence index\n\n${runs.map((r) => `- ${r.runId} · ${r.scenarioId || r.kind} · ${r.startedAt} → ${r.endedAt} · ${r.outcome?.status} · evidence/runs/${r.runId}/ (${r.steps.length} steps; console errors ${r.network.consoleErrors.length}; HTTP≥400 ${r.network.httpErrors.length}; off-domain request hosts: ${(r.network.offDomainRequests || []).join(", ") || "none"})`).join("\n")}\n`);
console.log(`Wrote reports/results.md, defect-register-draft.{md,csv}, cleanup-manifest.md, evidence-index.md (${runs.length} runs, ${findings.length} draft findings).`);
