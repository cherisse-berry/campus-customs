# Keyboard-trap detection (WCAG 2.2 SC 2.1.2)

## Why it changed

The live public audit, run on commit b2c5c6a with keyboard-v1, produced many possible P1 keyboard-trap warnings. Passing self-tests had not validated v1's method. Measured on an independent reference set, v1 is unreliable:

| Detector | Correct | False positives | False negatives | Overclaims (expected inconclusive) |
|---|---|---|---|---|
| keyboard-v1 (live audit) | 10 / 19 | 7 | 1 | 1 |
| keyboard-v2 (current) | 19 / 19 | 0 | 0 | 0 |

**The reference set has 19 cases: 2 violations, 16 non-violations and 1 inconclusive. That is too few to estimate statistical performance, and none is claimed.** The table shows agreement on these scenarios only. Regenerate it with `npm run validate-keyboard`, which writes `reports/keyboard-detector-validation.md` with every key-press transcript.

## The reference set

`selftest/keyboard-reference/cases.json` holds expected verdicts written from the success criterion before v2 existed. Detectors never read the file. Its SHA-256 is recorded in `EXPECTED_SHA256`, and the self-test fails if the file changes without that record being updated in a reviewed commit.

It covers:
- genuine traps: a field that swallows Tab/Shift+Tab/Escape; a widget that cycles internally
- normal document cycling, with one, three or no controls
- a long page
- look-alike controls: identical long class lists; adjacent identical links
- a modal dialog with Escape, and a native `<dialog>`
- dropdown menus, closed and open with roving tabindex
- shadow DOM
- same-origin and cross-origin iframes, the latter both returning and not returning
- controls added dynamically
- containment exited by Shift+Tab, and containment exited by Escape

## How v2 decides

1. **Identity.** Each element is identified by the element object itself (a counter in a WeakMap), never by its markup.
2. **Where focus really is.** Focus is followed into open shadow roots and same-origin iframes. A cross-origin iframe is recorded as "contents not observable".
3. **Browser UI vs page.** When `document.activeElement` is `<body>` and `document.hasFocus()` is false, focus has left the page for the browser. That is the normal end of the document, not a trap. Headless Chromium shows this after the last control, then wraps to the first.
4. **No trap is inferred** from a repeated target, a reached Tab budget, or document cycling alone. A trap candidate needs a set of controls that keeps repeating without focus reaching the end of the page. Then v2 tries standard exits: Shift+Tab (up to the set size + 2 presses), then Escape, then Tab again.
   - Focus leaves → **CONTAINED_WITH_ESCAPE**: legitimate containment, not a failure, with the exit key recorded.
   - Focus never leaves → **TRAP**. It is still "awaiting human confirmation", and the finding asks the reviewer to check whether the page tells users a non-standard exit (2.1.2 allows that).
   - Focus enters a cross-origin frame and doesn't return → **INCONCLUSIVE**.
   - Focus keeps moving to new controls until the budget ends → **NO_TRAP** (traversal incomplete).
5. **Evidence.** Every key press and the resulting focus is recorded: element, role, name, shadow/frame flags, dialog open, `aria-expanded`. The escape attempts and the containment set are recorded too. Reproduction steps are generated from the transcript.

## Limitations

- Focus inside browser UI is **inferred** from `document.hasFocus()`; Playwright cannot observe the browser chrome itself.
- Cross-origin frames, closed shadow roots and plugins are not observable from the page. Those cases are reported as inconclusive, never as traps.
- Escape can legitimately close a component on the live site (a menu or dialog). That's a read-only interaction, but it changes page state for the rest of that viewport's checks.
- Whether a page explains a non-standard exit method is not detected automatically.
- Screen-reader browse modes and other assistive-technology keyboard modes are not covered.
- Headed browsers and real devices can differ from headless Chromium. A confirmed trap needs a person to reproduce it with the recorded key sequence.
