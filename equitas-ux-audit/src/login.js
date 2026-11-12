// Founder-controlled sign-in (Section 3).
// Opens a visible browser at the real EQUITAS site. YOU type the password and
// MFA code into the website itself. Nothing is typed by this script, nothing
// is retried, and no credential is printed or stored.
//
// After you press Enter, you pick one or two things that only appear when you
// are signed in (and, optionally, one only a founder/admin sees). The script
// checks them against a separate signed-out browser, then saves the session to
// .auth/<account>.json (Git-ignored, owner-only permissions).
//
//   npm run login -- --account founder-admin
//   npm run login -- --account founder-admin --forget     (delete saved session)
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { chromium } from "playwright";
import { loadManifest, getAccount, parseArgs, ROOT } from "./lib/manifest.js";
import { contextOptions } from "./lib/evidence.js";
import { redact } from "./lib/redact.js";
import { statePath as sp, metaPath as mp, sessionShape, sessionStorageKeys, validateMarkersSignedOut, markerVisible } from "./lib/auth.js";

const args = parseArgs();
if (!args.account) { console.error("Usage: npm run login -- --account <id from manifest>"); process.exit(2); }
const manifest = loadManifest();
manifest._root = ROOT;
const account = getAccount(manifest, args.account);
const statePath = sp(ROOT, account.id);
const metaPath = mp(ROOT, account.id);

if (args.forget) {
  for (const p of [statePath, metaPath]) if (fs.existsSync(p)) fs.unlinkSync(p);
  console.log(`Deleted saved session for ${account.id}. Also sign out on the website if you want the server session ended.`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: false, executablePath: process.env.PW_CHROMIUM_PATH || undefined });
// Same context options the probe and scenarios use later.
const context = await browser.newContext(contextOptions("desktop", { viewport: { width: 1280, height: 860 } }));
const page = await context.newPage();
await page.goto(manifest.target.baseUrl);

console.log(`
A browser window has opened at ${manifest.target.baseUrl}
  1. Sign in there as the "${account.id}" account (${account.description}).
  2. Complete MFA in the website. Do not type credentials into this terminal.
  3. Stop on the first screen EQUITAS shows after sign-in — do not click
     "Choose your plan" or Settings.
`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question("Press Enter here once you are signed in (or Ctrl+C to abort)… ");

const host = new URL(page.url()).hostname;
if (!manifest.target.allowedHosts.includes(host)) {
  console.error(`The browser is on ${host}, which is not an approved host. Not saving.`);
  rl.close(); await browser.close(); process.exit(1);
}
if ((await page.locator("input[type=password]").filter({ visible: true }).count().catch(() => 0)) > 0) {
  console.error("A password field is still visible, so sign-in does not look complete. Not saving. Run the command again when you are signed in.");
  rl.close(); await browser.close(); process.exit(1);
}

// ---- Pick application-specific markers ----
const landedOnPath = new URL(page.url()).pathname + new URL(page.url()).search;
const cfg = account.authVerification || manifest.authVerification || {};
let markers = { signedIn: cfg.signedInMarkers || [], founder: cfg.founderMarkers || [] };
if (!markers.signedIn.length) {
  const items = [];
  for (const role of ["heading", "button", "link", "menuitem", "tab"]) {
    const loc = page.getByRole(role).filter({ visible: true });
    const n = Math.min(await loc.count().catch(() => 0), 40);
    for (let i = 0; i < n; i++) {
      const name = ((await loc.nth(i).getAttribute("aria-label").catch(() => null)) || (await loc.nth(i).innerText().catch(() => "")) || "").trim().replace(/\s+/g, " ");
      if (name && name.length <= 80 && !items.some((x) => x.role === role && x.name === name)) items.push({ role, name });
    }
  }
  console.log("\nThings visible on this signed-in screen:");
  items.forEach((x, i) => console.log(`  ${String(i + 1).padStart(2)}. ${x.role} "${redact(x.name)}"`));
  const pick = async (q) => (await rl.question(q)).split(/[ ,]+/).map(Number).filter((n) => n >= 1 && n <= items.length).map((n) => items[n - 1]);
  markers.signedIn = await pick("\nType the numbers of 1–3 items that appear ONLY when you are signed in\n(e.g. your account menu, 'Dashboard' heading, 'Sign out'), separated by spaces: ");
  markers.founder = await pick("Type the number(s) of items ONLY a founder/admin sees (e.g. 'Admin', 'Founder dashboard'), or press Enter if none is visible here: ");
}
rl.close();

const check = await validateMarkersSignedOut(browser, manifest, landedOnPath, markers);
for (const r of check.rejected) console.log(`  Not used: ${r.marker.role || "text"} "${redact(r.marker.name || r.marker.text)}" — ${r.why}.`);
const signedOutOnly = [];
for (const m of check.signedOutOnly) if (!(await markerVisible(page, m))) signedOutOnly.push(m);
markers = { signedIn: check.kept.signedIn, founder: check.kept.founder, signedOutAuto: signedOutOnly };

// ---- What the session is made of (names only) ----
const shape = await sessionShape(context, manifest);
const ssKeys = await sessionStorageKeys(page);
const userAgent = await page.evaluate(() => navigator.userAgent);
const persisted = shape.cookies.length + shape.origins.reduce((n, o) => n + o.localStorageKeys.length + o.indexedDB.length, 0);

await context.storageState({ path: statePath, indexedDB: true });
fs.chmodSync(statePath, 0o600);
fs.writeFileSync(metaPath, JSON.stringify({
  account: account.id,
  savedAt: new Date().toISOString(),
  landedOnPath,
  userAgent,
  markers,
  sessionShape: shape,
  sessionStorageKeyCount: ssKeys.length,
  signedOutCheckUrl: check.signedOutUrl,
}, null, 2));
fs.chmodSync(metaPath, 0o600);
await browser.close();

console.log(`\nSaved session for ${account.id} (reused for up to ${manifest.sessionReuseMaxHours ?? 12} h). Post-sign-in page: ${landedOnPath}`);
console.log(`Signed-in markers: ${markers.signedIn.length} · founder markers: ${markers.founder.length} · signed-out markers: ${signedOutOnly.length}`);
console.log(`Stored for EQUITAS: ${shape.cookies.length} cookie(s), ${shape.origins.reduce((n, o) => n + o.localStorageKeys.length, 0)} localStorage key(s), ${shape.origins.reduce((n, o) => n + o.indexedDB.length, 0)} IndexedDB database(s); sessionStorage keys (cannot be saved): ${ssKeys.length}.`);
if (!markers.signedIn.length) console.log("WARNING: no usable signed-in marker. Probe and scenarios will report INCONCLUSIVE/BLOCKED until you sign in again and pick one that is not visible when signed out.");
if (account.actualRole === "founder_admin" && !markers.founder.length) console.log("WARNING: no founder-only marker. Founder access cannot be verified, so the plan regression check will be INCONCLUSIVE.");
if (!persisted && ssKeys.length) console.log("WARNING: EQUITAS seems to keep this sign-in only in sessionStorage, which a saved session cannot carry. Use attended mode instead: npm run probe-plan -- --account " + account.id + " --attended");
