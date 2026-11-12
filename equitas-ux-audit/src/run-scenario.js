// Runs one persona scenario with the blinded agent against the real site.
//
//   npm run scenario -- --scenario P01-doctoral-idea --account founder-admin
//   options: --viewport desktop|tablet|mobile  --headed
import fs from "node:fs";
import path from "node:path";
import { loadManifest, getAccount, accountApprovedFor, parseArgs, ROOT, isMain } from "./lib/manifest.js";
import { makeGuard, STOP } from "./lib/safety.js";
import { observe, resolve, mainText, signedInCheck } from "./lib/observe.js";
import { Evidence, openBrowser, runId, readAuthMeta } from "./lib/evidence.js";
import { personaBrief, createClaudeDecider, usageUsd } from "./lib/agent.js";
import { evaluateScience } from "./lib/evaluator.js";
import { redact, redactUrl } from "./lib/redact.js";

export async function runScenario({ scenarioId, accountId, viewport = "desktop", headed = false, decider, manifest, configDir = path.join(ROOT, "config") }) {
  manifest ??= loadManifest();
  manifest._root ??= ROOT;
  const { scenarios } = JSON.parse(fs.readFileSync(path.join(configDir, "scenarios.json"), "utf8"));
  const { personas } = JSON.parse(fs.readFileSync(path.join(configDir, "personas.json"), "utf8"));
  const scenario = scenarios.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(`Unknown scenario ${scenarioId}`);
  const persona = personas.find((p) => p.id === scenario.persona);
  const account = getAccount(manifest, accountId);
  const ev = new Evidence(manifest, runId(`UXTEST-${persona.id}-${scenario.id}`), {
    scenarioId: scenario.id, personaId: persona.id, journey: scenario.journey,
    account: { id: account.id, actualRole: account.actualRole, actualEntitlement: account.actualEntitlement, accountState: account.accountState },
    target: manifest.target.baseUrl, viewport, blinded: true, testerModel: manifest.testerAi?.model,
  });

  // ---- Pre-flight: authorization and role checks (Section 3, 17) ----
  const blockedReasons = [];
  if (!accountApprovedFor(account, scenario.id)) blockedReasons.push(`Account ${account.id} is not approved for ${scenario.id} in the manifest.`);
  if (scenario.requiresRole && !scenario.requiresRole.includes(account.actualRole)) blockedReasons.push(`Scenario needs role ${scenario.requiresRole.join("/")}; account is ${account.actualRole}. Not improvising access.`);
  if (scenario.requiresServerSideNewUser && !account.serverSideNewUser) blockedReasons.push("Scenario needs a server-side new account; a fresh browser is not a new user.");
  if (!decider && !manifest.testerAi?.approved) blockedReasons.push("Tester AI is not approved in the manifest (testerAi.approved=false).");
  const pw = manifest.permittedWorkflows || {};
  if (scenario.question && !pw.submitSyntheticResearchQuestions) blockedReasons.push("Submitting synthetic research questions is not permitted.");
  if (scenario.authenticated !== false && !pw.navigateAuthenticatedPages) blockedReasons.push("Signed-in browsing is not permitted (permittedWorkflows.navigateAuthenticatedPages=false).");
  if (scenario.authenticated === false && !pw.navigatePublicPages) blockedReasons.push("Public-page browsing is not permitted (permittedWorkflows.navigatePublicPages=false).");
  if (scenario.needsProjectCreation && !pw.createSyntheticProjects) blockedReasons.push("Scenario needs a saved project but createSyntheticProjects=false.");
  if (blockedReasons.length) {
    ev.finding({ category: "BLOCKED", severity: null, title: `${scenario.id} blocked`, observed: blockedReasons.join(" ") });
    return ev.finish({ status: "BLOCKED", reason: blockedReasons.join(" ") });
  }
  const guard = makeGuard(manifest, { scenarioId: scenario.id });
  const start = guard.startScenario();
  if (!start.ok) return ev.finish({ status: "BLOCKED", reason: start.reason });

  let testerUsd = 0;
  decider ??= createClaudeDecider(manifest, {
    onUsage: (u, model) => { const c = usageUsd(u, model); testerUsd += c; guard.recordTesterSpend(c); },
  });

  const { browser, context } = await openBrowser(manifest, { accountId: account.id, viewport, headed, useAuth: scenario.authenticated !== false });
  const page = await context.newPage();
  ev.attach(page);

  // Off-domain top-level navigation is aborted before it happens.
  await context.route("**/*", async (route) => {
    const req = route.request();
    if (req.isNavigationRequest() && req.frame() === page.mainFrame() && !guard.isAllowedHost(req.url())) {
      ev.step({ kind: "guard", stop: STOP.OFF_DOMAIN, url: redactUrl(req.url()) });
      ev.finding({ category: "OBSERVED_NAVIGATION_BLOCKER", severity: "P2", title: "Navigation left the approved domain", observed: `Top-level navigation to ${new URL(req.url()).hostname} was blocked by the test harness.`, triage: "pending" });
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  context.on("page", async (p) => { if (p !== page) { ev.step({ kind: "popup", url: redactUrl(p.url()) }); await p.close().catch(() => {}); } });
  page.on("dialog", async (d) => { ev.run.dialogs.push({ type: d.type(), message: redact(d.message()) }); await d.dismiss().catch(() => {}); });

  const approvedInputs = [scenario.question, ...(scenario.followUps || []), ...(scenario.syntheticFacts || [])].filter(Boolean);
  const isSynthetic = (t) =>
    approvedInputs.includes(t) ||
    (t.startsWith(manifest.syntheticData.recordPrefix) && t.length <= 120) ||
    (scenario.allowComposedAnswers !== false && redact(t) === t && t.length <= 800 && !/patient|mrn|date of birth|ssn|confidential|unpublished/i.test(t));

  const brief = personaBrief(persona, scenario);
  const history = [];
  let pendingText = 0, noProgress = 0, failedLookups = 0, outcome = null, lastUrl = null;

  try {
    await page.goto(scenario.entryUrl ? new URL(scenario.entryUrl, manifest.target.baseUrl).toString() : manifest.target.baseUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    ev.run.entry = { url: redactUrl(page.url()), note: "Agent starts at the site root, as a user typing the address would." };

    // Verify the saved login really works before testing anything signed-in.
    if (scenario.authenticated !== false) {
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      ev.run.authCheck = await signedInCheck(page, readAuthMeta(manifest._root, account.id));
      if (ev.run.authCheck.status === "signed_out") {
        await ev.screenshot(page, "not-signed-in");
        outcome = { status: "BLOCKED", reason: `${STOP.NOT_SIGNED_IN}: ${ev.run.authCheck.reasons.join("; ")}. Run npm run login -- --account ${account.id} again; nothing was tested.` };
      } else if (ev.run.authCheck.status === "uncertain") {
        ev.finding({ category: "TEST_VALIDITY_WARNING", severity: null, title: "Sign-in state uncertain", observed: ev.run.authCheck.reasons.join("; "), triage: "check screenshots before trusting this run" });
      }
    }

    while (!outcome) {
      const obs = await observe(page);
      const shot = await ev.screenshot(page, `obs-${obs.title || "page"}`);
      if (lastUrl && obs.url !== lastUrl && scenario.expectedHostPathPrefix && !new URL(obs.url).pathname.startsWith(scenario.expectedHostPathPrefix)) {
        if (!guard.countRedirect()) { outcome = { status: "LIMIT", reason: STOP.REDIRECT_LIMIT }; break; }
      }
      lastUrl = obs.url;

      let d;
      try { d = await decider({ brief, history, obs, persona, scenario }); }
      catch (e) { outcome = { status: "ERROR", reason: `Tester decision failed: ${e.message}` }; break; }

      const a = d.action;
      const stepRec = { kind: "agent", url: obs.url, title: obs.title, headings: obs.headings, onPlanPage: obs.onPlanPage, screenshot: shot, decision: d };
      if (d.confusion) ev.finding({ category: "UX_HEURISTIC_CONCERN", severity: null, title: `Agent-reported unclear element (${scenario.id})`, observed: d.confusion, url: obs.url, screenshot: shot, triage: "pending", note: "Simulated-agent observation, not a human finding." });

      if (a.type === "done") { outcome = { status: "COMPLETED", reason: d.rationale }; ev.step({ ...stepRec, result: "done" }); break; }
      if (a.type === "give_up") { outcome = { status: "ABANDONED", reason: d.rationale }; ev.step({ ...stepRec, result: "give_up" }); break; }

      noProgress = d.progress === "none" ? noProgress + 1 : 0;
      if (noProgress >= manifest.limits.maxConsecutiveNoProgress) {
        ev.step({ ...stepRec, result: "no-progress limit" });
        outcome = { status: "ABANDONED", reason: `Stopping rule: ${noProgress} consecutive steps without progress.` };
        break;
      }

      // Resolve target and run the safety guard
      let ctx = { onPlanPage: obs.onPlanPage, pendingTextLength: pendingText, textIsSynthetic: a.type === "fill" ? isSynthetic(a.text) : true };
      let target = null;
      if (["click", "fill", "press_enter"].includes(a.type)) {
        // Every click, fill and Enter must name a real, uniquely identifiable control.
        target = a.role ? await resolve(page, a) : { error: `refused: ${a.type} without a role and name` };
        if (target.error) {
          failedLookups++;
          history.push({ n: history.length + 1, whereAmI: d.whereAmI, action: a, result: `FAILED: ${target.error}` });
          ev.step({ ...stepRec, result: `lookup failed: ${target.error}` });
          if (failedLookups >= 4) outcome = { status: "ABANDONED", reason: "Stopping rule: 4 failed attempts to find controls." };
          continue;
        }
        ctx = { ...ctx, actualName: target.actualName, actualText: target.actualText, matchedBy: target.matchedBy, href: target.href, inputType: target.inputType, autocomplete: target.autocomplete, containerText: target.containerText };
        stepRec.target = { actualName: target.actualName, matchedBy: target.matchedBy, count: target.count };
      }
      const check = await guard.checkAction(a, ctx);
      if (!check.ok && check.recoverable) {
        failedLookups++;
        history.push({ n: history.length + 1, whereAmI: d.whereAmI, action: a, result: `REFUSED: ${check.reason}` });
        ev.step({ ...stepRec, result: `guard refused: ${check.stop}`, guardReason: check.reason });
        ev.finding({ category: "ACCESSIBILITY_FINDING", severity: null, title: "Control without an accessible name", observed: `The agent tried to use ${a.role} "${a.name}", which has no accessible name or text.`, url: obs.url, screenshot: shot, triage: "pending" });
        if (failedLookups >= 4) outcome = { status: "ABANDONED", reason: "Stopping rule: 4 failed attempts to find controls." };
        continue;
      }
      if (!check.ok) {
        ev.step({ ...stepRec, result: `GUARD STOP: ${check.stop}`, guardReason: check.reason });
        if (check.stop === STOP.PLAN_SELECTION) {
          ev.finding({ category: "ENTITLEMENT_OR_ACCOUNT_STATE_FAILURE", severity: null, title: "Persona could only proceed by selecting a plan", observed: `On a plan page the agent's next step was "${a.name}". ${check.reason}`, url: obs.url, screenshot: shot, triage: "pending — compare with probe-plan results" });
        }
        outcome = { status: [STOP.ACTION_LIMIT, STOP.TIME_LIMIT, STOP.AI_BUDGET].includes(check.stop) ? "LIMIT" : "STOPPED_SAFETY", reason: `${check.stop}${check.reason ? ": " + check.reason : ""}` };
        break;
      }

      await guard.pace();
      guard.countAction();
      let result = "ok";
      const before = check.countsAsAiSubmission ? await mainText(page) : null;
      try {
        if (a.type === "click") {
          if (target.disabled) result = "control is disabled";
          else await target.el.click({ timeout: 10000 });
        } else if (a.type === "fill") {
          await target.el.fill(a.text, { timeout: 10000 });
          pendingText = a.text.length;
          if (a.text.startsWith(manifest.syntheticData.recordPrefix)) ev.run.createdRecords.push({ kind: "possible-record-name", value: a.text, at: new Date().toISOString(), url: obs.url });
        } else if (a.type === "press_enter") {
          await target.el.press("Enter", { timeout: 10000 });
        } else if (a.type === "scroll") {
          await page.mouse.wheel(0, 700);
        } else if (a.type === "back") {
          await page.goBack({ timeout: 15000 }).catch(() => (result = "no history"));
        } else if (a.type === "wait") {
          await page.waitForTimeout(5000);
        }
      } catch (e) {
        result = `action error: ${e.message.split("\n")[0]}`;
      }

      // Counted even if the action reported an error: it may still have been sent.
      if (check.countsAsAiSubmission) guard.countAiSubmission();
      if (check.countsAsAiSubmission && !result.startsWith("action error")) {
        pendingText = 0;
        const resp = await waitForResponse(page, before, scenario.responseTimeoutSec ?? 120);
        ev.run.equitasResponses.push({ submittedText: a.type === "press_enter" ? "(Enter key)" : `(clicked "${target.actualName || a.name}")`, looksLikeSubmit: check.looksLikeSubmit, lastFilled: history.filter((h) => h.action.type === "fill").at(-1)?.action.text, ...resp, url: redactUrl(page.url()) });
        result += ` — response captured (${resp.newText.length} chars${resp.timedOut ? ", TIMED OUT" : ""})`;
      }
      history.push({ n: history.length + 1, whereAmI: d.whereAmI, action: a, result });
      ev.step({ ...stepRec, result, afterUrl: redactUrl(page.url()) });
    }
  } catch (e) {
    outcome = { status: "ERROR", reason: e.message.split("\n")[0] };
  } finally {
    await ev.screenshot(page, "final").catch(() => {});
    await browser.close().catch(() => {});
  }

  // ---- Post-run analysis ----
  ev.run.metrics = {
    actions: guard.state.actions,
    aiSubmissions: guard.state.aiSubmissions,
    failedLookups,
    backNavigations: history.filter((h) => h.action.type === "back").length,
    firstActionSucceeded: history[0] ? !history[0].result.startsWith("FAILED") : null,
    distinctUrls: new Set(ev.run.navigationPath.map((n) => n.url)).size,
    testerUsd: Number(testerUsd.toFixed(4)),
  };
  for (const e of ev.run.network.httpErrors.filter((x) => x.status >= 500)) {
    ev.finding({ category: "OBSERVED_BROWSER_DEFECT", severity: null, title: `HTTP ${e.status} during ${scenario.id}`, observed: `${e.method} ${e.url} returned ${e.status}.`, triage: "pending — VENDOR_INVESTIGATION_REQUIRED" });
  }
  if (outcome.status === "ABANDONED") ev.finding({ category: "OBSERVED_NAVIGATION_BLOCKER", severity: null, title: `${persona.label}: task abandoned`, observed: outcome.reason, triage: "pending" });
  if (scenario.scienceExpectationId && ev.run.equitasResponses.length) {
    ev.run.science = await evaluateScience(manifest, scenario, ev.run.equitasResponses, { onUsage: (u, m) => { const c = usageUsd(u, m); ev.run.metrics.testerUsd += c; guard.recordTesterSpend(c); } });
  } else if (scenario.scienceExpectationId) {
    ev.run.science = { status: "NOT_EVALUATED", reason: "No EQUITAS response was captured." };
  }
  return ev.finish(outcome);
}

// Wait until the page's main text stops changing, then return what was added.
async function waitForResponse(page, before, timeoutSec) {
  const startT = Date.now();
  let prev = "", stable = 0, now = "";
  while (Date.now() - startT < timeoutSec * 1000) {
    await page.waitForTimeout(3000);
    now = await mainText(page);
    if (now === prev && now !== before) { if (++stable >= 2) break; } else stable = 0;
    prev = now;
  }
  const beforeLines = new Set((before || "").split("\n"));
  const newText = now.split("\n").filter((l) => l.trim() && !beforeLines.has(l)).join("\n");
  return { newText, seconds: Math.round((Date.now() - startT) / 1000), timedOut: Date.now() - startT >= timeoutSec * 1000 };
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  if (!args.scenario || !args.account) { console.error("Usage: npm run scenario -- --scenario <id> --account <id> [--viewport mobile] [--headed]"); process.exit(2); }
  const run = await runScenario({ scenarioId: args.scenario, accountId: args.account, viewport: args.viewport || "desktop", headed: !!args.headed });
  console.log(`${run.scenarioId}: ${run.outcome.status} — ${run.outcome.reason}\nEvidence: evidence/runs/${run.runId}/run.json`);
}
