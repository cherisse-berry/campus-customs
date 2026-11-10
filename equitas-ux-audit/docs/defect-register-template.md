# Vendor-actionable defect record (Section 22)

Copy for each triaged finding. Draft entries come from `reports/defect-register-draft.md`. A person confirms every field before the record goes to Appifest.

```
Issue ID:               EQX-0001
Title:
Classification:         OBSERVED_BROWSER_DEFECT | OBSERVED_NAVIGATION_BLOCKER | ENTITLEMENT_OR_ACCOUNT_STATE_FAILURE |
                        UX_HEURISTIC_CONCERN | SCIENTIFIC_EXPECTATION_FAILURE_PROVISIONAL |
                        SCIENTIFIC_EXPECTATION_FAILURE_EXPERT_REVIEWED | ACCESSIBILITY_FINDING |
                        PRIVACY_OR_PERMISSION_CONCERN | VENDOR_INVESTIGATION_REQUIRED |
                        PRODUCT_DESIGN_DECISION_REQUIRED | ACTUAL_HUMAN_USER_FINDING (only with real participants)
Type:                   Existing functional defect | Unclear product design | New functionality request | Unresolved contractual classification
Severity:               P0 | P1 | P2 | P3   (justify: task impact, scientific consequence, users affected, reproducibility, recoverability, privacy)
Affected user types:
Account role/entitlement actually used:
Environment / URL:      https://www.equitasintelligence.com  (production | staging)
Build identifier:       (if visible)
Date/time (with TZ):
Browser / viewport:     Chromium <version> / desktop 1440×900 | tablet 820×1180 | mobile 390×844
Preconditions:
Reproduction steps:     1. …  (re-performed by a person: yes/no)
Expected behaviour:
Actual behaviour:
Evidence:               evidence/runs/<runId>/steps/NN-*.png, run.json step N (redacted)
User impact:
Scientific impact:      (if applicable; PROVISIONAL unless expert-reviewed)
Cause:                  Confirmed by Appifest: … | Suspected (black-box): …
Proposed remediation:
Acceptance criteria:    Given … when … then …
Regression test:        npm run probe-plan -- --account <id>   or   npm run scenario -- --scenario <id> --account <id>
SOW deliverable:        (quote the verified SOW text, or "not mapped — SOW text not available")
Retest status:          Not retested | Retested <date> run <id>: pass/fail
```

A usability observation on its own is never classified as a contract breach.
