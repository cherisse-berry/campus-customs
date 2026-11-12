// Keyboard navigation detectors (WCAG 2.2 SC 2.1.2 No Keyboard Trap, 2.4.7, 2.4.11).
//
// keyboardV1 — the detector used by the public audit up to commit b2c5c6a,
//   kept verbatim so its behaviour can be measured against the reference set
//   (selftest/keyboard-reference). Do not use it for new findings. Known
//   defects, demonstrated by the reference set:
//     • identity = first 120 characters of outerHTML → distinct elements with
//       the same long class list (or same markup) look identical;
//     • reads document.activeElement only → focus moving inside an iframe or
//       a shadow root looks like focus stuck on the frame/host;
//     • "trap" whenever the same identity appears 3 times in a row, or when
//       the Tab budget runs out with ≤3 distinct identities — without trying
//       Shift+Tab or Escape, and without distinguishing browser-UI focus.
//
// keyboardV2 — the replacement. Element identity is the element object itself
//   (an internal counter in a WeakMap), focus is followed into open shadow
//   roots and same-origin frames, cross-origin frames are marked unobservable,
//   and focus reaching the browser UI (activeElement = body and
//   document.hasFocus() = false) is recorded as the end of the document.
//   A trap is reported only after a set of controls repeats without reaching
//   the end of the document AND Shift+Tab and Escape both fail to move focus
//   out of that set. Every key press and focus transition is recorded.

export const CLASSIFICATION = {
  NO_TRAP: "NO_TRAP",                         // focus left the document or kept moving
  CONTAINED_WITH_ESCAPE: "CONTAINED_WITH_ESCAPE", // focus contained, but a standard key exits
  TRAP: "TRAP",                               // contained; Tab, Shift+Tab and Escape all failed
  INCONCLUSIVE: "INCONCLUSIVE",               // focus could not be observed (e.g. cross-origin frame)
};
export const VERDICT_OF = { NO_TRAP: "NOT_A_VIOLATION", CONTAINED_WITH_ESCAPE: "NOT_A_VIOLATION", TRAP: "VIOLATION", INCONCLUSIVE: "INCONCLUSIVE" };

// ------------------------------------------------------------------ v1 (frozen)
export async function keyboardV1(page, maxStops = 40) {
  try {
    await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    const stops = [];
    for (let i = 0; i < maxStops; i++) {
      await page.keyboard.press("Tab");
      const f = await page.evaluate(() => {
        const a = document.activeElement;
        if (!a || a === document.body) return null;
        a.scrollIntoView?.({ block: "nearest" });
        const r = a.getBoundingClientRect();
        const s = getComputedStyle(a);
        const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none");
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const top = document.elementFromPoint(Math.min(Math.max(cx, 0), innerWidth - 1), Math.min(Math.max(cy, 0), innerHeight - 1));
        return {
          key: a.outerHTML.slice(0, 120),
          tag: a.tagName.toLowerCase(),
          name: (a.getAttribute("aria-label") || a.innerText || a.value || "").replace(/\s+/g, " ").trim().slice(0, 60),
          visibleFocus: !!ring,
          obscured: !!top && top !== a && !a.contains(top) && !top.contains(a),
        };
      });
      if (!f) { if (stops.length) break; else continue; }
      stops.push(f);
    }
    const keys = stops.map((s) => s.key);
    let trap = false;
    for (let i = 3; i < keys.length; i++) if (keys[i] === keys[i - 1] && keys[i] === keys[i - 2]) trap = true;
    const uniq = new Set(keys).size;
    if (!trap && keys.length >= maxStops && uniq <= 3) trap = true;
    return {
      version: "keyboard-v1",
      stops: stops.map(({ key, ...s }) => s),
      reachable: uniq,
      withoutVisibleFocus: stops.filter((s) => !s.visibleFocus).map((s) => `${s.tag} "${s.name}"`).slice(0, 15),
      obscured: stops.filter((s) => s.obscured).map((s) => `${s.tag} "${s.name}"`).slice(0, 15),
      trap,
      classification: trap ? CLASSIFICATION.TRAP : CLASSIFICATION.NO_TRAP,
    };
  } catch (e) { return { version: "keyboard-v1", error: e.message.split("\n")[0] }; }
}

