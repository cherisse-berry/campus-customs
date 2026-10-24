# AI Prompts Log

A record of the prompts used while building the Campus Customs website, organized by assignment problem.

---

## Problem 1: Vibe Coder Prompts

### Original prompt

> Create a file called AI_prompts.md in my campus-customs project to keep track of all the prompts I use while building the website. Start by recording this prompt, and keep adding my prompts as we work through each problem. Don't start building the website yet.

### Follow-up prompts

**Follow-up 1**

> Please organize AI_prompts.md with a separate section for each assignment problem. Each section should include the problem number and title, the exact prompts I gave you, and any follow-up prompts with a brief explanation of what was missing after the first attempt.
>
> Start with Problem 1: Vibe Coder Prompts. Keep my original prompt exactly as written. Don't add prompts I haven't actually given you or create sections for problems we haven't started.

*What was missing:* The first version listed prompts in one running sequence. It had no section for each assignment problem and no place to record follow-up prompts or what they fixed.

---

## Problem 2: Analyze the Database

### Original prompt

> For Problem 2, I want to understand how the Campus Customs database is organized. Please examine the database and explain the tables, including the product catalogue, inventory, and users.
>
> Create a file called output/harness.md that lists each table and its fields, with a brief explanation of why each field matters for the website or chatbot.
>
> Please also add this prompt to AI_prompts.md under Problem 2: Analyze the Database. Don't change the database or start building the website yet.

### Follow-up prompts

**Follow-up 1**

> @"/root/.claude/uploads/fdfd79a1-0a59-5b7b-a0c0-1989838dd95a/79ba9514-data.zip"

*(This message was just an uploaded file, `data.zip`, which contains `campus_customs.db` and the product images.)*

*What was missing:* After the first prompt, there was no database in the project, so `output/harness.md` couldn't be written. Uploading `data.zip` provided the database, and the analysis was then completed.

---

## Problem 3: Build the Website

### Original prompt

> For Problem 3, build a clean, professional Campus Customs website using React, Vite, and TypeScript, inspired by yalebulldogblue.com.
>
> Include Home, Products, About Us, Log In, and Create Account pages. Display products from the database with images, prices, and descriptions. Each product should open a detailed page showing sizes and current stock.
>
> Add a chat window in the bottom-right corner that we'll connect to the AI agent later. Use FastAPI to retrieve product data and images.
>
> Test the website, keep the database unchanged, and exclude the database, images, and API keys from GitHub. Update AI_prompts.md

### Follow-up prompts

**Follow-up 1**

> Can you show me a live preview of the Campus Customs website so I can review the design and functionality?

*What was missing:* The first build only ran on servers inside the private cloud workspace, so the only way to see it was through screenshots. This prompt led to a static preview build that runs without a server, published as a private live page for review.

---

## Problem 4: Customer Accounts

### Original prompt

> For Problem 4, make the Create Account and Log In pages functional. Customers should be able to register with their name, email, and password, and then log in.
>
> Save new accounts in the users table and securely hash passwords using PBKDF2-HMAC-SHA256 with 120,000 iterations, matching the existing database format.
>
> Test login with the existing account (test@campuscustoms.yale.edu / password) and a new account. Update output/harness.md to explain how authentication works, and record this prompt in AI_prompts.md.

### Follow-up prompts

**Follow-up 1**

> Please help me set up SESSION_SECRET for my website and make sure everything works properly.

*What was missing:* After the first attempt, no `SESSION_SECRET` was set up, and the backend only read `.env` if the server was started with an extra flag. Without a fixed secret, everyone was logged out whenever the server restarted. This prompt added automatic loading of `backend/.env`, a `setup_env.py` script that generates a strong secret, and warnings for a missing or weak secret.

---

## Problem 5: AI Shopping Assistant

### Original prompt

> For Problem 5, connect the Campus Customs chat window to a working AI chatbot using PydanticAI and FastAPI.
>
> Set up the required agent, tools, models, and prompt files. The chatbot should be friendly, helpful, and appropriate for a college merchandise store, with basic safety guidelines.
>
> Make sure messages from the website reach the agent and return responses. Help me set up the API key securely, test that everything works, and update AI_prompts.md and output/harness.md.

---
