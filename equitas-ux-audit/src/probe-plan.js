// Section 11 — "Choose your plan" defect investigation (deterministic probe).
// This is a LABELLED NON-BLINDED diagnostic: it inventories what is visible
// and tests whether Settings is the only way past the plan screen. It does not
// select a plan unless the manifest AND the account explicitly allow it.
//
//   npm run probe-plan -- --account founder-admin [--viewports desktop,mobile] [--headed]
//   npm run probe-plan -- --public          (signed-out visitor; no account)
//   npm run probe-plan -- --account founder-admin --attended   (sign in now, probe in the same window)
import { loadManifest, getAccount, accountApprovedFor, parseArgs, ROOT, isMain } from "./lib/manifest.js";
import readline from "node:readline/promises";
import { chromium } from "playwright";
import { observe, visibleControls } from "./lib/observe.js";
import { Evidence, openBrowser, runId, installNavigationGuard, contextOptions, VIEWPORTS } from "./lib/evidence.js";
import { AUTH, sessionPreflight, verifySession, verifyOnPage, authAllowsConclusions, resolveMarkers, readMeta } from "./lib/auth.js";
import { acquireLock } from "./lib/safety.js";
import { buildFingerprint, deploymentChanged, axeScan, reflowCheck, priorUseSignals } from "./lib/diagnostics.js";
import { redactUrl } from "./lib/redact.js";

const MONEY = /(\$|€|£|\/\s?mo\b|per month|per year|annual)/i;
const PLAN_CTA = /\b(select|choose|start|get started|continue with|activate|subscribe|try|trial|upgrade)\b/i;
const ESCAPE_CTA = /\b(continue|skip|later|dashboard|go to|enter|home|back|not now|explore|maybe later|close)\b/i;
const MODULES = /\b(advisor|project|evidence|funding|studio|incident|brief|settings)\b/i;

// Attended mode: the founder signs in, in a visible window, and the probe runs
// in that same browser straight away. Nothing is saved. Needed when EQUITAS
// keeps its sign-in only in sessionStorage. Tests pass their own function.
async function attendedSignIn(page, manifest) {
  if (!process.stdin.isTTY) return { ok: false, reason: "Attended mode needs an interactive terminal." };
  await page.goto(manifest.target.baseUrl, { waitUntil: "domcontentloaded" });
  console.log("\nATTENDED MODE: a browser window is open with no saved session.\nSign in there yourself, including MFA, and stop on the first screen EQUITAS shows. Then press Enter here.\nThe probe will run in this same window; nothing is saved.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Press Enter once signed in… ");
  rl.close();
  let landed = "/";
  try { const u = new URL(page.url()); landed = u.pathname + u.search; } catch {}
  return { ok: true, landedOnPath: landed };
}

