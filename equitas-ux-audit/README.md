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
npm run selftest                 # 72 offline checks against a local fake site
cp config/authorization-manifest.example.json config/authorization-manifest.json
```

Then edit `config/authorization-manifest.json` (Git-ignored):

1. Fill in `authorization` (approver, date, testing window, Appifest contact, environment type) and set `approved: true`.
2. List each test account under `accounts` with its **actual** role and entitlement as shown on the site. Use an `id` label only. Never write a password.
3. Decide `testerAi.approved` (see "What leaves your computer"). If it's `false`, only the deterministic plan probe runs.
4. Leave `selectFreePlan` and `createSyntheticProjects` set to `false` unless you approve them for a dedicated test account. With `createSyntheticProjects: false`, any control like "New project", "Save" or "Create…" stops the scenario as `PROJECT_CREATION_NOT_AUTHORIZED`. If EQUITAS needs a project before you can ask a question, the research journeys will stop there until you approve project creation. P18 (returning investigator) needs it too.
5. Remove from `approvedFor` any scenario you don't approve. `check-manifest` rejects scenario IDs that don't exist.
6. Put your name, institution and any account display names in `evidence.redactTerms`. They're removed from stored evidence and from tester-AI input, and blacked out in screenshots.
7. For each account, set `expectPlanScreen` to say what correct behaviour is. The plan probe's regression check uses it.

Check it:

```bash
npm run check-manifest
```

For the tester AI, set an Anthropic API key in your shell (`export ANTHROPIC_API_KEY=...`) or run `ant auth login`. Do not put the key in any file in this folder.

## Run order (Section 27)

```bash
# Phase 1–2: sign in yourself, then reproduce the "Choose your plan" issue
npm run login -- --account founder-admin          # a browser opens; YOU sign in + MFA, then press Enter
npm run probe-plan -- --account founder-admin     # desktop, mobile, 320 px; tests the Settings workaround
npm run probe-plan -- --public                    # signed-out visitor

# Phase 4: priority personas (early-stage, senior PI, international ×2, returning)
npm run batch -- --account founder-admin --phase 4
# Phase 5: research-first / funding-first / revision / cross-module
npm run batch -- --account founder-admin --phase 5
# Phase 6: everything else that an approved account can run, plus mobile/tablet
npm run batch -- --account founder-admin --phase 6 --mobile

npm run report                                    # → reports/*.md, defect-register-draft.csv
npm run login -- --account founder-admin --forget # delete the saved session when finished
npm run purge-evidence                            # list evidence older than retainDays (add -- --confirm to delete)

