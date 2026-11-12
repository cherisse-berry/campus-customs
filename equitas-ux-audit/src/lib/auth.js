// Authentication verification for the local testing harness.
//
// The harness never types credentials, never retries a sign-in, and never
// bypasses MFA. It only (a) checks a saved browser session the founder created
// by signing in themselves, and (b) looks for application-specific evidence on
// the page EQUITAS showed right after that sign-in.
//
// Statuses, in the order they are decided:
//   SESSION_MISSING        no saved session on disk                         → BLOCKED, site not visited
//   SESSION_EXPIRED        older than sessionReuseMaxHours, or every saved
//                          session cookie has expired                         → BLOCKED, site not visited
//   SESSION_REJECTED_EARLIER  a previous run saw EQUITAS reject this session  → BLOCKED, site not visited
//   MARKERS_NOT_CONFIGURED no signed-in markers recorded or configured       → INCONCLUSIVE / BLOCKED
//   SESSION_REJECTED       EQUITAS showed sign-in evidence (login page, password
//                          field, sign-in control, configured signed-out marker) → BLOCKED; session marked rejected
//   UNVERIFIED             no sign-in evidence, but no signed-in marker either → INCONCLUSIVE / BLOCKED
//   AUTHENTICATED          a signed-in marker is present, no signed-out evidence
//   FOUNDER_VERIFIED       AUTHENTICATED and a founder-only marker is present
import fs from "node:fs";
import path from "node:path";
import { redact, redactUrl } from "./redact.js";

export const AUTH = {
  MISSING: "SESSION_MISSING",
  EXPIRED: "SESSION_EXPIRED",
  REJECTED_EARLIER: "SESSION_REJECTED_EARLIER",
  NO_MARKERS: "MARKERS_NOT_CONFIGURED",
  REJECTED: "SESSION_REJECTED",
  UNVERIFIED: "UNVERIFIED",
  AUTHENTICATED: "AUTHENTICATED",
  FOUNDER_VERIFIED: "FOUNDER_VERIFIED",
};

const LOGIN_PATH = /\/(login|log-in|signin|sign-in|signup|sign-up|auth|sso|account\/login)(\/|$|\?)/i;
const LOGIN_CTL = /^(sign in|log in|login|sign up|create account|continue with google|continue with microsoft|forgot password\??)$/i;

const authDir = (root) => path.join(root, ".auth");
export const statePath = (root, id) => path.join(authDir(root), `${id}.json`);
export const metaPath = (root, id) => path.join(authDir(root), `${id}.meta.json`);
export function readMeta(root, id) {
  try { return JSON.parse(fs.readFileSync(metaPath(root, id), "utf8")); } catch { return null; }
}
function writeMeta(root, id, meta) {
  fs.writeFileSync(metaPath(root, id), JSON.stringify(meta, null, 2));
  try { fs.chmodSync(metaPath(root, id), 0o600); } catch {}
}

// Markers: what proves "signed in" and "founder". Manifest settings win over
// the markers the founder picked at sign-in, so they can be set declaratively.
// A marker is { role, name } (exact accessible name) or { text } (visible text).
export function resolveMarkers(manifest, account, meta) {
  const cfg = account.authVerification || manifest.authVerification || {};
  return {
    signedIn: cfg.signedInMarkers?.length ? cfg.signedInMarkers : meta?.markers?.signedIn || [],
    founder: cfg.founderMarkers?.length ? cfg.founderMarkers : meta?.markers?.founder || [],
    signedOut: [...(cfg.signedOutMarkers || []), ...(meta?.markers?.signedOutAuto || [])],
    entryPath: cfg.signedInPath || meta?.landedOnPath || null,
    requireFounder: account.actualRole === "founder_admin" && cfg.requireFounderMarker !== false,
    source: cfg.signedInMarkers?.length ? "manifest" : meta?.markers?.signedIn?.length ? "chosen at sign-in" : "none",
  };
}

