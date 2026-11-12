// Runs one persona scenario with the blinded agent against the real site.
//
//   npm run scenario -- --scenario P01-doctoral-idea --account founder-admin
//   options: --viewport desktop|tablet|mobile|reflow320  --headed
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { loadManifest, getAccount, accountApprovedFor, parseArgs, ROOT, isMain } from "./lib/manifest.js";
import { makeGuard, STOP, acquireLock } from "./lib/safety.js";
import { observe, resolve, mainText } from "./lib/observe.js";
import { Evidence, openBrowser, runId, installNavigationGuard } from "./lib/evidence.js";
import { AUTH, sessionPreflight, verifySession, resolveMarkers, readMeta } from "./lib/auth.js";
import { personaBrief, createClaudeDecider, usageUsd } from "./lib/agent.js";
import { evaluateScience } from "./lib/evaluator.js";
import { buildFingerprint, deploymentChanged, axeScan, priorUseSignals, serverRecordSignals } from "./lib/diagnostics.js";
import { redact, redactUrl } from "./lib/redact.js";

// Ask the founder to sign in again in a visible window (Journey I: real
// sign-out and return). Tests pass their own `relogin` function.
async function interactiveRelogin(page, manifest) {
  if (!process.stdin.isTTY) return { ok: false, reason: "Fresh sign-in needs an interactive terminal." };
  await page.goto(manifest.target.baseUrl, { waitUntil: "domcontentloaded" });
  console.log("\nA fresh browser window is open with NO saved login (this is the 'returning user' journey).\nSign in there yourself, including MFA, then press Enter here.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Press Enter once signed in… ");
  rl.close();
  return { ok: true };
}

function priorRecordsFor(manifest, accountId) {
  const dir = path.join(manifest._root, manifest.evidence?.storeDirectory || "evidence", "runs");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const d of fs.readdirSync(dir)) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, d, "run.json"), "utf8"));
      if (r.account?.id === accountId) for (const c of r.createdRecords || []) out.push({ ...c, runId: r.runId });
    } catch {}
  }
  return out;
}

