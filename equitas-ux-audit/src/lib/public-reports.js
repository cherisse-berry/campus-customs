// Report sections for the public audit and for consolidated, triaged
// findings. Every number here is computed from the evidence files; validate
// with `npm run validate-reports`.
import fs from "node:fs";
import path from "node:path";
import { CATEGORY, CATEGORY_LABEL } from "./findings.js";
import { authRecord } from "./collect.js";

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const list = (a, n = 6) => (a.length > n ? `${a.slice(0, n).join(", ")} … (+${a.length - n})` : a.join(", "));

export function latestPublicAudit(runs) {
  return runs.filter((r) => r.kind === "public-audit" && r.outcome?.status === "COMPLETED").sort((a, b) => a.startedAt.localeCompare(b.startedAt)).pop() || null;
}

// ---------- defect register (consolidated groups) ----------
export function registerMarkdown(groups, reproFor) {
  let md = "# Defect register — DRAFT (consolidated)\n\nEach entry is ONE underlying issue. Repeats across pages, viewports and runs are consolidated; the original finding IDs are listed and the original records are unchanged (see consolidation.md).\n\nCategories:\n" + Object.values(CATEGORY_LABEL).map((l) => `- ${l}`).join("\n") + "\n\nA finding is CONFIRMED only when a person records it in `config/triage.json`, or when an objective measurement (HTTP error, load failure) reproduces in two separate runs. An automated tool result alone never confirms a defect.\n\n";
  for (const cat of Object.keys(CATEGORY_LABEL)) {
    const gs = groups.filter((g) => g.category === cat);
    md += `## ${CATEGORY_LABEL[cat]} (${gs.length})\n\n`;
    if (!gs.length) { md += "None.\n\n"; continue; }
    for (const g of gs) {
      md += `### ${g.groupId} — ${g.title}\n`;
      md += `- Proposed severity: ${g.proposedSeverity || "n/a"} · Basis: ${g.basis}\n`;
      md += `- Rule: ${g.ruleId}${g.wcag.length ? ` · WCAG ${g.wcag.join(", ")}` : ""}\n`;
      md += `- Affected pages: ${g.pages.length ? list(g.pages, 10) : "n/a"} · Viewports: ${g.viewports.join(", ") || "n/a"} · Runs: ${g.runs.length} · Occurrences: ${g.occurrences}\n`;
      if (g.selector) md += `- Element: \`${g.selector}\`${g.text ? ` — text "${esc(g.text)}"` : ""}\n`;
      if (g.contrastSummary) md += `- Contrast (axe): lowest ${g.contrastSummary.minRatio}:1, needs ${g.contrastSummary.expected}; ${g.contrastSummary.fg} on ${g.contrastSummary.bg}\n`;
      if (g.expected) md += `- Expected: ${g.expected}\n`;
      md += `- Observed: ${esc(g.observations[0]?.observed)}${g.observations.length > 1 ? ` (and ${g.observations.length - 1} more observation(s))` : ""}\n`;
      const repro = g.repro || reproFor?.(g);
      if (repro?.length) md += `- Reproduction steps (generated; re-perform before sending):\n${repro.map((x, i) => `  ${i + 1}. ${x}`).join("\n")}\n`;
      if (g.acceptance) md += `- Acceptance criteria: ${g.acceptance}\n`;
      for (const n of g.notes) md += `- Note: ${n}\n`;
      md += `- Evidence: ${g.evidence.length ? list(g.evidence, 4) : "see original findings' run.json"}\n- Original findings: ${list(g.originalIds, 12)}\n\n`;
    }
  }
  return md;
}

export function registerCsv(groups, reproFor) {
  const cols = ["groupId", "category", "basis", "proposedSeverity", "title", "ruleId", "wcag", "affectedPages", "viewports", "runs", "occurrences", "selector", "text", "expected", "observed", "reproSteps", "acceptance", "evidence", "originalFindingIds", "notes"];
  const val = (g, c) => ({
    wcag: g.wcag.join(" "), affectedPages: g.pages.join(" "), viewports: g.viewports.join(" "), runs: g.runs.join(" "),
    observed: g.observations[0]?.observed, reproSteps: (g.repro || reproFor?.(g) || []).map((x, i) => `${i + 1}. ${x}`).join(" "),
    evidence: g.evidence.join(" "), originalFindingIds: g.originalIds.join(" "), notes: g.notes.join(" "),
  }[c] ?? g[c]);
  return [cols.join(",")].concat(groups.map((g) => cols.map((c) => `"${String(val(g, c) ?? "").replace(/"/g, '""')}"`).join(","))).join("\n");
}

