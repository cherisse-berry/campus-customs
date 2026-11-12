// Investigate one finding on the public site, read-only, signed out.
//
//   npm run investigate -- --selector '.bg-gold\/15.gap-1.py-0\.5'
//   npm run investigate -- --group G-1a2b3c4d          (selector and pages from the evidence)
//   options: --paths /,/pricing   --viewports desktop,tablet,mobile,reflow320
//
// For every matching element at every viewport it records: the element, its
// visible text and location, foreground/background colours, an independently
// computed contrast ratio (and axe-core's, for comparison), the WCAG criterion,
// and a screenshot with the element outlined.
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import { loadManifest, parseArgs, ROOT, isMain } from "./lib/manifest.js";
import { installNavigationGuard, contextOptions, VIEWPORTS } from "./lib/evidence.js";
import { publicAuditConfig, installPublicSafety } from "./lib/public-safety.js";
import { publicAuditAuthorization } from "./public-audit.js";
import { measureElement, assessContrast } from "./lib/contrast.js";
import { collect } from "./lib/collect.js";
import { redact, redactUrl } from "./lib/redact.js";

export function targetFromGroup(root, groupId) {
  const { groups } = collect(root);
  const g = groups.find((x) => x.groupId === groupId);
  if (!g) throw new Error(`No finding group ${groupId} in the evidence.`);
  if (!g.selector || g.selector.startsWith("(")) throw new Error(`Group ${groupId} has no recorded selector.`);
  return { selector: g.selector, paths: g.pages.length ? g.pages : ["/"], group: g };
}

