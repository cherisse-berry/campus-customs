// Section 11 — "Choose your plan" defect investigation (deterministic probe).
// This is a LABELLED NON-BLINDED diagnostic: it inventories what is visible
// and tests whether Settings is the only way past the plan screen. It does not
// select a plan unless the manifest AND the account explicitly allow it.
//
//   npm run probe-plan -- --account founder-admin [--viewports desktop,mobile] [--headed]
//   npm run probe-plan -- --public          (signed-out visitor; no account)
import { loadManifest, getAccount, accountApprovedFor, parseArgs, ROOT, isMain } from "./lib/manifest.js";
import { observe, visibleControls, signedInCheck } from "./lib/observe.js";
import { Evidence, openBrowser, runId, readAuthMeta } from "./lib/evidence.js";
import { redactUrl } from "./lib/redact.js";

const MONEY = /(\$|€|£|\/\s?mo\b|per month|per year|annual)/i;
const PLAN_CTA = /\b(select|choose|start|get started|continue with|activate|subscribe|try|trial|upgrade)\b/i;
const ESCAPE_CTA = /\b(continue|skip|later|dashboard|go to|enter|home|back|not now|explore|maybe later|close)\b/i;
const MODULES = /\b(advisor|project|evidence|funding|studio|incident|brief|settings)\b/i;