export async function probePlan({ manifest, accountId, publicVisitor = false, viewports = ["desktop", "mobile", "reflow320"], headed = false, attended = false, attendedLogin }) {
  manifest ??= loadManifest();
  manifest._root ??= ROOT;
  const account = publicVisitor ? { id: "public-visitor", actualRole: "none (signed out)", actualEntitlement: "none", accountState: "signed-out" } : getAccount(manifest, accountId);
  if (!publicVisitor && !accountApprovedFor(account, "probe-plan")) throw new Error(`Account ${account.id} is not approved for probe-plan.`);
  const pw = manifest.permittedWorkflows || {};
  if (!publicVisitor && !pw.navigateAuthenticatedPages) throw new Error("Signed-in browsing is not permitted (permittedWorkflows.navigateAuthenticatedPages=false).");
  if (publicVisitor && !pw.navigatePublicPages) throw new Error("Public-page browsing is not permitted (permittedWorkflows.navigatePublicPages=false).");
  const ev = new Evidence(manifest, runId(`UXTEST-PLANPROBE-${account.id}`), {
    kind: "probe-plan", blinded: false, labelledAs: "DETERMINISTIC_DIAGNOSTIC (not a blinded user test)", harnessAuthVersion: 2,
    account: { id: account.id, actualRole: account.actualRole, actualEntitlement: account.actualEntitlement, accountState: account.accountState, serverSideNewUser: !!account.serverSideNewUser },
    target: manifest.target.baseUrl, mode: publicVisitor ? "public" : attended ? "attended" : "saved-session",
  });

  // ---- Step 1: saved-session checks that need no site visit ----
  let pre = null;
  if (!publicVisitor) {
    if (attended) {
      const meta = readMeta(manifest._root, account.id);
      pre = { status: "READY", meta, markers: resolveMarkers(manifest, account, meta), reasons: [] };
    } else {
      pre = sessionPreflight(manifest, account);
      ev.run.auth = { preflight: pre.status, reasons: pre.reasons };
      if (pre.status !== "READY") {
        ev.run.regression = { status: "BLOCKED", reason: `${pre.status}: ${pre.reasons.join(" ")}` };
        ev.finding({ category: "BLOCKED", severity: null, title: `Probe blocked: ${pre.status}`, observed: pre.reasons.join(" "), triage: "harness/session state — not an EQUITAS finding" });
        return ev.finish({ status: "BLOCKED", reason: `${pre.status}: ${pre.reasons.join(" ")} EQUITAS was not contacted.` });
      }
    }
  }

  const results = [];
  const lock = acquireLock(manifest, `probe-plan/${account.id}`);
  if (!lock.ok) throw new Error(`SESSION_LOCK: ${lock.reason}`);
  let shared = null; // attended mode: one browser for all viewports
  let stopReason = null;
  try {
    if (attended && !publicVisitor) {
      // A real attended sign-in always uses a visible window; only the
      // self-test (which injects attendedLogin) may run it headless.
      const browser = await chromium.launch({ headless: attendedLogin ? !headed : false, executablePath: process.env.PW_CHROMIUM_PATH || undefined });
      const context = await browser.newContext(contextOptions("desktop"));
      await installNavigationGuard(context, manifest, (b) => ev.step({ kind: "guard", blockedNavigation: b.url, popup: b.popup }));
      const page = await context.newPage();
      const s = await (attendedLogin || attendedSignIn)(page, manifest);
      if (!s.ok) {
        await browser.close().catch(() => {});
        ev.run.regression = { status: "BLOCKED", reason: `ATTENDED_SIGN_IN_NOT_COMPLETED: ${s.reason}` };
        return ev.finish({ status: "BLOCKED", reason: `ATTENDED_SIGN_IN_NOT_COMPLETED: ${s.reason}` });
      }
      if (!pre.markers.entryPath) pre.markers.entryPath = s.landedOnPath;
      shared = { browser, context, page, browserInfo: { name: "chromium", version: browser.version(), headless: !!attendedLogin && !headed, attended: true } };
    }

    for (const vp of viewports) {
      let browser, context, page, browserInfo, viewport;
      if (shared) {
        ({ browser, context, page, browserInfo } = shared);
        viewport = VIEWPORTS[vp] || VIEWPORTS.desktop;
        await page.setViewportSize(viewport);
      } else {
        ({ browser, context, viewport, browserInfo } = await openBrowser(manifest, { accountId: account.id, viewport: vp, headed, useAuth: !publicVisitor }));
        await installNavigationGuard(context, manifest, (b) => ev.step({ kind: "guard", viewport: vp, blockedNavigation: b.url, popup: b.popup }));
        page = await context.newPage();
      }
      ev.run.browser = browserInfo;
      // Close real pop-ups (pages opened by a page). Helper pages that tools such
      // as the accessibility scanner open themselves have no opener and are left alone.
      context.on("page", async (p) => { if (await p.opener().catch(() => null)) p.close().catch(() => {}); });
      ev.attach(page);
      page.on("dialog", (d) => d.dismiss().catch(() => {}));
      const r = { viewport: vp };
      try {
        // 1. What the site root shows (as if the address were typed).
        const resp = await page.goto(manifest.target.baseUrl, { waitUntil: "networkidle", timeout: 60000 }).catch(async () => page.goto(manifest.target.baseUrl, { waitUntil: "domcontentloaded" }));
        r.redirectChain = chain(resp?.request());
        const rootObs = await observe(page);
        r.root = { url: rootObs.url, title: rootObs.title, headings: rootObs.headings, onPlanPage: rootObs.onPlanPage, screenshot: await ev.screenshot(page, `${vp}-root`) };
        let entryUrl = manifest.target.baseUrl;

        if (!publicVisitor) {
          // What the root shows to this session (informational only).
          r.root.signedInEvidence = (await verifyOnPage(page, manifest, account, pre)).signedInMarkersSeen;
          // 2. Verify sign-in ONCE, on the page EQUITAS showed after sign-in.
          r.auth = await verifySession(page, manifest, account, pre);
          r.authConclusive = authAllowsConclusions(r.auth.status, account, manifest);
          entryUrl = new URL(r.auth.entryPath, manifest.target.baseUrl).toString();
          if (r.auth.status === AUTH.REJECTED) {
            r.landingScreenshot = await ev.screenshot(page, `${vp}-session-rejected`);
            stopReason = `${AUTH.REJECTED}: ${r.auth.reasons.join("; ")}`;
            throw new Error(`${stopReason}. The saved session is marked rejected and will not be reused; sign in again.`);
          }
          if (!r.authConclusive) r.authNote = `Authentication not established (${r.auth.status}). ${r.auth.reasons.join(" ")} Observations below are recorded for diagnosis only.`;
        }

        // 3. The screen under test: post-sign-in page (or root for a public visitor).
        const obs = await observe(page);
        r.landing = { url: obs.url, title: obs.title, headings: obs.headings, onPlanPage: obs.onPlanPage, alerts: obs.alerts, isPostSignInPage: !publicVisitor };
        r.landingScreenshot = await ev.screenshot(page, `${vp}-landing`);
        r.landingSnapshot = ev.saveSnapshot(obs.snapshot);
        r.build = await buildFingerprint(page, manifest);
        r.accessibility = await axeScan(page);
        if (vp === "reflow320") r.reflow = await reflowCheck(page);
        if (account.serverSideNewUser) r.priorUseSignals = await priorUseSignals(page, manifest.syntheticData?.recordPrefix);
        const controls = await visibleControls(page);
        r.controls = controls;

        // 4. Classify controls on the plan screen
        const planCtas = [], escapeCtas = [], navModules = [];
        for (const c of controls) {
          if (PLAN_CTA.test(c.name) || MONEY.test(c.name)) planCtas.push(c);
          else if (ESCAPE_CTA.test(c.name)) escapeCtas.push(c);
          if (MODULES.test(c.name)) navModules.push(c);
        }
        for (const c of planCtas) {
          const box = await page.getByRole(c.role, { name: c.name, exact: true }).first().boundingBox().catch(() => null);
          c.aboveFold = box ? box.y + box.height <= viewport.height : null;
        }
        r.classification = { planCtas, escapeCtas, navModules, disabledPlanCtas: planCtas.filter((c) => c.disabled).length };

        // 5. Settings workaround test (read-only navigation)
        const settings = controls.find((c) => /^settings$|account settings|^settings\b/i.test(c.name) && (c.role === "link" || c.role === "button" || c.role === "menuitem"));
        if (settings) {
          await page.getByRole(settings.role, { name: settings.name, exact: true }).first().click({ timeout: 10000 }).catch((e) => (r.settingsClickError = e.message.split("\n")[0]));
          await page.waitForLoadState("domcontentloaded").catch(() => {});
          await page.waitForTimeout(1500);
          const sObs = await observe(page);
          const sControls = await visibleControls(page);
          r.afterSettings = {
            url: sObs.url, headings: sObs.headings, onPlanPage: sObs.onPlanPage,
            moduleControlsNowVisible: sControls.filter((c) => MODULES.test(c.name)).map((c) => `${c.role}:${c.name}`),
            entitlementText: sObs.snapshot.split("\n").filter((l) => /plan|subscription|tier|entitle|license|trial/i.test(l)).slice(0, 15),
            screenshot: await ev.screenshot(page, `${vp}-after-settings`),
          };
          const mod = sControls.find((c) => /advisor|project/i.test(c.name) && !/new|create|add|delete|remove|start|submit|save/i.test(c.name) && (c.role === "link" || c.role === "tab" || (c.role === "button" && c.inNav)));
          if (mod) {
            await page.getByRole(mod.role, { name: mod.name, exact: true }).first().click({ timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(2000);
            const mObs = await observe(page);
            r.moduleFromSettings = { clicked: `${mod.role}:${mod.name}`, url: mObs.url, headings: mObs.headings, onPlanPage: mObs.onPlanPage, screenshot: await ev.screenshot(page, `${vp}-module-from-settings`) };
          }
          // 6. Does the plan gate come back on a fresh visit to the post-sign-in page?
          await page.goto(entryUrl, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(2000);
          const again = await observe(page);
          r.returnToRoot = { url: again.url, onPlanPage: again.onPlanPage, headings: again.headings, screenshot: await ev.screenshot(page, `${vp}-return-entry`) };
        } else {
          r.afterSettings = "No visible Settings control on the screen under test.";
        }

        // 7. Keyboard reachability of the screen under test
        await page.goto(entryUrl, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1500);
        const tabStops = [];
        for (let i = 0; i < 25; i++) {
          await page.keyboard.press("Tab");
          const f = await page.evaluate(() => {
            const a = document.activeElement;
            if (!a || a === document.body) return null;
            const s = getComputedStyle(a);
            return { tag: a.tagName.toLowerCase(), role: a.getAttribute("role"), name: (a.getAttribute("aria-label") || a.innerText || a.value || "").trim().slice(0, 60), visibleFocus: s.outlineStyle !== "none" || s.boxShadow !== "none" };
          });
          if (f) tabStops.push(f);
        }
        r.keyboardTabOrder = tabStops;
      } catch (e) {
        r.error = e.message.split("\n")[0];
      } finally {
        if (!shared) await browser.close().catch(() => {});
      }
      results.push(r);
      // Never present a rejected session again in the same run.
      if (stopReason) break;
    }
  } finally {
    if (shared) await shared.browser.close().catch(() => {});
    lock.release();
  }
  ev.run.probe = results;
  ev.run.auth = { ...(ev.run.auth || {}), perViewport: results.map((r) => ({ viewport: r.viewport, status: r.auth?.status, conclusive: r.authConclusive, entryPath: r.auth?.entryPath, signedInMarkersSeen: r.auth?.signedInMarkersSeen, founderMarkersSeen: r.auth?.founderMarkersSeen, signedOutEvidence: r.auth?.signedOutEvidence, reasons: r.auth?.reasons })) };
  const builds = results.map((r) => r.build).filter(Boolean);
  if (builds.length > 1 && builds.some((b) => deploymentChanged(builds[0], b))) {
    ev.finding({ category: "TEST_VALIDITY_WARNING", severity: null, title: "EQUITAS build changed between viewports", observed: JSON.stringify(builds), triage: "rerun the probe" });
  }
  for (const r of results) {
    if (r.auth && !r.authConclusive) {
      ev.finding({ category: "TEST_VALIDITY_WARNING", severity: null, title: `Authentication not established at ${r.viewport} (${r.auth.status})`, observed: (r.auth.reasons || []).join(" ") || r.error || "", triage: "harness/session state — results at this viewport cannot support conclusions about the founder pathway" });
    }
    for (const v of (r.accessibility?.violations || []).filter((x) => ["serious", "critical"].includes(x.impact)))
      ev.finding({ category: "ACCESSIBILITY_FINDING", severity: null, title: `axe: ${v.help}`, observed: `${v.id} (${v.impact}, ${v.wcag.join(", ")}) on the screen under test at ${r.viewport}: ${v.nodes} element(s)`, triage: "pending — automated rule; confirm manually" });
    if (r.reflow?.horizontalOverflowPx > 0)
      ev.finding({ category: "ACCESSIBILITY_FINDING", severity: null, title: "Content needs horizontal scrolling at 320 px (reflow)", observed: `Page is ${r.reflow.scrollWidth}px wide in a ${r.reflow.viewportWidth}px viewport; widest: ${r.reflow.widestElements.join(", ")}`, triage: "pending — WCAG 1.4.10 proxy; confirm with real zoom" });
    if (r.priorUseSignals?.length)
      ev.finding({ category: "TEST_VALIDITY_WARNING", severity: null, title: "Account labelled as new shows signs of prior use", observed: r.priorUseSignals.join("; "), triage: "confirm server-side state" });
  }
  ev.run.regression = regressionVerdict(results, account, publicVisitor, manifest);
  ev.run.interpretation = interpret(results, account, manifest);
  for (const f of ev.run.interpretation.draftFindings) ev.finding(f);
  if (stopReason) return ev.finish({ status: "BLOCKED", reason: `${stopReason}. Sign in again with npm run login.` });
  return ev.finish({ status: "COMPLETED", reason: "Probe finished; see authentication status, then interpretation (observations vs. hypotheses are separated)." });
}

// Section 26 — pass/fail regression check for the plan defect. The account's
// `expectPlanScreen` (manifest) says what correct behaviour is:
//   false → the account lands in the product, or the plan screen offers a
//           visible non-plan "Continue"-type exit. Settings-only access fails.
//   true  → the plan screen is shown with at least one enabled plan control.
// PASS or FAIL is given ONLY for viewports where authentication was established
// with application-specific evidence (and founder access, for founder accounts).
// Otherwise the viewport is inconclusive, and a rejected session BLOCKS the check.
export function regressionVerdict(results, account, publicVisitor, manifest = {}) {
  if (publicVisitor || account.expectPlanScreen === undefined) return { status: "NOT_APPLICABLE", reason: "No expectPlanScreen set for this account." };
  if (results.some((r) => r.auth?.status === AUTH.REJECTED)) return { status: "BLOCKED", reason: "EQUITAS rejected the saved session; nothing about the founder pathway was observed.", checks: results.map((r) => ({ viewport: r.viewport, pass: null, reason: r.error || r.auth?.status })) };
  const checks = results.map((r) => {
    if (r.error) return { viewport: r.viewport, pass: null, reason: r.error };
    if (!r.auth || !authAllowsConclusions(r.auth.status, account, manifest)) {
      return { viewport: r.viewport, pass: null, reason: `Authentication not established (${r.auth?.status || "not checked"}): ${(r.auth?.reasons || []).join(" ")}` };
    }
    if (account.expectPlanScreen === false) {
      if (!r.landing.onPlanPage) return { viewport: r.viewport, pass: true, reason: `Verified ${r.auth.status}; post-sign-in page is not the plan screen.` };
      const exits = r.classification.escapeCtas.filter((c) => !c.disabled);
      return exits.length
        ? { viewport: r.viewport, pass: true, reason: `Verified ${r.auth.status}; plan screen shown but offers: ${exits.map((c) => `"${c.name}"`).join(", ")}.` }
        : { viewport: r.viewport, pass: false, reason: `Verified ${r.auth.status}; plan screen shown with no visible non-plan way forward.` };
    }
    const enabled = (r.classification?.planCtas || []).filter((c) => !c.disabled);
    return r.landing.onPlanPage && enabled.length
      ? { viewport: r.viewport, pass: true, reason: "Plan screen shown with an enabled plan control." }
      : { viewport: r.viewport, pass: false, reason: r.landing.onPlanPage ? "All plan controls disabled." : "Expected a plan screen; none shown." };
  });
  const status = checks.some((c) => c.pass === null) ? "INCONCLUSIVE" : checks.every((c) => c.pass) ? "PASS" : "FAIL";
  return { status, expectPlanScreen: account.expectPlanScreen, checks };
}

function chain(req) {
  const out = [];
  for (let r = req; r; r = r.redirectedFrom()) out.unshift(redactUrl(r.url()));
  return out;
}

// Separates what was observed from what it might mean (Section 11, 19).
function interpret(results, account, manifest) {
  const obs = [], hypotheses = [], questions = [], draftFindings = [];
  for (const r of results) {
    if (r.auth) {
      obs.push(`[${r.viewport}] AUTHENTICATION: ${r.auth.status} on ${r.auth.url} (post-sign-in page ${r.auth.entryPath}). Signed-in markers seen: ${r.auth.signedInMarkersSeen?.join(", ") || "none"}; founder markers seen: ${r.auth.founderMarkersSeen?.join(", ") || "none"}; signed-out evidence: ${r.auth.signedOutEvidence?.join(", ") || "none"}.`);
    }
    if (r.error) { obs.push(`[${r.viewport}] Probe stopped: ${r.error}`); continue; }
    if (r.root) obs.push(`[${r.viewport}] Site root: ${r.root.url} — headings: ${r.root.headings.slice(0, 3).join(" | ") || "(none)"}${r.root.signedInEvidence ? ` — signed-in markers at root: ${r.root.signedInEvidence.join(", ") || "none"}` : ""}`);
    if (r.redirectChain?.length > 1) obs.push(`[${r.viewport}] Root redirect chain: ${r.redirectChain.join(" → ")}`);
    obs.push(`[${r.viewport}] Screen under test${r.landing.isPostSignInPage ? " (post-sign-in page)" : ""}: ${r.landing.url} — headings: ${r.landing.headings.slice(0, 4).join(" | ") || "(none)"} — plan screen: ${r.landing.onPlanPage}`);
    if (r.auth && !r.authConclusive) {
      obs.push(`[${r.viewport}] No conclusions drawn at this viewport: authentication was not established (${r.auth.status}).`);
      continue;
    }
    if (r.auth && r.root && r.root.signedInEvidence && !r.root.signedInEvidence.length && r.auth.signedInMarkersSeen?.length) {
      hypotheses.push(`[${r.viewport}] The site root (${r.root.url}) shows no signed-in markers even though the session is verified on ${r.auth.entryPath}. A signed-in founder who types the address may see the public homepage — a possible EQUITAS navigation/UX issue to confirm.`);
    }
    if (!r.landing.onPlanPage) continue;
    const c = r.classification;
    obs.push(`[${r.viewport}] Plan CTAs: ${c.planCtas.map((x) => `"${x.name}"${x.disabled ? " (disabled)" : ""}${x.aboveFold === false ? " (below fold)" : ""}`).join(", ") || "none visible"}`);
    obs.push(`[${r.viewport}] Non-plan exits: ${c.escapeCtas.map((x) => `"${x.name}"`).join(", ") || "none visible"}`);
    if (typeof r.afterSettings === "object") {
      obs.push(`[${r.viewport}] After Settings: ${r.afterSettings.url}, plan screen: ${r.afterSettings.onPlanPage}, module controls visible: ${r.afterSettings.moduleControlsNowVisible.join(", ") || "none"}`);
      if (r.moduleFromSettings) obs.push(`[${r.viewport}] Module reached from Settings: ${r.moduleFromSettings.clicked} → ${r.moduleFromSettings.url} (plan screen: ${r.moduleFromSettings.onPlanPage})`);
      obs.push(`[${r.viewport}] Back at root: plan screen shown again = ${r.returnToRoot.onPlanPage}`);
    }

    const noExit = c.escapeCtas.length === 0;
    const allPlanCtasDisabled = c.planCtas.length > 0 && c.planCtas.every((x) => x.disabled);
    const settingsBypass = typeof r.afterSettings === "object" && r.moduleFromSettings && !r.moduleFromSettings.onPlanPage;
    if (c.planCtas.length === 0) hypotheses.push(`[${r.viewport}] MISSING CALL TO ACTION: the plan screen shows no recognisable plan-selection control.`);
    if (allPlanCtasDisabled) hypotheses.push(`[${r.viewport}] SUBSCRIPTION PROVISIONING or ENTITLEMENT: all plan controls are disabled.`);
    if (c.planCtas.some((x) => x.aboveFold === false)) hypotheses.push(`[${r.viewport}] CONFUSING LAYOUT: plan controls are below the fold.`);
    if (settingsBypass) {
      hypotheses.push(`[${r.viewport}] DEFECTIVE ROUTING or INCORRECT ONBOARDING STATE: the product is reachable via Settings without choosing a plan, so the plan screen is not a hard entitlement gate for this account (${account.actualRole}/${account.actualEntitlement}).`);
      draftFindings.push({
        category: "OBSERVED_NAVIGATION_BLOCKER", severity: "P1 (proposed)", title: "Plan screen has no direct path forward; Settings is the observed workaround",
        affectedUsers: [`${account.actualRole} with entitlement ${account.actualEntitlement}`], viewport: r.viewport,
        observed: `Landing showed a plan screen with ${noExit ? "no" : c.escapeCtas.length} non-plan exit(s). Clicking Settings, then ${r.moduleFromSettings.clicked}, reached ${r.moduleFromSettings.url} without selecting a plan.`,
        expected: "An account that already has access goes straight to the product, or the plan screen offers a clear 'Continue' for the current plan.",
        evidence: [r.landingScreenshot, r.afterSettings.screenshot, r.moduleFromSettings.screenshot],
        suspectedCause: "Not confirmed (black-box). Candidates: onboarding-complete flag not set; entitlement check run before subscription state loads; plan screen used as default route.",
        triage: "pending — VENDOR_INVESTIGATION_REQUIRED",
      });
    } else if (noExit && c.planCtas.length) {
      hypotheses.push(`[${r.viewport}] Either a LEGITIMATE ENTITLEMENT RESTRICTION (account has no active plan) or MISSING CONTINUE ACTION (account has a plan). Account entitlement in manifest: ${account.actualEntitlement}.`);
    }
  }
  questions.push(
    "What server-side onboarding/entitlement state does this account have, and which route should it land on?",
    "Is the plan screen meant to appear for accounts that already have an active plan or founder role?",
    "Does selecting a plan create a subscription record, and is a free plan provisioned instantly or via the payment provider?",
    "Why is Settings reachable (and the product reachable from it) while the plan gate is active?",
  );
  if (!account.serverSideNewUser) questions.push("This probe used an EXISTING account; first-time-user behaviour needs a new server-side test account.");
  return { observations: obs, hypotheses, questionsForAppifest: questions, draftFindings, note: "Hypotheses are inferences from visible behaviour only; they are not confirmed root causes." };
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  const run = await probePlan({ accountId: args.account, publicVisitor: !!args.public, viewports: (args.viewports || "desktop,mobile,reflow320").split(","), headed: !!args.headed, attended: !!args.attended });
  if (!run.interpretation) {
    console.log(`${run.outcome.status}: ${run.outcome.reason}`);
    console.log(`\nRegression check: ${run.regression?.status || "BLOCKED"}\nEvidence: evidence/runs/${run.runId}/run.json`);
    if (args.assert) process.exit(2);
    process.exit(0);
  }
  console.log(run.interpretation.observations.join("\n"));
  console.log("\nHypotheses:\n" + (run.interpretation.hypotheses.join("\n") || "(none)"));
  console.log(`\nRegression check: ${run.regression.status}${run.regression.checks ? "\n" + run.regression.checks.map((c) => `  [${c.viewport}] ${c.pass === true ? "pass" : c.pass === false ? "FAIL" : "?"} — ${c.reason}`).join("\n") : ""}`);
  console.log(`\nEvidence: evidence/runs/${run.runId}/run.json`);
  // --assert: exit code 1 on FAIL, 2 on INCONCLUSIVE (for scripted retests).
  if (args.assert) process.exit(run.regression.status === "PASS" ? 0 : run.regression.status === "FAIL" ? 1 : 2);
}
