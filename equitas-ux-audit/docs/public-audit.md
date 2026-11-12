# Public website audit (signed-out visitor)

Audits every publicly reachable page of https://www.equitasintelligence.com/ for navigation, responsive layout, accessibility and technical reliability. It runs as a signed-out visitor, separate from:
- the authenticated investigator track (`npm run scenario`, `npm run batch`)
- the founder-administrator track (`npm run probe-plan`, `npm run login`)

## Commands

```bash
npm run public-audit -- --plan          # scope, limits and authorization status; contacts nothing
npm run public-audit                    # live audit (only inside the approved testing window)
npm run investigate -- --group G-xxxxxxxx               # re-measure one consolidated issue
npm run investigate -- --selector '.bg-gold\/15.gap-1.py-0\.5' --paths /
npm run report                          # rebuild every report from the evidence
npm run validate-reports                # check the reports against the evidence
```

## What it does

1. **Discovery** follows links on rendered pages, plus `/sitemap.xml` if the site publishes one. It starts from `/` (and any `publicAudit.seedPaths`), stays on the approved host(s), and respects robots.txt.
   - Protected routes are classified and never requested: sign-in, app, admin, account, billing, API, projects, studio, advisor and similar (`DEFAULT_PROTECTED_PATTERNS` in `src/lib/public-safety.js`).
   - External, contact and file links are listed but not crawled. URLs are never guessed.
   - The founder's expected pages (Homepage, For Researchers, … Data Security) are matched against what was discovered. Missing ones are reported as "not found via navigation", not as defects.
2. **Per page and viewport** (desktop 1440×900, tablet 820×1180, mobile 390×844, narrow 320×640), it records:
   - HTTP status, redirect chain, load time, console errors, uncaught exceptions, failed requests and missing assets.
   - A full-page screenshot.
   - axe-core rules for WCAG 2.0/2.1/2.2 A and AA plus best practice. Colour-contrast findings keep the measured colours and ratio.
   - Headings, landmarks, breadcrumbs, skip link, language and title.
   - Touch targets under 24×24 CSS px, controls off-screen or covered, small text, and text clipped when WCAG 1.4.12 spacing is applied.
   - Keyboard Tab order, visible focus, focus hidden behind other content, and keyboard traps (keyboard-v2: tries Shift+Tab and Escape before reporting a trap; see `docs/keyboard-detector.md`).
   - At mobile and 320 px, the navigation menu: opened, `aria-expanded` checked, links shown, Escape tested.
   - Dialogs (accessible name), media (for 1.2.x applicability), forms (inspected only), and wording such as "coming soon", "preview" or "waitlist".
3. **Site-level analysis:**
   - consistent navigation (WCAG 3.2.3)
   - the same link text going to different places (3.2.4)
   - broken links and redirects, links that lead to sign-in
   - dead ends, loops, and deep pages without breadcrumbs or a parent link
   - generic link text
   - calls to action that promise use ("Start now") but lead to planned or waitlist pages

A page that loads is **not** a pass. Load status, layout, accessibility and usability are reported separately.

## Production safety (enforced in the browser, tested offline)

- No saved session is loaded, and no credentials are used.
- Every non-GET request is aborted before it leaves the browser: form posts, fetch/XHR writes and beacons. Form submissions are also cancelled inside the page, so a page that auto-submits stays intact.
- Navigation to protected routes and payment hosts is aborted. Pop-ups are closed.
- The only clicks are on a navigation menu toggle that declares itself one: `aria-expanded`/`aria-controls`, in the header or nav, named like a menu, not a link, not inside a form.
- One page at a time, with `delayMs` between loads (default 2 s), a hard page limit (40), a page-load limit (200) and a navigation timeout (30 s).
- Live runs require an approved manifest, `permittedWorkflows.navigatePublicPages: true`, and the current time inside `authorization.testingWindow`. Outside the window the audit and investigations stop **before any request**.

## Findings, consolidation and triage

- Each observation gets a **fingerprint** = rule + element (or page/target) + identifying text. Page, viewport and run are not part of it, so the same element at four viewports in three runs is **one issue** with 12 observations. Original findings keep their IDs and stay unchanged in `run.json`. `reports/consolidation.md` shows the mapping.
- Earlier harness versions' findings (including the 12 Nov probes) are translated using the selectors they recorded, so they consolidate with new observations of the same element.
- Categories, in the register:
  1. **Confirmed defects.** Either a person confirmed the issue in `config/triage.json`, or it's an objective measurement (HTTP error, load failure) reproduced in two separate runs.
  2. **Automated findings awaiting human confirmation**: everything axe-core or heuristics report.
  3. **Potential usability concerns**: judgment needed.
  4. **Inconclusive or blocked**: protected routes, robots, limits, forms not submitted, axe "needs review", expected pages not found.
  5. **Intentionally unavailable or planned.**
  6. **Testing-harness defects.**
- To triage, copy `config/triage.example.json` to `config/triage.json`. Then record `confirmed`, `rejected`, `intended` or `harness` against the group ID, then run `npm run report`.

## Investigating the 12 Nov contrast finding

```bash
npm run report                       # consolidation.md shows whether the nine findings are one issue
npm run investigate -- --selector '.bg-gold\/15.gap-1.py-0\.5' --paths /
```

For every viewport, the investigation records:
- the exact element and its visible text
- its landmark, nearest heading and position on the page
- the text colour, the background layers and the resulting background (translucent layers such as `bg-gold/15` are blended correctly)
- an independent WCAG contrast ratio, with axe-core's ratio for comparison
- the size threshold that applies (4.5:1 normal text, 3:1 large text)
- a screenshot with the element outlined, and whether the issue reproduces at every viewport

If the background is an image or gradient, or an ancestor has opacity or a blend mode, the ratio is reported as **not reliably measurable**. The investigation is a measurement, not a confirmation: record your decision in `config/triage.json`.

## WCAG 2.2 AA coverage

`config/wcag22-aa.json` classifies all 55 Level A/AA criteria:
- **25 partly automated:** automation catches some failures only.
- **18 need manual review.**
- **6 depend on media being present.**
- **6 not evaluated:** they would need form submission or sign-in.

`reports/accessibility.md` lists each criterion with its method and any open issues. Automated results never establish conformance.

## Validation and re-assessment

See `docs/keyboard-detector.md` (independent reference set, measured false positives and false negatives) and `docs/evidence-integrity.md` (checksums, historical re-assessment, reconciliation, blocked-request analysis). Product, content, availability and commercial matters are presented for founder review, and the audit recommends no change to them.

## Limitations

- Signed-out pages only. Forms are never submitted (3.3.x not evaluated). No plan selection, payment or paid AI.
- Discovery depends on links and the sitemap. Unlinked pages, or pages beyond the limits, are listed as not audited.
- Focus-visibility detection looks for an outline or box-shadow. Other focus styles may be reported and need a person to check.
- Availability is classified from page wording. It does not prove whether a feature works.
- A deployment during the run is detected only if build text or asset names change.
