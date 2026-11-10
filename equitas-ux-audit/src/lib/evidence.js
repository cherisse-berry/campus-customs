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
  return { browser, context, viewportName: viewport, viewport: VIEWPORTS[viewport] };
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
      machine: { platform: os.platform(), node: process.version },
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

  async screenshot(page, label) {
    const file = path.join(this.dir, "steps", `${String(this.run.steps.length).padStart(2, "0")}-${label.replace(/[^a-z0-9-]/gi, "_").slice(0, 40)}.png`);
    const mask = (this.manifest.evidence?.maskSelectors || []).map((s) => page.locator(s));
    await page.screenshot({ path: file, fullPage: false, mask, maskColor: "#000" }).catch(() => {});
    return path.relative(this.dir, file);
  }

  step(record) {
    this.run.steps.push({ n: this.run.steps.length + 1, at: new Date().toISOString(), ...record });
    fs.writeFileSync(path.join(this.dir, "steps", `${String(this.run.steps.length).padStart(2, "0")}.json`), JSON.stringify(record, null, 2));
  }

  finding(f) { this.run.findings.push({ id: `${this.id}-F${this.run.findings.length + 1}`, observedAt: new Date().toISOString(), ...f }); }

  finish(outcome) {
    this.run.outcome = outcome;
    this.run.endedAt = new Date().toISOString();
    this.run.network.offDomainRequests = [...this.run.network.offDomainRequests];
    fs.writeFileSync(path.join(this.dir, "run.json"), JSON.stringify(this.run, null, 2));
    return this.run;
  }
}
