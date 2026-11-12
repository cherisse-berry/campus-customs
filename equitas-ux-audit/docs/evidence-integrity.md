# Evidence integrity, re-assessment and reconciliation

## 0. Before updating the code — record the current state

Run this on the machine that holds the evidence **before** pulling or copying new code. The output is stored outside the project, so no code update can touch it.

```bash
cd ~/equitas-ux-testing/equitas-ux-audit
mkdir -p ../equitas-integrity
( git rev-parse HEAD 2>/dev/null || echo "not a git checkout — code deployed from commit b2c5c6a per the update instructions" ) > ../equitas-integrity/commit-before.txt
find evidence -type f ! -path 'evidence/integrity/*' -print0 | sort -z | xargs -0 shasum -a 256 > ../equitas-integrity/evidence-before.sha256
wc -l ../equitas-integrity/evidence-before.sha256
```

The live public audit and the 12 Nov diagnostics were produced by commit **b2c5c6a** (keyboard detector v1). Confirm that against `commit-before.txt`.

## 1. After updating — prove nothing changed

```bash
npm run verify-evidence -- --against ../equitas-integrity/evidence-before.sha256
```

This exits 0 only if every recorded file is byte-identical: "Original evidence is unchanged." Files created later, such as new reports or snapshots, are listed but are not errors. Modified or missing files fail.

`npm run evidence-snapshot` writes a JSON and a `shasum` listing to `evidence/integrity/`, with the current Git commit, for later comparisons.

## 2. Re-assessment of historical keyboard-trap warnings

`npm run reconcile -- --expect-observations 7655 --expect-groups 420`

- Reads only the original run files. No live request is made.
- "Before" regroups the original observations with the original grouping rules. It should reproduce the reported 7,655 observations and 420 groups; the command reports any difference.
- "After" applies one change: each historical keyboard-v1 trap warning is classified by **evidence sufficiency**, using the focus sequence stored in its run:

| Class | Meaning |
|---|---|
| SUPPORTED_BY_EXISTING_EVIDENCE | Needs recorded, failed escape attempts. v1 recorded none, so no v1 warning can be in this class. That does not show that no trap exists. |
| INSUFFICIENT_EVIDENCE | No usable keyboard record was stored. |
| SUPERSEDED_HARNESS_DEFECT | The stored sequence shows a v1 defect demonstrated by the reference set: identity collision, focus inside a frame, or focus inside a shadow-DOM host. The warning is not evidence of a trap; it is **not** proof that none exists. Retest is recommended for frames and shadow hosts. |
| REQUIRES_TARGETED_LIVE_RETEST | The pattern fits a real trap **or** legitimate containment, e.g. the same control three times in a row, or a cycle of three or fewer controls. Only keyboard-v2's escape attempts can tell them apart. |

- Nothing is rejected. Every observation keeps its original ID, category, severity and fingerprint.
- `reports/reconciliation-observations.csv` has one row per original observation. Each row gives the original finding ID, run, page and viewport; the issue group before and after; category and severity before and after; the sufficiency class and root cause; and the evidence used. Where an older run's single finding expanded into several observations (one per selector), each gets `~2`, `~3` … after the ID.
- `reports/reconciliation.md` gives the totals, root causes (with pages, viewports and IDs), and changed groups. `reports/reconciliation-groups.csv` gives the before→after group flows.
- To have the expected totals checked on every `npm run report`, create `config/reconciliation-expect.json` containing `{"observations": 7655, "groups": 420}`.

**Root causes.** Similar warnings are not assumed to share a cause. A detector-defect cause is assigned only when an observation's own stored sequence shows that defect. A shared component is assigned only when the same element type and name repeats across pages. Everything else stays page-level.

## 3. Blocked requests

`npm run analyze-blocked` writes `reports/blocked-requests.md`. It classifies each blocked request's likely purpose (analytics, error monitoring, feature flags, consent, form submission, same-site API, …) from method, host, path and resource type only. It judges whether blocking could have changed what the audit observed:
- **none:** e.g. analytics
- **possible:** e.g. feature flags or consent
- **high:** a same-site write on page load
- **intended:** form submissions, blocked by policy

Requests are **never replayed**. Public-audit-1 did not record which page sent each request, so page-level effects can't be established for the 12 Nov audit; public-audit-2 records page and time.

## 4. Check everything

```bash
npm run report
npm run validate-reports
npm run verify-evidence -- --against ../equitas-integrity/evidence-before.sha256
```

`validate-reports` checks that the register, summary and reconciliation agree with the evidence:
- every original observation is mapped exactly once
- the after-groups exist in the register
- the expected totals match, if configured
- no v1 warning is marked "supported"
