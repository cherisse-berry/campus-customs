// Aggregates every run into founder- and vendor-facing reports (Sections 19, 21–22, 26, 29).
// Draft findings from automation stay "triage: pending" until a person reviews
// them; severity is proposed, never final.
import fs from "node:fs";
import path from "node:path";
import { ROOT, isMain } from "./lib/manifest.js";
import { rawFindings, loadInvestigations } from "./lib/collect.js";
import { consolidate, loadTriage } from "./lib/findings.js";
import { registerMarkdown, registerCsv, consolidationMarkdown, publicSummaryMarkdown, wcagMarkdown, a11yGroupsMarkdown, publicNavMarkdown, authRecordMarkdown, loadWcag } from "./lib/public-reports.js";
import { effectiveFindings } from "./lib/historical.js";
import { analyzeBlocked, blockedMarkdown } from "./lib/blocked.js";
import { reconcile } from "./reconcile.js";

const STATUS = {
  COMPLETED: "Tested — navigation task completed (science assessed separately)",
  ABANDONED: "Tested — failed (task abandoned under stopping rules)",
  STOPPED_SAFETY: "Partially tested — stopped at a consequential or off-domain action",
  LIMIT: "Partially tested — run limit reached",
  ERROR: "Partially tested — harness or site error; rerun needed",
  BLOCKED: "Blocked — no authorized account/permission or precondition",
};
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function loadRuns(root = ROOT) {
  const runsDir = path.join(root, "evidence", "runs");
  return fs.existsSync(runsDir)
    ? fs.readdirSync(runsDir).map((d) => { try { return JSON.parse(fs.readFileSync(path.join(runsDir, d, "run.json"), "utf8")); } catch { return null; } }).filter(Boolean)
    : [];
}

// Normalise a URL to a page "node": path only, with IDs replaced by {id}.
export function pageNode(u) {
  try {
    return new URL(u).pathname.replace(/\/([0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{12,}|[A-Za-z0-9_-]{16,}|\d{3,})(?=\/|$)/g, "/{id}") || "/";
  } catch { return String(u); }
}

// Plain-language reproduction steps for a finding, rebuilt from the run's steps.
export function reproSteps(run, finding) {
  const out = [`Open ${run.target} in Chromium ${run.browser?.version || ""} at the ${run.viewport || "desktop"} viewport, signed in as an account with role "${run.account?.actualRole}" and entitlement "${run.account?.actualEntitlement}"${run.freshLogin ? " (fresh sign-in, no saved session)" : ""}.`];
  const upto = finding.stepIndex ?? run.steps.length;
  for (const s of run.steps.slice(0, upto + 1)) {
    if (s.kind === "agent" && s.decision) {
      const a = s.decision.action;
      const name = s.target?.actualName || a.name;
      if (a.type === "click") out.push(`On "${s.title || s.url}", click the ${a.role} "${name}".`);
      else if (a.type === "fill") out.push(`On "${s.title || s.url}", type into the ${a.role} "${name}": "${a.text}".`);
      else if (a.type === "press_enter") out.push(`Press Enter in the ${a.role} "${name}".`);
      else if (a.type === "back") out.push("Press the browser Back button.");
      else if (a.type === "scroll") out.push("Scroll down.");
      else if (a.type === "wait") out.push("Wait 5 seconds.");
    } else if (s.kind === "hook") out.push(`(Test condition) ${s.note}`);
  }
  return out;
}

// Optional expected totals from the live audit's original reports
// (config/reconciliation-expect.json: {"observations": 7655, "groups": 420}).
function readExpect(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, "config", "reconciliation-expect.json"), "utf8")); } catch { return {}; }
}

