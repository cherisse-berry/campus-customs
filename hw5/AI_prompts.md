# AI Prompts Log — Homework 5

A record of the prompts I give the AI assistant while working on Homework 5, organized by problem number and title. Each section includes my original prompt and any follow-up prompts, with a brief explanation of what was missing or needed to be corrected.

---

## Problem 1: Vibe Coder Prompts

### Original prompt

> I am starting Homework 5. Please create a file called `AI_prompts.md` to document the instructions I give you while working on this assignment.
>
> Organize the file by problem number and title. For each problem, include my original prompt. If I give you a follow-up instruction because something was missing or needed to be corrected, include that prompt and a brief explanation of what needed to be fixed.
>
> Please record the prompts I actually give you, rather than creating examples or making up instructions. We will work through the assignment one problem at a time.

### Follow-up prompts

**Follow-up 1**

> Thank you. Please keep the file in the hw5 folder. Since this is Problem 1: Vibe Coder Prompts, please add a section for Problem 1 with my original instructions. We will add the remaining problem sections as we complete them. Please make sure the file stays updated throughout the assignment.

*What needed to be fixed:* The first version put my original prompt under a generic "Setup" heading instead of a section labeled with the problem number and title. It is now under Problem 1: Vibe Coder Prompts, and the file stays in the `hw5/` folder.

---

## Problem 2: Study the Campus Customs Database

### Original prompt

> @"/root/.claude/uploads/2e15021e-c810-5d06-9d80-81d7d9a388ad/1f6cf656-data_2.zip" Let's move on to Problem 2. I want you to review the Campus Customs database so we understand what information is available and how everything connects.
>
> Please go through all the tables and explain what information each one contains and why it matters for the agents we're building. Also, look at the three open tickets and explain how they relate to the information in the database.
>
> Make a copy of the original database so we can work with it without changing the original.
>
> Create the harness.md file to document what you find. Please explain everything in plain language so I can follow along.
>
> Also, update AI_prompts.md with this prompt and push the changes to GitHub.

### Follow-up prompts

**Follow-up 1**

> Thank you. Before we move on, I noticed a couple of things that need to be corrected.
>
> The assignment specifies that the original database should be named campus_customs.db and the working copy should be campus_customs_new.db. Please update the filenames so they match the assignment exactly.
>
> Also, the official title is Problem 2: Study the Campus Customs Database. Please correct that in AI_prompts.md.
>
> Since our final submission will be a public GitHub repository, please make sure there are clear instructions for how the database files can be set up when someone reviews the project.
>
> Please document this follow-up in AI_prompts.md, including what needed to be corrected, and commit and push the updates.

*What needed to be fixed:*

- **File names:** the first version named the original `campus_customs_original.db` and the working copy `campus_customs.db`. The assignment requires the original to be `campus_customs.db` and the working copy to be `campus_customs_new.db`. The files and `harness.md` now use those names.
- **Problem title:** the section was labeled "Analyze the Database" because no title had been given. It now uses the official title, "Study the Campus Customs Database".
- **Setup instructions:** the database files aren't in the repository, and the only setup note was one sentence in `harness.md`. A reviewer of the public repository had no clear way to recreate them. `hw5/README.md` now has step-by-step setup instructions, and `hw5/setup_db.py` creates both files from `data_2.zip`.

**Follow-up 2**

> Yes, please make sure the script stops if the database doesn't match the original assignment file. I don't want it replacing the original with the wrong data.
>
> Please test this without changing our existing files, update AI_prompts.md with this follow-up, and push the changes to GitHub.

*What needed to be fixed:* When `setup_db.py` was given a database that didn't match the one in `data_2.zip`, it replaced the original anyway and only printed a warning. It now checks the file's fingerprint before replacing anything, and stops without changing any files if it doesn't match. It also stops instead of creating or resetting the working copy if the original on disk has been altered. The changes were tested in a separate scratch folder with mismatched files, and the real database files were confirmed unchanged. `hw5/README.md` now describes this behavior.

---

## Problem 3: Build the MCP Server

### Original prompt

> Let's move on to Problem 3. I want to build the MCP server so our AI agents can access the information they need from the Campus Customs database.
>
> Please use FastMCP and make sure we're working with the copy of the database, not the original.
>
> Let's start with three tools that will help address the open tickets we reviewed in Problem 2. Each tool should have a clear purpose and only use information that's actually in the database.
>
> Please update harness.md to explain what each tool does, which tables it uses, how it relates to a specific ticket, and why it's needed. Also, create a README in the MCP server folder explaining what we've built.
>
> We don't need to run or connect the server yet. Please update AI_prompts.md with this prompt and push everything to GitHub.

