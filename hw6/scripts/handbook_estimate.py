"""Count the tokens in data/shop_handbook.md and estimate the cost of sending it.

Run from the hw6 folder:  python3 scripts/handbook_estimate.py
Needs:  pip install tiktoken
"""
import json
from decimal import Decimal
from pathlib import Path

import tiktoken

HW6 = Path(__file__).resolve().parent.parent
HANDBOOK = HW6 / "data" / "shop_handbook.md"
PRICES = HW6 / "data" / "prices.json"
MODEL = "gpt-6-luna"
MILLION = Decimal(1_000_000)

# newline="" keeps the file's Windows-style line endings (\r\n) exactly as they
# are, so we count the same text that would be sent to the model.
text = HANDBOOK.read_text(encoding="utf-8", newline="")
encoding = tiktoken.get_encoding("o200k_base")
tokens = len(encoding.encode(text))

rates = json.loads(PRICES.read_text(encoding="utf-8"), parse_float=Decimal)[MODEL]
input_rate = rates["input_per_1m"]
cache_write_rate = rates["cache_write_per_1m"]
cache_read_rate = rates["cached_input_per_1m"]


def cost(token_count, rate_per_million):
    return Decimal(token_count) * rate_per_million / MILLION


uncached_call = cost(tokens, input_rate)
cache_write_call = cost(tokens, cache_write_rate)
cache_read_call = cost(tokens, cache_read_rate)

print(f"Characters:  {len(text):,}")
print(f"Tokens:      {tokens:,}  (tiktoken {tiktoken.__version__}, {encoding.name})")
print()
print(f"Without caching, 1 call:      ${uncached_call}")
print(f"Without caching, 1,000 calls: ${uncached_call * 1000}")
print(f"With caching, 1 call:         ${cache_write_call}  (writes the cache)")
print(f"With caching, 1,000 calls:    ${cache_write_call + 999 * cache_read_call}"
      "  (1 write + 999 reads)")
