// Evidence collection (Sections 17–18). Everything stays on the local disk in
// a Git-ignored folder. Screenshots mask credential and email fields.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";
import { redact, redactUrl } from "./redact.js";

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
  // WCAG 1.4.10 reflow: 320 CSS px ≈ 1280 px window at 400% zoom.
  reflow320: { width: 320, height: 640 },
};

export function runId(prefix) {
  const t = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `${prefix}-${t}-${Math.random().toString(36).slice(2, 6)}`;
}

export function authStatePath(root, accountId) {
  return path.join(root, ".auth", `${accountId}.json`);
}

export function readAuthMeta(root, accountId) {
  try { return JSON.parse(fs.readFileSync(path.join(root, ".auth", `${accountId}.meta.json`), "utf8")); } catch { return null; }
}

export async function openBrowser(manifest, { accountId, viewport = "desktop", headed = false, useAuth = true }) {
  const root = manifest._root;
  let storageState;
  if (useAuth && accountId) {
    const p = authStatePath(root, accountId);
    const meta = readAuthMeta(root, accountId);
    if (!fs.existsSync(p) || !meta) throw new Error(`No saved login for "${accountId}". Run: npm run login -- --account ${accountId}`);
    const ageH = (Date.now() - new Date(meta.savedAt).getTime()) / 3.6e6;
    if (ageH > (manifest.sessionReuseMaxHours ?? 12)) throw new Error(`Saved login for "${accountId}" is ${ageH.toFixed(1)}h old. Log in again.`);
    storageState = p;
  }
  const browser = await chromium.launch({ headless: !headed, executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport] || VIEWPORTS.desktop,
    storageState,
    locale: "en-US",
    acceptDownloads: false,
    serviceWorkers: "block",
  });
  return { browser, context, viewportName: viewport, viewport: VIEWPORTS[viewport] || VIEWPORTS.desktop, browserInfo: { name: "chromium", version: browser.version(), headless: !headed } };
}

// Blocks off-domain navigation in EVERY top-level frame of the context: the
// main tab and any pop-up / new tab, before the page loads. Iframes are left
// alone (embedded widgets), but their hosts are logged as off-domain requests.
export async function installNavigationGuard(context, manifest, onBlocked) {
  const allowed = new Set(manifest.target.allowedHosts.map((h) => h.toLowerCase()));
  const ok = (u) => {
    try {
      const url = new URL(u);
      return ["about:", "data:", "blob:"].includes(url.protocol) || allowed.has(url.hostname.toLowerCase());
    } catch { return false; }
  };
  await context.route("**/*", async (route) => {
    const req = route.request();
    let topLevel = false, popup = false;
    try {
      topLevel = req.isNavigationRequest() && req.frame().parentFrame() === null;
      if (topLevel) popup = req.frame().page() !== context.pages()[0];
    } catch {
      // Playwright has no frame yet for a navigation issued before its page
      // exists: that is a brand-new pop-up / new tab.
      topLevel = req.isNavigationRequest();
      popup = topLevel;
    }
    if (topLevel && !ok(req.url())) {
      onBlocked?.({ url: redactUrl(req.url()), host: (() => { try { return new URL(req.url()).hostname; } catch { return "?"; } })(), popup });
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  return ok;
}

export class Evidence {
  constructor(manifest, id, meta) {
    this.manifest = manifest;
    this.id = id;
    this.dir = path.join(manifest._root, manifest.evidence?.storeDirectory || "evidence", "runs", id);
    fs.mkdirSync(path.join(this.dir, "steps"), { recursive: true });
    try { fs.chmodSync(this.dir, 0o700); } catch {}
    this.run = {
      runId: id,
      startedAt: new Date().toISOString(),
      machine: { platform: os.platform(), release: os.release(), node: process.version },
      ...meta,
      steps: [],
      navigationPath: [],
      network: { failedRequests: [], httpErrors: [], consoleErrors: [], offDomainRequests: new Set() },
      dialogs: [],
      createdRecords: [],
      equitasResponses: [],
      findings: [],
      outcome: null,
    };
  }

  attach(page) {
    const allowed = new Set(this.manifest.target.allowedHosts);
    page.on("console", (m) => { if (m.type() === "error") this.run.network.consoleErrors.push(redact(m.text()).slice(0, 400)); });
    page.on("pageerror", (e) => this.run.network.consoleErrors.push("pageerror: " + redact(e.message).slice(0, 400)));
    page.on("requestfailed", (r) => this.run.network.failedRequests.push({ url: redactUrl(r.url()), method: r.method(), failure: r.failure()?.errorText }));
    page.on("response", (r) => {
      if (r.status() >= 400) this.run.network.httpErrors.push({ url: redactUrl(r.url()), status: r.status(), method: r.request().method() });
    });
    page.on("request", (r) => {
      try { const h = new URL(r.url()).hostname; if (!allowed.has(h)) this.run.network.offDomainRequests.add(h); } catch {}
    });
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) this.run.navigationPath.push({ at: new Date().toISOString(), url: redactUrl(f.url()) }); });
  }

  // Full-page screenshots by default, so content below the fold is evidenced.
  // Credential/email fields and the manifest's redactTerms are blacked out.
  async screenshot(page, label, { fullPage = true } = {}) {
    const file = path.join(this.dir, "steps", `${String(this.run.steps.length).padStart(2, "0")}-${label.replace(/[^a-z0-9-]/gi, "_").slice(0, 40)}.png`);
    const mask = (this.manifest.evidence?.maskSelectors || []).map((s) => page.locator(s));
    for (const term of this.manifest.evidence?.redactTerms || []) if (term && term.length >= 2) mask.push(page.getByText(term, { exact: false }));
    await page.screenshot({ path: file, fullPage, mask, maskColor: "#000", timeout: 20000 }).catch(() =>
      page.screenshot({ path: file, fullPage: false, mask, maskColor: "#000" }).catch(() => {})
    );
    return path.relative(this.dir, file);
  }

  // The exact (redacted) accessibility text the blinded agent saw at a step.
  saveSnapshot(text) {
    const file = path.join(this.dir, "steps", `${String(this.run.steps.length + 1).padStart(2, "0")}.snapshot.txt`);
    fs.writeFileSync(file, text ?? "");
    return path.relative(this.dir, file);
  }

  step(record) {
    this.run.steps.push({ n: this.run.steps.length + 1, at: new Date().toISOString(), ...record });
    fs.writeFileSync(path.join(this.dir, "steps", `${String(this.run.steps.length).padStart(2, "0")}.json`), JSON.stringify(record, null, 2));
  }

  // stepIndex lets the reporter rebuild exact reproduction steps.
  finding(f) { this.run.findings.push({ id: `${this.id}-F${this.run.findings.length + 1}`, observedAt: new Date().toISOString(), stepIndex: this.run.steps.length, ...f }); }

  finish(outcome) {
    this.run.outcome = outcome;
    this.run.endedAt = new Date().toISOString();
    this.run.network.offDomainRequests = [...this.run.network.offDomainRequests];
    fs.writeFileSync(path.join(this.dir, "run.json"), JSON.stringify(this.run, null, 2));
    return this.run;
  }
}
