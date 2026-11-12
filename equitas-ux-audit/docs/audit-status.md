# Audit status — Section 26 deliverables and Section 28 success criteria

**As of 2026-11-12: the harness is built, every code gap from the gap analysis is closed, and it passes its offline self-test (72 checks). Nothing has been run against the EQUITAS website.** The cloud build session can't reach the site: its environment deliberately has no live-site hosts ("production protection"). All live runs happen on the founder's computer.

## Deliverables (Section 26)

| # | Deliverable | Status | Where |
|---|---|---|---|
| 1 | Authorization & scope record | Template built; **awaiting founder sign-off** | `config/authorization-manifest.example.json` |
| 2 | Browser testing implementation | Built; offline self-test passes (72 checks) | `src/`, `selftest/` |
| 3 | Test-account & entitlement inventory | **Awaiting founder** (only founder-admin known) | manifest `accounts`; `npm run check-manifest` |
| 4–5 | 20-persona registry & behavioural specs | Built | `config/personas.json` |
| 6 | Coverage matrix | Built | `docs/coverage-matrix.md` |
| 7 | Choose Your Plan investigation | Probe built; **not run** | `npm run probe-plan` |
| 8–17 | Journey findings (onboarding, research-first, funding-first, senior PI, early-stage, international, under-resourced, returning, cross-module, revision) | Scenarios built; **not run** | `config/scenarios.json` → `reports/results.md` |
| 18 | Accessibility results & limitations | axe-core scans per page and viewport, 320 px reflow, tab order, accessible names; manual tests **NOT TESTED** | `reports/accessibility.md` |
| 19 | Current navigation map | Generated from observed runs (pages, controls used, redirects) | `reports/navigation-map.md` |
| 20–21 | IA/cognitive-friction review; proposed integrated journey | **Requires run evidence.** Framework below to be filled in from evidence | below |
| 22 | Founder-access observations | Scenario P20 built; **not run** | |
| 23 | Evidence-backed defect register | Draft generator with reproduction steps, browser and build; human triage template | `reports/defect-register-draft.*`, `docs/defect-register-template.md` |
| 24 | SOW-linked mapping | **Blocked: needs the verified SOW text** | template column |
| 25 | Persona comparison | Side-by-side table for the shared benchmark task BENCH-CHW-HTN (P01, P06, P11, P12, P13) | `reports/persona-comparison.md` |
| 26 | Reusable regression tests | `probe-plan --assert` gives PASS/FAIL/inconclusive exit codes for the plan defect; scenarios are rerunnable | |
| 27 | Beta-readiness assessment | **Requires run evidence**; rubric below | |
| 28 | Real-user validation protocol | Built | `docs/real-user-validation-protocol.md` |
| 29 | Evidence index | Generated | `reports/evidence-index.md` |
| 30 | Executive founder assessment | **Requires run evidence**; questions A–K below | |

## Success criteria (Section 28)

| # | Criterion | Met? |
|---|---|---|
| 1 | Actual site accessed | No — not yet run |
| 2 | Authorized authentication | Mechanism built (founder signs in in-browser); not yet used |
| 3 | Real browser executed journeys | Against local fixture only |
| 4 | Choose Your Plan investigated | No |
| 5 | Persona behaviour differentiated | Specified; not yet observed |
| 6 | No hidden navigation knowledge | Enforced by design: agent sees only the accessibility tree, starts at the site root, can't type URLs. The plan probe is labelled non-blinded |
| 7 | Science assessed separately from usability | Built (separate evaluator, PROVISIONAL labels) |
| 8–10 | Early/senior/international, research-/funding-first, continuity | Scenarios defined; not run |
| 11 | Reproducible evidence | Built (per-step JSON, screenshots, navigation path) |
| 12 | Role/entitlement limitations disclosed | Each run records the actual account role; mismatches → BLOCKED |
| 13 | No prohibited production actions | Guard built and self-tested; to be confirmed in live runs |
| 14 | No sensitive content exposed | Synthetic-only inputs; redaction; local evidence |
| 15–18 | User-specific barriers, defect register, navigation framework, real-user plan | Only the real-user plan is complete; the rest depend on runs |

## What still cannot be closed in code

These need people, accounts or documents. The harness marks them BLOCKED, NOT TESTED or PROVISIONAL rather than guessing:
- **Accounts:** role-specific test accounts (new server-side user, free, paid, institutional, expired, non-admin, funder).
- **Contract:** the verified SOW text, for contract mapping.
- **Expert review:** independent review of `config/scientific-expectations.json` (all PROVISIONAL).
- **Real investigators:** sessions per `docs/real-user-validation-protocol.md`.
- **Manual accessibility:** screen readers, real zoom, cognitive load.
- **EQUITAS AI outage:** can't be tested safely on production. Only a client-side network failure is simulated.
- **Source-side questions:** root causes, hosting and infrastructure ownership need Appifest or separate evidence.

## Accessibility: automated vs. NOT TESTED

Automated:
- axe-core WCAG 2.x A/AA rules on each new page, in scenarios and the probe.
- 320 px reflow.
- Keyboard tab order and a visible-focus heuristic on the landing screen.
- Desktop, tablet and mobile viewports.
- Accessible-name availability (failed lookups, refused unnamed controls).
- Alerts and status messages shown during the offline test.

**NOT TESTED (needs manual or assistive-technology testing):** screen readers (NVDA/JAWS/VoiceOver), 200%/400% zoom and reflow, colour contrast, motion and timing, cognitive load with real users, voice control, form-error announcement timing, focus management after AI responses load.

## Proposed integrated navigation framework (to be completed from evidence)

Don't fill this in until at least phases 2 and 4 have run. For each stage, record what the evidence showed against the seven questions in Section 15 (Where am I? Why here? Which feature? What did EQUITAS do? What does it mean? What next? How do I return?). Then propose a structure that keeps every existing capability while reducing decision points. A possible frame to test against the evidence, *not* a recommendation yet:

1. **Entry:** one primary "Start or continue a research project" action, with plan or entitlement shown as status rather than a gate (if entitlement allows).
2. **Project as home:** Advisor, Evidence & Funding, Studios, Brief and Incidents reached *from within a project*, showing that project's context.
3. **Mode by need, not title:** a "guided" vs. "direct critique" choice on entry, which the user picks and can change.
4. **Return path:** recent projects and "last recommendation / next action" on the first screen for returning users.

## Beta-readiness rubric (Section 24)

For each area, mark Ready / Not ready / Unknown, with the evidence run IDs: core account access · functional workflows · scientific assessment reliability (needs expert review) · project-context integrity (Journey H, I) · UX · accessibility (manual tests outstanding) · privacy & security (P16; formal security testing is out of scope) · operational readiness (P20) · independent scientific evaluation · real-user testing. Any P0/P1 finding in the first four areas blocks a controlled beta.

## Executive questions (Section 29) — answer only from evidence

A. Intuitive for intended users? B. What prevents starting? C. What prevents completing research tasks? D. Which users face the greatest barriers? E. Integrated advisor or disconnected features? F. Are limitations and uncertainty clear? G. Which defects need Appifest correction? H. Which are UX/product decisions? I. Which need independent scientific review? J. What must be fixed before a controlled beta? K. What should be tested with real investigators?
