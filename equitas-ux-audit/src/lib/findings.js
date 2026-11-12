// Findings model: raw observations → fingerprints → consolidated groups →
// triage categories. Original observations are never altered; groups list the
// original finding IDs they consolidate.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CATEGORY = {
  CONFIRMED: "CONFIRMED_DEFECT",
  AWAITING: "AUTOMATED_AWAITING_CONFIRMATION",
  USABILITY: "USABILITY_CONCERN",
  INCONCLUSIVE: "INCONCLUSIVE_OR_BLOCKED",
  PLANNED: "INTENTIONALLY_UNAVAILABLE_OR_PLANNED",
  HARNESS: "HARNESS_DEFECT",
  REJECTED: "REJECTED_BY_REVIEWER",
};
export const CATEGORY_LABEL = {
  CONFIRMED_DEFECT: "1. Confirmed defects (reproducible evidence)",
  AUTOMATED_AWAITING_CONFIRMATION: "2. Automated findings awaiting human confirmation",
  USABILITY_CONCERN: "3. Potential usability concerns (judgment needed)",
  INCONCLUSIVE_OR_BLOCKED: "4. Inconclusive or blocked tests",
  INTENTIONALLY_UNAVAILABLE_OR_PLANNED: "5. Features intentionally unavailable or planned",
  HARNESS_DEFECT: "6. Testing-harness defects",
  REJECTED_BY_REVIEWER: "Rejected by reviewer (kept for the record)",
};