export function buildReports(root = ROOT, configRoot = ROOT) {
  const outDir = path.join(root, "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const runs = loadRuns(root);
  const { scenarios } = JSON.parse(fs.readFileSync(path.join(configRoot, "config", "scenarios.json"), "utf8"));
  const { personas } = JSON.parse(fs.readFileSync(path.join(configRoot, "config", "personas.json"), "utf8"));
  const latest = {};
  for (const r of runs.filter((r) => r.scenarioId).sort((a, b) => a.startedAt.localeCompare(b.startedAt))) latest[`${r.scenarioId}|${r.viewport}`] = r;
  const scenarioRuns = Object.values(latest);

  // Current reports use the re-assessed view (historical keyboard-v1 trap
  // warnings classified by evidence sufficiency); reconciliation.md maps it
  // back to the original observations and groups.
  const raw = effectiveFindings(rawFindings(runs), runs);
  const groups = consolidate(raw, { ...loadTriage(configRoot), ...loadTriage(root) });
  const recon = reconcile(root, configRoot, { write: true, expectObservations: readExpect(root).observations, expectGroups: readExpect(root).groups }).summary;
  const blockedAnalyses = analyzeBlocked(runs);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "blocked-requests.md"), blockedMarkdown(blockedAnalyses));
  let kbdValidation = null;
  try { kbdValidation = JSON.parse(fs.readFileSync(path.join(outDir, "keyboard-detector-validation.json"), "utf8")); } catch {}
  const investigations = loadInvestigations(root);
  const wcag = loadWcag(configRoot);

  // ---------- results.md ----------
  let md = `# EQUITAS black-box test results\n\nGenerated ${new Date().toISOString()} from ${runs.length} run(s) in evidence/runs.\n\n> Automated persona runs are simulations. They are not real-user findings. Scientific judgments are PROVISIONAL unless the criteria are marked expert-reviewed. Runs with validity warnings must be checked before use.\n\n## Scenario status\n\n| Scenario | Persona | Viewport | Account (role / entitlement) | Status | Validity | Actions | Failed lookups | Unexpected redirects | AI submissions | Science coverage | Build | Run |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const s of scenarios) {
    const rs = scenarioRuns.filter((r) => r.scenarioId === s.id);
    if (!rs.length) { md += `| ${s.id} | ${s.persona} | — | — | Not yet run | | | | | | | | |\n`; continue; }
    for (const r of rs) {
      const sci = r.science?.deterministic ? `${r.science.deterministic.coveredCount}/${r.science.deterministic.total} (${r.science.label})` : r.science?.status || "n/a";
      const validity = r.validity?.warnings?.length ? "⚠ " + r.validity.warnings.join("; ") : "ok";
      md += `| ${s.id} | ${s.persona} | ${r.viewport} | ${esc(r.account.id)} (${esc(r.account.actualRole)} / ${esc(r.account.actualEntitlement)}) | ${STATUS[r.outcome.status] || r.outcome.status}: ${esc(r.outcome.reason).slice(0, 120)} | ${esc(validity)} | ${r.metrics?.actions ?? ""} | ${r.metrics?.failedLookups ?? ""} | ${r.metrics?.unexpectedRedirects ?? ""} | ${r.metrics?.aiSubmissions ?? ""} | ${esc(sci)} | ${esc(r.buildAtStart?.buildId || r.buildAtStart?.assetHash || "")} | ${r.runId} |\n`;
    }
  }

  const probes = runs.filter((r) => r.kind === "probe-plan");
  md += `\n## Choose Your Plan probe (deterministic, not blinded)\n\n`;
  if (!probes.length) md += "Not yet run.\n";
  for (const p of probes) {
    md += `### ${p.runId} — account ${p.account.id} (${p.account.actualRole} / ${p.account.actualEntitlement}, state ${p.account.accountState}, server-side new user: ${p.account.serverSideNewUser}) · Chromium ${p.browser?.version || "?"}\n\n`;
    // Probes recorded before sign-in verification existed (harnessAuthVersion < 2)
    // could report PASS on a public page. Their verdicts are not trusted.
    const legacy = !p.harnessAuthVersion && p.account?.id !== "public-visitor";
    if (legacy) md += `**Regression check: INVALID** — recorded by an older harness that did not verify sign-in (originally reported ${p.regression?.status || "n/a"}). Superseded; rerun the probe.\n\n`;
    if (p.auth?.perViewport) md += `**Authentication:** ${p.auth.perViewport.map((a) => `[${a.viewport}] ${a.status || "not checked"}${a.conclusive ? " (verified)" : " (NOT established)"}`).join(" · ")}\n\n`;
    else if (p.auth?.preflight && p.auth.preflight !== "READY") md += `**Authentication:** ${p.auth.preflight} — ${p.auth.reasons.join(" ")} EQUITAS was not contacted.\n\n`;
    if (!legacy) md += `**Regression check:** ${p.regression?.status || "n/a"}${p.regression?.reason ? ` — ${p.regression.reason}` : ""}${p.regression?.checks ? "\n" + p.regression.checks.map((c) => `- [${c.viewport}] ${c.pass === true ? "pass" : c.pass === false ? "FAIL" : "inconclusive"} — ${c.reason}`).join("\n") : ""}\n\n`;
    if (!p.interpretation) continue;
    md += `**Observed**\n${p.interpretation.observations.map((o) => "- " + o).join("\n")}\n\n**Hypotheses (inferred, not confirmed)**\n${p.interpretation.hypotheses.map((o) => "- " + o).join("\n") || "- none"}\n\n**Questions for Appifest**\n${p.interpretation.questionsForAppifest.map((o) => "- " + o).join("\n")}\n\n`;
  }

  md += `\n## Persona-by-persona\n\n`;
  for (const r of scenarioRuns) {
    const persona = personas.find((p) => p.id === r.personaId);
    md += `### ${r.scenarioId} · ${persona?.label} · ${r.viewport}\n- Outcome: **${r.outcome.status}** — ${esc(r.outcome.reason)}\n- Browser: Chromium ${r.browser?.version || "?"} · Build at start/end: ${esc(r.buildAtStart?.buildId || r.buildAtStart?.assetHash)} / ${esc(r.buildAtEnd?.buildId || r.buildAtEnd?.assetHash)}\n- Sign-in check: ${r.auth?.status || r.auth?.preflight || (r.authCheck ? `${r.authCheck.status} (old heuristic, not reliable)` : "n/a")}${r.freshLogin ? " (fresh sign-in)" : ""} · First action succeeded: ${r.metrics?.firstActionSucceeded} · Duration: ${r.metrics?.durationSec ?? "?"} s\n`;
    if (r.validity?.warnings?.length) md += `- ⚠ Validity: ${r.validity.warnings.join("; ")}\n`;
    md += `- Path: ${r.navigationPath.map((n) => n.url).filter((u, i, a) => u !== a[i - 1]).join(" → ")}\n`;
    md += `- Steps:\n${r.steps.filter((s) => s.kind === "agent" && s.decision).map((s) => `  - [${esc(s.decision.whereAmI)}] ${s.decision.action.type} ${s.decision.action.role} "${esc(s.target?.actualName || s.decision.action.name)}" → ${esc(s.result)}`).join("\n")}\n`;
    if (r.offlineObservation) md += `- While offline the page showed: alerts=${JSON.stringify(r.offlineObservation.alerts)} status=${JSON.stringify(r.offlineObservation.status)}\n`;
    if (r.science?.aiJudge && typeof r.science.aiJudge === "object") {
      const j = r.science.aiJudge;
      md += `- Provisional AI judge: question recognized=${j.questionRecognizedCorrectly}; uncertainty=${j.uncertaintyCommunicated}; sources=${j.evidenceSourcesShown}; actionability=${j.actionability}; level fit=${j.levelFitForPersona}. Critical errors: ${j.criticalErrors.map((e) => esc(e.description)).join("; ") || "none flagged"}. Overclaims: ${j.overclaims.map((e) => esc(e.description)).join("; ") || "none flagged"}.\n`;
    }
    if (r.science?.deterministic) {
      const d = r.science.deterministic;
      md += `- Concept coverage (keyword, quoted for checking):\n${d.concepts.map((c) => `  - ${c.addressed ? "✓" : "✗"} ${c.label}${c.snippets?.length ? ` — "${esc(c.snippets[0].snippet)}"` : ""}`).join("\n")}\n`;
      if (d.overclaims?.length) md += `- Overclaim patterns matched: ${d.overclaims.map((o) => o.label).join("; ")}\n`;
      if (d.staleTerms) md += `- Old-question terms after revision: ${d.staleTerms.map((t) => `${t.term}×${t.occurrences}`).join(", ")}\n`;
    }
    md += "\n";
  }
  md += authRecordMarkdown(runs);
  const pubRuns = runs.filter((r) => r.kind === "public-audit");
  if (pubRuns.length) md += `\n## Public website audits\n\n${pubRuns.map((r) => `- ${r.runId}: **${r.outcome?.status}** — ${esc(r.outcome?.reason)}`).join("\n")}\n\nSee public-audit-summary.md.\n`;
  fs.writeFileSync(path.join(outDir, "results.md"), md);

  // ---------- persona-comparison.md (shared benchmark tasks) ----------
  let pc = `# Persona comparison on shared benchmark tasks (Section 21A)\n\nSame underlying research task, different personas. Read each row separately: these are not averaged and say nothing about real users.\n\n`;
  const benches = [...new Set(scenarios.map((s) => s.sharedBenchmark).filter(Boolean))];
  for (const b of benches) {
    pc += `## ${b}\n\n| Persona | Scenario | Viewport | Outcome | Actions | Failed lookups | First action ok | Concepts covered | Question recognized (AI, provisional) | Level fit (AI, provisional) | Uncertainty | Overclaims |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
    for (const s of scenarios.filter((x) => x.sharedBenchmark === b)) {
      const rs = scenarioRuns.filter((r) => r.scenarioId === s.id);
      const persona = personas.find((p) => p.id === s.persona);
      if (!rs.length) { pc += `| ${persona?.label} | ${s.id} | — | not yet run | | | | | | | | |\n`; continue; }
      for (const r of rs) {
        const d = r.science?.deterministic, j = typeof r.science?.aiJudge === "object" ? r.science.aiJudge : null;
        pc += `| ${persona?.label} | ${s.id} | ${r.viewport} | ${r.outcome.status} | ${r.metrics?.actions ?? ""} | ${r.metrics?.failedLookups ?? ""} | ${r.metrics?.firstActionSucceeded ?? ""} | ${d ? `${d.coveredCount}/${d.total}` : "—"} | ${j?.questionRecognizedCorrectly ?? "—"} | ${j?.levelFitForPersona ?? "—"} | ${j?.uncertaintyCommunicated ?? "—"} | ${d?.overclaims?.length ?? "—"} |\n`;
      }
    }
    pc += "\nSevere failures for any single persona are reported in the defect register regardless of how other personas fared.\n\n";
  }
  fs.writeFileSync(path.join(outDir, "persona-comparison.md"), pc);

  // ---------- navigation-map.md (Section 19) ----------
  const edges = new Map(), nodes = new Map();
  for (const r of scenarioRuns) {
    for (const s of r.steps.filter((x) => x.kind === "agent" && x.decision && x.afterUrl)) {
      const from = pageNode(s.url), to = pageNode(s.afterUrl);
      nodes.set(from, (nodes.get(from) || new Set()).add(s.title || ""));
      nodes.set(to, nodes.get(to) || new Set());
      if (from === to) continue;
      const label = `${s.decision.action.type} "${(s.target?.actualName || s.decision.action.name || "").slice(0, 30)}"`;
      const k = `${from}|${to}|${label}`;
      edges.set(k, { from, to, label, count: (edges.get(k)?.count || 0) + 1, personas: new Set([...(edges.get(k)?.personas || []), r.personaId]) });
    }
    for (const s of r.steps.filter((x) => x.kind === "redirect")) {
      const k = `${pageNode(s.from)}|${pageNode(s.to)}|(redirect)`;
      edges.set(k, { from: pageNode(s.from), to: pageNode(s.to), label: "(redirect)", count: (edges.get(k)?.count || 0) + 1, personas: new Set([...(edges.get(k)?.personas || []), r.personaId]) });
    }
  }
  const ids = new Map([...nodes.keys()].map((n, i) => [n, `n${i}`]));
  let nm = `# Current website navigation map (observed)\n\nBuilt only from pages the blinded agent actually reached and the controls it used, across ${scenarioRuns.length} run(s). Pages not reached do not appear. IDs in paths are shown as {id}.\n\n\`\`\`mermaid\nflowchart LR\n`;
  for (const [n, id] of ids) nm += `  ${id}["${n.replace(/"/g, "'")}"]\n`;
  for (const e of edges.values()) nm += `  ${ids.get(e.from)} -->|${e.label.replace(/[|"]/g, "'")} ×${e.count}| ${ids.get(e.to)}\n`;
  nm += "```\n\n| From | To | Via | Times | Personas |\n|---|---|---|---|---|\n";
  for (const e of [...edges.values()].sort((a, b) => b.count - a.count)) nm += `| ${esc(e.from)} | ${esc(e.to)} | ${esc(e.label)} | ${e.count} | ${[...e.personas].join(", ")} |\n`;
  nm += `\n## Pages\n\n| Page | Titles seen |\n|---|---|\n${[...nodes].map(([n, t]) => `| ${esc(n)} | ${esc([...t].filter(Boolean).join("; "))} |`).join("\n")}\n`;
  nm += publicNavMarkdown(runs);
  fs.writeFileSync(path.join(outDir, "navigation-map.md"), nm);

  // ---------- accessibility.md ----------
  const scans = [...scenarioRuns.flatMap((r) => (r.accessibility || []).map((a) => ({ ...a, runId: r.runId }))), ...probes.flatMap((p) => (p.probe || []).filter((x) => x.accessibility).map((x) => ({ ...x.accessibility, viewport: x.viewport, runId: p.runId, reflow: x.reflow })))];
  const byRule = new Map();
  for (const s of scans) for (const v of s.violations || []) {
    const e = byRule.get(v.id) || { ...v, pages: new Set(), nodes: 0 };
    e.pages.add(`${pageNode(s.url)} (${s.viewport})`); e.nodes += v.nodes; byRule.set(v.id, e);
  }
  let ax = `# Accessibility — automated results and limitations\n\n${scans.length} automated scan(s) (axe-core, WCAG 2.x A/AA rules). Automated rules find only part of the barriers; this is **not** a conformance claim.\n\n| Rule | Impact | WCAG | Elements | Pages |\n|---|---|---|---|---|\n`;
  for (const v of [...byRule.values()].sort((a, b) => ["critical", "serious", "moderate", "minor"].indexOf(a.impact) - ["critical", "serious", "moderate", "minor"].indexOf(b.impact))) ax += `| ${v.id}: ${esc(v.help)} | ${v.impact} | ${v.wcag.join(", ")} | ${v.nodes} | ${esc([...v.pages].join("; "))} |\n`;
  const reflows = scans.filter((s) => s.reflow);
  if (reflows.length) ax += `\n## Reflow at 320 px\n\n${reflows.map((s) => `- ${pageNode(s.url)}: horizontal overflow ${s.reflow.horizontalOverflowPx}px${s.reflow.widestElements?.length ? ` (widest: ${s.reflow.widestElements.join(", ")})` : ""}`).join("\n")}\n`;
  ax += `\n## NOT TESTED (manual / assistive technology required)\nScreen readers (NVDA, JAWS, VoiceOver), real browser zoom at 200%/400%, colour contrast in states axe cannot compute (hover, focus, images of text), motion and timing, voice control, cognitive load, announcement timing of AI responses, focus management after responses load.\n`;
  ax += a11yGroupsMarkdown(groups) + wcagMarkdown(wcag, groups);
  if (investigations.length) ax += `\n## Targeted investigations\n\n${investigations.map((i) => `- ${i.investigationId} — \`${i.selector}\`: ${esc(i.conclusion || i.reason)} (evidence/investigations/${i.investigationId}/investigation.md)`).join("\n")}\n`;
  fs.writeFileSync(path.join(outDir, "accessibility.md"), ax);

  // ---------- defect register (consolidated, triaged) ----------
  // Agent-scenario findings keep their generated reproduction steps.
  const byRun = new Map(runs.map((r) => [r.runId, r]));
  const reproFor = (g) => {
    for (const o of g.observations) {
      const run = byRun.get(o.runId);
      const f = run?.findings?.find((x) => x.id === o.id);
      if (f && run.steps?.some((s) => s.kind === "agent")) return reproSteps(run, f);
    }
    return null;
  };
  fs.writeFileSync(path.join(outDir, "defect-register-draft.md"), registerMarkdown(groups, reproFor));
  fs.writeFileSync(path.join(outDir, "defect-register-draft.csv"), registerCsv(groups, reproFor));
  fs.writeFileSync(path.join(outDir, "consolidation.md"), consolidationMarkdown(groups));
  fs.writeFileSync(path.join(outDir, "public-audit-summary.md"), publicSummaryMarkdown(runs, groups, investigations, wcag, { recon, blockedAnalyses, kbdValidation }));
  const findings = raw;

  // ---------- cleanup manifest + evidence index ----------
  const created = runs.flatMap((r) => (r.createdRecords || []).map((c) => ({ ...c, runId: r.runId, account: r.account?.id })));
  fs.writeFileSync(path.join(outDir, "cleanup-manifest.md"), `# Test-created records (for authorized manual cleanup — nothing is deleted automatically)\n\n| Value | Kind | Source | Account | Run | When | Page |\n|---|---|---|---|---|---|---|\n${created.map((c) => `| ${esc(c.value)} | ${c.kind} | ${c.source || ""} | ${c.account} | ${c.runId} | ${c.at} | ${c.url} |`).join("\n")}\n\n"new-id-in-url" rows are pages that appeared after a submission and may be records EQUITAS created itself. Also search the site for anything named with UXTEST.\n`);
  fs.writeFileSync(path.join(outDir, "evidence-index.md"), `# Evidence index\n\n${runs.map((r) => `- ${r.runId} · ${r.scenarioId || r.kind} · ${r.startedAt} → ${r.endedAt} · ${r.outcome?.status} · Chromium ${r.browser?.version || "?"} · evidence/runs/${r.runId}/ (${r.steps.length} steps; console errors ${r.network.consoleErrors.length}; HTTP≥400 ${r.network.httpErrors.length}; off-domain request hosts: ${(r.network.offDomainRequests || []).join(", ") || "none"}${r.kind === "public-audit" ? `; ${(r.pages || []).length} page(s), ${r.pageLoads ?? 0} page load(s), ${(r.blockedRequests || []).filter((b) => b.kind === "write-request").length} write request(s) blocked` : ""})${r.validity?.warnings?.length ? " · ⚠ " + r.validity.warnings.join("; ") : ""}`).join("\n")}\n${investigations.length ? `\n## Investigations\n\n${investigations.map((i) => `- ${i.investigationId} · ${i.at} · \`${i.selector}\` · evidence/investigations/${i.investigationId}/`).join("\n")}\n` : ""}`);
  return { runs: runs.length, findings: findings.length, groups: groups.length, outDir };
}

if (isMain(import.meta.url)) {
  const r = buildReports();
  console.log(`Wrote reports/results.md, public-audit-summary.md, consolidation.md, persona-comparison.md, navigation-map.md, accessibility.md, defect-register-draft.{md,csv}, cleanup-manifest.md, evidence-index.md (${r.runs} runs, ${r.findings} observations → ${r.groups} issues).`);
}
