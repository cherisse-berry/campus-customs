// Classification of requests the public audit BLOCKED (never replayed).
// Uses only sanitized metadata already in the evidence: kind, method, host,
// path (query strings were redacted when recorded), resource type, viewport,
// and — from public-audit-2 on — the page and time.

const P = (purpose, effect, rationale, tests) => ({ purpose, effect, rationale, tests });
// effect: what blocking could have changed in what the audit observed.
//   none     — no expected effect on rendered content or accessibility
//   possible — could change UI state or variants seen by the agent
//   high     — could leave content or behaviour missing
//   intended — blocking IS the policy (writes the audit must not make)
const RULES = [
  P("form submission", "intended", "A form submit (e.g. early access, contact) was cancelled by policy; the page after submission was not observed.", (e) => e.method === "FORM-SUBMIT" || e.resourceType === "form"),
  P("analytics", "none", "Page-view / event analytics; no effect on rendered content.", (e) => /google-analytics\.com|analytics\.google\.com|googletagmanager\.com|doubleclick\.net|api\.segment\.io|cdn\.segment|api(-js)?\.mixpanel\.com|api2?\.amplitude\.com|plausible\.io|vitals\.vercel-insights\.com|\/_vercel\/(insights|speed-insights)|heapanalytics|rudderstack|matomo|\/g\/collect|\/collect$|\/(e|i\/v0\/e|batch|capture)\/?$|\/track$|\/events?$/i.test(e.host + e.path)),
  P("feature flags / remote configuration", "possible", "Flag or configuration lookup; without it the page may show a default variant that differs from what real visitors see.", (e) => /\/decide\/?$|\/flags\/?$|launchdarkly|statsig|growthbook|split\.io|optimizely|\/api\/feature/i.test(e.host + e.path)),
  P("error monitoring", "none", "Error/performance reporting; no effect on rendered content.", (e) => /sentry\.io|ingest\.|\/envelope\/?$|browser-intake-datadoghq|bugsnag|rollbar|nr-data\.net|newrelic/i.test(e.host + e.path)),
  P("session replay", "none", "Session-recording upload; no effect on rendered content.", (e) => /hotjar|clarity\.ms|fullstory|logrocket|\/s\/?$/i.test(e.host + e.path)),
  P("security / CSP reporting", "none", "Browser security report; no effect on rendered content.", (e) => /csp-report|\/report(-uri)?\/?$|reporting/i.test(e.path)),
  P("consent management", "possible", "Consent choice could not be saved; a cookie banner or dialog may persist across pages (affects dialog, overlap and focus findings).", (e) => /cookiebot|onetrust|cookielaw|cookieyes|usercentrics|consent/i.test(e.host + e.path)),
  P("authentication / session", "none", "Session or token refresh; the audit is signed out by design.", (e) => /\/auth\/v1|identitytoolkit|securetoken|clerk|auth0|\/api\/auth|\/token\/?$/i.test(e.host + e.path)),
  P("chat / support widget", "possible", "Widget initialisation; a chat launcher may be missing from what the agent saw.", (e) => /intercom|crisp\.chat|drift|tawk|hubspot|hsforms|zendesk|livechat/i.test(e.host + e.path)),
  P("application API / server action (same site)", "high", "A same-site write on page load (API call or server action); content or state that depends on it may have been missing.", (e) => e.sameSite),
];

export function classifyBlocked(e) {
  const r = RULES.find((x) => x.tests(e));
  return r ? { purpose: r.purpose, effect: r.effect, rationale: r.rationale } : { purpose: "unknown", effect: "unknown", rationale: "Purpose not recognisable from host and path." };
}

export function normalizeBlocked(b, allowedHosts = []) {
  let host = "", p = "";
  try { const u = new URL(b.url); host = u.hostname; p = u.pathname; } catch { p = String(b.url || ""); }
  return { kind: b.kind, method: b.method || "", resourceType: b.resourceType || "", host, path: p, viewport: b.viewport || null, page: b.page || null, at: b.at || null, sameSite: allowedHosts.includes(host) };
}