export async function investigate({ manifest, selector, paths = ["/"], viewports, groupId = null, now = new Date() }) {
  manifest ??= loadManifest({ allowUnapproved: true });
  manifest._root ??= ROOT;
  const cfg = publicAuditConfig(manifest);
  viewports ??= cfg.viewports;
  const id = `INV-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = path.join(manifest._root, "evidence", "investigations", id);
  const result = { investigationId: id, at: new Date().toISOString(), groupId, selector, paths, target: manifest.target.baseUrl, mode: "public-visitor (signed out), read-only", viewports: [], conclusion: null };
  const auth = publicAuditAuthorization(manifest, now);
  if (!auth.ok) { result.status = "BLOCKED"; result.reason = `Not authorized for live testing: ${auth.problems.join("; ")}. EQUITAS was not contacted.`; return result; }
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  result.browser = browser.version();
  const blocked = [];
  try {
    for (const vp of viewports) {
      const context = await browser.newContext(contextOptions(vp));
      await installNavigationGuard(context, manifest, (b) => blocked.push(b));
      await installPublicSafety(context, manifest, cfg, (b) => blocked.push({ ...b, url: redactUrl(b.url) }));
      const page = await context.newPage();
      for (const p of paths) {
        const url = new URL(p, manifest.target.baseUrl).toString();
        const row = { viewport: vp, size: VIEWPORTS[vp], page: p, url: redactUrl(url), elements: [] };
        result.viewports.push(row);
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: cfg.navTimeoutMs });
          await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        } catch (e) { row.error = e.message.split("\n")[0]; continue; }
        const loc = page.locator(selector);
        row.matches = await loc.count().catch(() => 0);
        let axeNodes = [];
        try {
          const a = await new AxeBuilder({ page }).include(selector).withRules(["color-contrast"]).analyze();
          axeNodes = (a.violations[0]?.nodes || []).map((n) => ({ target: n.target.join(" "), data: (n.any || []).map((c) => c.data).find((d) => d?.contrastRatio !== undefined) || null }));
          row.axePasses = a.passes.some((x) => x.id === "color-contrast");
        } catch (e) { row.axeError = e.message.split("\n")[0]; }
        for (let i = 0; i < Math.min(row.matches, 5); i++) {
          const el = loc.nth(i);
          const visible = await el.isVisible().catch(() => false);
          if (!visible) { row.elements.push({ index: i, visible: false }); continue; }
          await el.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
          const m = await measureElement(el);
          const a = assessContrast(m);
          const axe = axeNodes[i]?.data || axeNodes.find((n) => n.data)?.data || null;
          await el.evaluate((n) => { n.dataset.uxauditOutline = n.style.outline; n.style.outline = "3px solid #ff00ff"; n.style.outlineOffset = "2px"; });
          const box = await el.boundingBox();
          const vpSize = page.viewportSize();
          const shot = `${vp}-${p.replace(/[^a-z0-9]/gi, "_")}-${i}`;
          if (box) await page.screenshot({ path: path.join(dir, `${shot}-context.png`), clip: { x: Math.max(0, box.x - 60), y: Math.max(0, box.y - 60), width: Math.min(vpSize.width - Math.max(0, box.x - 60), box.width + 120), height: Math.min(vpSize.height - Math.max(0, box.y - 60), box.height + 120) } }).catch(() => {});
          await page.screenshot({ path: path.join(dir, `${shot}-page.png`), fullPage: true, timeout: 20000 }).catch(() => {});
          await el.evaluate((n) => { n.style.outline = n.dataset.uxauditOutline || ""; delete n.dataset.uxauditOutline; });
          row.elements.push({
            index: i, visible: true,
            text: redact(m.text), tag: m.tag, classes: m.classes, html: redact(m.outerHTML),
            location: { pageY: m.rect.y, pageX: m.rect.x, width: m.rect.width, height: m.rect.height, landmark: m.landmark, nearestHeading: m.nearestHeading ? redact(m.nearestHeading) : null },
            colours: { textCss: m.color.css, backgroundLayers: m.backgroundLayers.map((l) => ({ element: l.tag, css: l.css })), effectiveForeground: a.foreground, effectiveBackground: a.background },
            contrast: a,
            axe: axe ? { ratio: axe.contrastRatio, fg: axe.fgColor, bg: axe.bgColor, expected: axe.expectedContrastRatio } : null,
            screenshots: [`${shot}-context.png`, `${shot}-page.png`].filter((f) => fs.existsSync(path.join(dir, f))),
          });
        }
      }
      await context.close();
    }
  } finally {
    await browser.close().catch(() => {});
  }
  result.blockedRequests = blocked;
  // ---- Conclusion: facts first, then what they support ----
  const seen = result.viewports.filter((r) => r.elements?.some((e) => e.visible));
  const failing = seen.filter((r) => r.elements.some((e) => e.visible && (e.contrast.passes === false || (e.contrast.passes === null && e.axe && e.axe.ratio < e.axe.expected))));
  const ratios = result.viewports.flatMap((r) => (r.elements || []).filter((e) => e.visible).map((e) => e.contrast.ratio ?? e.contrast.estimatedRatio));
  result.reproducible = { viewportsTested: viewports.length, viewportsWithElement: seen.length, viewportsBelowThreshold: failing.length, acrossAllViewports: seen.length === viewports.length && failing.length === viewports.length };
  const first = seen[0]?.elements.find((e) => e.visible);
  result.conclusion = !seen.length
    ? "The element was not found (or not visible) at any viewport. The original finding could not be reproduced: the page may have changed, or the selector is page-specific."
    : `${first.tag} with text "${first.text}" (${first.location.landmark}${first.location.nearestHeading ? `, near heading "${first.location.nearestHeading}"` : ""}): ${first.contrast.foreground} on ${first.contrast.background}, ${first.contrast.reliable ? `measured ${first.contrast.ratio}:1` : `estimated ${first.contrast.estimatedRatio}:1 (not reliably measurable: ${first.contrast.reliabilityNotes.join("; ")})`}${first.axe ? `; axe-core measured ${first.axe.ratio}:1` : ""}; required ${first.contrast.requiredRatio}:1 under ${first.contrast.wcag.split(":")[0]}. Below threshold at ${failing.length} of ${seen.length} viewport(s) where it appears. ${result.reproducible.acrossAllViewports ? "Reproducible at every viewport tested." : ""} This is a measurement, not a human confirmation: record the decision in config/triage.json.`;
  result.status = "COMPLETED";
  fs.writeFileSync(path.join(dir, "investigation.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(dir, "investigation.md"), investigationMarkdown(result));
  return result;
}

export function investigationMarkdown(r) {
  let md = `# Investigation ${r.investigationId}\n\n- Selector: \`${r.selector}\`${r.groupId ? ` (finding group ${r.groupId})` : ""}\n- Site: ${r.target} — ${r.mode}\n- When: ${r.at} · Chromium ${r.browser || "?"}\n\n**Conclusion:** ${r.conclusion}\n\n| Viewport | Page | Matches | Text | Location | Foreground | Background | Ratio (independent) | Ratio (axe) | Required | Result | Screenshot |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const v of r.viewports) {
    if (v.error) { md += `| ${v.viewport} | ${v.page} | — | load error: ${v.error} |||||||||\n`; continue; }
    if (!v.elements.length) { md += `| ${v.viewport} | ${v.page} | ${v.matches} | not found ||||||||| \n`; continue; }
    for (const e of v.elements) {
      if (!e.visible) { md += `| ${v.viewport} | ${v.page} | ${v.matches} | (match ${e.index} not visible) |||||||||\n`; continue; }
      const res = e.contrast.passes === null ? "not reliably measurable" : e.contrast.passes ? "meets 1.4.3" : "**below 1.4.3**";
      md += `| ${v.viewport} | ${v.page} | ${v.matches} | ${e.text.replace(/\|/g, "\\|")} | ${e.location.landmark}, y=${e.location.pageY}px | ${e.contrast.foreground} | ${e.contrast.background} | ${e.contrast.ratio ?? `~${e.contrast.estimatedRatio}`}:1 | ${e.axe ? `${e.axe.ratio}:1` : "—"} | ${e.contrast.requiredRatio}:1 | ${res} | ${e.screenshots[0] || "—"} |\n`;
    }
  }
  const notes = [...new Set(r.viewports.flatMap((v) => (v.elements || []).flatMap((e) => e.contrast?.reliabilityNotes || [])))];
  if (notes.length) md += `\n**Measurement notes:** ${notes.join("; ")}\n`;
  md += `\nWCAG: ${r.viewports.find((v) => v.elements?.[0]?.contrast)?.elements[0].contrast.wcag || "SC 1.4.3 Contrast (Minimum), AA"}\n`;
  return md;
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  let manifest;
  try { manifest = loadManifest({ allowUnapproved: true }); } catch (e) { console.error(e.message); process.exit(1); }
  manifest._root = ROOT;
  let selector = args.selector, paths = args.paths ? String(args.paths).split(",") : null, groupId = args.group || null;
  if (groupId) { const t = targetFromGroup(ROOT, groupId); selector = t.selector; paths ??= t.paths; }
  if (!selector) { console.error("Usage: npm run investigate -- --selector '<css>' [--paths /,/pricing] | --group G-xxxxxxxx"); process.exit(2); }
  const r = await investigate({ manifest, selector, paths: paths || ["/"], viewports: args.viewports ? String(args.viewports).split(",") : undefined, groupId });
  if (r.status === "BLOCKED") { console.error(r.reason); process.exit(3); }
  console.log(r.conclusion);
  console.log(`\nEvidence: evidence/investigations/${r.investigationId}/investigation.md`);
}
