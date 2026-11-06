"""Run the Campus Customs vendor desk agent on vendor documents.

Examples (from the hw6 folder):
    python main.py data/practice_docs/p01_bluehen_quote.html
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

from pydantic_ai.exceptions import UnexpectedModelBehavior

from agent import offline_model, review_document
from models import ReviewResult
from tools import SUFFIX_KINDS

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


def show(result: ReviewResult) -> None:
    r = result.report

    def money(v):
        return "unknown" if v is None else f"${v:.2f}"

    def num(v, unit):
        return "unknown" if v is None else f"{v:,} {unit}"

    print(f"\n{result.file}")
    print(f"  Vendor:        {r.vendor}")
    print(f"  SKU:           {r.sku or 'unknown'}")
    print(f"  Unit price:    {money(r.unit_price)}")
    print(f"  Lead time:     {num(r.lead_time_days, 'days')}")
    print(f"  Minimum order: {num(r.min_order, 'units')}")
    print(f"  Decision:      {r.decision.upper().replace('_', ' ')}")
    print(f"  Reason:        {r.reason}")
    for check in result.checks:
        print(f"    [{'pass' if check.passed else 'FAIL'}] {check.check}: {check.detail}")
    if result.hidden_passages_removed:
        print(f"  Ignored {len(result.hidden_passages_removed)} hidden passage(s):")
        for passage in result.hidden_passages_removed:
            print(f"    - {passage[:120]}{'...' if len(passage) > 120 else ''}")


def score(results: list[ReviewResult], key_path: Path) -> int:
    key = {row["file"]: row for row in json.loads(key_path.read_text(encoding="utf-8"))}
    graded = [r for r in results if r.file in key]
    correct = 0
    print(f"\nScore against {key_path.name}:")
    for r in graded:
        expected = {f: key[r.file][f] for f in KEY_FIELDS}
        got = r.report.model_dump(include=set(KEY_FIELDS))
        wrong = [f"{f}: got {got[f]!r}, expected {expected[f]!r}" for f in KEY_FIELDS if got[f] != expected[f]]
        correct += not wrong
        print(f"  {'OK  ' if not wrong else 'MISS'} {r.file}" + ("" if not wrong else "  (" + "; ".join(wrong) + ")"))
    print(f"  {correct}/{len(graded)} documents fully correct")
    return len(graded) - correct


def main() -> None:
    parser = argparse.ArgumentParser(description="Review vendor documents against the Campus Customs shop handbook.")
    parser.add_argument("paths", nargs="+", help="vendor documents (.pdf, .html, .eml) or folders of them")
    parser.add_argument("--key", type=Path, help="answer key to score against, e.g. data/practice_key.json")
    parser.add_argument("--json", type=Path, help="save the results to this JSON file")
    parser.add_argument("--offline", action="store_true",
                        help="use a rule-based stand-in instead of GPT-6 Luna (for testing, no API key needed)")
    args = parser.parse_args()

    model = offline_model() if args.offline else None
    if args.offline:
        print("Offline test mode: a rule-based stand-in replaces GPT-6 Luna.")

    results: list[ReviewResult] = []
    failed: list[str] = []
    for path in find_documents(args.paths):
        try:
            result = review_document(path, model=model)
        except UnexpectedModelBehavior as error:  # e.g. the report failed the output check 3 times
            failed.append(path.name)
            print(f"\n{path.name}\n  Couldn't review this document: {error}")
            continue
        except RuntimeError as error:  # e.g. no API key
            sys.exit(str(error))
        results.append(result)
        show(result)

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        rows = [{"file": r.file, **r.report.model_dump()} for r in results]
        args.json.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
        print(f"\nSaved {len(rows)} result(s) to {args.json}")

    if failed:
        print(f"\nCouldn't review {len(failed)} document(s): {', '.join(failed)}")
    misses = score(results, args.key) if args.key else 0
    sys.exit(1 if failed or misses else 0)


if __name__ == "__main__":
    main()
