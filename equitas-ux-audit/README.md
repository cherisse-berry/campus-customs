# EQUITAS black-box UX audit harness

Independent browser-based tester for the **real** EQUITAS Intelligence website (`https://www.equitasintelligence.com`). It does not read or need any Appifest source code. It runs **on the founder's own computer**, so the founder can sign in and complete MFA in a normal browser window.

> **Status (as built):** no test has been run against EQUITAS yet. Every result section in `reports/` is generated only from real runs on your machine. Nothing in this folder is a finding about EQUITAS.

## What it contains

| Part (Section 6) | File |
|---|---|
| Test orchestrator | `src/run-scenario.js`, `src/run-batch.js`, `config/authorization-manifest.example.json` |
| Persona engine | `config/personas.json` (20 personas), `config/scenarios.json` (22 charters) |
| Blinded browser user agent | `src/lib/agent.js` + `src/lib/observe.js` (sees only the accessibility tree: roles + visible names) |
| UX evaluator | step logs, failed lookups, back-navigations, agent-reported unclear elements, abandonment |
| Scientific expectation evaluator | `config/scientific-expectations.json` (all **PROVISIONAL**), `src/lib/evaluator.js` |
| Evidence & defect reporter | `src/lib/evidence.js`, `src/report.js` |
| Diagnostic (labelled, not blinded) | `src/probe-plan.js` — the "Choose your plan" investigation |
| Safety contract | `src/lib/safety.js` |
| Offline self-test | `selftest/` (local fake site; never contacts EQUITAS) |

## One-time setup (your computer)

Requirements: Node.js 20+.

```bash
git clone https://github.com/cherisse-berry/campus-customs.git
cd campus-customs && git checkout claude/youthful-einstein-sxzqvz
cd equitas-ux-audit
npm install
npx playwright install chromium
npm run selftest                 # 18 offline checks against a local fake site
cp config/authorization-manifest.example.json config/authorization-manifest.json
```

Then edit `config/authorization-manifest.json` (Git-ignored):

1. Fill in `authorization` (approver, date, testing window, Appifest contact, environment type) and set `approved: true`.
2. List each test account under `accounts` with its **actual** role and entitlement as shown on the site. Use an `id` label only. Never write a password.
3. Decide `testerAi.approved` (see "What leaves your computer"). If it's `false`, only the deterministic plan probe runs.
4. Leave `selectFreePlan` and `createSyntheticProjects` set to `false` unless you approve them for a dedicated test account.

Check it:

```bash
npm run check-manifest
```

For the tester AI, set an Anthropic API key in your shell (`export ANTHROPIC_API_KEY=...`) or run `ant auth login`. Do not put the key in any file in this folder.

## Run order (Section 27)

```bash
# Phase 1–2: sign in yourself, then reproduce the "Choose your plan" issue
npm run login -- --account founder-admin          # a browser opens; YOU sign in + MFA, then press Enter
npm run probe-plan -- --account founder-admin     # desktop + mobile; also tests the Settings workaround
npm run probe-plan -- --public                    # signed-out visitor

# Phase 4: priority personas (early-stage, senior PI, international ×2, returning)
npm run batch -- --account founder-admin --phase 4
# Phase 5: research-first / funding-first / revision / cross-module
npm run batch -- --account founder-admin --phase 5
# Phase 6: everything else that an approved account can run, plus mobile/tablet
npm run batch -- --account founder-admin --phase 6 --mobile

npm run report                                    # → reports/*.md, defect-register-draft.csv
npm run login -- --account founder-admin --forget # delete the saved session when finished
```

Run a single scenario with `npm run scenario -- --scenario P06-senior-critique --account founder-admin --headed`. `--headed` lets you watch it.

Scenarios that need an account you haven't approved (funder, server-side new user, a specific entitlement) are recorded as **BLOCKED**. They never run under the founder login.

## Safety behaviour (Section 4)

- Top-level navigation off `allowedHosts` is aborted and recorded.
- Before any click, the visible control name is checked against `prohibitedActionPatterns` (purchase, delete, invite, password, permissions…) and prices. A match stops the scenario: `STOPPED_SAFETY`.
- On a plan page, plan-selection controls are blocked unless the manifest allows free-plan selection **and** the plan looks free.
- The agent never types into password, MFA, email or payment fields. It types only the scenario's synthetic text, which carries a `UXTEST` marker.
- Limits per scenario and per day: actions, minutes, EQUITAS AI submissions, redirects, tester spend. Scenarios run one at a time, at least 2.5 s apart.
- Pop-ups are closed, browser dialogs are dismissed (cancel), and downloads are disabled.
- Nothing is deleted on the site. `reports/cleanup-manifest.md` lists test-created records for you to remove by hand.

## What leaves your computer

- **To EQUITAS:** ordinary browsing plus the synthetic questions in `config/scenarios.json`. These may trigger EQUITAS's own AI calls and analytics, which count against your EQUITAS costs.
- **To Anthropic (only if `testerAi.approved`):** for each step, the page's accessibility text after redaction (emails, tokens, phone and card-like numbers removed) and the persona brief. For the scientific judge, EQUITAS's captured response text. **Screenshots are not sent.** Anthropic's API data policy applies to this, not EQUITAS's policy. Estimated cost: about US$0.50–2 per scenario on the default model, capped by `maxTesterSpendUsdPerDay`.
- **Stays local:** screenshots (with password/email fields masked), step logs, the saved login (`.auth/`, owner-only permissions, expires after 12 h). All of these are Git-ignored and must not be committed or uploaded.

## Reading results

- `reports/results.md`: status per scenario, the plan probe's observations vs. hypotheses, and step-by-step persona narratives.
- `reports/defect-register-draft.*`: **draft** findings. Each needs human triage: confirm severity, reproduction steps, acceptance criteria and SOW mapping (`docs/defect-register-template.md`).
- Science scores come in two layers: keyword coverage (crude) and an AI judge labelled `PROVISIONAL_AI_JUDGMENT`. Neither is expert review.
- Simulated personas are not users. Use `docs/real-user-validation-protocol.md` before drawing conclusions about real investigators.

## Known limitations

- Black-box only: root causes are hypotheses for Appifest to confirm.
- The founder account can't show how other entitlements behave. Each role needs its own approved account.
- Automated accessibility signals (keyboard tab order on the plan screen, viewport layout, ARIA tree) are **not** WCAG conformance. Screen-reader, zoom, contrast and cognitive testing are listed as NOT TESTED in `docs/audit-status.md`.
- The tester's request format was checked only up to API authentication in the build environment. Check your first live run's log.
- Element lookup uses accessible names. If EQUITAS has unlabeled controls, the agent can't use them. That's recorded as a failed lookup, which is itself an accessibility signal.