// objective: a direct measurement (HTTP status, load failure). Two separate
// runs reproducing it are enough to call it confirmed. Everything else needs
// a person to confirm it in config/triage.json.
const R = (category, severity, wcag, expected, acceptance, objective = false) => ({ category, severity, wcag, expected, acceptance, objective });
export const RULES = {
  "page-load-failure": R(CATEGORY.AWAITING, "P1", [], "Every public page linked from the site loads.", "The page loads with HTTP 200 at all four viewports in two consecutive runs.", true),
  "http-error-page": R(CATEGORY.AWAITING, "P2", [], "Public pages return HTTP 200.", "The URL returns 200, or every link to it is removed or redirected to a live page.", true),
  "broken-internal-link": R(CATEGORY.AWAITING, "P2", [], "Internal links lead to a working page.", "No public page links to a URL that returns an HTTP error.", true),
  "missing-asset": R(CATEGORY.AWAITING, "P3", [], "Images, scripts and styles referenced by the page load.", "No same-site asset request returns 4xx/5xx.", true),
  "unexpected-redirect": R(CATEGORY.USABILITY, "P3", [], "Links point directly at their final destination.", "The link's href equals its final URL, or the redirect is intended and documented."),
  "link-to-sign-in": R(CATEGORY.USABILITY, "P3", [], "A public link that requires sign-in says so.", "Links that lead to sign-in are labelled (e.g. 'Sign in to …') or the destination explains what is needed."),
  "failed-request": R(CATEGORY.AWAITING, "P3", [], "Page requests complete.", "No request fails for reasons other than the test harness's own blocking."),
  "console-error": R(CATEGORY.AWAITING, "P3", [], "No JavaScript errors in the browser console.", "The console shows no errors on this page at any viewport."),
  "page-exception": R(CATEGORY.AWAITING, "P2", [], "No uncaught JavaScript exceptions.", "No uncaught exception is raised while loading or using the page."),
  "reflow-overflow": R(CATEGORY.AWAITING, "P2", ["1.4.10"], "At 320 CSS px wide, content fits without horizontal scrolling.", "At 320×640, document scrollWidth ≤ clientWidth and no content is cut off."),
  "offscreen-control": R(CATEGORY.AWAITING, "P2", ["1.4.10"], "Controls stay within the viewport.", "The control is fully visible and operable at this viewport."),
  "covered-control": R(CATEGORY.AWAITING, "P2", ["2.4.11"], "Controls are not covered by other content.", "Nothing overlaps the control's centre at this viewport."),
  "small-target": R(CATEGORY.AWAITING, "P3", ["2.5.8"], "Pointer targets are at least 24×24 CSS px (or have enough spacing / are inline).", "Each listed control is ≥24×24 CSS px or meets a 2.5.8 exception."),
  "text-spacing-clip": R(CATEGORY.AWAITING, "P3", ["1.4.12"], "Text stays fully visible when users increase line, letter, word and paragraph spacing.", "With WCAG 1.4.12 spacing applied, no text is clipped."),
  "tiny-text": R(CATEGORY.USABILITY, "P3", [], "Body text is readable on phones (≥12px; 16px recommended).", "No visible text below 12px at mobile and 320px viewports."),
  "no-visible-focus": R(CATEGORY.AWAITING, "P2", ["2.4.7"], "Keyboard focus is clearly visible.", "Every focusable control shows a visible focus indicator."),
  "focus-obscured": R(CATEGORY.AWAITING, "P2", ["2.4.11"], "A focused control is not hidden behind sticky content.", "When focused, the control is at least partly visible."),
  "keyboard-trap": R(CATEGORY.AWAITING, "P1", ["2.1.2"], "Keyboard focus can always move on.", "Tab and Shift+Tab move focus out of every component."),
  "skip-link-missing": R(CATEGORY.AWAITING, "P3", ["2.4.1"], "A way to skip repeated navigation exists.", "A visible-on-focus 'Skip to main content' link (or equivalent landmarks) is present."),
  "heading-structure": R(CATEGORY.AWAITING, "P3", ["1.3.1", "2.4.6"], "One h1 per page and no skipped heading levels.", "Each page has exactly one h1 and heading levels do not skip."),
  "menu-state-not-exposed": R(CATEGORY.AWAITING, "P2", ["4.1.2"], "The mobile menu button exposes its open/closed state.", "aria-expanded switches from false to true when the menu opens."),
  "menu-escape": R(CATEGORY.USABILITY, "P3", [], "An open mobile menu closes with Escape.", "Escape closes the menu and returns focus to the button."),
  "no-mobile-navigation": R(CATEGORY.USABILITY, "P2", [], "Navigation is available on phones.", "At mobile widths, a menu button or visible navigation links are present."),
  "dialog-no-name": R(CATEGORY.AWAITING, "P2", ["4.1.2"], "Dialogs have an accessible name.", "Each dialog has aria-label or aria-labelledby."),
  "nav-inconsistent": R(CATEGORY.USABILITY, "P3", ["3.2.3"], "The main navigation is the same on every page.", "Primary navigation items and order match across public pages."),
  "same-text-different-destination": R(CATEGORY.USABILITY, "P3", ["3.2.4"], "Links with the same text go to the same place.", "Identical link text leads to the same destination everywhere."),
  "no-return-navigation": R(CATEGORY.USABILITY, "P3", [], "Deeper pages show where the visitor is and how to go back.", "Pages two or more levels deep have breadcrumbs or a link to their parent section."),
  "dead-end": R(CATEGORY.USABILITY, "P2", [], "Every page offers a way onward.", "The page links to at least one other public page (navigation or content)."),
  "navigation-loop": R(CATEGORY.USABILITY, "P3", [], "Pages do not only link to each other in a closed loop.", "The pages offer navigation to the rest of the site."),
  "generic-link-text": R(CATEGORY.USABILITY, "P3", ["2.4.4"], "Link and button text says where it goes.", "Generic labels ('Learn more', 'Click here') are made specific or given context."),
  "availability-mismatch": R(CATEGORY.USABILITY, "P2", [], "Calls to action match what is actually available.", "Links that promise immediate use lead to a working feature, or their label says it is planned / early access."),
  "feature-planned": R(CATEGORY.PLANNED, null, [], "", ""),
  "expected-page-not-found": R(CATEGORY.INCONCLUSIVE, null, [], "", ""),
  "not-tested": R(CATEGORY.INCONCLUSIVE, null, [], "", ""),
  "form-not-submitted": R(CATEGORY.INCONCLUSIVE, null, ["3.3.1", "3.3.3", "3.3.4", "3.3.7", "3.3.8"], "", ""),
  "axe-needs-review": R(CATEGORY.INCONCLUSIVE, null, [], "", ""),
  "harness-error": R(CATEGORY.HARNESS, null, [], "", ""),
};
export function ruleFor(ruleId) {
  if (ruleId.startsWith("axe:")) return R(CATEGORY.AWAITING, null, [], "", "");
  return RULES[ruleId] || R(CATEGORY.AWAITING, "P3", [], "", "");
}

const axeSeverity = (impact) => ({ critical: "P1", serious: "P2", moderate: "P3", minor: "P3" }[impact] || "P3");
export const shortId = (fp) => "G-" + crypto.createHash("sha1").update(fp).digest("hex").slice(0, 8);
export const normMessage = (m) => (m || "").replace(/https?:\/\/\S+/g, "<url>").replace(/\b\d+\b/g, "<n>").replace(/\s+/g, " ").trim().slice(0, 160);

export function makeFinding(base, ruleId, fields) {
  const rule = ruleFor(ruleId);
  return {
    ruleId,
    category: rule.category,
    proposedSeverity: fields.proposedSeverity ?? rule.severity,
    wcag: fields.wcag ?? rule.wcag,
    expected: fields.expected ?? rule.expected,
    acceptance: fields.acceptance ?? rule.acceptance,
    objective: rule.objective,
    ...base,
    ...fields,
  };
}

