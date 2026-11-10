// What the blinded agent is allowed to see: the rendered page as exposed by
// accessibility semantics (roles + visible/accessible names). No hidden DOM
// attributes, test IDs, source code, or route lists are given to the agent.
import { redact, redactUrl } from "./redact.js";

const PLAN_PAGE = /(choose|select|pick)\s+(your|a)\s+plan|pricing|subscription plans?/i;
const MAX_SNAPSHOT_CHARS = 14000;

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
  const truncated = snapshot.length > MAX_SNAPSHOT_CHARS;
  if (truncated) snapshot = snapshot.slice(0, MAX_SNAPSHOT_CHARS) + "\n…[truncated]";
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
export async function resolve(page, { role, name, index = 0 }) {
  if (!role) return { error: "no role given" };
  const loc = page.getByRole(role, name ? { name, exact: true } : {});
  let count = await loc.count().catch(() => 0);
  let target = loc;
  if (count === 0 && name) {
    target = page.getByRole(role, { name, exact: false });
    count = await target.count().catch(() => 0);
  }
  if (count === 0) return { error: `No visible ${role} named "${name}"` };
  const el = target.nth(Math.min(index, count - 1));
  if (!(await el.isVisible().catch(() => false))) return { error: `${role} "${name}" exists but is not visible` };
  const info = await el
    .evaluate((node) => {
      const card = node.closest("article, section, li, [class*=card], [class*=plan], [class*=tier]");
      return {
        href: node.closest("a")?.href || null,
        inputType: node.getAttribute("type") || null,
        autocomplete: node.getAttribute("autocomplete") || null,
        disabled: node.disabled === true || node.getAttribute("aria-disabled") === "true",
        containerText: card ? card.innerText.slice(0, 600) : "",
      };
    })
    .catch(() => ({}));
  return { el, count, ...info };
}

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
