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
const browser = await chromium.launch({ headless: false });
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
rl.close();

const host = new URL(page.url()).hostname;
if (!manifest.target.allowedHosts.includes(host)) {
  console.error(`The browser is on ${host}, which is not an approved host. Not saving.`);
  await browser.close();
  process.exit(1);
}
await context.storageState({ path: statePath });
fs.chmodSync(statePath, 0o600);
fs.writeFileSync(metaPath, JSON.stringify({ account: account.id, savedAt: new Date().toISOString(), landedOnPath: new URL(page.url()).pathname }, null, 2));
fs.chmodSync(metaPath, 0o600);
await browser.close();
console.log(`Saved session for ${account.id}. It is reused for ${manifest.sessionReuseMaxHours ?? 12}h, then you must log in again.`);
