// Live-site safety contract (Section 4). Every action the agent proposes goes
// through checkAction() before it touches the page. Navigation outside the
// allowed hosts is stopped. Limits come from the manifest.
import fs from "node:fs";
import path from "node:path";

export const STOP = {
  CONSEQUENTIAL_ACTION: "CONSEQUENTIAL_ACTION_STOP",
  PLAN_SELECTION: "PLAN_SELECTION_STOP",
  OFF_DOMAIN: "OFF_DOMAIN_NAVIGATION_STOP",
  CREDENTIAL_FIELD: "CREDENTIAL_FIELD_STOP",
  AI_BUDGET: "EQUITAS_AI_SUBMISSION_LIMIT",
  ACTION_LIMIT: "ACTION_LIMIT_REACHED",
  TIME_LIMIT: "TIME_LIMIT_REACHED",
  REDIRECT_LIMIT: "UNEXPECTED_REDIRECT_LIMIT",
  NON_SYNTHETIC_TEXT: "NON_SYNTHETIC_TEXT_STOP",
};

const MONEY = /(\$|€|£|usd|\/\s?mo\b|per month|per year|\/\s?yr\b|annual(ly)?)/i;
const PLAN_CTA = /\b(select|choose|start|get started|continue with|activate|claim|try|trial|free|basic|pro|premium|plan)\b/i;
const SUBMIT_LIKE = /\b(send|submit|ask|analy[sz]e|assess|evaluate|generate|run|review|critique|start analysis|get feedback|go)\b/i;

export function makeGuard(manifest, { scenarioId, now = () => Date.now() } = {}) {
  const lim = manifest.limits;
  const prohibited = (manifest.prohibitedActionPatterns || []).map((p) => p.toLowerCase());
  const allowedHosts = new Set(manifest.target.allowedHosts.map((h) => h.toLowerCase()));
  const started = now();
  const state = { actions: 0, aiSubmissions: 0, redirects: 0, lastActionAt: 0 };
  const ledgerPath = path.join(manifest._root || ".", manifest.evidence?.storeDirectory || "evidence", "ledger.json");

  function ledger() {
    try { return JSON.parse(fs.readFileSync(ledgerPath, "utf8")); } catch { return {}; }
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function bumpLedger(field, n = 1) {
    const l = ledger();
    l[today()] ??= { scenarios: 0, aiSubmissions: 0, testerUsd: 0 };
    l[today()][field] += n;
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, JSON.stringify(l, null, 2));
    return l[today()];
  }

  function isAllowedHost(u) {
    try {
      const url = new URL(u);
      if (url.protocol === "about:" || url.protocol === "data:" || url.protocol === "blob:") return true;
      return allowedHosts.has(url.hostname.toLowerCase());
    } catch { return false; }
  }

  return {
    state,
    isAllowedHost,
    startScenario() {
      const d = ledger()[today()] || { scenarios: 0, aiSubmissions: 0, testerUsd: 0 };
      if (d.scenarios >= lim.maxScenariosPerDay) return { ok: false, stop: "DAILY_SCENARIO_LIMIT", reason: `Daily scenario limit (${lim.maxScenariosPerDay}) reached.` };
      if (manifest.testerAi?.approved && d.testerUsd >= manifest.testerAi.maxTesterSpendUsdPerDay)
        return { ok: false, stop: "DAILY_TESTER_SPEND_LIMIT", reason: "Daily tester-AI spend limit reached." };
      bumpLedger("scenarios");
      return { ok: true };
    },
    recordTesterSpend(usd) { bumpLedger("testerUsd", usd); },
    testerSpendToday() { return (ledger()[today()] || {}).testerUsd || 0; },

    // Called before every action. `ctx` describes the target element as the
    // agent sees it (role + accessible name) plus page context.
    async checkAction(action, ctx) {
      if (state.actions >= lim.maxActionsPerScenario) return { ok: false, stop: STOP.ACTION_LIMIT };
      if (now() - started > lim.maxMinutesPerScenario * 60_000) return { ok: false, stop: STOP.TIME_LIMIT };
      const name = (action.name || "").toLowerCase();

      if (action.type === "click" || action.type === "press_enter") {
        const hit = prohibited.find((p) => name.includes(p));
        if (hit) return { ok: false, stop: STOP.CONSEQUENTIAL_ACTION, reason: `Control "${action.name}" matches prohibited pattern "${hit}".` };
        if (MONEY.test(action.name || "")) return { ok: false, stop: STOP.CONSEQUENTIAL_ACTION, reason: `Control "${action.name}" mentions a price.` };
        if (ctx.href && !isAllowedHost(ctx.href)) return { ok: false, stop: STOP.OFF_DOMAIN, reason: `Link leads off the approved domain.` };
        if (ctx.onPlanPage && PLAN_CTA.test(action.name || "") && (action.role === "button" || action.role === "link")) {
          const free = /\bfree\b/i.test(action.name || "") || /\bfree\b/i.test(ctx.containerText || "");
          const paid = MONEY.test(ctx.containerText || "") && !/\$\s?0\b/.test(ctx.containerText || "");
          if (!(manifest.permittedWorkflows.selectFreePlan && free && !paid)) {
            return { ok: false, stop: STOP.PLAN_SELECTION, reason: `Plan-selection control "${action.name}" — not authorized in manifest (selectFreePlan=${manifest.permittedWorkflows.selectFreePlan}, looksFree=${free}, looksPaid=${paid}).` };
          }
        }
        const submits = SUBMIT_LIKE.test(action.name || "") || action.type === "press_enter";
        if (submits && ctx.pendingTextLength > 20) {
          if (!manifest.permittedWorkflows.submitSyntheticResearchQuestions) return { ok: false, stop: STOP.CONSEQUENTIAL_ACTION, reason: "Submitting research questions is not permitted in the manifest." };
          if (state.aiSubmissions >= lim.maxEquitasAiSubmissionsPerScenario) return { ok: false, stop: STOP.AI_BUDGET };
          const d = ledger()[today()] || { aiSubmissions: 0 };
          if (d.aiSubmissions >= lim.maxEquitasAiSubmissionsPerDay) return { ok: false, stop: STOP.AI_BUDGET, reason: "Daily EQUITAS AI submission limit reached." };
          return { ok: true, countsAsAiSubmission: true };
        }
      }

      if (action.type === "fill") {
        if (ctx.inputType === "password" || /password|passcode|one-time|otp|mfa|verification code|card|cvc|cvv/i.test(`${action.name} ${ctx.autocomplete || ""}`))
          return { ok: false, stop: STOP.CREDENTIAL_FIELD, reason: "The agent never types into credential, MFA or payment fields." };
        if (ctx.inputType === "email" || /e-?mail/i.test(action.name || ""))
          return { ok: false, stop: STOP.CREDENTIAL_FIELD, reason: "The agent never enters email addresses." };
        if (!ctx.textIsSynthetic) return { ok: false, stop: STOP.NON_SYNTHETIC_TEXT, reason: "Text is not from the scenario's approved synthetic inputs." };
      }
      return { ok: true };
    },

    async pace() {
      const wait = state.lastActionAt + lim.minDelayBetweenActionsMs - now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      state.lastActionAt = now();
    },
    countAction() { state.actions++; },
    countAiSubmission() { state.aiSubmissions++; bumpLedger("aiSubmissions"); },
    countRedirect() { state.redirects++; return state.redirects <= lim.maxUnexpectedRedirects; },
  };
}
