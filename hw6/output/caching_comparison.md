# Caching Comparison: 12 Practice Documents

What prompt caching saves when the vendor desk agent reviews all 12 practice documents, how that compares with the Problem 2 estimate, and what 1,000 documents a day for 30 days would cost.

> **These are simulated runs, not measured GPT-6 Luna costs.** No OpenAI API key was available in the cloud workspace, so no real calls were made. The real agent ran through PydanticAI's real OpenAI client. A local stand-in answered each request the way a correct review goes, and every request the agent would have sent to OpenAI was captured and its tokens counted. To get measured costs, run `python3 scripts/caching_comparison.py --live` with `OPENAI_API_KEY` set. See [How to run it](#how-to-run-it).

## Results

| 12 practice documents | Without caching | With caching |
|---|---:|---:|
| Model requests | 36 | 36 |
| Input tokens | 429,525 | 429,525 |
| …read from the cache | 0 | 403,200 |
| …written to the cache | 0 | 11,520 |
| …not cached | 429,525 | 14,805 |
| Output tokens | 3,195 | 3,195 |
| **Cost** | **$0.044550** | **$0.008550** |

**Caching saves $0.036 on the 12 documents: 80.8% cheaper.** Once the cache is warm, each document costs **$0.000603 instead of $0.003713 (83.8% cheaper).**

All 12 recommendations match `practice_key.json` in both cases. Caching changes what the requests cost, not what they say.

| 1,000 documents a day for 30 days (30,000 documents) | Cost |
|---|---:|
| Without caching | **$111.38** |
| With caching, cache written once a day | **$18.12** |
| With caching, cache expired before every document (worst case) | $57.59 |
| **Saved by caching** | **$93.25 a month (83.7%)** |

---

## How it was measured

1. **Run the agent on each document.** `scripts/caching_comparison.py` reviews the 12 practice documents in order (p01 to p12). It uses the real agent, tools and output check, and PydanticAI's real `OpenAIChatModel`. Only the HTTP replies are local.
2. **Capture every request.** Each review took 3 requests:
   - read the fields and look up the vendor;
   - run the purchasing checks;
   - return the report.

   Each request contains the 7 tool definitions, the instructions with the full handbook, the document, and the conversation so far.
3. **Count the tokens** with `tiktoken` `o200k_base`, the same tokenizer as Problem 2. I added OpenAI's usual 3 tokens of wrapping per message, plus 3 to start each reply.
4. **Price the same 36 requests twice** at the GPT-6 Luna rates in `data/prices.json`:
   - **Without caching:** input × $0.10, output × $0.50 per 1M tokens.
   - **With caching:** the part that's identical in every request (tool definitions + instructions + handbook = 11,603 tokens) is the cacheable prefix. OpenAI caches in 128-token blocks, so 11,520 tokens are cached. The first request writes them at $0.125 per 1M. Every later request reads them at $0.01 per 1M. Everything else is billed at $0.10 per 1M.

### What's in one request

| Part of the first request for p01 | Tokens |
|---|---:|
| Tool definitions (6 tools + the report format) | 998 |
| Instructions | 544 |
| Shop handbook | 10,058 |
| Message wrapping | 3 |
| **Shared prefix (the same in every request)** | **11,603** |
| Document, prompt and reply priming | 147 |
| **Total input** | **11,750** |

The second and third requests also carry the earlier tool calls and results, so their uncached part grows from 230 to 404 to 595 tokens.

### The cost with caching, worked through

| | Tokens | Rate per 1M | Cost |
|---|---:|---:|---:|
| Cache write (first request only) | 11,520 | $0.125 | $0.001440 |
| Cache reads (other 35 requests) | 403,200 | $0.01 | $0.004032 |
| Input not cached | 14,805 | $0.10 | $0.001481 |
| Output | 3,195 | $0.50 | $0.001598 |
| **Total** | | | **$0.008550** |

Without caching: 429,525 × $0.10 ÷ 1M + 3,195 × $0.50 ÷ 1M = $0.042953 + $0.001598 = **$0.044550**.

### The 30-day projection, worked through

- **Without caching:** $0.0037125 per document × 30,000 = **$111.38**
- **With caching, one cache write a day:** $0.000603 per warm document × 30,000 = $18.08, plus the extra cost of writing the cache once a day, $0.001317 × 30 = $0.04, for **$18.12**.
  - 1,000 documents a day is one about every 86 seconds, which is short enough for the cache to stay warm. Spread evenly over a day, that assumes the cache lasts at least a few minutes between documents.