export async function probePlan({ manifest, accountId, publicVisitor = false, viewports = ["desktop", "mobile"], headed = false }) {
  manifest ??= loadManifest();
  manifest._root ??= ROOT;
  const account = publicVisitor ? { id: "public-visitor", actualRole: "none (signed out)", actualEntitlement: "none", accountState: "signed-out" } : getAccount(manifest, accountId);
  if (!publicVisitor && !accountApprovedFor(account, "probe-plan")) throw new Error(`Account ${account.id} is not approved for probe-plan.`);
  const pw = manifest.permittedWorkflows || {};
  if (!publicVisitor && !pw.navigateAuthenticatedPages) throw new Error("Signed-in browsing is not permitted (permittedWorkflows.navigateAuthenticatedPages=false).");
  if (publicVisitor && !pw.navigatePublicPages) throw new Error("Public-page browsing is not permitted (permittedWorkflows.navigatePublicPages=false).");
  const ev = new Evidence(manifest, runId(`UXTEST-PLANPROBE-${account.id}`), {
    kind: "probe-plan", blinded: false, labelledAs: "DETERMINISTIC_DIAGNOSTIC (not a blinded user test)",
    account: { id: account.id, actualRole: account.actualRole, actualEntitlement: account.actualEntitlement, accountState: account.accountState, serverSideNewUser: !!account.serverSideNewUser },
    target: manifest.target.baseUrl,
  });
  const results = [];

  for (const vp of viewports) {
    const { browser, context, viewport } = await openBrowser(manifest, { accountId: account.id, viewport: vp, headed, useAuth: !publicVisitor });
    await context.route("**/*", (route) => {
      const r = route.request();
      if (r.isNavigationRequest() && !manifest.target.allowedHosts.includes(new URL(r.url()).hostname)) {
        ev.step({ kind: "guard", viewport: vp, blockedNavigation: redactUrl(r.url()) });
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    const page = await context.newPage();
    ev.attach(page);
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    const r = { viewport: vp };
    try {
      // 1. Landing state
      const resp = await page.goto(manifest.target.baseUrl, { waitUntil: "networkidle", timeout: 60000 }).catch(async () => page.goto(manifest.target.baseUrl, { waitUntil: "domcontentloaded" }));
      r.redirectChain = chain(resp?.request());
      if (!publicVisitor) {
        // A probe of a signed-out page would be reported as the post-login screen: refuse.
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        r.authCheck = await signedInCheck(page, readAuthMeta(manifest._root, account.id));
        if (r.authCheck.status === "signed_out") {
          r.landingScreenshot = await ev.screenshot(page, `${vp}-not-signed-in`);
          throw new Error(`SAVED_LOGIN_NOT_ACCEPTED: ${r.authCheck.reasons.join("; ")}. Log in again; this viewport was not probed.`);
        }
      }
      const obs = await observe(page);
      r.landing = { url: obs.url, title: obs.title, headings: obs.headings, onPlanPage: obs.onPlanPage, alerts: obs.alerts };
      r.landingScreenshot = await ev.screenshot(page, `${vp}-landing`);
      const controls = await visibleControls(page);
      r.controls = controls;

      // 2. Classify controls on the plan screen
      const planCtas = [], escapeCtas = [], navModules = [];
      for (const c of controls) {
        if (PLAN_CTA.test(c.name) || MONEY.test(c.name)) planCtas.push(c);
        else if (ESCAPE_CTA.test(c.name)) escapeCtas.push(c);
        if (MODULES.test(c.name)) navModules.push(c);
      }
      // Is each plan CTA above the fold at this viewport?
      for (const c of planCtas) {
        const box = await page.getByRole(c.role, { name: c.name, exact: true }).first().boundingBox().catch(() => null);
        c.aboveFold = box ? box.y + box.height <= viewport.height : null;
      }
      r.classification = { planCtas, escapeCtas, navModules, disabledPlanCtas: planCtas.filter((c) => c.disabled).length };

      // 3. Settings workaround test (read-only navigation)
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
        // Can the user reach a module from Settings without choosing a plan?
        // Only plain navigation: never a control that creates, deletes or changes anything.
        const mod = sControls.find((c) => /advisor|project/i.test(c.name) && !/new|create|add|delete|remove|start|submit|save/i.test(c.name) && (c.role === "link" || c.role === "tab" || (c.role === "button" && c.inNav)));
        if (mod) {
          await page.getByRole(mod.role, { name: mod.name, exact: true }).first().click({ timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(2000);
          const mObs = await observe(page);
          r.moduleFromSettings = { clicked: `${mod.role}:${mod.name}`, url: mObs.url, headings: mObs.headings, onPlanPage: mObs.onPlanPage, screenshot: await ev.screenshot(page, `${vp}-module-from-settings`) };
        }
        // 4. Does the plan gate come back on a fresh visit to the root?
        await page.goto(manifest.target.baseUrl, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2000);
        const again = await observe(page);
        r.returnToRoot = { url: again.url, onPlanPage: again.onPlanPage, headings: again.headings, screenshot: await ev.screenshot(page, `${vp}-return-root`) };
      } else {
        r.afterSettings = "No visible Settings control on the landing screen.";
      }

      // 5. Keyboard reachability of the plan screen's first controls
      await page.goto(manifest.target.baseUrl, { waitUntil: "domcontentloaded" });
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
      await browser.close().catch(() => {});
    }
    results.push(r);
  }
  ev.run.probe = results;
  ev.run.interpretation = interpret(results, account, manifest);
  for (const f of ev.run.interpretation.draftFindings) ev.finding(f);
  return ev.finish({ status: "COMPLETED", reason: "Probe finished; see interpretation (observations vs. hypotheses are separated)." });
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
    if (r.error) { obs.push(`[${r.viewport}] Probe error: ${r.error}`); continue; }
    if (r.authCheck?.status === "uncertain") obs.push(`[${r.viewport}] WARNING — sign-in state uncertain (${r.authCheck.reasons.join("; ")}). Check the screenshots before using this result.`);
    obs.push(`[${r.viewport}] Landing: ${r.landing.url} — headings: ${r.landing.headings.slice(0, 4).join(" | ") || "(none)"} — plan screen: ${r.landing.onPlanPage}`);
    if (r.redirectChain?.length > 1) obs.push(`[${r.viewport}] Redirect chain: ${r.redirectChain.join(" → ")}`);
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
  const run = await probePlan({ accountId: args.account, publicVisitor: !!args.public, viewports: (args.viewports || "desktop,mobile").split(","), headed: !!args.headed });
  console.log(run.interpretation.observations.join("\n"));
  console.log("\nHypotheses:\n" + (run.interpretation.hypotheses.join("\n") || "(none)"));
  console.log(`\nEvidence: evidence/runs/${run.runId}/run.json`);
}