// ---------- consolidation record ----------
export function consolidationMarkdown(groups) {
  const multi = groups.filter((g) => g.occurrences > 1).sort((a, b) => b.occurrences - a.occurrences);
  let md = `# Finding consolidation\n\n${groups.reduce((n, g) => n + g.occurrences, 0)} original observation(s) consolidated into ${groups.length} group(s). Original findings are unchanged in their run.json files; this page shows how they were grouped.\n\nGrouping key (fingerprint) = rule + element selector (or page/target for page-level issues) + identifying text. Page, viewport and run are NOT part of the key, so the same element seen on several pages, at several viewports or in several runs is one issue.\n\n## Groups with more than one observation\n\n`;
  if (!multi.length) md += "None.\n";
  for (const g of multi) {
    md += `### ${g.groupId} — ${g.title} (${g.occurrences} observations → 1 issue)\n- Fingerprint: \`${g.fingerprint}\`\n- Viewports: ${g.viewports.join(", ") || "n/a"} · Pages: ${g.pages.join(", ") || "n/a"} · Runs: ${g.runs.length}\n`;
    for (const n of g.notes) md += `- Note: ${n}\n`;
    md += `\n| Original finding | Run | Page | Viewport | Original observation |\n|---|---|---|---|---|\n${g.observations.map((o) => `| ${o.id} | ${o.runId} | ${o.page || ""} | ${o.viewport || ""} | ${esc(o.observed).slice(0, 160)} |`).join("\n")}\n\n`;
  }
  return md;
}

