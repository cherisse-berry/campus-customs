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