export async function runScenario({ scenarioId, accountId, viewport = "desktop", headed = false, attended = false, decider, manifest, aiClient, relogin, configDir = path.join(ROOT, "config") }) {
  manifest ??= loadManifest();
  manifest._root ??= ROOT;
  const { scenarios } = JSON.parse(fs.readFileSync(path.join(configDir, "scenarios.json"), "utf8"));
  const { personas } = JSON.parse(fs.readFileSync(path.join(configDir, "personas.json"), "utf8"));
  const scenario = scenarios.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(`Unknown scenario ${scenarioId}`);
  const persona = personas.find((p) => p.id === scenario.persona);
  const account = getAccount(manifest, accountId);
  const ev = new Evidence(manifest, runId(`UXTEST-${persona.id}-${scenario.id}`), {
    scenarioId: scenario.id, personaId: persona.id, journey: scenario.journey, sharedBenchmark: scenario.sharedBenchmark || null,
    account: { id: account.id, actualRole: account.actualRole, actualEntitlement: account.actualEntitlement, accountState: account.accountState, serverSideNewUser: !!account.serverSideNewUser },
    target: manifest.target.baseUrl, viewport, blinded: true, testerModel: manifest.testerAi?.model,
    validity: { warnings: [] },
  });

  // ---- Pre-flight: authorization, role and permission checks (Sections 3, 4, 17) ----
  const blockedReasons = [];
  const pw = manifest.permittedWorkflows || {};
  if (!accountApprovedFor(account, scenario.id)) blockedReasons.push(`Account ${account.id} is not approved for ${scenario.id} in the manifest.`);
  if (scenario.requiresRole && !scenario.requiresRole.includes(account.actualRole)) blockedReasons.push(`Scenario needs role ${scenario.requiresRole.join("/")}; account is ${account.actualRole}. Not improvising access.`);
  if (scenario.requiresServerSideNewUser && !account.serverSideNewUser) blockedReasons.push("Scenario needs a server-side new account; a fresh browser is not a new user.");
  if (!decider && !manifest.testerAi?.approved) blockedReasons.push("Tester AI is not approved in the manifest (testerAi.approved=false).");
  if (scenario.question && !pw.submitSyntheticResearchQuestions) blockedReasons.push("Submitting synthetic research questions is not permitted.");
  if (scenario.authenticated !== false && !pw.navigateAuthenticatedPages) blockedReasons.push("Signed-in browsing is not permitted (permittedWorkflows.navigateAuthenticatedPages=false).");
  if (scenario.authenticated === false && !pw.navigatePublicPages) blockedReasons.push("Public-page browsing is not permitted (permittedWorkflows.navigatePublicPages=false).");
  if (scenario.needsProjectCreation && !pw.createSyntheticProjects) blockedReasons.push("Scenario needs a saved project but createSyntheticProjects=false.");
  if (scenario.requiresPriorRecord) {
    const prior = priorRecordsFor(manifest, account.id);
    ev.run.precondition = { priorRecords: prior.slice(-5) };
    if (!prior.length) blockedReasons.push(`Precondition not met: no earlier run created a ${manifest.syntheticData.recordPrefix} record for account ${account.id}. ${scenario.precondition || ""}`);
  }
  if (blockedReasons.length) {
    ev.finding({ category: "BLOCKED", severity: null, title: `${scenario.id} blocked`, observed: blockedReasons.join(" ") });
    return ev.finish({ status: "BLOCKED", reason: blockedReasons.join(" ") });
  }
  const lock = acquireLock(manifest, `${scenario.id}/${account.id}`);
  if (!lock.ok) return ev.finish({ status: "BLOCKED", reason: `SESSION_LOCK: ${lock.reason}` });

  try {
    const guard = makeGuard(manifest, { scenarioId: scenario.id });
    const start = guard.startScenario();
    if (!start.ok) return ev.finish({ status: "BLOCKED", reason: start.reason });

    let testerUsd = 0;
    const onUsage = (u, model) => { const c = usageUsd(u, model); testerUsd += c; guard.recordTesterSpend(c); };
    decider ??= createClaudeDecider(manifest, { onUsage, client: aiClient });

    // Sign-in: a fresh sign-in (Journey I, or --attended) or the saved session.
    // A saved session is checked first WITHOUT contacting EQUITAS: missing,
    // expired or previously rejected sessions stop here.
    const fresh = !!scenario.freshLogin || !!attended;
    let pre = null;
    if (scenario.authenticated !== false) {
      if (fresh) {
        const meta = readMeta(manifest._root, account.id);
        pre = { status: "READY", meta, markers: resolveMarkers(manifest, account, meta), reasons: [] };
      } else {
        pre = sessionPreflight(manifest, account);
        ev.run.auth = { preflight: pre.status, reasons: pre.reasons };
        if (pre.status !== "READY") return ev.finish({ status: "BLOCKED", reason: `${pre.status}: ${pre.reasons.join(" ")} EQUITAS was not contacted.` });
      }
    }
    const { browser, context, browserInfo } = await openBrowser(manifest, { accountId: account.id, viewport, headed: headed || (fresh && !relogin), useAuth: scenario.authenticated !== false && !fresh });
    ev.run.browser = browserInfo;
    const page = await context.newPage();
    ev.attach(page);

    // Off-domain navigation is aborted before it loads, in the main tab AND in pop-ups.
    await installNavigationGuard(context, manifest, (b) => {
      ev.step({ kind: "guard", stop: STOP.OFF_DOMAIN, url: b.url, popup: b.popup });
      ev.finding({ category: "OBSERVED_NAVIGATION_BLOCKER", severity: null, title: b.popup ? "A pop-up tried to open an off-domain page" : "Navigation left the approved domain", observed: `Top-level navigation${b.popup ? " in a pop-up" : ""} to ${b.host} was blocked by the test harness before it loaded.`, triage: "pending" });
    });
    // Close real pop-ups (opened by a page). Helper pages the accessibility
    // scanner opens itself have no opener and are left alone.
    context.on("page", async (p) => { if (p !== page && (await p.opener().catch(() => null))) { ev.step({ kind: "popup", url: redactUrl(p.url()), note: "pop-up closed by harness" }); await p.close().catch(() => {}); } });
    page.on("dialog", async (d) => { ev.run.dialogs.push({ type: d.type(), message: redact(d.message()) }); await d.dismiss().catch(() => {}); });

    const prefix = manifest.syntheticData.recordPrefix;
    const approvedInputs = [scenario.question, ...(scenario.followUps || []), ...(scenario.syntheticFacts || [])].filter(Boolean);
    const isSynthetic = (t) =>
      approvedInputs.includes(t) ||
      (t.startsWith(prefix) && t.length <= 120) ||
      (scenario.allowComposedAnswers !== false && redact(t) === t && t.length <= 800 && !/patient|mrn|date of birth|ssn|confidential|unpublished/i.test(t));

    const brief = personaBrief(persona, scenario);
    const history = [];
    const hooks = (scenario.hooks || []).map((h) => ({ ...h, done: false }));
    const scannedPaths = new Set();
    const maxAxe = manifest.limits.maxAxeScansPerScenario ?? 5;
    ev.run.accessibility = [];
    let pendingText = 0, noProgress = 0, stuck = 0, failedLookups = 0, outcome = null, lastAfterUrl = null, lastHash = null, unexpectedRedirects = 0, truncatedSteps = 0;

    const recordServerSignals = async (beforeUrl) => {
      for (const sig of await serverRecordSignals(page, prefix, beforeUrl)) {
        if (!ev.run.createdRecords.some((c) => c.value === sig.value)) ev.run.createdRecords.push({ ...sig, at: new Date().toISOString(), url: redactUrl(page.url()), source: "observed on site" });
      }
    };

    try {
      if (fresh) {
        const r = await (relogin || interactiveRelogin)(page, manifest);
        ev.run.freshLogin = { performed: r.ok, note: "Journey I: no saved session was reused; the founder signed in again." };
        if (!r.ok) outcome = { status: "BLOCKED", reason: `FRESH_LOGIN_NOT_COMPLETED: ${r.reason}` };
      }
      // Verify sign-in ONCE with application-specific markers, on the page
      // EQUITAS showed after sign-in. Unverified or rejected → BLOCKED.
      if (!outcome && scenario.authenticated !== false) {
        const stayOnPage = fresh && !pre.markers.entryPath;
        const v = await verifySession(page, manifest, account, pre, { navigate: !stayOnPage });
        ev.run.auth = { ...(ev.run.auth || {}), ...v };
        const needFounder = (scenario.requiresRole || []).includes("founder_admin");
        const ok = v.status === AUTH.FOUNDER_VERIFIED || (v.status === AUTH.AUTHENTICATED && !needFounder);
        if (!ok) {
          await ev.screenshot(page, "auth-not-established");
          outcome = { status: "BLOCKED", reason: `${v.status}: ${v.reasons.join(" ")} ${v.status === AUTH.REJECTED ? `The saved session is marked rejected and will not be reused. Run npm run login -- --account ${account.id} again.` : "Nothing was tested."}` };
        }
      }
      if (!outcome) {
        // Signed-in scenarios start where EQUITAS put the user after sign-in
        // (manifest target.signedInStart: "post-sign-in", default) or at the root.
        const signedInStart = manifest.target.signedInStart ?? "post-sign-in";
        const startUrl = scenario.entryUrl ? new URL(scenario.entryUrl, manifest.target.baseUrl).toString()
          : scenario.authenticated !== false && signedInStart === "post-sign-in" ? null : manifest.target.baseUrl;
        if (startUrl) await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        ev.run.entry = { url: redactUrl(page.url()), note: startUrl ? "Agent starts at the site root, as a user typing the address would." : "Agent starts on the page EQUITAS showed after sign-in." };
        ev.run.buildAtStart = await buildFingerprint(page, manifest);
      }

      if (!outcome && scenario.authenticated !== false) {
        if (account.serverSideNewUser) {
          const signals = await priorUseSignals(page, prefix);
          ev.run.newUserCheck = { signals };
          if (signals.length) {
            ev.run.validity.warnings.push("account labelled new shows prior use");
            ev.finding({ category: "TEST_VALIDITY_WARNING", severity: null, title: "Account labelled as new shows signs of prior use", observed: signals.join("; "), triage: "confirm the account's real server-side state before treating results as first-time-user results" });
          }
        }
      }

      while (!outcome) {
        // Mid-run failure/recovery hooks (Journey K). Client-side only: they
        // never disrupt EQUITAS's servers.
        for (const h of hooks) {
          if (!h.done && h.type === "clearSession" && history.length >= (h.afterStep ?? 3)) {
            await context.clearCookies();
            await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} }).catch(() => {});
            h.done = true;
            ev.step({ kind: "hook", hook: "clearSession", note: "Cookies and local/session storage cleared in this browser only, to observe session-expiry handling." });
          }
        }

        const obs = await observe(page);
        if (lastAfterUrl && obs.url !== lastAfterUrl) {
          unexpectedRedirects++;
          ev.step({ kind: "redirect", from: lastAfterUrl, to: obs.url, note: "URL changed without an agent action" });
          if (!guard.countRedirect()) { outcome = { status: "LIMIT", reason: `${STOP.REDIRECT_LIMIT}: ${unexpectedRedirects} URL changes not caused by the agent.` }; break; }
        }
        stuck = obs.hash === lastHash ? stuck + 1 : 0;
        lastHash = obs.hash;
        if (obs.truncated) truncatedSteps++;
        const shot = await ev.screenshot(page, `obs-${obs.title || "page"}`);
        const snapshotFile = ev.saveSnapshot(obs.snapshot);

        let urlPath = "";
        try { urlPath = new URL(page.url()).pathname; } catch {}
        if (!scannedPaths.has(urlPath) && scannedPaths.size < maxAxe) {
          scannedPaths.add(urlPath);
          ev.run.accessibility.push({ viewport, ...(await axeScan(page)) });
        }

        const budget = guard.testerBudgetLeft();
        if (!budget.ok) { outcome = { status: "LIMIT", reason: `${budget.stop}: ${budget.reason}` }; break; }
        let d;
        try { d = await decider({ brief, history, obs, persona, scenario }); }
        catch (e) { outcome = { status: "ERROR", reason: `Tester decision failed: ${e.message}` }; break; }

        const a = d.action;
        const stepRec = { kind: "agent", url: obs.url, title: obs.title, headings: obs.headings, onPlanPage: obs.onPlanPage, screenshot: shot, snapshot: snapshotFile, snapshotTruncated: obs.truncated, pageHash: obs.hash, decision: d };
        if (d.confusion) ev.finding({ category: "UX_HEURISTIC_CONCERN", severity: null, title: `Agent-reported unclear element (${scenario.id})`, observed: d.confusion, url: obs.url, screenshot: shot, triage: "pending", note: "Simulated-agent observation, not a human finding." });

        if (a.type === "done") { outcome = { status: "COMPLETED", reason: d.rationale }; ev.step({ ...stepRec, result: "done" }); break; }
        if (a.type === "give_up") { outcome = { status: "ABANDONED", reason: d.rationale }; ev.step({ ...stepRec, result: "give_up" }); break; }

        // Two independent "no progress" signals: the agent's own judgment, and
        // the page staying byte-identical. Either one reaching the limit ends the run.
        noProgress = d.progress === "none" ? noProgress + 1 : 0;
        const lim = manifest.limits.maxConsecutiveNoProgress;
        if (noProgress >= lim || stuck >= lim) {
          ev.step({ ...stepRec, result: "no-progress limit" });
          outcome = { status: "ABANDONED", reason: `Stopping rule: ${noProgress >= lim ? `${noProgress} steps the agent judged without progress` : `page unchanged for ${stuck} consecutive steps`}.` };
          break;
        }

        let ctx = { onPlanPage: obs.onPlanPage, pendingTextLength: pendingText, textIsSynthetic: a.type === "fill" ? isSynthetic(a.text) : true };
        let target = null;
        if (["click", "fill", "press_enter"].includes(a.type)) {
          target = a.role ? await resolve(page, a) : { error: `refused: ${a.type} without a role and name` };
          if (target.error) {
            failedLookups++;
            const note = obs.truncated && !target.unnamed && !target.ambiguous ? " (page text was shortened for the agent; this may be a harness limitation, not a site fault)" : "";
            history.push({ n: history.length + 1, whereAmI: d.whereAmI, action: a, result: `FAILED: ${target.error}` });
            ev.step({ ...stepRec, result: `lookup failed: ${target.error}${note}` });
            if (failedLookups >= 4) outcome = { status: "ABANDONED", reason: `Stopping rule: 4 failed attempts to find controls.${truncatedSteps ? " Some pages were shortened for the agent." : ""}` };
            lastAfterUrl = redactUrl(page.url());
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
          lastAfterUrl = redactUrl(page.url());
          continue;
        }
        if (!check.ok) {
          ev.step({ ...stepRec, result: `GUARD STOP: ${check.stop}`, guardReason: check.reason });
          if (check.stop === STOP.PLAN_SELECTION) {
            ev.finding({ category: "ENTITLEMENT_OR_ACCOUNT_STATE_FAILURE", severity: null, title: "Persona could only proceed by selecting a plan", observed: `On a plan page the agent's next step was "${ctx.actualName || a.name}". ${check.reason}`, url: obs.url, screenshot: shot, triage: "pending — compare with probe-plan results" });
          }
          outcome = { status: [STOP.ACTION_LIMIT, STOP.TIME_LIMIT, STOP.AI_BUDGET].includes(check.stop) ? "LIMIT" : "STOPPED_SAFETY", reason: `${check.stop}${check.reason ? ": " + check.reason : ""}` };
          break;
        }

        await guard.pace();
        guard.countAction();
        let result = "ok";
        const beforeUrl = page.url();
        const before = check.countsAsAiSubmission ? await mainText(page) : null;
        const offlineHook = check.countsAsAiSubmission && hooks.find((h) => !h.done && h.type === "offlineBeforeSubmission");
        if (offlineHook) {
          await context.setOffline(true);
          offlineHook.done = true;
          ev.step({ kind: "hook", hook: "offlineBeforeSubmission", note: `Browser set offline for ${offlineHook.durationSec ?? 20}s before sending, to observe network-failure handling. EQUITAS servers are not affected.` });
        }
        try {
          if (a.type === "click") {
            if (target.disabled) result = "control is disabled";
            else await target.el.click({ timeout: 10000 });
          } else if (a.type === "fill") {
            await target.el.fill(a.text, { timeout: 10000 });
            pendingText = a.text.length;
            if (a.text.startsWith(prefix)) ev.run.createdRecords.push({ kind: "typed-record-name", value: a.text, at: new Date().toISOString(), url: obs.url, source: "typed by harness" });
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
        // Let navigation started by this action finish before recording where it
        // led, so a slow click-through is not mistaken for an unexpected redirect.
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1500);
        if (offlineHook) {
          await page.waitForTimeout((offlineHook.durationSec ?? 20) * 1000);
          ev.run.offlineObservation = { alerts: await page.getByRole("alert").allInnerTexts().catch(() => []), status: await page.getByRole("status").allInnerTexts().catch(() => []), screenshot: await ev.screenshot(page, "while-offline") };
          await context.setOffline(false);
        }

        // Counted even if the action reported an error: it may still have been sent.
        if (check.countsAsAiSubmission) guard.countAiSubmission();
        if (check.countsAsAiSubmission && !result.startsWith("action error") && !offlineHook) {
          pendingText = 0;
          const resp = await waitForResponse(page, before, scenario.responseTimeoutSec ?? 120);
          ev.run.equitasResponses.push({ submittedText: a.type === "press_enter" ? "(Enter key)" : `(clicked "${target.actualName || a.name}")`, looksLikeSubmit: check.looksLikeSubmit, lastFilled: history.filter((h) => h.action.type === "fill").at(-1)?.action.text, ...resp, url: redactUrl(page.url()) });
          result += ` — response captured (${resp.newText.length} chars${resp.timedOut ? ", TIMED OUT" : ""})`;
          await recordServerSignals(beforeUrl);
        } else if (offlineHook) {
          pendingText = 0;
          result += " — sent while offline (network-failure observation)";
        }
        history.push({ n: history.length + 1, whereAmI: d.whereAmI, action: a, result });
        lastAfterUrl = redactUrl(page.url());
        ev.step({ ...stepRec, result, afterUrl: lastAfterUrl });
      }
      if (ev.run.buildAtStart) {
        await recordServerSignals("");
        ev.run.finalPageText = (await mainText(page)).slice(0, 40000);
        ev.run.buildAtEnd = await buildFingerprint(page, manifest);
      }
    } catch (e) {
      outcome = { status: "ERROR", reason: e.message.split("\n")[0] };
    } finally {
      await ev.screenshot(page, "final").catch(() => {});
      await browser.close().catch(() => {});
    }

    // ---- Post-run analysis ----
    if (deploymentChanged(ev.run.buildAtStart, ev.run.buildAtEnd)) {
      ev.run.validity.warnings.push("deployment changed during run");
      ev.finding({ category: "TEST_VALIDITY_WARNING", severity: null, title: "EQUITAS appears to have been redeployed during this run", observed: `Build/asset fingerprint changed from ${JSON.stringify(ev.run.buildAtStart)} to ${JSON.stringify(ev.run.buildAtEnd)}.`, triage: "do not compare this run with runs on either build; rerun" });
    }
    ev.run.metrics = {
      actions: guard.state.actions,
      aiSubmissions: guard.state.aiSubmissions,
      failedLookups,
      unexpectedRedirects,
      truncatedSteps,
      backNavigations: history.filter((h) => h.action.type === "back").length,
      firstActionSucceeded: history[0] ? !/^(FAILED|REFUSED)/.test(history[0].result) : null,
      distinctUrls: new Set(ev.run.navigationPath.map((n) => n.url)).size,
      durationSec: Math.round((Date.now() - new Date(ev.run.startedAt).getTime()) / 1000),
      testerUsd: Number(testerUsd.toFixed(4)),
    };
    for (const e of ev.run.network.httpErrors.filter((x) => x.status >= 500)) {
      ev.finding({ category: "OBSERVED_BROWSER_DEFECT", severity: null, title: `HTTP ${e.status} during ${scenario.id}`, observed: `${e.method} ${e.url} returned ${e.status}.`, triage: "pending — VENDOR_INVESTIGATION_REQUIRED" });
    }
    for (const scan of ev.run.accessibility) {
      for (const v of (scan.violations || []).filter((x) => ["serious", "critical"].includes(x.impact))) {
        ev.finding({ category: "ACCESSIBILITY_FINDING", severity: null, title: `axe: ${v.help}`, observed: `${v.id} (${v.impact}, ${v.wcag.join(", ")}) on ${scan.url} at ${scan.viewport}: ${v.nodes} element(s), e.g. ${v.examples.join(" | ")}`, triage: "pending — automated rule; confirm manually" });
      }
    }
    if (outcome.status === "ABANDONED") ev.finding({ category: "OBSERVED_NAVIGATION_BLOCKER", severity: null, title: `${persona.label}: task abandoned`, observed: outcome.reason, triage: "pending" });
    if (scenario.scienceExpectationId && ev.run.equitasResponses.length) {
      const budget = guard.testerBudgetLeft();
      ev.run.science = await evaluateScience(budget.ok ? manifest : { ...manifest, testerAi: { ...manifest.testerAi, skipJudge: true } }, scenario, ev.run.equitasResponses, {
        client: aiClient, finalPageText: ev.run.finalPageText,
        onUsage: (u, m) => { const c = usageUsd(u, m); ev.run.metrics.testerUsd += c; guard.recordTesterSpend(c); },
      });
      if (!budget.ok) ev.run.science.aiJudge = `not run: ${budget.reason}`;
    } else if (scenario.scienceExpectationId) {
      ev.run.science = { status: "NOT_EVALUATED", reason: "No EQUITAS response was captured." };
    }
    return ev.finish(outcome);
  } finally {
    lock.release();
  }
}