# Regression retest after Appifest's fix: exit code 0 = PASS, 1 = FAIL, 2 = inconclusive
npm run probe-plan -- --account founder-admin --assert
```

Run a single scenario with `npm run scenario -- --scenario P06-senior-critique --account founder-admin --headed`. `--headed` lets you watch it.

Scenarios that need an account you haven't approved (funder, server-side new user, non-admin, a specific entitlement) are recorded as **BLOCKED**. They never run under the founder login.

**P18 (returning investigator)** first checks that an earlier run created a UXTEST record for the same account. It then opens a browser **without** the saved login, and you sign in again, so it tests a real sign-out and return.

**Journey K** has two cases, both client-side only, so EQUITAS's servers are never disrupted:
- `K-session-expiry` clears the test browser's cookies mid-task.
- `K-offline-submission` takes the browser offline just before a question is sent, so the request never reaches EQUITAS.

An outage of EQUITAS's own AI service can't be simulated safely on production, so it is not tested.

## Safety behaviour (Section 4)

- Navigation off `allowedHosts` is aborted before it loads, in the main tab and in pop-ups / new tabs. Real pop-ups are then closed.
- Every click, typed entry and Enter key needs a control the page itself names. Controls with no accessible name are never clicked. A loose name that partly matches several controls is refused. Checks use the control's **real** name and text from the page, not the name the tester AI typed.
- Before any click, the control's name is checked against `prohibitedActionPatterns` (purchase, delete, invite, password, permissions…) and prices. Patterns match at the start of a word: "pay" blocks "Payment" but not "Display". A match stops the scenario: `STOPPED_SAFETY`.
- On a plan page, plan-selection controls are blocked unless the manifest allows free-plan selection **and** the plan looks free.
- Once text has been typed, the **next click or Enter of any kind** counts as an EQUITAS AI submission, whatever the button is called. This can over-count but never under-counts.
- `navigatePublicPages`, `navigateAuthenticatedPages`, `submitSyntheticResearchQuestions`, `createSyntheticProjects` and `selectFreePlan` are all enforced.
- Before any signed-in test, the harness checks that the saved login still works. That means no sign-in page or password field, and the controls seen right after your sign-in are present. If the check fails, the run is `BLOCKED: SAVED_LOGIN_NOT_ACCEPTED` and nothing is clicked. The plan probe likewise refuses to describe a signed-out page.
- The agent never types into password, MFA, email or payment fields. It types only the scenario's synthetic text, which carries a `UXTEST` marker.
- These limits are enforced:
  - Actions and minutes per scenario.
  - EQUITAS AI submissions, per scenario and per day.
  - Unexpected redirects: URL changes the agent didn't cause.
  - Tester-AI spend, checked before **every** call, both per scenario (`maxTesterSpendUsdPerScenario`) and per day.
  - Scenarios per day.
  - One session at a time: a lock file in `evidence/`.
- Actions are spaced at least 2.5 s apart. Browser dialogs are dismissed (cancel) and downloads are disabled.
- Every question the harness types carries the `UXTEST` marker. `check-manifest` refuses a scenario without it.
- Nothing is deleted on the site. `reports/cleanup-manifest.md` lists records the harness typed **and** ones EQUITAS appears to have created itself (new IDs in the URL, listed UXTEST items), for you to remove by hand.
- Evidence older than `evidence.retainDays` is flagged by `check-manifest` and removed by `npm run purge-evidence -- --confirm`. Only `UXTEST-*` folders inside `evidence/runs` are removed.

## What leaves your computer

- **To EQUITAS:** ordinary browsing plus the synthetic questions in `config/scenarios.json`. These may trigger EQUITAS's own AI calls and analytics, which count against your EQUITAS costs.
- **To Anthropic (only if `testerAi.approved`):**
  - For each step, the page's accessibility text and the persona brief. The text is redacted first: emails, tokens, phone and card-like numbers, and your `redactTerms` are removed.
  - For the scientific judge, EQUITAS's captured response plus the final page text, both redacted the same way.
  - **Screenshots are not sent.**
  - Anthropic's API data policy applies to this, not EQUITAS's policy.
  - Cost is priced by the model that actually answered (unknown models at the highest rate) and capped per scenario and per day.
- **Stays local:** full-page screenshots (with password/email fields and `redactTerms` blacked out), the accessibility text the agent saw at each step, step logs, and the saved login (`.auth/`, owner-only permissions, expires after 12 h). All of these are Git-ignored and must not be committed or uploaded.

## Reading results

- `reports/results.md`: status per scenario, with browser, build and validity warnings. It also has the plan probe's observations, hypotheses and regression verdict, and step-by-step persona narratives.
- `reports/persona-comparison.md`: the shared benchmark task, persona by persona, side by side. Rows are not averaged.
- `reports/navigation-map.md`: a map of the pages the agent actually reached and how it got there.
- `reports/accessibility.md`: automated accessibility scan results (axe-core) and 320 px reflow results, plus the list of manual tests still needed.
- `reports/defect-register-draft.*`: **draft** findings with generated reproduction steps. Each needs human triage: re-perform the steps, confirm severity, add acceptance criteria and SOW mapping (`docs/defect-register-template.md`).
- Science scores come in two layers:
  - Keyword coverage: word-start matches, each quoted with context, and generic concepts need two distinct terms.
  - An AI judge labelled `PROVISIONAL_AI_JUDGMENT`.
  - Neither is expert review.
- **Validity warnings:** a run is flagged when the sign-in state is uncertain, when an account labelled "new" shows prior use, or when EQUITAS was redeployed mid-run (a changed build or asset fingerprint). Don't compare flagged runs.
- Simulated personas are not users. Use `docs/real-user-validation-protocol.md` before drawing conclusions about real investigators.

## Known limitations

- Black-box only: root causes are hypotheses for Appifest to confirm.
- The founder account can't show how other entitlements behave. Each role needs its own approved account.
- Automated accessibility checks (axe-core, 320 px reflow, keyboard tab order, accessible names) are **not** WCAG conformance. Screen-reader, real zoom, cognitive and other manual tests are listed as NOT TESTED in `reports/accessibility.md`.
- The saved login includes cookies, local storage and IndexedDB. Playwright can't save sessionStorage. If EQUITAS keeps its login only there, every run will say `SAVED_LOGIN_NOT_ACCEPTED`. It won't silently test a signed-out page.
- The tester-AI and judge paths are tested end to end with a fake client. The real API request was checked only up to authentication in the build environment, so check your first live run's log.
- Long pages: the agent gets the start and end of the page plus a complete list of controls. Failed lookups on shortened pages are labelled as possibly a harness limitation.
- Mid-run redeployment is detected from the page's build text and script and style file names. A deploy that changes neither won't be noticed.
- Element lookup uses accessible names. If EQUITAS has unlabeled controls, the agent can't use them. That's recorded as a failed lookup, which is itself an accessibility signal.
