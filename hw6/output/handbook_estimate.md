# Handbook Token Count and Cost Estimate

How many tokens `shop_handbook.md` takes up, and what it costs to send it to GPT-6 Luna once and 1,000 times, with and without prompt caching.

## Results

**`shop_handbook.md` = 10,069 tokens**

| | 1 call | 1,000 calls |
|---|---:|---:|
| Without caching | $0.0010069 | **$1.0069** |
| With caching | $0.001258625 | **$0.101847935** (about $0.10) |

With caching, 1,000 calls cost about **$0.91 less (89.9% cheaper)**. A single call costs **25% more** with caching, because the first call pays the higher cache-write rate.

These figures are for the handbook as **input only**. They leave out the question, the documents sent with it, and the model's reply.

---

## How the tokens were measured

| | |
|---|---|
| File | `hw6/data/shop_handbook.md` |
| Size | 29,241 characters (29,241 bytes), 6,127 words, 338 lines |
| Tokenizer | `o200k_base`, OpenAI's tokenizer for its current GPT models |
| Tool | OpenAI's `tiktoken` Python library, version 0.14.0 |
| **Token count** | **10,069** |

**Steps:**

1. Read the file exactly as it is. The handbook uses Windows-style line endings (`\r\n`) on all 338 lines. Python normally converts these to plain `\n` when it reads a file, which would remove 338 characters and make the count **11 tokens too low (10,058)**. The script opens the file with `newline=""` so the line endings stay as they are.
2. Encode the text with `o200k_base` and count the tokens.

The script that does this is [`hw6/scripts/handbook_estimate.py`](../scripts/handbook_estimate.py). It also works out every cost below.

**Why `o200k_base`:** `prices.json` gives the rates as "OpenAI Standard pricing", so GPT-6 Luna is treated as an OpenAI model. OpenAI's current models use `o200k_base` (`tiktoken.encoding_for_model("gpt-4o")` returns it). `tiktoken` has no entry for GPT-6 Luna, so this assumes it uses the same tokenizer.

**Cross-checks:**

| Method | Tokens |
|---|---:|
| `tiktoken` 0.14.0, `o200k_base` (the count used) | **10,069** |
| `js-tiktoken` 1.0.21, `o200k_base` (JavaScript version of tiktoken) | 10,069 |
| `gpt-tokenizer` 2.9.0, `o200k_base` | 10,072 |
| `cl100k_base`, the older GPT-4 tokenizer (for comparison) | 10,191 |
| Rule of thumb: about 4 characters per token (29,241 ÷ 4) | about 7,310 |

- `gpt-tokenizer` counts 3 more because it splits words like "item's" into " item" + "'s". `tiktoken` keeps each as one token.
- The rule of thumb is well off for this file: it averages **2.9 characters per token**, not 4. The handbook has many numbers, prices, SKUs, list markers and Markdown symbols, and these break into short tokens.

**A note on the setup:** the cloud workspace's network blocked `tiktoken` from downloading the `o200k_base` file. So I rebuilt the file from the copy bundled in the `js-tiktoken` npm package and checked it against the SHA-256 hash that `tiktoken` expects (`446a9538…0cfb1a2d`). It matched exactly, so `tiktoken` counted with the official, unmodified file. On a normal computer, `pip install tiktoken` downloads the file automatically.

---

## Rates used

From `hw6/data/prices.json`, model `gpt-6-luna` ("OpenAI Standard pricing, per 1M tokens (MGT 409 Lecture 11)"):

| Rate | Per 1M tokens | Used for |
|---|---:|---|
| `input_per_1m` | $0.10 | Input sent without caching |
| `cache_write_per_1m` | $0.125 | The first call, which stores the handbook in the cache |
| `cached_input_per_1m` | $0.01 | Later calls that read the handbook from the cache |
| `output_per_1m` | $0.50 | The model's reply. Not used here, because only the cost of *sending* the handbook was asked for |

**Formula:** cost = tokens × (rate per 1M tokens ÷ 1,000,000)

---

## Calculations

### Cost of one handbook at each rate

| Rate | Calculation | Cost |
|---|---|---:|
| Input, no caching | 10,069 × $0.10 ÷ 1,000,000 | $0.0010069 |
| Cache write | 10,069 × $0.125 ÷ 1,000,000 | $0.001258625 |
| Cache read | 10,069 × $0.01 ÷ 1,000,000 | $0.00010069 |

### Without caching

Every call sends the handbook at the full input rate.

- **1 call:** 1 × $0.0010069 = **$0.0010069** (about a tenth of a cent)
- **1,000 calls:** 1,000 × $0.0010069 = **$1.0069**
  - Check: 1,000 × 10,069 = 10,069,000 tokens = 10.069M tokens × $0.10 = $1.0069 ✓

### With caching

The first call writes the handbook to the cache. Every later call reads it from the cache.

- **1 call:** 1 cache write = **$0.001258625**
  - That is $0.000251725 (25%) more than without caching, because the cache-write rate ($0.125) is higher than the normal input rate ($0.10).
- **1,000 calls:** 1 cache write + 999 cache reads
  - = $0.001258625 + (999 × $0.00010069)
  - = $0.001258625 + $0.10058931
  - = **$0.101847935** (about $0.10)

### Comparison for 1,000 calls

| | Cost |
|---|---:|
| Without caching | $1.0069 |
| With caching | $0.101847935 |
| **Savings** | **$0.905052065** (89.9%) |

**Break-even:** caching pays for itself from the **second call**. Two calls cost $0.0020138 without caching and $0.001359315 with it (1 write + 1 read).

---

## Assumptions

1. **GPT-6 Luna uses `o200k_base`.** `prices.json` names it as an OpenAI model but doesn't say which tokenizer it uses.
2. **Only the handbook is counted.** Each real call would also include the question or vendor document, plus a few formatting tokens from the API's message wrapping, and the reply would be charged at $0.50 per 1M tokens.
3. **The cache stays warm.** All 1,000 calls happen while the handbook is still in the cache, and the handbook comes first in every prompt, unchanged, so it can be reused. If the cache expired between calls, the handbook would have to be written to the cache again, and the cost would go up.
4. **One cache write is charged.** `prices.json` lists a cache-write rate, so the first cached call is charged at $0.125 per 1M tokens instead of the normal $0.10. If the cache were already filled before the first call, a single call would cost only the read rate: **$0.00010069**.
5. **The handbook is long enough to cache.** Many providers only cache prompts above a minimum length, often 1,024 tokens. At 10,069 tokens, the handbook is well above that.
