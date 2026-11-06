# AI Prompts Log: Homework 6

A record of the prompts used during Homework 6, organized by assignment problem. Each section gives the problem number and title, my original prompt exactly as written, and any follow-up prompts with a short note on what was missing after the first attempt.

---

## Problem 1: Vibe Coder Prompts

### Original prompt

> Homwork 6: Create an `AI_prompts.md` file to document my AI prompts throughout this assignment. Organize it by problem number and title, including my initial prompt and any follow-up prompts.

### Follow-up prompts

**Follow-up 1**

> Remove the stray edit from `hw4/AI_prompts.md` and leave the rest of Homework 4 unchanged.
>
> For Homework 6, update the Problem 1 title to **Vibe Coder Prompts**. Keep `hw6/AI_prompts.md` updated as we work through each problem.
>
> Also, confirm that all Homework 6 files are being saved in the `hw6/` folder.

*What was missing:* The first attempt used a placeholder title for Problem 1 because the assignment's title wasn't known. It also left an uncommitted edit in `hw4/AI_prompts.md` that recorded this Homework 6 prompt in the Homework 4 log. This prompt gave the correct title and asked for the Homework 4 file to be restored.

---

## Problem 2: Size Up the Handbook

### Original prompt

> For Problem 2, calculate the token count for `shop_handbook.md` and explain how you measured it. Using the GPT-6 Luna rates in `prices.json`, calculate the cost of sending the handbook for 1 call and 1,000 calls, with and without caching. Show the calculations and save the results in `hw6/output/handbook_estimate.md`. Update `AI_prompts.md`.

### Follow-up prompts

**Follow-up 1**

> @"/root/.claude/uploads/960ea48b-242b-55bc-8716-20def2c1f94c/16aa9a8c-data_1.zip"

*(This message was just an uploaded file, `data_1.zip`, which contains `shop_handbook.md`, `prices.json`, `practice_key.json` and the practice and exam documents. They were saved in `hw6/data/`, which is kept out of GitHub.)*

*What was missing:* After the first prompt, neither `shop_handbook.md` nor `prices.json` was in the project, so the tokens couldn't be counted and the costs couldn't be worked out. Uploading `data_1.zip` provided both files. The handbook was measured at 10,069 tokens with `tiktoken` (`o200k_base`), and the results were saved in `hw6/output/handbook_estimate.md`, along with the script that calculates them, `hw6/scripts/handbook_estimate.py`.

---

## Problem 3: Vendor Desk Agent

### Original prompt

> For Problem 3, I need to build a vendor desk agent using PydanticAI and GPT-6 Luna. It should review PDF, HTML, and email documents, identify the vendor, SKU, price, delivery time, and minimum order, and use the shop handbook to decide whether to recommend the purchase. I also need it to briefly explain each decision. Please create the four required files and update my prompt log.

### Follow-up prompts

**Follow-up 1**

> For Problem 3, I forgot to include Panel B. The agent also needs two test tools for emails and payments that only log attempted actions without actually sending or paying anything.
>
> Please track each run's token usage, cost, tool activity, and final recommendation. Test the agent using practice documents p01 and p08, and create the required file explaining the fields and tools. Update my prompt log.

*What was missing:* The first version had no email or payment tools, no record of each run, and no file explaining the fields and tools. This prompt added `send_email` and `approve_payment` test tools that only log the attempt, and a run log (`hw6/output/run_log.json`) with each run's tokens, cost, tool calls, attempted actions and final recommendation. It also added `hw6/output/harness.md`, which explains the fields and tools. p01 and p08 were tested with the offline stand-in, and both were recommended, matching the key. A real GPT-6 Luna test needed an OpenAI API key. The request to add one in the cloud workspace was declined, so those runs' tokens and costs are estimates.

---

## Problem 4: Prompt Caching Comparison

### Original prompt

> For Problem 4, I want to test the agent on all 12 practice documents with and without caching to see how much money it saves. Please compare the token usage and actual costs for both approaches using the provided pricing.
>
> I also want to understand how the results compare to our estimates from Problem 2, what it would cost to process 1,000 documents a day for 30 days, and whether anything in the results was unexpected.
>
> Please save the results in the required files and update my prompt log.

---
