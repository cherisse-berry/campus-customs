// Founder-controlled sign-in (Section 3).
// Opens a visible browser at the real EQUITAS site. YOU type the password and
// MFA code into the website itself. Nothing is typed by this script, and
// nothing is printed. When you press Enter here, the browser's session is
// saved to .auth/<account>.json (Git-ignored, owner-only permissions).
//
//   npm run login -- --account founder-admin
//   npm run login -- --account founder-admin --forget     (delete saved session)
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { chromium } from "playwright";
import { loadManifest, getAccount, parseArgs, ROOT } from "./lib/manifest.js";
import { visibleControls } from "./lib/observe.js";

const args = parseArgs();
if (!args.account) { console.error("Usage: npm run login -- --account <id from manifest>"); process.exit(2); }
const manifest = loadManifest();
const account = getAccount(manifest, args.account);
const authDir = path.join(ROOT, ".auth");
const statePath = path.join(authDir, `${account.id}.json`);
const metaPath = path.join(authDir, `${account.id}.meta.json`);

if (args.forget) {
  for (const p of [statePath, metaPath]) if (fs.existsSync(p)) fs.rmSync(p);
  console.log(`Deleted saved session for ${account.id}. Also sign out on the website if you want the server session ended.`);
  process.exit(0);
}

fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: false, executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await context.newPage();
await page.goto(manifest.target.baseUrl);

console.log(`
A browser window has opened at ${manifest.target.baseUrl}
  1. Sign in there as the "${account.id}" account (${account.description}).
  2. Complete MFA in the website. Do not type credentials into this terminal.
  3. Stop as soon as you are signed in — do not click "Choose your plan" or
     Settings; the probe needs to see the first screen untouched.
`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question("Press Enter here once you are signed in (or Ctrl+C to abort)… ");

// Sanity check: does this page still look like a sign-in page?
const pwVisible = await page.locator("input[type=password]").filter({ visible: true }).count().catch(() => 0);
if (pwVisible) {
  const a = await rl.question("A password field is still visible, so you may not be signed in yet. Save anyway? (y/N) ");
  if (!/^y/i.test(a)) { rl.close(); await browser.close(); console.log("Not saved."); process.exit(1); }
}
rl.close();
// What a signed-in user sees: control names only, kept locally, used later to
// confirm that a saved login still works.
const fingerprint = [...new Set((await visibleControls(page)).filter((c) => c.name).map((c) => c.name))].slice(0, 60);

const host = new URL(page.url()).hostname;
if (!manifest.target.allowedHosts.includes(host)) {
  console.error(`The browser is on ${host}, which is not an approved host. Not saving.`);
  await browser.close();
  process.exit(1);
}
// indexedDB: true — many sites (Firebase and others) keep their sign-in there,
// and Playwright leaves it out unless asked. sessionStorage is never saved by
// Playwright; if EQUITAS keeps its login only there, every run will report
// SAVED_LOGIN_NOT_ACCEPTED rather than test a signed-out page.
await context.storageState({ path: statePath, indexedDB: true });
fs.chmodSync(statePath, 0o600);
fs.writeFileSync(metaPath, JSON.stringify({ account: account.id, savedAt: new Date().toISOString(), landedOnPath: new URL(page.url()).pathname, signedInFingerprint: fingerprint }, null, 2));
fs.chmodSync(metaPath, 0o600);
await browser.close();
console.log(`Saved session for ${account.id}. It is reused for ${manifest.sessionReuseMaxHours ?? 12}h, then you must log in again.`);