// ------------------------------------------------------------------ v2
// Runs in the page: describe the element that really has focus.
function describeFocus() {
  const ids = (window.__uxauditIds ||= new WeakMap());
  window.__uxauditNext ||= 1;
  const idOf = (el) => { if (!ids.has(el)) ids.set(el, window.__uxauditNext++); return ids.get(el); };
  const docHasFocus = document.hasFocus();
  let a = document.activeElement;
  if (!a || (a === document.body && !docHasFocus)) return { outside: true, docHasFocus };
  if (a === document.body || a === document.documentElement) return { body: true, docHasFocus };
  const path = [];
  let inShadow = false, inFrame = false, crossOrigin = false;
  for (let guard = 0; a && guard < 20; guard++) {
    path.push(a);
    if (a.shadowRoot && a.shadowRoot.activeElement) { a = a.shadowRoot.activeElement; inShadow = true; continue; }
    if (a.tagName === "IFRAME" || a.tagName === "FRAME") {
      let d = null;
      try { d = a.contentDocument; } catch { d = null; }
      if (!d) { crossOrigin = true; break; }
      if (d.activeElement && d.activeElement !== d.body) { a = d.activeElement; inFrame = true; continue; }
      break;
    }
    break;
  }
  const el = path[path.length - 1];
  const view = el.ownerDocument.defaultView || window;
  const s = view.getComputedStyle(el);
  const r = el.getBoundingClientRect();
  let ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none");
  let obscured = false;
  if (!inFrame && !crossOrigin) {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const root = el.getRootNode && el.getRootNode().elementFromPoint ? el.getRootNode() : document;
    const top = root.elementFromPoint(Math.min(Math.max(cx, 0), innerWidth - 1), Math.min(Math.max(cy, 0), innerHeight - 1));
    obscured = !!top && top !== el && !el.contains(top) && !top.contains(el);
  }
  const dialog = [...document.querySelectorAll("dialog[open], [role=dialog], [role=alertdialog]")].find((d) => d.getClientRects().length && !d.hidden);
  const exp = el.closest?.("[aria-expanded]");
  return {
    key: path.map(idOf).join(">"),
    id: idOf(el),
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute("role") || null,
    name: (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60),
    inShadow, inFrame, crossOrigin,
    frameTitle: crossOrigin ? (el.getAttribute("title") || el.getAttribute("src") || "").slice(0, 80) : null,
    visibleFocus: !!ring, obscured,
    state: { dialogOpen: !!dialog, dialogName: dialog ? (dialog.getAttribute("aria-label") || "").slice(0, 40) : null, ariaExpanded: exp ? exp.getAttribute("aria-expanded") : null },
    docHasFocus,
  };
}

// Count tabbable controls, including open shadow roots and same-origin frames.
function countTabbable() {
  const sel = "a[href],area[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex='-1']),[contenteditable=true],summary";
  let n = 0, crossOriginFrames = 0;
  const walk = (root) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.matches(sel) && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && el.tabIndex >= 0) {
        if (el.tagName === "IFRAME") {
          let d = null; try { d = el.contentDocument; } catch {}
          if (d) walk(d); else crossOriginFrames++;
        } else n++;
      }
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  return { tabbable: n, crossOriginFrames };
}

const short = (f) => (f.outside ? "[browser UI — outside the page]" : f.body ? "[page body]" : `${f.tag}${f.role ? `[role=${f.role}]` : ""} "${f.name}"${f.inShadow ? " (shadow DOM)" : ""}${f.inFrame ? " (in frame)" : ""}${f.crossOrigin ? " (cross-origin frame — contents not observable)" : ""}`);