### Follow-up prompts

**Follow-up 1**

> Thank you. The official title is Problem 3: Build the MCP Server, so please correct that in AI_prompts.md.
>
> I also noticed that the bulk order tool calculates a maximum discount of 62.07%. Can you explain how that number was determined and whether it means we should actually offer that discount? I want to make sure I understand what the tool is telling us.
>
> Please update AI_prompts.md with this follow-up and push the changes to GitHub.

*What needed to be fixed:*

- **Problem title:** the section was labeled only "Problem 3" because no title had been given. It now uses the official title, "Build the MCP Server".
- **Explaining the 62.07% figure:** nothing in the code changed, but the meaning of `max_discount_percent_without_loss` needed explaining. It's the break-even discount: ($58.00 list price − $22.00 unit cost) ÷ $58.00 = 62.07%, the discount at which the hoodie sells for exactly what it costs the shop, so the profit is $0. It's a limit, not a recommendation. It only counts the item's cost, not rent or other expenses, so the shop would actually lose money at that discount.

---

## Problem 4: Add the MCP Server to Vibe Coder and Test Each Tool

### Original prompt

> Let's move on to Problem 4. I want to connect the MCP server we built to our coding assistant so we can actually use the three tools.
>
> Please set up the connection for this project and then test each tool using the information from the Campus Customs database. I want to make sure all three tools work correctly and that the results match what's actually in our working database.
>
> Please save the connection settings and document the tests, including what you asked, which tool was used, and what it returned.
>
> Also, update AI_prompts.md with this prompt and push the changes to GitHub.

### Follow-up prompts

**Follow-up 1**

> Thank you. It looks like the three tools are working correctly.
>
> I noticed that the assignment asks for a file called output/mcp_smoke.json, but you mentioned creating mcp_tests.md instead. Can you check whether we have the required JSON file? If not, please create it using the results from the tests we already completed.
>
> Also, the official title is Problem 4: Add the MCP Server to Vibe Coder and Test Each Tool. Please correct that in AI_prompts.md.
>
> Please update the prompt log with this follow-up and push the changes to GitHub.

*What needed to be fixed:*

- **Missing required file:** the test results were only written up in `output/mcp_tests.md`; the required `output/mcp_smoke.json` didn't exist. It was created from the logs of the tests already run, without re-running them. For each test it records the question asked, the tool called, its arguments, the raw result, the assistant's answer and the database values it was checked against. It also includes the automated check (31 of 31 passed) and the database fingerprints before and after. For the fourth test (the connection re-check), the raw tool result hadn't been saved, so the file says so instead of filling it in.
- **Problem title:** the section was labeled only "Problem 4" because no title had been given. It now uses the official title, "Add the MCP Server to Vibe Coder and Test Each Tool".

---

## Problem 5: Build the Agent Team and Grow the MCP Tools

### Original prompt

> Let's move on to Problem 5. I want to build the five Campus Customs agents using PydanticAI: Boss, Inventory, Accounting, Facilities, and Customer Service.
>
> Each agent should have clear responsibilities and detailed instructions based on the shop's rules. They should all be able to communicate and delegate tasks to each other as needed.
>
> Please put the individual agent prompts in backend/prompts, the agent code in backend, and the data types in backend/models.py. Make sure all agents use only gpt-6-luna through Portkey.
>
> We also need to expand our MCP tools so the agents can address the three open tickets. All shop information should come through the MCP server using our working database, not a separate system.
>
> I want to track what each agent does, including decisions and communication between agents. Please save this in output/audit_trail.json without overwriting previous activity.
>
> Make sure the agents follow the shop's rules, particularly around payments, available cash, vendor restrictions, discounts, and customer communications. Human approval should be required where appropriate, and no messages should actually be sent. We also need limits on AI usage to control costs.
>
> Please update harness.md with all the agents and MCP tools, including which tables they use, and update the MCP server README.
>
> Finally, add this prompt to AI_prompts.md under Problem 5: Build the Agent Team and Grow the MCP Tools, then commit and push everything to GitHub.

### Follow-up prompts

**Follow-up 1**

