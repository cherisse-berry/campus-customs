// Read-only diagnostics used by the probe and the scenario runner.
import crypto from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { redact, redactUrl } from "./redact.js";

// Section 17.6 — build identifier and a fingerprint of the site's script
// assets. If the fingerprint changes during a run, Appifest probably deployed
// mid-run and results from before/after must not be compared.
export async function buildFingerprint(page, manifest) {
  const info = await page
    .evaluate(() => ({
      scripts: [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")),
      styles: [...document.querySelectorAll("link[rel=stylesheet][href]")].map((l) => l.getAttribute("href")),
      metaVersion: document.querySelector('meta[name="version"],meta[name="build"],meta[name="app-version"]')?.content || null,
      text: document.body?.innerText?.slice(-4000) || "",
    }))
    .catch(() => ({ scripts: [], styles: [], metaVersion: null, text: "" }));
  let buildId = info.metaVersion;
  const re = manifest.target?.buildIdentifierRegex;
  if (!buildId && re) {
    try { buildId = new RegExp(re, "i").exec(info.text)?.[1] || null; } catch {}
  }
  const assets = [...info.scripts, ...info.styles].map((u) => u.split("?")[0]).sort();
  const assetHash = assets.length ? crypto.createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 16) : null;
  return { buildId, assetHash, assetCount: assets.length, at: new Date().toISOString() };
}

export function deploymentChanged(a, b) {
  if (!a || !b) return false;
  if (a.buildId && b.buildId && a.buildId !== b.buildId) return true;
  return !!(a.assetHash && b.assetHash && a.assetHash !== b.assetHash);
}

// Section 16 — automated accessibility scan (axe-core). Automated rules catch
// only part of WCAG; results never establish conformance.
export async function axeScan(page) {
  try {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    return {
      url: redactUrl(page.url()),
      engine: `axe-core ${r.testEngine?.version || ""}`.trim(),
      violations: r.violations.map((v) => ({
        id: v.id, impact: v.impact, help: v.help, wcag: v.tags.filter((t) => /^wcag\d/.test(t)),
        nodes: v.nodes.length, examples: v.nodes.slice(0, 3).map((n) => redact(n.target.join(" ")).slice(0, 160)),
      })),
      incompleteCount: r.incomplete.length,
      passCount: r.passes.length,
    };
  } catch (e) {
    return { url: redactUrl(page.url()), error: `axe failed: ${e.message.split("\n")[0]}` };
  }
}

// WCAG 1.4.10 reflow proxy: at 320 CSS px wide content should not need
// horizontal scrolling (equivalent to 400% zoom of a 1280 px window).
export async function reflowCheck(page) {
  return page
    .evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      const overflow = el.scrollWidth - el.clientWidth;
      const wide = [...document.querySelectorAll("body *")]
        .filter((n) => n.getBoundingClientRect().right > el.clientWidth + 2 && getComputedStyle(n).position !== "fixed")
        .slice(0, 5)
        .map((n) => n.tagName.toLowerCase() + (n.id ? "#" + n.id : ""));
      return { viewportWidth: el.clientWidth, scrollWidth: el.scrollWidth, horizontalOverflowPx: Math.max(0, overflow), widestElements: wide };
    })
    .catch((e) => ({ error: e.message.split("\n")[0] }));
}

// Section 11 — a "new" account should not show signs of prior use.
const PRIOR_USE = /\b(welcome back|recent projects|your projects|continue where you left off|last edited|resume)\b/i;
export async function priorUseSignals(page, prefix = "UXTEST") {
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const hits = [];
  const m = text.match(PRIOR_USE);
  if (m) hits.push(`text "${m[0]}"`);
  if (text.includes(prefix)) hits.push(`an existing ${prefix} record is listed`);
  return hits;
}

// Section 5 — records the site may have created on its own (a project or
// conversation named by EQUITAS, a new ID in the URL) after a submission.
const ID_SEGMENT = /\/([0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{12,}|[A-Za-z0-9_-]{16,}|\d{3,})(?=\/|$)/;
export async function serverRecordSignals(page, prefix = "UXTEST", beforeUrl = "") {
  const out = [];
  const url = page.url();
  try {
    const now = new URL(url), before = beforeUrl ? new URL(beforeUrl) : null;
    const id = ID_SEGMENT.exec(now.pathname)?.[1];
    if (id && (!before || !before.pathname.includes(id))) out.push({ kind: "new-id-in-url", value: redactUrl(url) });
  } catch {}
  const lines = await page
    .locator("main, [role=main], nav, aside")
    .allInnerTexts()
    .then((ts) => ts.join("\n").split("\n").map((l) => l.trim()).filter((l) => l.includes(prefix) && l.length < 160))
    .catch(() => []);
  for (const l of [...new Set(lines)].slice(0, 10)) out.push({ kind: "listed-test-record", value: redact(l) });
  return out;
}