// ---------- public website audit summary ----------
export function publicSummaryMarkdown(runs, groups, investigations, wcag) {
  const r = latestPublicAudit(runs);
  const auth = authRecord(runs);
  let md = "# EQUITAS public website audit — summary\n\n";
  if (!r) {
    md += "**No completed public audit run in the evidence.** Run `npm run public-audit` inside an approved testing window.\n\n";
    const blocked = runs.filter((x) => x.kind === "public-audit" && x.outcome?.status === "BLOCKED");
    if (blocked.length) md += `Blocked attempts: ${blocked.map((b) => `${b.runId} — ${b.outcome.reason}`).join("; ")}\n\n`;
  } else {
    const pages = r.pages || [];
    const ok = pages.filter((p) => p.status && p.status < 400 && !p.error);
    const vpsTested = new Set(pages.flatMap((p) => Object.entries(p.viewports || {}).filter(([, v]) => v.structure).map(([k]) => k)));
    const writes = (r.blockedRequests || []).filter((b) => b.kind === "write-request");
    md += `Run **${r.runId}** · ${r.startedAt} → ${r.endedAt} · Chromium ${r.browser?.version} · signed-out visitor · build ${r.buildAtStart?.buildId || r.buildAtStart?.assetHash || "unknown"}${r.validity?.warnings?.length ? ` · ⚠ ${r.validity.warnings.join("; ")}` : ""}\n\n`;
    md += `## Coverage\n\n- Pages discovered and audited: **${ok.length}** (of ${pages.length} requested; ${pages.length - ok.length} returned an error or failed to load)\n- Viewports: ${[...vpsTested].join(", ")}\n- Page loads: ${r.pageLoads} (limit ${r.limits?.maxPageLoads}); delay ${r.limits?.delayMs} ms; max ${r.limits?.maxPages} pages, depth ${r.limits?.maxDepth}\n- Not audited: ${(r.crawl?.skipped || []).length} URL(s) (robots.txt or limits); protected routes are never requested\n- Safety: ${writes.length} write request(s) blocked in the browser; ${(r.blockedRequests || []).filter((b) => b.kind === "protected-route").length} protected-route navigation(s) blocked; no forms submitted; no session used\n\n`;
    md += "### Expected pages\n\n| Page | Found | Path |\n|---|---|---|\n" + (r.coverage || []).map((c) => `| ${c.name} | ${c.found ? "yes" : "**not found via navigation**"} | ${c.path || "—"} |`).join("\n") + "\n\n";
    md += "### Pages audited\n\n| Path | HTTP | Depth | Found on | Availability wording |\n|---|---|---|---|---|\n" + pages.map((p) => `| ${esc(p.path)} | ${p.status ?? p.error ?? "—"} | ${p.depth} | ${esc(list(p.foundOn || [], 3)) || (p.fromSitemapOnly ? "sitemap only" : "start")} | ${esc((p.viewports?.desktop?.availability?.signals || []).map((s) => s.phrase).join(", "))} |`).join("\n") + "\n\n";
  }
  const pub = groups.filter((g) => !g.notes.some((n) => /INVALID/.test(n)) || g.ruleId.startsWith("axe:"));
  md += "## Findings by category (consolidated)\n\n| Category | Issues | Observations |\n|---|---|---|\n" + Object.keys(CATEGORY_LABEL).map((c) => { const gs = groups.filter((g) => g.category === c); return `| ${CATEGORY_LABEL[c]} | ${gs.length} | ${gs.reduce((n, g) => n + g.occurrences, 0)} |`; }).join("\n") + "\n\n";
  const top = groups.filter((g) => [CATEGORY.CONFIRMED, CATEGORY.AWAITING, CATEGORY.USABILITY].includes(g.category)).sort((a, b) => (a.proposedSeverity || "P9").localeCompare(b.proposedSeverity || "P9") || b.pages.length - a.pages.length).slice(0, 12);
  md += "## Principal findings\n\n" + (top.length ? top.map((g) => `- **${g.proposedSeverity || "—"} · ${g.groupId}** ${g.title} — ${g.category === CATEGORY.CONFIRMED ? "confirmed" : g.category === CATEGORY.AWAITING ? "awaiting human confirmation" : "usability concern"}; ${g.pages.length} page(s), ${g.viewports.length} viewport(s)${g.wcag.length ? `; WCAG ${g.wcag.join(", ")}` : ""}`).join("\n") : "None recorded.") + "\n\n";
  md += "## Recommended remediation priorities\n\n1. Confirm or reject each P1/P2 item in section 2 of the register (record decisions in `config/triage.json`).\n2. Fix confirmed defects that block access first: load failures, broken links, keyboard traps, reflow at 320 px.\n3. Sitewide components (same element on many pages, e.g. a header badge) — one fix clears every page listed.\n4. Usability concerns — product decisions; review with the founder before raising with Appifest.\n5. Manual WCAG review for the criteria listed as manual below.\n\n";
  if (investigations.length) md += "## Targeted investigations\n\n" + investigations.map((i) => `- ${i.investigationId} (\`${i.selector}\`): ${i.conclusion || i.reason}`).join("\n") + "\n\n";
  const counts = {}; for (const c of wcag) counts[c.status] = (counts[c.status] || 0) + 1;
  md += `## WCAG 2.2 AA coverage\n\n${wcag.length} Level A/AA criteria: ${Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase().replace(/_/g, " ")}`).join(", ")}. See accessibility.md. **Automated results do not establish conformance.**\n\n`;
  md += `## Authentication records (not part of the public audit)\n\n${auth.length ? auth.map((a) => `- ${a.runId}: **${a.validity}** — ${a.detail}${a.countsAsAuthenticated ? "" : " (not counted as a successful authentication test)"}`).join("\n") : "None."}\n\n`;
  md += "## Limitations\n\n- Signed-out visitor only; authenticated investigator and founder areas are separate test tracks.\n- Forms were inspected but never submitted, so error handling (WCAG 3.3.x) was not evaluated.\n- Paid AI features, plan selection and payment were not exercised.\n- Automated accessibility checks catch only part of WCAG; screen-reader, zoom, cognitive and device testing remain manual.\n- Discovery follows links and the sitemap; pages not linked anywhere, or beyond the page limit, were not audited.\n- Availability classification is based on wording on the page; it does not prove whether a feature works.\n";
  return md;
}

