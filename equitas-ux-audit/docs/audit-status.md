# Audit status — Section 26 deliverables and Section 28 success criteria

**As of build (2026-11-10): the harness is built and has passed its offline self-test. Nothing has been run against the EQUITAS website.** The cloud build session can't reach the site: its environment deliberately has no live-site hosts ("production protection"). All live runs happen on the founder's computer.

## Deliverables (Section 26)

| # | Deliverable | Status | Where |
|---|---|---|---|
| 1 | Authorization & scope record | Template built; **awaiting founder sign-off** | `config/authorization-manifest.example.json` |
| 2 | Browser testing implementation | Built; offline self-test passes (18 checks) | `src/`, `selftest/` |
| 3 | Test-account & entitlement inventory | **Awaiting founder** (only founder-admin known) | manifest `accounts`; `npm run check-manifest` |
| 4–5 | 20-persona registry & behavioural specs | Built | `config/personas.json` |
| 6 | Coverage matrix | Built | `docs/coverage-matrix.md` |
| 7 | Choose Your Plan investigation | Probe built; **not run** | `npm run probe-plan` |
| 8–17 | Journey findings (onboarding, research-first, funding-first, senior PI, early-stage, international, under-resourced, returning, cross-module, revision) | Scenarios built; **not run** | `config/scenarios.json` → `reports/results.md` |
| 18 | Accessibility results & limitations | Partial automation built (tab order, viewports, ARIA tree); manual tests listed below are **NOT TESTED** | below |
| 19 | Current navigation map | Generated from run `navigationPath` once runs exist | `reports/results.md` |
| 20–21 | IA/cognitive-friction review; proposed integrated journey | **Requires run evidence.** Framework below to be filled in from evidence | below |
| 22 | Founder-access observations | Scenario P20 built; **not run** | |
| 23 | Evidence-backed defect register | Draft generator built; human triage template | `reports/defect-register-draft.*`, `docs/defect-register-template.md` |
| 24 | SOW-linked mapping | **Blocked: needs the verified SOW text** | template column |
| 25 | Persona comparison | Generated per run; shared benchmark task BENCH-CHW-HTN across P01, P06, P11, P12, P13 | `reports/results.md` |
| 26 | Reusable regression tests | `probe-plan` doubles as the regression check for the plan defect; scenarios are rerunnable | |
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

## Accessibility: automated vs. NOT TESTED

Automated: keyboard tab order and visible-focus heuristic on the landing screen; desktop/tablet/mobile viewports; accessible-name availability (failed lookups); alerts and status messages exposed via ARIA.

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
