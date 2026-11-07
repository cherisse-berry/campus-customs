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

---