- **Worst case, the cache expires before every document:** each document pays the cache write, like p01 did, at $0.00192 × 30,000 = **$57.59**. That's still about half the cost without caching, because the second and third requests within each review reuse the first one's cache.

---

## Compared with the Problem 2 estimate

| | Problem 2 estimate | Problem 4 (simulated) | Difference |
|---|---:|---:|---:|
| Model requests per document | 1 | 3 | 3× |
| Shared prefix per request | 10,069 (handbook only) | 11,603 | +15% |
| Input tokens per document | 10,069 | 35,794 | 3.6× |
| Cost per document, no caching | $0.0010069 | $0.0037125 | 3.7× |
| Cost per document, warm cache | $0.00010069 | $0.000603 | 6.0× |
| 1,000 documents, no caching | $1.01 | $3.71 | 3.7× |
| 1,000 documents, with caching | $0.10 | $0.60 | 5.9× |
| Savings from caching | 89.9% | 83.7% (1,000 documents) | 6.2 points less |

**Problem 2 was right about the handbook, but it underestimated the cost of a review by about 3.7 times.** Problem 2 priced the handbook alone, sent once. A real review sends it three times, with tools and instructions added.

Why the numbers differ:

1. **Three requests per document, not one.** PydanticAI sends the whole conversation, including the handbook, on every request. The agent needs three: one to read the fields and look up the vendor, one to run the checks, and one to return the report.
2. **The prefix is bigger than the handbook.** The tool definitions (998 tokens) and instructions (544 tokens) are sent with it.
3. **The handbook itself is 11 tokens smaller.** Problem 2 counted it with its Windows line endings (10,069). The agent normalizes them, so it sends 10,058.
4. **Caching saves a little less** (about 84% instead of 90%):
   - the document, the growing conversation and the output can't be cached;
   - the prefix is cached in 128-token blocks, so 83 of its tokens are always billed at the full rate.

---

## What was unexpected

1. **Caching already pays off on the first document.** Problem 2 found a single call costs 25% *more* with caching, because of the cache write. But a document is three calls, so p01 costs $0.00192 with caching against $0.00371 without (48% less), even though it pays the cache write.
2. **Once caching is on, the output becomes a real share of the cost.** Without caching, output is 3.6% of the cost. With caching it's 18.7% ($0.0016 of $0.0086), the second-largest cost after cache reads. Once the handbook is cached, shorter replies are the next saving.
3. **Even the worst case saves half.** If the cache expired between every document, caching would still cut the month from $111 to $58, because the three requests within one review share a cache.
4. **Every document costs almost the same.** Per-document cost without caching ranges only from $0.003702 to $0.003733. Each document adds only a few hundred tokens next to the 11,603-token prefix, so the document type (PDF, HTML or email) hardly affects cost.
5. **No retries and no attempted actions** in any run, so these figures are a best case. A real model that falls for a trap and gets sent back by the output check would add a request, about $0.0002 with caching or $0.0012 without.

---

## Limits of this simulation

- **Not measured.** Real GPT-6 Luna runs may differ:
  - the model may write more output, including reasoning tokens;
  - it may use two requests or four instead of three;
  - OpenAI formats tool definitions more compactly than the JSON counted here, so the prefix may be a little smaller.
- **Cache writes.** `prices.json` lists a cache-write rate ($0.125 per 1M), so it's charged once per warm cache, as in Problem 2. OpenAI's own automatic caching doesn't charge for writes. Without that charge, the 12-document total with caching would be $0.007110 (84.0% saved).
- **Cache lifetime.** OpenAI keeps a cached prefix for a few minutes of inactivity, and sometimes up to an hour. The projection assumes the documents arrive steadily enough to keep it warm. The worst-case line covers the opposite.

---

## How to run it

From the `hw6` folder:

```
pip install -r requirements.txt
python3 scripts/caching_comparison.py           # simulated, no API key needed
export OPENAI_API_KEY=...                       # your key
python3 scripts/caching_comparison.py --live    # real GPT-6 Luna, measured costs
```

**Live mode** reviews each document twice:

- **Without caching:** a random line is placed at the start of every request's instructions, so OpenAI can't reuse any earlier request.
- **With caching:** the requests are left unchanged.

Its token counts, including cached tokens, come from OpenAI's usage reports. Live runs are also added to `output/run_log.json`. They cost about 12 × ($0.0037 + $0.0007) ≈ $0.05.

All results, including every request's token counts, are saved to `output/caching_results.json`.
