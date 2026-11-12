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
  PROJECT_CREATION: "PROJECT_CREATION_NOT_AUTHORIZED",
  UNNAMED_CONTROL: "UNNAMED_CONTROL_REFUSED",
  NOT_SIGNED_IN: "SAVED_LOGIN_NOT_ACCEPTED",
  WORKFLOW_NOT_PERMITTED: "WORKFLOW_NOT_PERMITTED",
};

const MONEY = /(\$|€|£|usd|\/\s?mo\b|per month|per year|\/\s?yr\b|annual(ly)?)/i;
const PLAN_CTA = /\b(select|choose|start|get started|continue with|activate|claim|try|trial|free|basic|pro|premium|plan)\b/i;
const PROJECT_CREATE = /\b(new|create|add|save)\b[^.]{0,30}\b(project|study|workspace|idea|draft|brief)\b|^\s*(save|create)\b/i;
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

    // Called before every action. The checks use the element's REAL name and
    // text from the page (ctx.actualName / ctx.actualText), together with the
    // name the agent gave, so a loosely named target can't slip past.
    // `recoverable: true` means the action is refused but the scenario goes on
    // (the agent is told and picks another step).
    async checkAction(action, ctx) {
      if (state.actions >= lim.maxActionsPerScenario) return { ok: false, stop: STOP.ACTION_LIMIT };
      if (now() - started > lim.maxMinutesPerScenario * 60_000) return { ok: false, stop: STOP.TIME_LIMIT };
      const acts = ["click", "press_enter", "fill"].includes(action.type);
      const shown = ctx.actualName || action.name || "";
      const allText = [action.name, ctx.actualName, ctx.actualText].filter(Boolean).join(" ");
      const lower = allText.toLowerCase();
      const pw = manifest.permittedWorkflows || {};

      if (acts && !(ctx.actualName || "").trim() && !(ctx.actualText || "").trim()) {
        return { ok: false, recoverable: true, stop: STOP.UNNAMED_CONTROL, reason: "The control has no accessible name or text, so it can't be checked; it is never clicked." };
      }

      if (action.type === "click" || action.type === "press_enter") {
        const hit = prohibited.find((p) => lower.includes(p));
        if (hit) return { ok: false, stop: STOP.CONSEQUENTIAL_ACTION, reason: `Control "${shown}" matches prohibited pattern "${hit}".` };
        if (MONEY.test(allText)) return { ok: false, stop: STOP.CONSEQUENTIAL_ACTION, reason: `Control "${shown}" mentions a price.` };
        if (ctx.href && !isAllowedHost(ctx.href)) return { ok: false, stop: STOP.OFF_DOMAIN, reason: `Link leads off the approved domain.` };
        if (ctx.onPlanPage && PLAN_CTA.test(allText) && (action.role === "button" || action.role === "link")) {
          const free = /\bfree\b/i.test(allText) || /\bfree\b/i.test(ctx.containerText || "");
          const paid = MONEY.test(ctx.containerText || "") && !/\$\s?0\b/.test(ctx.containerText || "");
          if (!(pw.selectFreePlan && free && !paid)) {
            return { ok: false, stop: STOP.PLAN_SELECTION, reason: `Plan-selection control "${shown}" — not authorized in manifest (selectFreePlan=${!!pw.selectFreePlan}, looksFree=${free}, looksPaid=${paid}).` };
          }
        }
        if (!pw.createSyntheticProjects && PROJECT_CREATE.test(allText)) {
          return { ok: false, stop: STOP.PROJECT_CREATION, reason: `Control "${shown}" looks like it creates or saves a project; createSyntheticProjects is false in the manifest.` };
        }
        // Any click or Enter while typed text is waiting to be sent is treated
        // as a submission, whatever the button is called ("Continue", an icon…).
        // This may over-count (e.g. clicking away), never under-count.
        if (ctx.pendingTextLength > 20) {
          if (!pw.submitSyntheticResearchQuestions) return { ok: false, stop: STOP.CONSEQUENTIAL_ACTION, reason: "Submitting research questions is not permitted in the manifest." };
          if (state.aiSubmissions >= lim.maxEquitasAiSubmissionsPerScenario) return { ok: false, stop: STOP.AI_BUDGET, reason: `Scenario limit of ${lim.maxEquitasAiSubmissionsPerScenario} EQUITAS submissions reached.` };
          const d = ledger()[today()] || { aiSubmissions: 0 };
          if (d.aiSubmissions >= lim.maxEquitasAiSubmissionsPerDay) return { ok: false, stop: STOP.AI_BUDGET, reason: "Daily EQUITAS AI submission limit reached." };
          return { ok: true, countsAsAiSubmission: true, looksLikeSubmit: SUBMIT_LIKE.test(allText) || action.type === "press_enter" };
        }
      }

      if (action.type === "fill") {
        const fieldText = `${allText} ${ctx.autocomplete || ""}`;
        if (ctx.inputType === "password" || /password|passcode|one-time|otp|mfa|verification code|card|cvc|cvv/i.test(fieldText))
          return { ok: false, stop: STOP.CREDENTIAL_FIELD, reason: "The agent never types into credential, MFA or payment fields." };
        if (ctx.inputType === "email" || /e-?mail/i.test(fieldText))
          return { ok: false, stop: STOP.CREDENTIAL_FIELD, reason: "The agent never enters email addresses." };
        if (!ctx.textIsSynthetic) return { ok: false, stop: STOP.NON_SYNTHETIC_TEXT, reason: "Text is not from the scenario's approved synthetic inputs." };
        const prefix = manifest.syntheticData?.recordPrefix || "UXTEST";
        if (!pw.createSyntheticProjects && (action.text || "").startsWith(prefix + "-") && /name|title|project/i.test(fieldText))
          return { ok: false, stop: STOP.PROJECT_CREATION, reason: "Typing a project name; createSyntheticProjects is false in the manifest." };
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
