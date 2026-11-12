// Re-assessment of historical keyboard-trap observations made by keyboard-v1
// (public-audit-1, up to commit b2c5c6a). Nothing is deleted or rejected:
// each observation keeps its original ID, category, severity and fingerprint,
// and gains an evidence-sufficiency classification and a root cause based
// ONLY on what the original run stored.
//
// Evidence-sufficiency classes:
//   SUPPORTED_BY_EXISTING_EVIDENCE   — would need recorded, failed escape attempts
//                                      (Shift+Tab, Escape). keyboard-v1 never
//                                      recorded any, so no v1 observation can
//                                      reach this class.
//   INSUFFICIENT_EVIDENCE            — the stored record cannot support or refute a trap.
//   SUPERSEDED_HARNESS_DEFECT        — the stored focus sequence shows the warning
//                                      came from a v1 defect demonstrated by the
//                                      reference set. This means the observation is
//                                      not evidence of a trap — NOT that the page has
//                                      no trap.
//   REQUIRES_TARGETED_LIVE_RETEST    — a pattern consistent with either a real trap or
//                                      legitimate containment; only a retest with
//                                      keyboard-v2 (escape attempts) can tell.
import { CATEGORY } from "./findings.js";

export const SUFFICIENCY = {
  SUPPORTED: "SUPPORTED_BY_EXISTING_EVIDENCE",
  INSUFFICIENT: "INSUFFICIENT_EVIDENCE",
  SUPERSEDED: "SUPERSEDED_HARNESS_DEFECT",
  RETEST: "REQUIRES_TARGETED_LIVE_RETEST",
};

// Root causes, with the reference cases that demonstrate each v1 defect.
export const ROOT_CAUSES = {
  V1_IDENTITY_COLLISION: { kind: "detector defect", text: "keyboard-v1 identified elements by the first 120 characters of their HTML; distinct controls with identical leading markup (e.g. long shared class lists) were treated as one element focused three times.", referenceCases: ["K03-identical-markup", "K04-identical-adjacent-links"] },
  V1_FRAME_FOCUS: { kind: "detector defect", text: "keyboard-v1 read only document.activeElement; while focus moved inside an iframe the frame element itself appeared focused repeatedly.", referenceCases: ["K12-same-origin-iframe", "K14-cross-origin-iframe-no-return"] },
  V1_SHADOW_HOST: { kind: "detector defect", text: "keyboard-v1 did not look inside shadow roots; while focus moved between controls in a web component, the host element appeared focused repeatedly.", referenceCases: ["K11-shadow-dom"] },
  REPEATED_IDENTICAL_CONTROL: { kind: "needs retest", text: "Three consecutive focus stops with the same element type and accessible name. Consistent with a genuine stuck focus OR with adjacent look-alike controls (which v1 cannot tell apart).", referenceCases: ["K04-identical-adjacent-links", "K05-js-refocus-trap"] },
  CONTAINMENT_NO_ESCAPE_TEST: { kind: "needs retest", text: "Focus cycled among three or fewer controls until the Tab budget ran out, without reaching the end of the page. Consistent with a genuine trap OR with legitimate containment (modal, editor) that Escape or Shift+Tab would exit; v1 never tried either.", referenceCases: ["K06-js-cycling-widget-trap", "K07-modal-with-escape", "K18-shift-tab-exit", "K19-escape-releases"] },
  NO_KEYBOARD_RECORD: { kind: "missing evidence", text: "The run did not store the keyboard traversal for this page and viewport.", referenceCases: [] },
};

const ident = (s) => `${s.tag}|${s.name}`;

export function isV1Run(run) {
  return run.kind === "public-audit" && run.keyboardDetector !== "keyboard-v2";
}

