// Redaction for anything written to evidence or sent to the tester AI.
const PATTERNS = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, "[REDACTED_JWT]"],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}\b/g, "[REDACTED_KEY]"],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_KEY]"],
  [/\b(?:\d[ -]?){13,19}\b/g, "[REDACTED_NUMBER]"],
  [/\+?\d{1,3}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[REDACTED_PHONE]"],
  [/([?&](?:token|code|state|session|sid|auth|key|access_token|id_token)=)[^&#\s]+/gi, "$1[REDACTED]"],
];

// Words the founder lists locally in the manifest (evidence.redactTerms), such
// as their own name, institution or account names that appear on screen.
// They are removed from everything stored and from everything sent to the
// tester AI. The list itself never leaves the computer.
let TERMS = [];
export function setRedactTerms(terms = []) {
  TERMS = terms
    .filter((t) => typeof t === "string" && t.trim().length >= 2)
    .sort((a, b) => b.length - a.length)
    .map((t) => new RegExp(t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "gi"));
}

export function redact(text) {
  if (text == null) return text;
  let t = String(text);
  for (const re of TERMS) t = t.replace(re, "[REDACTED_NAME]");
  for (const [re, rep] of PATTERNS) t = t.replace(re, rep);
  return t;
}

export function redactUrl(u) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) {
      if (/token|code|state|session|sid|auth|key|email/i.test(k)) url.searchParams.set(k, "REDACTED");
    }
    url.hash = url.hash ? "#[hash]" : "";
    return redact(url.toString());
  } catch {
    return redact(u);
  }
}
