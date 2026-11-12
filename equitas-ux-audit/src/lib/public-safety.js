// Production-safety layer for the PUBLIC (signed-out) website audit.
//
// The public audit only reads. These guards make that a property of the
// browser, not a promise of the code that drives it:
//   1. No saved session is ever loaded (public visitor only).
//   2. Every request that could write is aborted before it leaves the
//      browser: any method other than GET/HEAD/OPTIONS, to ANY host. That
//      covers form submissions (early access, demo requests, newsletters),
//      fetch/XHR posts, and analytics beacons.
//   3. Top-level navigation to protected or transactional paths (sign-in,
//      app, admin, account, checkout, billing, API, logout …) is aborted, so
//      those routes are never requested at all.
//   4. Payment/checkout hosts are blocked outright.
// Each block is recorded so the report can show what was prevented.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const DEFAULT_PROTECTED_PATTERNS = [
  "^/(app|dashboard|admin|founder|account|accounts|settings|profile|billing|checkout|subscribe|subscription|payment|payments|cart|orders?)(/|$)",
  "^/(login|log-in|signin|sign-in|signup|sign-up|register|logout|log-out|signout|sign-out|auth|oauth|sso|callback|verify|reset-password|forgot-password|invite|onboarding)(/|$)",
  "^/(api|graphql|trpc|_actions?|webhooks?)(/|$)",
  "^/(projects?|workspace|studio|studios|advisor|incidents?|brief)(/|$)",
];
export const DEFAULT_BLOCKED_HOSTS = ["checkout.stripe.com", "billing.stripe.com", "buy.stripe.com", "js.stripe.com/v3/checkout", "paypal.com", "www.paypal.com"];

export function publicAuditConfig(manifest) {
  const c = manifest.publicAudit || {};
  return {
    maxPages: c.maxPages ?? 40,
    maxDepth: c.maxDepth ?? 4,
    maxPageLoads: c.maxPageLoads ?? 200,
    delayMs: c.delayMs ?? 2000,
    navTimeoutMs: c.navTimeoutMs ?? 30000,
    viewports: c.viewports ?? ["desktop", "tablet", "mobile", "reflow320"],
    protectedPathPatterns: [...DEFAULT_PROTECTED_PATTERNS, ...(c.extraProtectedPathPatterns || [])],
    blockedHosts: [...DEFAULT_BLOCKED_HOSTS, ...(c.extraBlockedHosts || [])],
    seedPaths: c.seedPaths ?? ["/"],
    useSitemap: c.useSitemap ?? true,
    respectRobots: c.respectRobots ?? true,
    keyboardTabStops: c.keyboardTabStops ?? 40,
    expectedPages: c.expectedPages ?? DEFAULT_EXPECTED_PAGES,
  };
}

// The pages the founder expects to exist. Matched against discovered pages by
// path or link text; never requested by guessing URLs.
export const DEFAULT_EXPECTED_PAGES = [
  { name: "Homepage", match: ["^/$"] },
  { name: "For Researchers", match: ["researcher"] },
  { name: "For Institutions", match: ["institution"] },
  { name: "Pricing", match: ["pricing", "plans?"] },
  { name: "How It Works", match: ["how-it-works", "how it works"] },
  { name: "Research Journey: Imagine", match: ["imagine"] },
  { name: "Research Journey: Design", match: ["journey.*design", "/design"] },
  { name: "Research Journey: Compete", match: ["compete"] },
  { name: "Research Journey: Review", match: ["journey.*review", "/review"] },
  { name: "Research Journey: Manage", match: ["journey.*manage", "/manage"] },
  { name: "Research Journey: Transform", match: ["transform"] },
  { name: "Resources", match: ["resources?"] },
  { name: "Guides", match: ["guides?"] },
  { name: "FAQ", match: ["faqs?"] },
  { name: "About", match: ["about"] },
  { name: "Mission", match: ["mission"] },
  { name: "Early Access", match: ["early-access", "early access", "waitlist"] },
  { name: "Privacy Policy", match: ["privacy"] },
  { name: "Terms of Service", match: ["terms"] },
  { name: "Accessibility statement", match: ["accessibility"] },
  { name: "Data Security", match: ["security"] },
];

export function isProtectedPath(pathname, cfg) {
  return cfg.protectedPathPatterns.some((p) => new RegExp(p, "i").test(pathname));
}

function hostBlocked(u, cfg) {
  try {
    const url = new URL(u);
    return cfg.blockedHosts.some((h) => {
      const [host, ...rest] = h.split("/");
      return (url.hostname === host || url.hostname.endsWith("." + host)) && (!rest.length || url.pathname.startsWith("/" + rest.join("/")));
    });
  } catch { return false; }
}

// Install AFTER installNavigationGuard: Playwright runs the most recently
// registered handler first, and fallback() hands safe requests on to it.
export async function installPublicSafety(context, manifest, cfg, onBlocked) {
  const allowed = new Set(manifest.target.allowedHosts.map((h) => h.toLowerCase()));
  // Layer 1 (in the page): cancel form submissions before they start, so a
  // page whose script auto-submits stays intact and auditable. Layer 2 below
  // still aborts any write request that gets through.
  await context.exposeBinding("__uxauditFormBlocked", (_src, info) => onBlocked?.({ kind: "write-request", method: "FORM-SUBMIT", url: info?.action || "(form)", resourceType: "form", inPage: true })).catch(() => {});
  await context.addInitScript(() => {
    const report = (f) => { try { window.__uxauditFormBlocked?.({ action: f?.getAttribute?.("action") || location.pathname }); } catch {} };
    document.addEventListener("submit", (e) => { e.preventDefault(); e.stopImmediatePropagation(); report(e.target); }, true);
    HTMLFormElement.prototype.submit = function () { report(this); };
    HTMLFormElement.prototype.requestSubmit = function () { report(this); };
  });
  await context.route("**/*", async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = req.url();
    if (!SAFE_METHODS.has(method)) {
      onBlocked?.({ kind: "write-request", method, url, resourceType: req.resourceType() });
      return route.abort("blockedbyclient");
    }
    if (hostBlocked(url, cfg)) {
      onBlocked?.({ kind: "payment-host", method, url, resourceType: req.resourceType() });
      return route.abort("blockedbyclient");
    }
    let nav = false;
    try { nav = req.isNavigationRequest(); } catch {}
    if (nav) {
      try {
        const u = new URL(url);
        if (allowed.has(u.hostname.toLowerCase()) && isProtectedPath(u.pathname, cfg)) {
          onBlocked?.({ kind: "protected-route", method, url, resourceType: "document" });
          return route.abort("blockedbyclient");
        }
      } catch {}
    }
    return route.fallback();
  });
}

// The only clicks the public audit makes: opening/closing a navigation menu.
// The control must declare itself a disclosure (aria-expanded or
// aria-controls), live in a header/nav, have a menu-like name, and not be a
// link, submit button or anything inside a form.
export async function isSafeMenuToggle(locator) {
  return locator
    .evaluate((el) => {
      const name = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim();
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute("type") || "").toLowerCase();
      return {
        ok:
          (el.hasAttribute("aria-expanded") || el.hasAttribute("aria-controls")) &&
          !!el.closest("header, nav, [role=banner], [role=navigation]") &&
          /\b(menu|navigation|nav|open menu|toggle)\b/i.test(name) &&
          tag !== "a" && type !== "submit" && !el.closest("form"),
        name,
      };
    })
    .catch(() => ({ ok: false, name: "" }));
}