// Classify one historical keyboard-trap observation from its run's stored data.
export function classifyHistoricalTrap(f, run) {
  const rec = (run.pages || []).find((p) => p.path === f.page);
  const d = rec?.viewports?.[f.viewport];
  const k = d?.keyboard;
  const maxStops = run.limits?.keyboardTabStops ?? 40;
  if (!k || !Array.isArray(k.stops)) return { sufficiency: SUFFICIENCY.INSUFFICIENT, rootCause: "NO_KEYBOARD_RECORD", evidence: "No stored keyboard record for this page and viewport.", retestRecommended: true };
  const stops = k.stops;
  let triple = null;
  // Same range as v1 (its loop started at index 3), so only repeats v1 could see count.
  for (let i = 3; i < stops.length; i++) if (ident(stops[i]) === ident(stops[i - 1]) && ident(stops[i]) === ident(stops[i - 2])) { triple = { at: i - 2, stop: stops[i] }; break; }
  const distinctVisible = new Set(stops.map(ident)).size;
  const budgetCycle = stops.length >= maxStops && distinctVisible <= 3;
  const seq = stops.map((s) => `${s.tag} "${s.name}"`);
  const evidence = `Stored v1 sequence (${stops.length} stops, ${distinctVisible} distinct by element type + name, Tab budget ${maxStops}): ${seq.slice(0, 12).join(" → ")}${seq.length > 12 ? " …" : ""}`;
  if (!triple && !budgetCycle) {
    return { sufficiency: SUFFICIENCY.SUPERSEDED, rootCause: "V1_IDENTITY_COLLISION", evidence: `${evidence}. No three consecutive stops share a type and name, and the sequence is not a ≤3-control cycle, so v1's trap flag could only have come from identical leading HTML on different controls (assuming accessible names did not change on focus).`, retestRecommended: false };
  }
  if (triple) {
    const t = triple.stop.tag;
    if (t === "iframe" || t === "frame") return { sufficiency: SUFFICIENCY.SUPERSEDED, rootCause: "V1_FRAME_FOCUS", evidence: `${evidence}. The repeated stop is an ${t} ("${triple.stop.name}"): focus was inside the frame.`, retestRecommended: true, retestReason: "A cross-origin frame can only be checked manually; keyboard-v2 reports it as inconclusive if focus does not return." };
    if (t.includes("-")) return { sufficiency: SUFFICIENCY.SUPERSEDED, rootCause: "V1_SHADOW_HOST", evidence: `${evidence}. The repeated stop is a custom element (<${t}>), i.e. a shadow-DOM host.`, retestRecommended: true, retestReason: "keyboard-v2 follows focus into open shadow roots; a retest shows whether focus leaves the component." };
    return { sufficiency: SUFFICIENCY.RETEST, rootCause: "REPEATED_IDENTICAL_CONTROL", component: `${t} "${triple.stop.name}"`, evidence: `${evidence}. Stops ${triple.at + 1}–${triple.at + 3} are ${t} "${triple.stop.name}".`, retestRecommended: true };
  }
  const dialogs = (d.structure?.dialogs || []).length;
  return { sufficiency: SUFFICIENCY.RETEST, rootCause: "CONTAINMENT_NO_ESCAPE_TEST", component: [...new Set(stops.map((s) => `${s.tag} "${s.name}"`))].join(" + "), evidence: `${evidence}.${dialogs ? ` ${dialogs} dialog(s) were open on this page.` : ""}`, retestRecommended: true };
}

// The "after" view of raw findings: historical v1 keyboard-trap observations
// are re-grouped by demonstrated root cause and re-categorised; everything
// else is passed through unchanged.
export function effectiveFindings(raw, runs) {
  const byRun = new Map(runs.map((r) => [r.runId, r]));
  return raw.map((f) => {
    if (f.ruleId !== "keyboard-trap") return f;
    const run = byRun.get(f.runId);
    if (!run || !isV1Run(run)) return f;
    const c = classifyHistoricalTrap(f, run);
    const cause = ROOT_CAUSES[c.rootCause];
    const fp = c.sufficiency === SUFFICIENCY.SUPERSEDED ? `trap-v1|superseded|${c.rootCause}`
      : c.sufficiency === SUFFICIENCY.RETEST ? `trap-v1|retest|${c.rootCause}|${c.component}`
      : `trap-v1|insufficient|${f.page}`;
    return {
      ...f,
      fingerprint: fp,
      category: c.sufficiency === SUFFICIENCY.SUPERSEDED ? CATEGORY.HARNESS : CATEGORY.INCONCLUSIVE,
      proposedSeverity: null,
      title: c.sufficiency === SUFFICIENCY.SUPERSEDED ? `Historical keyboard-trap warnings caused by a detector defect: ${c.rootCause}`
        : c.sufficiency === SUFFICIENCY.RETEST ? `Historical keyboard-trap warning needs a targeted retest: ${c.component}`
        : `Historical keyboard-trap warning without stored evidence: ${f.page}`,
      objective: false,
      historical: {
        detector: "keyboard-v1", sufficiency: c.sufficiency, rootCause: c.rootCause, rootCauseKind: cause.kind, rootCauseText: cause.text,
        referenceCases: cause.referenceCases, evidence: c.evidence, component: c.component || null, retestRecommended: c.retestRecommended, retestReason: c.retestReason || null,
        originalFingerprint: f.fingerprint, originalCategory: f.category, originalSeverity: f.proposedSeverity, originalTitle: f.title,
      },
      sourceNote: `Re-assessed: ${c.sufficiency} (${c.rootCause}). Original: "${f.title}", ${f.category}, ${f.proposedSeverity}. ${c.sufficiency === SUFFICIENCY.SUPERSEDED ? "Not evidence of a trap; not proof that none exists." : ""}`.trim(),
    };
  });
}

// Product, content and commercial matters are the founder's to decide; the
// audit presents them and recommends no change.
export const DECISION_AREAS = {
  "availability-mismatch": "feature availability",
  "feature-planned": "feature availability",
  "expected-page-not-found": "site structure / product scope",
  "link-to-sign-in": "product design",
  "nav-inconsistent": "product design (information architecture)",
  "same-text-different-destination": "product design (information architecture)",
  "dead-end": "product design (information architecture)",
  "navigation-loop": "product design (information architecture)",
  "no-return-navigation": "product design (information architecture)",
  "tiny-text": "visual design",
  "unexpected-redirect": "product design (URLs)",
};
export const decisionArea = (ruleId) => DECISION_AREAS[ruleId] || null;
