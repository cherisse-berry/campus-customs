"""Run the Campus Customs vendor desk agent on vendor documents.

Every run is added to output/run_log.json (token usage, cost, tool activity,
attempted emails or payments, and the final recommendation).

Examples (from the hw6 folder):
    python main.py data/practice_docs/p01_bluehen_quote.html data/practice_docs/p08_chapelst_email.eml
    python main.py data/practice_docs --key data/practice_key.json
    python main.py data/exam_docs --json output/exam_results.json
    python main.py data/practice_docs --offline     # test without an API key
"""

import argparse
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")  # keep the report readable

from agent import RUN_LOG_PATH, offline_model, review_document  # noqa: E402
from models import RunRecord  # noqa: E402
from tools import SUFFIX_KINDS  # noqa: E402

KEY_FIELDS = ("vendor", "sku", "unit_price", "lead_time_days", "min_order", "decision")


def find_documents(paths: list[str]) -> list[Path]:
    found: list[Path] = []
    for p in map(Path, paths):
        if p.is_dir():
            found += sorted(f for f in p.iterdir() if f.suffix.lower() in SUFFIX_KINDS)
        elif p.is_file():
            found.append(p)
        else:
            sys.exit(f"Not found: {p}")
    return found


def show(run: RunRecord) -> None:
    print(f"\n{run.file}   (run {run.run_id}, {run.model}, {run.duration_seconds}s)")
    r = run.recommendation
    if r is None:
        print(f"  Couldn't review this document: {run.error}")
    else:
        def money(v):
            return "unknown" if v is None else f"${v:.2f}"

        def num(v, unit):
            return "unknown" if v is None else f"{v:,} {unit}"

        print(f"  Vendor:        {r.vendor}")
        print(f"  SKU:           {r.sku or 'unknown'}")
        print(f"  Unit price:    {money(r.unit_price)}")
        print(f"  Lead time:     {num(r.lead_time_days, 'days')}")
        print(f"  Minimum order: {num(r.min_order, 'units')}")
        print(f"  Decision:      {r.decision.upper().replace('_', ' ')}")
        print(f"  Reason:        {r.reason}")
        for check in run.checks:
            print(f"    [{'pass' if check.passed else 'FAIL'}] {check.check}: {check.detail}")

    t, c = run.tokens, run.cost
    estimate = "" if t.measured else " (offline estimate)"
    print(f"  Tokens{estimate}: {t.input_tokens:,} in ({t.cache_read_tokens:,} cached), "
          f"{t.output_tokens:,} out, {t.requests} model calls")
    print(f"  Cost{estimate}: ${c.total:.6f} at {c.model_rates} rates")
    print(f"  Tools: {', '.join(a.tool for a in run.tool_activity) or 'none'}"
          f"; output check retries: {run.output_check_retries}")
    if run.attempted_actions:
        print(f"  !! Attempted {len(run.attempted_actions)} action(s) - logged only, nothing sent or paid:")
        for action in run.attempted_actions:
            print(f"     - {action.tool}({json.dumps(action.arguments)[:140]})")
    else:
        print("  Attempted actions: none")
    if run.hidden_passages_removed:
        print(f"  Hidden passages ignored: {run.hidden_passages_removed}")


def score(runs: list[RunRecord], key_path: Path) -> int:
    key = {row["file"]: row for row in json.loads(key_path.read_text(encoding="utf-8"))}
    graded = [r for r in runs if r.file in key]
    correct = 0
    print(f"\nScore against {key_path.name}:")
    for run in graded:
        expected = {f: key[run.file][f] for f in KEY_FIELDS}
        got = run.recommendation.model_dump(include=set(KEY_FIELDS)) if run.recommendation else {}
        wrong = [f"{f}: got {got.get(f)!r}, expected {expected[f]!r}" for f in KEY_FIELDS if got.get(f) != expected[f]]
        correct += not wrong
        print(f"  {'OK  ' if not wrong else 'MISS'} {run.file}" + ("" if not wrong else "  (" + "; ".join(wrong) + ")"))
    print(f"  {correct}/{len(graded)} documents fully correct")
    return len(graded) - correct


def main() -> None:
    parser = argparse.ArgumentParser(description="Review vendor documents against the Campus Customs shop handbook.")
    parser.add_argument("paths", nargs="+", help="vendor documents (.pdf, .html, .eml) or folders of them")
    parser.add_argument("--key", type=Path, help="answer key to score against, e.g. data/practice_key.json")
    parser.add_argument("--json", type=Path, help="also save this batch's recommendations to a JSON file")
    parser.add_argument("--log", type=Path, default=RUN_LOG_PATH, help=f"run log (default: output/{RUN_LOG_PATH.name})")
    parser.add_argument("--no-log", action="store_true", help="don't add these runs to the run log")
    parser.add_argument("--offline", action="store_true",
                        help="use a rule-based stand-in instead of GPT-6 Luna (for testing, no API key needed)")
    args = parser.parse_args()

    model = offline_model() if args.offline else None
    if args.offline:
        print("Offline test mode: a rule-based stand-in replaces GPT-6 Luna. Tokens and cost are estimates.")

    runs: list[RunRecord] = []
    for path in find_documents(args.paths):
        try:
            run = review_document(path, model=model, log_path=None if args.no_log else args.log)
        except RuntimeError as error:  # no API key
            sys.exit(str(error))
        runs.append(run)
        show(run)

    done = [r for r in runs if r.recommendation]
    total = sum(r.cost.total for r in runs)
    print(f"\n{len(done)}/{len(runs)} reviewed. Total cost: ${total:.6f}"
          + ("" if all(r.tokens.measured for r in runs) else " (offline estimate)"))
    if not args.no_log:
        print(f"Runs added to {args.log}")
    attempts = sum(len(r.attempted_actions) for r in runs)
    if attempts:
        print(f"!! {attempts} attempted email/payment action(s) logged. Nothing was sent or paid.")

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        rows = [{"file": r.file, **r.recommendation.model_dump()} for r in done]
        args.json.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
        print(f"Saved {len(rows)} recommendation(s) to {args.json}")

    misses = score(runs, args.key) if args.key else 0
    sys.exit(1 if len(done) < len(runs) or misses else 0)


if __name__ == "__main__":
    main()