// ---------- WCAG coverage section ----------
export function wcagMarkdown(wcag, groups) {
  const hit = (sc) => groups.filter((g) => g.wcag.includes(sc) && g.category !== CATEGORY.REJECTED);
  let md = "\n## WCAG 2.2 Level A/AA coverage\n\n| SC | Name | Level | Evaluation | Method | Open issues |\n|---|---|---|---|---|---|\n";
  for (const c of wcag) md += `| ${c.sc} | ${c.name} | ${c.level} | ${c.status.replace(/_/g, " ").toLowerCase()} | ${esc(c.method)} | ${hit(c.sc).map((g) => g.groupId).join(", ") || "—"} |\n`;
  return md;
}

export function a11yGroupsMarkdown(groups) {
  const a = groups.filter((g) => g.ruleId.startsWith("axe:") || g.wcag.length);
  return `\n## Consolidated accessibility issues\n\n| Group | Issue | Category | Severity | WCAG | Element | Pages | Viewports | Observations |\n|---|---|---|---|---|---|---|---|---|\n${a.map((g) => `| ${g.groupId} | ${esc(g.title)} | ${g.category} | ${g.proposedSeverity || ""} | ${g.wcag.join(", ")} | ${g.selector ? `\`${esc(g.selector).slice(0, 60)}\`` : ""} | ${g.pages.length} | ${g.viewports.join(", ")} | ${g.occurrences} |`).join("\n")}\n`;
}

// ---------- navigation section for the public crawl ----------
export function publicNavMarkdown(runs) {
  const r = latestPublicAudit(runs);
  if (!r) return "\n## Public website (crawl)\n\nNo completed public audit yet.\n";
  const ids = new Map((r.pages || []).map((p, i) => [p.path, `p${i}`]));
  let md = `\n## Public website (crawl ${r.runId})\n\nBuilt from links present on audited pages (desktop). Protected links are shown but were not requested.\n\n\`\`\`mermaid\nflowchart LR\n`;
  for (const [p, id] of ids) md += `  ${id}["${p.replace(/"/g, "'")}"]\n`;
  const edges = new Set();
  for (const p of r.pages || []) for (const l of p.links || []) {
    if (l.kind !== "page" || !l.url) continue;
    let to; try { const u = new URL(l.url); to = u.pathname + (u.search || ""); } catch { continue; }
    if (ids.has(to) && to !== p.path) edges.add(`  ${ids.get(p.path)} --> ${ids.get(to)}`);
  }
  md += [...edges].join("\n") + "\n```\n\n| Page | HTTP | Internal links out | Protected links | External links | Breadcrumbs |\n|---|---|---|---|---|---|\n";
  for (const p of r.pages || []) md += `| ${esc(p.path)} | ${p.status ?? p.error ?? "—"} | ${(p.links || []).filter((l) => l.kind === "page").length} | ${(p.links || []).filter((l) => l.kind === "protected").length} | ${(p.links || []).filter((l) => l.kind === "external").length} | ${p.viewports?.desktop?.structure?.breadcrumbs ? "yes" : "no"} |\n`;
  return md;
}

export function authRecordMarkdown(runs) {
  const a = authRecord(runs);
  return `\n## Authentication test record\n\nOnly VERIFIED probes count as successful authentication tests. Probes from the pre-v2 harness are permanently INVALID.\n\n| Run | When | Validity | Detail | Counts as authenticated |\n|---|---|---|---|---|\n${a.map((x) => `| ${x.runId} | ${x.at} | ${x.validity} | ${esc(x.detail)} | ${x.countsAsAuthenticated ? "yes" : "no"} |`).join("\n") || "| — | | | | |"}\n\nSuccessful authentication tests: **${a.filter((x) => x.countsAsAuthenticated).length}** of ${a.length}.\n`;
}

export function loadWcag(configRoot) {
  return JSON.parse(fs.readFileSync(path.join(configRoot, "config", "wcag22-aa.json"), "utf8")).criteria;
}