// Axe violations → one finding per (rule, element). Best-practice rules are
// labelled as such: they are not WCAG failures.
export function axeFindings(base, axe) {
  const out = [];
  for (const v of axe?.violations || []) {
    for (const n of v.nodes) {
      out.push(makeFinding(base, `axe:${v.id}`, {
        fingerprint: `axe:${v.id}|${n.target}`,
        title: `${v.bestPractice ? "Best practice" : "Accessibility"}: ${v.help}`,
        selector: n.target, text: n.text || "", impact: v.impact,
        proposedSeverity: v.bestPractice ? "P3" : axeSeverity(v.impact),
        wcag: v.wcag.map((t) => t.replace(/^wcag(\d)(\d)(\d+)$/, "$1.$2.$3")),
        expected: v.help + ".", acceptance: `axe-core rule "${v.id}" passes for this element at every viewport, and a manual check confirms it (${v.helpUrl}).`,
        observed: `${v.id} (${v.impact}) on ${n.target}${n.contrast ? `: contrast ${n.contrast.ratio}:1 (needs ${n.contrast.expected}), text ${n.contrast.fgColor} on ${n.contrast.bgColor}, ${n.contrast.fontSize} ${n.contrast.fontWeight}` : ""}. ${n.failureSummary}`.trim(),
        details: { html: n.html, contrast: n.contrast, bestPractice: v.bestPractice, helpUrl: v.helpUrl },
      }));
    }
  }
  return out;
}

// ---------- Historical findings (earlier harness versions) ----------
// Recovers fingerprints from older runs so the same element observed then and
// now consolidates into one group. Original IDs and text are kept verbatim.
export function legacyFindings(run) {
  const out = [];
  const legacyAuth = run.kind === "probe-plan" && !run.harnessAuthVersion && run.account?.id !== "public-visitor";
  for (const f of run.findings || []) {
    const base = { originalId: f.id, runId: run.runId, observedAt: f.observedAt || run.startedAt, source: run.kind || "scenario", sourceNote: legacyAuth ? "Recorded during a founder probe whose authentication was INVALID (pre-v2 harness). The page observed was the public site; the accessibility observation is kept as a public-page observation only." : null, originalTitle: f.title, originalObserved: f.observed };
    const m = /^axe: /.test(f.title || "") && /^([a-z0-9-]+) \(([a-z]+)[,)]/.exec(f.observed || "");
    if (m) {
      const vp = /at ([a-z0-9]+)(?::|$| )/.exec(f.observed)?.[1] || f.viewport || run.viewport || "unknown";
      const probeVp = (run.probe || []).find((p) => p.viewport === vp);
      const scan = probeVp?.accessibility || (run.accessibility || []).find((a) => a.viewport === vp);
      const v = (scan?.violations || []).find((x) => x.id === m[1]);
      const selectors = v?.examples?.length ? v.examples : ["(selector not recorded)"];
      const pageUrl = probeVp?.landing?.url || probeVp?.root?.url || scan?.url || run.target;
      let page = "/";
      try { page = new URL(pageUrl).pathname; } catch {}
      for (const sel of selectors) {
        out.push(makeFinding(base, `axe:${m[1]}`, {
          fingerprint: `axe:${m[1]}|${sel}`, title: `Accessibility: ${f.title.replace(/^axe: /, "")}`, selector: sel, impact: m[2],
          proposedSeverity: axeSeverity(m[2]), page, url: pageUrl, viewport: vp, observed: f.observed,
          wcag: (v?.wcag || []).map((t) => t.replace(/^wcag(\d)(\d)(\d+)$/, "$1.$2.$3")),
          expected: `${f.title.replace(/^axe: /, "")}.`, acceptance: `axe-core rule "${m[1]}" passes for this element at every viewport, and a manual check confirms it.`,
          evidence: f.screenshot ? [`evidence/runs/${run.runId}/${f.screenshot}`] : [], legacy: true,
        }));
      }
      continue;
    }
    // Anything else from older runs: kept as-is, one group per title + run kind.
    const cat = f.category === "BLOCKED" ? CATEGORY.INCONCLUSIVE : f.category === "TEST_VALIDITY_WARNING" ? CATEGORY.HARNESS : f.category === "UX_HEURISTIC_CONCERN" ? CATEGORY.USABILITY : CATEGORY.AWAITING;
    out.push({ ...base, ruleId: `legacy:${f.category}`, category: cat, fingerprint: `legacy:${f.category}|${(f.title || "").replace(/\b\d{6,}\S*/g, "")}|${run.kind || run.scenarioId}`, title: f.title, observed: f.observed, expected: f.expected || "", proposedSeverity: (f.severity || "").replace(/ \(proposed\)/, "") || null, page: null, viewport: f.viewport || run.viewport || null, evidence: [f.screenshot, ...(f.evidence || [])].filter(Boolean).map((e) => `evidence/runs/${run.runId}/${e}`), legacy: true, wcag: [], acceptance: "" });
  }
  return out;
}

