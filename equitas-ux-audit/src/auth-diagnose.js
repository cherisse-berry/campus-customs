// Read-only diagnosis of a saved EQUITAS session. Never types credentials,
// never retries, never prints cookie or storage VALUES (names only).
//
//   npm run auth-diagnose -- --account founder-admin
//
// One browser, one visit to the post-sign-in page and one to the site root.
// If EQUITAS rejects the session, it is marked rejected so no later run
// presents it again.
import fs from "node:fs";
import path from "node:path";
import { loadManifest, getAccount, parseArgs, ROOT, isMain } from "./lib/manifest.js";
import { openBrowser, installNavigationGuard } from "./lib/evidence.js";
import { AUTH, sessionPreflight, verifySession, verifyOnPage, readMeta, sessionShape } from "./lib/auth.js";
import { redactUrl } from "./lib/redact.js";

export async function diagnose({ manifest, accountId, headed = false }) {
  manifest ??= loadManifest();
  manifest._root ??= ROOT;
  const account = getAccount(manifest, accountId);
  const meta = readMeta(manifest._root, account.id);
  const out = { account: account.id, at: new Date().toISOString(), saved: null, preflight: null, live: null, diagnosis: [] };
  if (meta) {
    out.saved = {
      savedAt: meta.savedAt, landedOnPath: meta.landedOnPath, hasUserAgent: !!meta.userAgent,
      markers: meta.markers ? { signedIn: meta.markers.signedIn.length, founder: meta.markers.founder.length, signedOut: (meta.markers.signedOutAuto || []).length } : "none (saved by an older harness)",
      cookiesAtSignIn: meta.sessionShape?.cookies?.map((c) => `${c.name} (${c.domain}${c.session ? ", session cookie" : `, expires ${c.expires}`}${c.partitioned ? ", partitioned" : ""})`) || "unknown",
      localStorageAtSignIn: meta.sessionShape?.origins?.map((o) => `${o.origin}: ${o.localStorageKeys.length} key(s), ${o.indexedDB.length} IndexedDB`) || "unknown",
      sessionStorageKeysAtSignIn: meta.sessionStorageKeyCount ?? "unknown",
      rejectedAt: meta.rejectedAt || null,
    };
  }
  const pre = sessionPreflight(manifest, account);
  out.preflight = { status: pre.status, reasons: pre.reasons };
  if (pre.status !== "READY") {
    out.diagnosis.push(`Saved session is not usable (${pre.status}); EQUITAS was not contacted. ${pre.reasons.join(" ")}`);
    return out;
  }
  const { browser, context } = await openBrowser(manifest, { accountId: account.id, headed });
  try {
    await installNavigationGuard(context, manifest, () => {});
    out.live = { restoredInBrowser: await sessionShape(context, manifest) };
    const page = await context.newPage();
    // 1. Post-sign-in page (the one EQUITAS showed after you signed in)
    const v = await verifySession(page, manifest, account, pre);
    out.live.postSignIn = { path: v.entryPath, finalUrl: v.url, status: v.status, signedInMarkersSeen: v.signedInMarkersSeen, founderMarkersSeen: v.founderMarkersSeen, signedOutEvidence: v.signedOutEvidence, reasons: v.reasons };
    out.live.cookiesAfterVisit = (await sessionShape(context, manifest)).cookies.map((c) => c.name);
    // 2. Site root, unless the session was just rejected
    if (v.status !== AUTH.REJECTED) {
      await page.goto(manifest.target.baseUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      const r = await verifyOnPage(page, manifest, account, pre);
      out.live.root = { finalUrl: redactUrl(page.url()), signedInMarkersSeen: r.signedInMarkersSeen, signedOutEvidence: r.signedOutEvidence };
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // ---- Plain-language reading, separating harness from EQUITAS ----
  const L = out.live, d = out.diagnosis;
  const savedCookies = Array.isArray(out.saved?.cookiesAtSignIn) ? out.saved.cookiesAtSignIn.length : null;
  if (savedCookies === 0 && !(meta?.sessionShape?.origins || []).some((o) => o.localStorageKeys.length || o.indexedDB.length) && meta?.sessionStorageKeyCount > 0)
    d.push("HARNESS LIMIT: at sign-in EQUITAS stored nothing a saved session can carry (no cookies, localStorage or IndexedDB) but did use sessionStorage. Saved sessions cannot work for this site; use --attended mode.");
  if (L.restoredInBrowser.cookies.length < (savedCookies || 0)) d.push(`HARNESS: only ${L.restoredInBrowser.cookies.length} of ${savedCookies} cookies saved at sign-in were restored into the test browser.`);
  if (L.postSignIn.status === AUTH.NO_MARKERS) d.push("HARNESS: no signed-in markers recorded. Sign in again with the updated `npm run login` to pick them.");
  if (L.postSignIn.status === AUTH.REJECTED) d.push(`Session REJECTED on ${L.postSignIn.path}: ${L.postSignIn.signedOutEvidence.join(", ")}. Either the session expired or was ended server-side (sign-out elsewhere, short session lifetime), or EQUITAS ties sessions to something the test browser does not reproduce. Run once with --headed to compare; if a visible browser is also rejected, the session itself ended.`);
  if ([AUTH.AUTHENTICATED, AUTH.FOUNDER_VERIFIED].includes(L.postSignIn.status)) {
    d.push(`Session RESTORED and verified (${L.postSignIn.status}) on the post-sign-in page ${L.postSignIn.path}.`);
    if (L.root && !L.root.signedInMarkersSeen.length) d.push(`HARNESS DEFECT CONFIRMED (fixed): the old probe only looked at the site root (${L.root.finalUrl}), which shows no signed-in markers even with a valid session. Whether a signed-in founder should see the public homepage at the root is an EQUITAS product question, not a session failure.`);
  }
  if (L.postSignIn.status === AUTH.UNVERIFIED) d.push(`UNVERIFIED: no sign-in page, but none of the chosen markers is visible on ${L.postSignIn.finalUrl}. The markers may be wrong, or the page differs from the one seen at sign-in. Sign in again and pick markers from the post-sign-in screen.`);
  return out;
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  if (!args.account) { console.error("Usage: npm run auth-diagnose -- --account <id> [--headed]"); process.exit(2); }
  const out = await diagnose({ accountId: args.account, headed: !!args.headed });
  const dir = path.join(ROOT, "evidence", "auth-diagnose");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${args.account}-${out.at.replace(/[:.]/g, "")}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ saved: out.saved, preflight: out.preflight, postSignIn: out.live?.postSignIn, root: out.live?.root }, null, 2));
  console.log("\nDIAGNOSIS:\n" + out.diagnosis.map((x) => " - " + x).join("\n"));
  console.log(`\nSaved to ${path.relative(ROOT, file)} (names only; no cookie or storage values).`);
}