// Step 1 — checks that need no site visit.
export function sessionPreflight(manifest, account, now = Date.now()) {
  const root = manifest._root;
  const meta = readMeta(root, account.id);
  if (!fs.existsSync(statePath(root, account.id)) || !meta) {
    return { status: AUTH.MISSING, reasons: [`No saved session for "${account.id}". Run: npm run login -- --account ${account.id}`] };
  }
  if (meta.rejectedAt) {
    return { status: AUTH.REJECTED_EARLIER, meta, reasons: [`EQUITAS rejected this saved session at ${meta.rejectedAt} (${meta.rejectedReason}). The harness will not reuse it. Sign in again: npm run login -- --account ${account.id}`] };
  }
  const maxH = manifest.sessionReuseMaxHours ?? 12;
  const ageH = (now - new Date(meta.savedAt).getTime()) / 3.6e6;
  if (!(ageH <= maxH)) return { status: AUTH.EXPIRED, meta, reasons: [`Saved session is ${ageH.toFixed(1)} h old (limit ${maxH} h). Sign in again.`] };
  // Cookie expiry (names and expiry only; values are never read here).
  let state = null;
  try { state = JSON.parse(fs.readFileSync(statePath(root, account.id), "utf8")); } catch {}
  const hosts = new Set(manifest.target.allowedHosts.map((h) => h.toLowerCase()));
  const siteCookies = (state?.cookies || []).filter((c) => [...hosts].some((h) => h === c.domain.replace(/^\./, "") || h.endsWith(c.domain.replace(/^\./, ""))));
  const persistent = siteCookies.filter((c) => c.expires && c.expires > 0);
  if (persistent.length && siteCookies.every((c) => c.expires > 0 && c.expires * 1000 < now)) {
    return { status: AUTH.EXPIRED, meta, reasons: [`All ${siteCookies.length} saved EQUITAS cookies have expired.`] };
  }
  const markers = resolveMarkers(manifest, account, meta);
  return { status: "READY", meta, markers, reasons: [] };
}

export async function markerVisible(page, m) {
  try {
    const loc = m.text ? page.getByText(m.text, { exact: false }) : page.getByRole(m.role, { name: m.name, exact: true });
    return (await loc.filter({ visible: true }).count()) > 0;
  } catch { return false; }
}
const label = (m) => redact(m.text ? `text "${m.text}"` : `${m.role} "${m.name}"`);

// Step 2 — one visit to the page EQUITAS showed right after sign-in. No retries.
export async function verifyOnPage(page, manifest, account, pre) {
  const { markers } = pre;
  const evidence = { url: redactUrl(page.url()), signedOutEvidence: [], signedInMarkersSeen: [], founderMarkersSeen: [], markerSource: markers.source };
  let pathname = "";
  try { pathname = new URL(page.url()).pathname; } catch {}
  if (LOGIN_PATH.test(pathname)) evidence.signedOutEvidence.push(`sign-in path ${pathname}`);
  if ((await page.locator("input[type=password]").filter({ visible: true }).count().catch(() => 0)) > 0) evidence.signedOutEvidence.push("visible password field");
  for (const role of ["link", "button"]) {
    const names = await page.getByRole(role).filter({ visible: true }).allInnerTexts().catch(() => []);
    for (const n of names) if (LOGIN_CTL.test(n.trim())) evidence.signedOutEvidence.push(`${role} "${n.trim()}"`);
  }
  for (const m of markers.signedOut) if (await markerVisible(page, m)) evidence.signedOutEvidence.push(`signed-out marker ${label(m)}`);
  for (const m of markers.signedIn) if (await markerVisible(page, m)) evidence.signedInMarkersSeen.push(label(m));
  for (const m of markers.founder) if (await markerVisible(page, m)) evidence.founderMarkersSeen.push(label(m));

  if (!markers.signedIn.length) return { status: AUTH.NO_MARKERS, ...evidence, reasons: ["No signed-in markers are recorded. Sign in again with the updated `npm run login` (it asks you to pick them) or set authVerification.signedInMarkers in the manifest."] };
  // Sign-in evidence plus no signed-in marker = rejected. (A page can show a
  // "Sign up" link to others while signed in, so a marker overrides weak signals.)
  if (evidence.signedOutEvidence.length && !evidence.signedInMarkersSeen.length) {
    return { status: AUTH.REJECTED, ...evidence, reasons: [`EQUITAS showed signed-out evidence: ${evidence.signedOutEvidence.join("; ")}`] };
  }
  if (!evidence.signedInMarkersSeen.length) {
    return { status: AUTH.UNVERIFIED, ...evidence, reasons: [`None of the signed-in markers (${markers.signedIn.map(label).join(", ")}) were visible on ${evidence.url}.`] };
  }
  if (markers.founder.length && evidence.founderMarkersSeen.length) return { status: AUTH.FOUNDER_VERIFIED, ...evidence, reasons: [] };
  return { status: AUTH.AUTHENTICATED, ...evidence, reasons: markers.requireFounder ? [markers.founder.length ? "Signed in, but no founder-only marker was visible." : "Signed in, but no founder-only marker is configured, so founder access is not verified."] : [] };
}