export function loadTriage(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, "config", "triage.json"), "utf8")).decisions || {}; } catch { return {}; }
}

// Consolidate raw findings into groups and decide each group's category.
export function consolidate(raw, triage = {}) {
  const groups = new Map();
  for (const f of raw) {
    let g = groups.get(f.fingerprint);
    if (!g) {
      g = { groupId: shortId(f.fingerprint), fingerprint: f.fingerprint, ruleId: f.ruleId, title: f.title, defaultCategory: f.category, objective: !!f.objective, proposedSeverity: f.proposedSeverity, wcag: new Set(), expected: f.expected, acceptance: f.acceptance, selector: f.selector || null, text: f.text || "", pages: new Set(), viewports: new Set(), runs: new Set(), originalIds: [], observations: [], evidence: new Set(), notes: new Set(), contrast: [] };
      groups.set(f.fingerprint, g);
    }
    (f.wcag || []).forEach((w) => g.wcag.add(w));
    if (f.page) g.pages.add(f.page);
    if (f.viewport) g.viewports.add(f.viewport);
    g.runs.add(f.runId);
    g.originalIds.push(f.originalId || f.id);
    g.observations.push({ id: f.originalId || f.id, runId: f.runId, page: f.page, viewport: f.viewport, observed: f.originalObserved || f.observed, at: f.observedAt });
    (f.evidence || []).forEach((e) => g.evidence.add(e));
    if (f.sourceNote) g.notes.add(f.sourceNote);
    if (f.details?.contrast) g.contrast.push({ viewport: f.viewport, page: f.page, ...f.details.contrast });
    if (!g.text && f.text) g.text = f.text;
    if (f.repro && !g.repro) g.repro = f.repro;
    if (f.details?.html && !g.html) g.html = f.details.html;
  }
  const out = [];
  for (const g of groups.values()) {
    const t = triage[g.groupId] || triage[g.fingerprint];
    let category = g.defaultCategory, basis = "rule default";
    if (t?.decision === "confirmed") { category = CATEGORY.CONFIRMED; basis = `confirmed by ${t.by || "reviewer"} on ${t.date || "?"}${t.note ? ` — ${t.note}` : ""}`; }
    else if (t?.decision === "rejected") { category = CATEGORY.REJECTED; basis = `rejected by ${t.by || "reviewer"}${t.note ? ` — ${t.note}` : ""}`; }
    else if (t?.decision === "intended") { category = CATEGORY.PLANNED; basis = `marked intended by ${t.by || "reviewer"}${t.note ? ` — ${t.note}` : ""}`; }
    else if (t?.decision === "harness") { category = CATEGORY.HARNESS; basis = `marked as a harness defect by ${t.by || "reviewer"}`; }
    else if (g.objective && category === CATEGORY.AWAITING) {
      if (g.runs.size >= 2) { category = CATEGORY.CONFIRMED; basis = `objective measurement reproduced in ${g.runs.size} separate runs`; }
      else basis = "objective measurement seen in one run; reproduce in a second run to confirm";
    } else if (category === CATEGORY.AWAITING) basis = "automated tool result; needs a person to confirm (config/triage.json)";
    if (t?.severity) g.proposedSeverity = t.severity;
    out.push({
      ...g, category, basis, triage: t || null,
      wcag: [...g.wcag].sort(), pages: [...g.pages].sort(), viewports: [...g.viewports].sort(), runs: [...g.runs].sort(), evidence: [...g.evidence], notes: [...g.notes],
      occurrences: g.observations.length,
      contrastSummary: g.contrast.length ? { minRatio: Math.min(...g.contrast.map((c) => c.ratio).filter((x) => typeof x === "number")), fg: g.contrast[0].fgColor, bg: g.contrast[0].bgColor, expected: g.contrast[0].expected } : null,
    });
  }
  const order = Object.keys(CATEGORY_LABEL);
  const sev = (s) => ({ P0: 0, P1: 1, P2: 2, P3: 3 }[s] ?? 4);
  return out.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || sev(a.proposedSeverity) - sev(b.proposedSeverity) || b.occurrences - a.occurrences);
}