export async function keyboardV2(page, maxPresses = 40, { window: W = 12, redact = (s) => s } = {}) {
  const transcript = [];
  const stops = new Map(); // element key -> descriptor (first focus)
  const press = async (key) => {
    await page.keyboard.press(key);
    const f = await page.evaluate(describeFocus).catch((e) => ({ error: e.message.split("\n")[0] }));
    if (f.name) f.name = redact(f.name);
    transcript.push({ n: transcript.length + 1, key, focus: f, focusText: short(f) });
    if (f.key && !stops.has(f.key)) stops.set(f.key, f);
    return f;
  };
  try {
    await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    const before = await page.evaluate(countTabbable);
    let boundary = false, error = null;
    const seq = [];
    for (let i = 0; i < maxPresses; i++) {
      const f = await press("Tab");
      if (f.error) { error = f.error; break; }
      if (f.outside) { boundary = true; break; }  // focus went to the browser: end of document reached
      if (f.body) continue;
      seq.push(f);
    }
    const after = await page.evaluate(countTabbable);
    const base = {
      version: "keyboard-v2", maxPresses, tabbableAtStart: before.tabbable, tabbableAtEnd: after.tabbable, crossOriginFrames: after.crossOriginFrames,
      presses: transcript.length, boundaryReached: boundary,
      reachable: stops.size,
      withoutVisibleFocus: [...stops.values()].filter((s) => !s.visibleFocus && !s.crossOrigin).map(short).slice(0, 15),
      obscured: [...stops.values()].filter((s) => s.obscured).map(short).slice(0, 15),
    };
    const done = (classification, reason, extra = {}) => ({ ...base, classification, verdict: VERDICT_OF[classification], trap: classification === CLASSIFICATION.TRAP, reason, ...extra, transcript });
    if (error) return done(CLASSIFICATION.INCONCLUSIVE, `Focus could not be read: ${error}`);
    if (boundary) return done(CLASSIFICATION.NO_TRAP, `Focus moved through ${stops.size} control(s) and then left the page for the browser (end of document reached after ${transcript.length} Tab presses).`);
    if (!seq.length) return done(CLASSIFICATION.NO_TRAP, "No control received focus.");

    // Focus never reached the end of the document within the budget.
    const tail = seq.slice(-Math.min(W, seq.length));
    if (tail.every((f) => f.crossOrigin)) {
      return done(CLASSIFICATION.INCONCLUSIVE, `Focus entered a cross-origin frame (${tail[0].frameTitle || "untitled"}) and had not returned after ${tail.length} Tab presses. What happens inside the frame cannot be observed from the page; this is not evidence of a trap.`);
    }
    const tailKeys = tail.filter((f) => !f.crossOrigin).map((f) => f.key);
    const distinct = [...new Set(tailKeys)];
    const repeated = distinct.every((k) => tailKeys.filter((x) => x === k).length >= 2) && tailKeys.length >= Math.min(W, 4);
    if (!repeated) {
      return done(CLASSIFICATION.NO_TRAP, `Focus kept moving to new controls (${stops.size} distinct in ${transcript.length} presses); the Tab budget ended before the end of the page. Traversal incomplete — no trap observed in the traversed part.`, { traversalComplete: false });
    }
    // A set S of controls repeats. Try standard exits: Shift+Tab, then Escape (+Tab).
    const S = new Set(distinct);
    const setDesc = distinct.map((k) => short(stops.get(k)));
    const attempts = [];
    const outOfSet = (f) => f.outside || f.body || (f.key && !S.has(f.key));
    let escaped = null;
    const shiftTries = Math.max(3, S.size + 2);
    for (let i = 0; i < shiftTries && !escaped; i++) { const f = await press("Shift+Tab"); if (outOfSet(f)) escaped = { method: "Shift+Tab", presses: i + 1, focusAfter: short(f) }; }
    attempts.push({ method: "Shift+Tab", presses: escaped ? escaped.presses : shiftTries, escaped: !!escaped });
    if (!escaped) {
      const f1 = await press("Escape");
      if (outOfSet(f1)) escaped = { method: "Escape", presses: 1, focusAfter: short(f1) };
      else {
        for (let i = 0; i < S.size + 2 && !escaped; i++) { const f = await press("Tab"); if (outOfSet(f)) escaped = { method: "Escape, then Tab", presses: i + 2, focusAfter: short(f) }; }
      }
      attempts.push({ method: "Escape (then Tab)", escaped: !!escaped });
    }
    const containment = { controls: setDesc, size: S.size, firstSeenAtPress: transcript.findIndex((t) => t.focus.key && S.has(t.focus.key)) + 1, otherTabbableControls: Math.max(0, after.tabbable - S.size), state: tail[tail.length - 1].state };
    if (escaped) return done(CLASSIFICATION.CONTAINED_WITH_ESCAPE, `Tab cycled within ${S.size} control(s) (${setDesc.join(", ")}), but ${escaped.method} moved focus out (to ${escaped.focusAfter}). Legitimate containment with a standard exit; not a 2.1.2 failure.`, { containment, escapeAttempts: attempts, escapedBy: escaped });
    return done(CLASSIFICATION.TRAP, `Tab cycled within ${S.size} control(s) (${setDesc.join(", ")}) while ${containment.otherTabbableControls} other control(s) exist, and neither Shift+Tab nor Escape moved focus out. Check whether the page advises a non-standard exit (allowed by 2.1.2).`, { containment, escapeAttempts: attempts });
  } catch (e) {
    return { version: "keyboard-v2", classification: CLASSIFICATION.INCONCLUSIVE, verdict: "INCONCLUSIVE", trap: false, reason: `Detector error: ${e.message.split("\n")[0]}`, transcript };
  }
}