// Wait until the page's main text stops changing, then return what was added.
// The new content is what lies between the longest common prefix and suffix of
// the before/after text, so repeated lines and in-place updates are kept.
export async function waitForResponse(page, before, timeoutSec) {
  const startT = Date.now();
  let prev = "", stable = 0, now = "";
  while (Date.now() - startT < timeoutSec * 1000) {
    await page.waitForTimeout(3000);
    now = await mainText(page);
    if (now === prev && now !== before) { if (++stable >= 2) break; } else stable = 0;
    prev = now;
  }
  return { newText: diffMiddle(before || "", now), seconds: Math.round((Date.now() - startT) / 1000), timedOut: Date.now() - startT >= timeoutSec * 1000 };
}

export function diffMiddle(before, after) {
  // Line-based: drop the lines shared at the start and at the end; what is
  // left in `after` is the new content (repeated lines inside it are kept).
  const a = before.split("\n"), b = after.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return b.slice(i, b.length - j).join("\n").trim();
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  if (!args.scenario || !args.account) { console.error("Usage: npm run scenario -- --scenario <id> --account <id> [--viewport mobile] [--headed]"); process.exit(2); }
  const run = await runScenario({ scenarioId: args.scenario, accountId: args.account, viewport: args.viewport || "desktop", headed: !!args.headed, attended: !!args.attended });
  console.log(`${run.scenarioId}: ${run.outcome.status} — ${run.outcome.reason}\nEvidence: evidence/runs/${run.runId}/run.json`);
}
