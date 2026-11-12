# Incident: saved founder session not verified; plan check reported PASS on the public homepage

**Reported:** 12 Nov 2026, from the founder's Mac.
**Runs:** `UXTEST-PLANPROBE-founder-admin-20261112T151545-0690` and `UXTEST-PLANPROBE-founder-admin-20261112T151916-0wcg`.
**Status:** testing-harness defects fixed (auth verification v2). Whether EQUITAS restores the session is **not yet known**: rerun needed.

## What was observed

- `npm run login` completed, and the session was saved.
- `npm run probe-plan` landed on the public EQUITAS homepage at desktop, mobile and 320 px.
- The harness reported that only 8% of controls seen after sign-in were visible.
- The regression check still reported **PASS**.

## Testing-harness defects (confirmed in the harness code)

| # | Defect | Effect | Fix |
|---|---|---|---|
| H1 | The probe always opened the **site root**. The page EQUITAS showed after sign-in was recorded, but never used. | If the root is a public homepage for everyone, the probe never looks at the founder pathway, even with a valid session. | Sign-in is verified on, and the plan screen is analysed on, the post-sign-in page. The root is recorded separately. |
| H2 | An "uncertain" sign-in only produced a warning, and the regression verdict ignored sign-in state. | A public page could produce **PASS**. | PASS/FAIL only for viewports where sign-in is verified (`FOUNDER_VERIFIED` for founder accounts). Otherwise INCONCLUSIVE, or BLOCKED for a rejected session. |
| H3 | Sign-in was judged by overlap with controls seen after sign-in, comparing **different pages**. | 8% overlap meant nothing either way. | Heuristic removed. Application-specific markers you choose are checked against a signed-out browser at sign-in. |
| H4 | Sign-in used a visible browser; the probe used headless Chromium (user agent "HeadlessChrome") with service workers blocked. | A site that ties sessions to the browser identity could reject or ignore the replayed session. | Both use the same settings, and the probe reuses the user agent recorded at sign-in. |
| H5 | No pre-check of the saved session, and no memory of rejection. | Expired or rejected sessions could be presented to EQUITAS on every run. | Missing, expired and rejected sessions are BLOCKED before any contact, and a rejected session is never reused. |

**The earlier PASS results are invalid.** The report marks probes recorded before this fix as "INVALID — superseded". The evidence files themselves are unchanged.

## Possible EQUITAS-side explanations (not established; need the rerun)

1. **The site root is a public homepage even for signed-in users.** That's a product or navigation question, not a session failure. `auth-diagnose` reports it as "root shows no signed-in markers while the session is verified on the post-sign-in page".
2. **The session isn't restored.** Possible causes: a short session lifetime, ending the session server-side, sign-in kept only in sessionStorage, or binding to the browser/IP. `auth-diagnose` shows which storage the sign-in used (names only) and whether EQUITAS rejected the restored session.

## The "Choose your plan" problem

**Not resolved, and not re-tested.** No verified founder pathway has been observed yet. A conclusion needs a probe run where every viewport shows `FOUNDER_VERIFIED`.
