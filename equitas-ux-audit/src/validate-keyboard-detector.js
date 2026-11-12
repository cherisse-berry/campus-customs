// Independent validation of the keyboard-trap detectors against the reference
// set in selftest/keyboard-reference/cases.json (expected verdicts written from
// WCAG 2.1.2, not from the detector). Offline: two local servers, one per origin.
//
//   npm run validate-keyboard     → reports/keyboard-detector-validation.md (+ .json)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright";
import { ROOT, isMain } from "./lib/manifest.js";
import { keyboardV1, keyboardV2, VERDICT_OF } from "./lib/keyboard.js";

const REF_DIR = path.join(ROOT, "selftest", "keyboard-reference");

export function loadReference(refDir = REF_DIR) {
  const file = path.join(refDir, "cases.json");
  const text = fs.readFileSync(file, "utf8");
  const sha = crypto.createHash("sha256").update(text).digest("hex");
  const expectedSha = fs.readFileSync(path.join(refDir, "EXPECTED_SHA256"), "utf8").trim();
  return { ...JSON.parse(text), sha256: sha, expectedSha256: expectedSha, intact: sha === expectedSha };
}

function generated(kind) {
  const cls = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2";
  if (kind === "longPage") return Array.from({ length: 120 }, (_, i) => `<p>Paragraph ${i + 1} with a <a href='#l${i}'>link ${i + 1}</a>.</p>`).join("");
  if (kind === "identicalMarkup") return Array.from({ length: 12 }, (_, i) => `<button class="${cls}" type="button">Action ${i + 1}</button>`).join(" ");
  throw new Error(`unknown generator ${kind}`);
}

const toVerdict = (r) => (r.version === "keyboard-v1" ? (r.error ? "INCONCLUSIVE" : r.trap ? "VIOLATION" : "NOT_A_VIOLATION") : r.verdict || VERDICT_OF[r.classification] || "INCONCLUSIVE");
export function score(expected, predicted) {
  if (expected === predicted) return "correct";
  if (predicted === "VIOLATION" && expected === "NOT_A_VIOLATION") return "false positive";
  if (predicted === "NOT_A_VIOLATION" && expected === "VIOLATION") return "false negative";
  if (predicted === "INCONCLUSIVE") return "inconclusive (expected a determination)";
  return "overclaim (expected inconclusive)";
}

export async function validateKeyboardDetectors({ maxPresses = 40, write = true, outDir = path.join(ROOT, "reports") } = {}) {
  const ref = loadReference();
  if (!ref.intact) throw new Error(`Reference set has been modified (sha256 ${ref.sha256} ≠ recorded ${ref.expectedSha256}). Review the change; update EXPECTED_SHA256 only in a reviewed commit.`);
  const pages = new Map(ref.cases.map((c) => [c.id, c]));
  const x = http.createServer((req, res) => {
    const id = req.url.replace(/^\//, "").split("?")[0];
    const body = ref._crossOriginFrames[id];
    res.writeHead(body ? 200 : 404, { "content-type": "text/html" });
    res.end(body ? `<!doctype html><html lang="en"><body>${body}</body></html>` : "nf");
  }).listen(0);
  const xorigin = `http://localhost:${x.address().port}`;
  const main = http.createServer((req, res) => {
    const c = pages.get(req.url.replace(/^\/case\//, "").split("?")[0]);
    if (!c) { res.writeHead(404); return res.end("nf"); }
    const html = (c.generate ? generated(c.generate) : c.html).replaceAll("{{XORIGIN}}", xorigin);
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html lang="en"><head><title>${c.id}</title></head><body>${html}</body></html>`);
  }).listen(0);
  const base = `http://127.0.0.1:${main.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const results = [];
  try {
    for (const c of ref.cases) {
      const row = { id: c.id, category: c.category, expected: c.expected };
      for (const [name, fn] of [["v1", keyboardV1], ["v2", keyboardV2]]) {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(`${base}/case/${c.id}`, { waitUntil: "load" });
        await page.waitForTimeout(400);
        const r = await fn(page, maxPresses);
        await ctx.close();
        const predicted = toVerdict(r);
        row[name] = { predicted, outcome: score(c.expected, predicted), classification: r.classification, reason: r.reason || (r.trap ? "v1 heuristic: repeated identity or ≤3 identities at Tab budget" : "v1: no repeat detected"), presses: r.presses ?? r.stops?.length, transcript: r.transcript?.map((t) => `${t.key} → ${t.focusText}`) };
      }
      results.push(row);
    }
  } finally {
    await browser.close().catch(() => {});
    main.close(); x.close();
  }
  const tally = (k) => {
    const t = { cases: results.length, correct: 0, "false positive": 0, "false negative": 0, "inconclusive (expected a determination)": 0, "overclaim (expected inconclusive)": 0 };
    for (const r of results) t[r[k].outcome]++;
    return t;
  };
  const expectedCounts = results.reduce((m, r) => ({ ...m, [r.expected]: (m[r.expected] || 0) + 1 }), {});
  const out = {
    at: new Date().toISOString(), referenceSha256: ref.sha256, maxPresses, expectedCounts, v1: tally("v1"), v2: tally("v2"), results,
    statisticalNote: `The reference set has ${results.length} cases (${Object.entries(expectedCounts).map(([k, v]) => `${v} ${k}`).join(", ")}). That is too few for meaningful sensitivity, specificity or error-rate estimates; statistical performance has NOT been established. The results show agreement on these scenarios only.`,
  };
  if (write) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "keyboard-detector-validation.json"), JSON.stringify(out, null, 2));
    fs.writeFileSync(path.join(outDir, "keyboard-detector-validation.md"), markdown(out));
  }
  return out;
}

function markdown(o) {
  const row = (t) => `${t.correct} correct · ${t["false positive"]} false positive · ${t["false negative"]} false negative · ${t["inconclusive (expected a determination)"]} inconclusive where a determination was expected · ${t["overclaim (expected inconclusive)"]} determinations where inconclusive was expected`;
  let md = `# Keyboard-trap detector validation\n\nReference set: \`selftest/keyboard-reference/cases.json\` (sha256 ${o.referenceSha256}). Expected verdicts were written from WCAG 2.2 SC 2.1.2 before the v2 detector existed; detectors never read them.\n\n- **v1** (used in the live audit up to commit b2c5c6a): ${row(o.v1)}\n- **v2** (current): ${row(o.v2)}\n\n> ${o.statisticalNote}\n\n| Case | Scenario | Expected | v1 | v2 | v2 reason |\n|---|---|---|---|---|---|\n`;
  for (const r of o.results) md += `| ${r.id} | ${r.category} | ${r.expected} | ${r.v1.predicted}${r.v1.outcome === "correct" ? "" : ` (**${r.v1.outcome}**)`} | ${r.v2.predicted}${r.v2.outcome === "correct" ? "" : ` (**${r.v2.outcome}**)`} | ${(r.v2.reason || "").replace(/\|/g, "\\|")} |\n`;
  md += "\n## v2 key-press transcripts (abridged)\n\n";
  for (const r of o.results) md += `- **${r.id}**: ${(r.v2.transcript || []).slice(0, 14).join(" · ")}${(r.v2.transcript || []).length > 14 ? " …" : ""}\n`;
  return md;
}

if (isMain(import.meta.url)) {
  const o = await validateKeyboardDetectors();
  console.log(`v1: ${JSON.stringify(o.v1)}\nv2: ${JSON.stringify(o.v2)}\n${o.statisticalNote}\nWrote reports/keyboard-detector-validation.md`);
  if (o.v2["false positive"] || o.v2["false negative"]) process.exit(1);
}
