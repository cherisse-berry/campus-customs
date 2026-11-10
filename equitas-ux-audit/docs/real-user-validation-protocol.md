# Real-user validation protocol (Section 25)

Automated persona runs only generate hypotheses. This protocol tests them with real investigators. No claim that "users" can or can't do something should be made until these sessions are complete.

## 1. Participants (target 10–14 for formative rounds)

| Segment | n | Recruitment criteria |
|---|---|---|
| Early-stage (PhD/postdoc) | 2–3 | Currently developing a first independent question |
| Junior faculty | 2 | ≤5 years in faculty role, ≤1 external award |
| Senior PI | 2 | ≥2 major awards; has served as a reviewer |
| International investigator | 2–3 | Based outside the US; include ≥1 at a resource-constrained institution |
| Limited institutional support (US) | 1–2 | No research office or statistician access |
| Research administrator | 1–2 | Supports proposal development (only if institutional features are in scope) |

Exclude Appifest staff, EQUITAS investors and anyone who has used EQUITAS for more than 1 hour. Spread disciplines (clinical, basic, computational, social/behavioural). Don't select on demographics, and don't interpret results by demographic group.

## 2. Consent and privacy

- Written informed consent covering: purpose, voluntary participation, recording (screen + audio, optional video), storage location, retention (e.g., 12 months), who sees recordings, and the right to withdraw.
- Ask whether the founder's institution requires IRB review or a non-human-subjects determination for usability research, and record the answer before recruiting.
- Participants use **synthetic or public research ideas only**. Supply a task card. Tell them not to enter unpublished data, PHI or confidential grant text.
- Use dedicated test accounts per participant with a clearly marked entitlement. Never use the founder account.
- Compensation (e.g., gift card) is disclosed in consent and doesn't depend on performance.

## 3. Session (60 min, moderated, remote or in person)

1. Intro and consent check (5 min). "We are testing the website, not you."
2. First impression (5 min): open the home page. "What do you think this site offers? Where would you start?"
3. Tasks (40 min). Use neutral wording that never names the module or button:
   - T1 Start: "Sign in and get to the point where you could begin working on a research idea."
   - T2 Research-first: "Use the site to develop this idea: [task card matched to segment, e.g. BENCH-CHW-HTN vague/advanced/international]."
   - T3 Interpret: "Tell me what the site concluded and what you would do next."
   - T4 Funding-first: "Find out whether any funding could fit this project for someone in your situation."
   - T5 Revision: "Your question has changed to [card]. Update your work."
   - T6 Return (second short session 2–7 days later): "Pick up where you left off."
   - Admin segment instead: "Find out how your faculty would get access and what data the site keeps."
4. Debrief interview (10 min).

Think-aloud protocol. The moderator gives no hints. After 3 minutes stuck, offer one standard prompt ("What would you try next?"). If still stuck, mark the task failed and move on.

## 4. Observation template (per task)

| Field | Values |
|---|---|
| Completed | yes / with assistance / no |
| Time on task | seconds (from task read to declared done) |
| First click | correct / incorrect (+ label clicked) |
| Wrong paths & dead ends | count + description |
| Errors / system messages | verbatim |
| Participant's statement of "what EQUITAS did" | verbatim |
| Matches what EQUITAS actually did | yes / partly / no |
| Stated next step | verbatim |
| Severity of observed problem | P0–P3 using Section 20 |
| Quotes | verbatim |

## 5. Debrief questions

- What was easiest or hardest to find?
- How confident are you in the feedback you got? What would make it more or less trustworthy?
- Was the level of explanation right for you? Too basic or too advanced where?
- Did any advice not fit your institution, country or resources?
- If you came back next week, how would you find your work?
- What would stop you using this for a real project?

## 6. Scientific review (separate from usability)

For each captured EQUITAS response, two independent qualified reviewers in the relevant discipline, blinded to persona and session, rate it against `config/scientific-expectations.json`: required concepts, critical errors, overclaims, uncertainty, specificity. They resolve disagreements by discussion and record inter-rater agreement. Expectation entries change to `expert_reviewed` only after this, with reviewer role and date.

## 7. Analysis

- Task success rate, time and error counts **per segment**. Report small-n results as counts (e.g., "2 of 3"), not percentages, and don't pool segments into one average.
- Affinity-map observations into issues. Each issue gets frequency, segments affected, severity and evidence (clip timestamp).
- Compare with the automated findings: confirmed, not observed, or new. Only confirmed or new issues from these sessions become `ACTUAL_HUMAN_USER_FINDING`.

## 8. Remediation verification

For each fix Appifest ships: rerun the matching automated regression (`npm run probe-plan` or `npm run scenario`) on the same account type, then rerun the affected task with 3–5 new participants from the affected segment. A fix is verified when the acceptance criteria pass in both.
