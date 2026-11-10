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

export function redact(text) {
  if (text == null) return text;
  let t = String(text);
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