// Can results from this run support conclusions for this account?
export function authAllowsConclusions(status, account, manifest) {
  if (status === AUTH.FOUNDER_VERIFIED) return true;
  if (status !== AUTH.AUTHENTICATED) return false;
  const cfg = account.authVerification || manifest.authVerification || {};
  return !(account.actualRole === "founder_admin" && cfg.requireFounderMarker !== false);
}

// Remember a rejection so later runs do not keep presenting a dead session
// to EQUITAS (avoids repeated failed-auth traffic and account-security alerts).
export function markRejected(manifest, account, reason) {
  const meta = readMeta(manifest._root, account.id);
  if (!meta) return;
  meta.rejectedAt = new Date().toISOString();
  meta.rejectedReason = redact(reason).slice(0, 300);
  writeMeta(manifest._root, account.id, meta);
}

// Full check used by the probe and the scenario runner. Visits the post-sign-in
// page once, in the given page, and returns { status, ...evidence }.
export async function verifySession(page, manifest, account, pre, { navigate = true } = {}) {
  const entry = pre.markers.entryPath || "/";
  if (navigate) {
    await page.goto(new URL(entry, manifest.target.baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  }
  const v = await verifyOnPage(page, manifest, account, pre);
  v.entryPath = entry;
  v.at = new Date().toISOString();
  if (v.status === AUTH.REJECTED) markRejected(manifest, account, v.reasons.join("; "));
  return v;
}

// Names-only description of what a context stores for the approved hosts.
// Used at sign-in and by `npm run auth-diagnose`. Values are never read out.
export async function sessionShape(context, manifest) {
  const hosts = manifest.target.allowedHosts.map((h) => h.toLowerCase());
  const st = await context.storageState({ indexedDB: true }).catch(() => ({ cookies: [], origins: [] }));
  const onSite = (d) => hosts.some((h) => h === d.replace(/^\./, "") || h.endsWith(d.replace(/^\./, "")));
  return {
    cookies: st.cookies.filter((c) => onSite(c.domain)).map((c) => ({ name: c.name, domain: c.domain, path: c.path, session: !(c.expires > 0), expires: c.expires > 0 ? new Date(c.expires * 1000).toISOString() : null, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, partitioned: !!c.partitionKey })),
    otherCookieDomains: [...new Set(st.cookies.filter((c) => !onSite(c.domain)).map((c) => c.domain))],
    origins: st.origins.map((o) => ({ origin: o.origin, localStorageKeys: (o.localStorage || []).map((x) => x.name), indexedDB: (o.indexedDB || []).map((d) => d.name) })),
  };
}

// sessionStorage cannot be saved by Playwright. Called on the live page at sign-in.
export async function sessionStorageKeys(page) {
  return page.evaluate(() => { try { return Object.keys(sessionStorage); } catch { return []; } }).catch(() => []);
}

// At sign-in: prove each chosen signed-in/founder marker does NOT appear to a
// signed-out visitor of the same page, using a separate, empty browser context
// (no credentials, no session — just one page load). Also collects sign-in
// controls that only the signed-out visitor sees, as extra signed-out markers.
export async function validateMarkersSignedOut(browser, manifest, entryPath, markers, contextOpts = {}) {
  const ctx = await browser.newContext({ locale: "en-US", serviceWorkers: "block", ...contextOpts });
  const page = await ctx.newPage();
  const out = { kept: { signedIn: [], founder: [] }, rejected: [], signedOutOnly: [], signedOutUrl: null };
  try {
    await page.goto(new URL(entryPath || "/", manifest.target.baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    out.signedOutUrl = redactUrl(page.url());
    for (const kind of ["signedIn", "founder"]) {
      for (const m of markers[kind] || []) {
        if (await markerVisible(page, m)) out.rejected.push({ kind, marker: m, why: "also visible when signed out" });
        else out.kept[kind].push(m);
      }
    }
    for (const role of ["link", "button"]) {
      for (const n of await page.getByRole(role).filter({ visible: true }).allInnerTexts().catch(() => [])) {
        const name = n.trim();
        if (/^(sign in|log in|login|sign up|register|create account)$/i.test(name)) out.signedOutOnly.push({ role, name });
      }
    }
  } finally {
    await ctx.close().catch(() => {});
  }
  return out;
}