> Here are the shop rules you need for Problem 5:
>
> All payments require human approval and must be recorded in the database. Payments cannot exceed available cash or result in a negative balance. Vendors with unpaid invoices cannot ship additional products.
>
> Revenue is only received when customers pick up their orders. Discounts require human approval, and there is no established discount policy, so please don't invent one.
>
> Agents can draft customer messages but cannot send them or contact vendors directly. Use desk.date_today as the shop's date.
>
> All five agents must use gpt-6-luna through Portkey with PORTKEY_API_KEY. Keep the API key private and out of GitHub.
>
> Please use these rules to proceed with Problem 5.Do not hallucinate. Update AI_prompts.md with this clarification and commit and push the changes to GitHub.

*What was missing:* The original prompt asked the agents to follow "the shop's rules", but the rules weren't in the database, the data zip or the repository. Before building anything, the assistant asked where the rules should come from, and the user chose to paste them. This follow-up supplied the rules, how the model is reached (gpt-6-luna through Portkey with `PORTKEY_API_KEY`) and that the key must stay out of GitHub. Nothing had been built before this clarification, so there was nothing to correct. The agents, prompts and code checks were written from these rules as given, without adding a discount policy or other rules of their own.

**Follow-up 2**

> Thank you. Before moving on, I have a few questions.
>
> I noticed you made some assumptions about payments, particularly requiring the exact amount and using a 31-day window for rent. Are those rules necessary, or could they create problems?
>
> Also, for the hoodie order, I want the agents to be able to evaluate different discounts and make a recommendation, while leaving the final decision to a person. Does our current setup allow that?
>
> Finally, since we haven't tested the agents with the actual AI model, please clarify what has been verified and what still needs testing.
>
> Please review these issues and make any necessary corrections without adding new business rules. Update AI_prompts.md with this follow-up and push the changes to GitHub.

*What needed to be fixed:*

- **Payment assumptions:** the first version refused any payment that didn't exactly match the amount on file, and any payment on a bill already paid. Neither is a shop rule. They would have blocked legitimate partial payments, for example paying part of a bill when cash is short. The 31-day window for deciding whether rent was paid was an arbitrary cut-off that could miscount early or late payments, and it never moved the lease on to the next month. Now:
  - Only the shop's rules block a payment: no more than the available cash and no negative balance (plus basic validity, such as a positive amount).
  - Partial payments, extra payments and payments on already-paid bills are allowed with warnings that the approver sees.
  - What's still owed is worked out from the payments recorded. An invoice is marked paid once it's fully covered. Rent moves `leases.next_due` on a month for each full month paid.
- **Discount recommendations:** the first version told the agents never to suggest or recommend a discount, and the approval request had nowhere to put one. Now:
  - Accounting can evaluate several discount levels with `price_bulk_order` and recommend one for that specific request, with reasons, in the discount approval request.
  - The code re-checks every option's figures and requires the recommendation to be one of the evaluated options with a reason.
  - A person still decides in `approve.py`, nothing is offered to the customer, and the agents are told not to turn a recommendation into a general discount rule.
- **What has been tested:** `harness.md` now has a section listing what was verified without the real model (23 offline tests plus the Problem 4 checks) and what still needs testing with gpt-6-luna through Portkey. That includes the connection and model name, tool calling and structured output, the agents' actual judgment, whether the usage limits fit, and the end-to-end scripts.

**Follow-up 3**

> Thank you. The changes make sense. I have one remaining question about payments.
>
> If a bill has already been paid, or someone enters more than the amount owed, does the system clearly alert the person approving it before the payment goes through? I want to make sure we don't accidentally pay the same bill twice.
>
> Please explain how that works and whether anything needs to be changed. Also, update AI_prompts.md with this follow-up.

*What needed to be fixed:* The warnings shown in `approve.py` were the ones worked out when the agents made the request, not when the person approved it. If two requests for the same bill were pending (for example, invoice 501 in the plans for both Ticket 101 and Ticket 102), the second showed no warning after the first was paid. A single `y` would pay the bill twice, and the "already paid" warning only came back after the payment was recorded. Now:
- **Live check:** `approve.py` re-checks each payment against the database right before asking, and shows what's still owed, any warnings and any other pending request for the same bill.
- **Typed confirmation:** a payment with any warning needs the person to type `PAY ANYWAY`.
- **Server-side check:** `record_payment` refuses a payment unless the approver confirmed exactly the warnings that apply at that moment, so a bill paid in the meantime can't go through unseen.
- **Refusals stay pending:** a refused payment stays pending for review.
- **Same bill twice in one plan:** this is flagged on the later request.

No business rule was added: the person approving can still pay, after seeing and confirming the warnings. Four new tests cover this (27 in total).

---

