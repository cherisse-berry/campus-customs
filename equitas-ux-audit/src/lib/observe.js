// What the blinded agent is allowed to see: the rendered page as exposed by
// accessibility semantics (roles + visible/accessible names). No hidden DOM
// attributes, test IDs, source code, or route lists are given to the agent.
import crypto from "node:crypto";
import { redact, redactUrl } from "./redact.js";

const PLAN_PAGE = /(choose|select|pick)\s+(your|a)\s+plan|pricing|subscription plans?/i;
// Long pages: the agent gets the start and end of the tree in full, plus a
// complete list of every visible control, so a button low on the page is never
// hidden by truncation. `truncated` is recorded so failures can be attributed.
const MAX_SNAPSHOT_CHARS = 30000;
const HEAD_CHARS = 18000;
const TAIL_CHARS = 6000;

export async function observe(page) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(800);
  let snapshot = "";
  try {
    snapshot = await page.locator("body").ariaSnapshot({ timeout: 8000 });
  } catch (e) {
    snapshot = `[ariaSnapshot failed: ${e.message.split("\n")[0]}]`;
  }
  snapshot = redact(snapshot);
  const fullLength = snapshot.length;
  // Hash of the full tree: identical hashes on consecutive steps mean the
  // page did not change (objective "no progress" signal).
  const hash = crypto.createHash("sha1").update(snapshot).digest("hex").slice(0, 12);
  const truncated = fullLength > MAX_SNAPSHOT_CHARS;
  if (truncated) {
    const controls = await visibleControls(page).catch(() => []);
    const list = [...new Map(controls.filter((c) => c.name).map((c) => [`${c.role}|${c.name}`, `- ${c.role} "${c.name}"${c.disabled ? " [disabled]" : ""}`])).values()].join("\n");
    snapshot = `${snapshot.slice(0, HEAD_CHARS)}\n…[middle of page omitted: ${fullLength - HEAD_CHARS - TAIL_CHARS} chars]…\n${snapshot.slice(-TAIL_CHARS)}\n\nALL VISIBLE CONTROLS ON THIS PAGE (complete list):\n${list}`;
  }
  const headings = await page
    .getByRole("heading")
    .allInnerTexts()
    .catch(() => []);
  const title = await page.title().catch(() => "");
  const onPlanPage = PLAN_PAGE.test(headings.join(" | ")) || PLAN_PAGE.test(title);
  const alerts = await page.getByRole("alert").allInnerTexts().catch(() => []);
  return {
    url: redactUrl(page.url()),
    title: redact(title),
    headings: headings.map(redact).slice(0, 30),
    alerts: alerts.map(redact),
    onPlanPage,
    snapshot,
    truncated,
    fullLength,
    hash,
  };
}

// The main readable content, used to capture EQUITAS's scientific responses.
export async function mainText(page) {
  for (const sel of ["main", "[role=main]", "body"]) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      return redact(await loc.innerText({ timeout: 5000 }).catch(() => ""));
    }
  }
  return "";
}

// Resolve an element exactly the way a sighted/AT user would describe it.
// Safety rules:
//  - A name is required: an unnamed control can't be judged, so it is never acted on.
//  - Exact name match first. A partial match is accepted only when it is the
//    single visible candidate, and the guard then checks the element's REAL
//    name, never the name the agent typed.
export async function resolve(page, { role, name, index = 0 }) {
  if (!role) return { error: "no role given" };
  if (!name || !name.trim()) return { error: `refused: no accessible name given for ${role}; unnamed controls are never clicked`, unnamed: true };
  let target = page.getByRole(role, { name, exact: true });
  let count = await target.count().catch(() => 0);
  let matchedBy = "exact";
  if (count === 0) {
    target = page.getByRole(role, { name, exact: false });
    count = await target.count().catch(() => 0);
    matchedBy = "partial";
    if (count > 1) return { error: `refused: "${name}" only partly matches ${count} different ${role}s; name the control exactly`, ambiguous: true };
  }
  if (count === 0) return { error: `No visible ${role} named "${name}"` };
  const el = target.nth(Math.min(index, count - 1));
  if (!(await el.isVisible().catch(() => false))) return { error: `${role} "${name}" exists but is not visible` };
  const info = await el
    .evaluate((node) => {
      const text = (s) => (s || "").replace(/\s+/g, " ").trim();
      const byId = (id) => text(document.getElementById(id)?.innerText);
      const lb = node.getAttribute("aria-labelledby");
      const actualName = text(
        node.getAttribute("aria-label") ||
          (lb ? lb.split(/\s+/).map(byId).join(" ") : "") ||
          (node.labels && node.labels[0] ? node.labels[0].innerText : "") ||
          node.innerText || node.value || node.getAttribute("title") || node.getAttribute("alt") || node.getAttribute("placeholder")
      );
      const card = node.closest("article, section, li, [class*=card], [class*=plan], [class*=tier]");
      return {
        actualName: actualName.slice(0, 200),
        // Visible text plus tooltip/labels, so an icon button labelled "Delete" is still caught.
        actualText: text([node.innerText, node.getAttribute("aria-label"), node.getAttribute("title"), node.getAttribute("aria-description"), node.value].filter(Boolean).join(" ")).slice(0, 300),
        href: node.closest("a")?.href || null,
        inputType: node.getAttribute("type") || null,
        autocomplete: node.getAttribute("autocomplete") || null,
        disabled: node.disabled === true || node.getAttribute("aria-disabled") === "true",
        containerText: card ? card.innerText.slice(0, 600) : "",
      };
    })
    .catch(() => ({ actualName: "", actualText: "" }));
  return { el, count, matchedBy, ...info };
}

// Sign-in verification lives in auth.js (application-specific markers).
// The old control-overlap heuristic was removed: it compared different pages
// and let an unverified public homepage pass as signed in.

// Read-only inventory of visible controls (used by the deterministic plan probe).
export async function visibleControls(page) {
  const out = [];
  for (const role of ["button", "link", "tab", "menuitem", "checkbox", "radio", "combobox", "textbox"]) {
    const loc = page.getByRole(role);
    const n = Math.min(await loc.count().catch(() => 0), 80);
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const d = await el
        .evaluate((node) => ({
          name: (node.getAttribute("aria-label") || node.innerText || node.value || node.getAttribute("title") || node.getAttribute("placeholder") || "").trim().slice(0, 120),
          disabled: node.disabled === true || node.getAttribute("aria-disabled") === "true",
          href: node.closest("a")?.getAttribute("href") || null,
          inNav: !!node.closest("nav, header, [role=navigation], aside"),
        }))
        .catch(() => null);
      if (d) out.push({ role, ...d, name: redact(d.name) });
    }
  }
  return out;
}