export function analyzeBlocked(runs) {
  const out = [];
  for (const r of runs.filter((x) => x.kind === "public-audit")) {
    const hosts = (r.target ? [new URL(r.target).hostname] : []).concat(r.limits?.allowedHosts || []);
    const all = r.blockedRequests || [];
    const writes = all.filter((b) => b.kind === "write-request");
    const rows = writes.map((b) => { const n = normalizeBlocked(b, hosts); return { ...n, ...classifyBlocked(n) }; });
    const byPurpose = {};
    for (const x of rows) {
      const k = x.purpose;
      byPurpose[k] ??= { purpose: k, effect: x.effect, rationale: x.rationale, count: 0, endpoints: new Map(), methods: new Set(), viewports: new Set(), pages: new Set() };
      const g = byPurpose[k];
      g.count++; g.methods.add(x.method); if (x.viewport) g.viewports.add(x.viewport); if (x.page) g.pages.add(x.page);
      const ep = `${x.method} ${x.host}${x.path}`;
      g.endpoints.set(ep, (g.endpoints.get(ep) || 0) + 1);
    }
    const groups = Object.values(byPurpose).map((g) => ({ ...g, endpoints: [...g.endpoints].sort((a, b) => b[1] - a[1]), methods: [...g.methods], viewports: [...g.viewports], pages: [...g.pages] })).sort((a, b) => b.count - a.count);
    const pageAttribution = writes.length ? writes.every((b) => b.page) : true;
    const limitations = [];
    for (const g of groups.filter((x) => ["possible", "high", "unknown"].includes(x.effect))) limitations.push(`${g.count} blocked ${g.purpose} request(s): ${g.rationale}${g.pages.length ? ` Pages: ${g.pages.slice(0, 8).join(", ")}.` : ""}`);
    if (writes.length && !pageAttribution) limitations.push("Blocked requests in this run were not recorded with the page that sent them (public-audit-1 limitation, fixed in public-audit-2), so page-level effects cannot be established from this evidence.");
    out.push({ runId: r.runId, harnessVersion: r.harnessVersion || "public-audit-1", totalBlocked: all.length, writeRequests: writes.length, otherBlocked: all.length - writes.length, otherKinds: all.filter((b) => b.kind !== "write-request").reduce((m, b) => ({ ...m, [b.kind]: (m[b.kind] || 0) + 1 }), {}), groups, pageAttribution, limitations, rows });
  }
  return out;
}

export function blockedMarkdown(analyses) {
  let md = "# Blocked requests — purpose and audit validity\n\nThe public audit blocks every non-GET request in the browser. These requests were **never sent to EQUITAS and are not replayed**. Purposes are inferred from sanitized metadata only (method, host, path, resource type); request bodies and headers were never recorded.\n\n";
  if (!analyses.length) return md + "No public audit runs in the evidence.\n";
  for (const a of analyses) {
    md += `## ${a.runId} (${a.harnessVersion})\n\n- Blocked: ${a.totalBlocked} (write requests: ${a.writeRequests}${a.otherBlocked ? `; other: ${Object.entries(a.otherKinds).map(([k, v]) => `${v} ${k}`).join(", ")}` : ""})\n- Page attribution: ${a.pageAttribution ? "recorded" : "**not recorded** (harness limitation)"}\n\n| Likely purpose | Requests | Methods | Effect on what the audit observed | Main endpoints (host + path) |\n|---|---|---|---|---|\n`;
    for (const g of a.groups) md += `| ${g.purpose} | ${g.count} | ${g.methods.join(", ")} | **${g.effect}** — ${g.rationale} | ${g.endpoints.slice(0, 4).map(([e, n]) => `${e} ×${n}`).join("; ")} |\n`;
    md += `\n**Validity limitations:**\n${a.limitations.length ? a.limitations.map((l) => `- ${l}`).join("\n") : "- None identified: every blocked request is of a kind not expected to change the rendered page."}\n\n`;
  }
  return md;
}
