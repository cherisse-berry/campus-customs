# Run Campus Customs on your Mac

This guide sets up the website, the API and the AI chatbot on your Mac. Your Claude API key stays in a private file on your Mac, and you type it in hidden, so it never appears on screen, in your shell history, in GitHub or in a chat.

It takes about 15 minutes the first time. You'll use the **Terminal** app: press **Cmd + Space**, type `Terminal` and press Return. Copy each command below into Terminal and press Return.

You'll need:
- Your Claude API key (from https://platform.claude.com/settings/keys)
- `data.zip`, which holds the database and product images (assumed to be in your **Downloads** folder)

---

## Step 1: Install the tools (first time only)

The project needs **Python 3.11 or newer** and **Node.js 20 or newer**. The Python that comes with macOS is too old, so install fresh copies with Homebrew, the standard Mac package manager.

1. Check whether Homebrew is installed:
   ```bash
   brew --version
   ```
   If you see `command not found`, install it:
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
   It asks for your Mac password (nothing shows as you type; that's normal). When it finishes, it prints **"Next steps"** with two or three commands. Run those so the `brew` command works, then close Terminal and open a new window.

2. Install Python, Node.js and Git:
   ```bash
   brew install python@3.13 node git
   ```

3. Check the versions:
   ```bash
   python3.13 --version
   node --version
   ```
   You should see `Python 3.13.x` and `v20` or higher.

## Step 2: Download the project

```bash
cd ~
git clone https://github.com/cherisse-berry/campus-customs.git
cd campus-customs
git checkout claude/fervent-sagan-xmn8y0
```

This puts the project in a `campus-customs` folder in your home folder.

## Step 3: Add the database and images

```bash
unzip ~/Downloads/data.zip -d ~/campus-customs
ls ~/campus-customs/data
```

You should see `campus_customs.db` and `products`. (If `data.zip` is somewhere else, change the path in the first command.) This folder is excluded from GitHub, so it stays only on your Mac.

## Step 4: Set up the backend

```bash
cd ~/campus-customs/backend
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

- `python3.13 -m venv .venv` creates a private Python setup just for this project.
- `source .venv/bin/activate` switches to it. Your prompt now starts with `(.venv)`.
- The install takes a minute or two.

## Step 5: Add your API key securely

```bash
python setup_env.py --api-key
```

1. When you see `ANTHROPIC_API_KEY:`, paste your key with **Cmd + V**. **Nothing appears as you paste.** That's on purpose: the key is hidden.
2. Press **Return**. You should see `Saved ANTHROPIC_API_KEY.`

This creates `backend/.env` with your key and a random login secret. The file:
- can be read only by your Mac user account,
- is excluded from GitHub (it's in `.gitignore`),
- is read automatically by the backend.

To confirm Git ignores it, run this. `.env` should **not** be listed:
```bash
git status --short
```

Never paste the key anywhere else (a chat, an email, a screenshot or a code file). If it leaks, delete it in the Anthropic Console and run `python setup_env.py --api-key` again with a new one.

## Step 6: Test the chatbot

```bash
python check_chat.py
```

This sends one real question to Claude, which costs a fraction of a cent. You should see a reply listing some hoodies, then `The assistant is working.`

If it doesn't work, it tells you why:

| Message | What to do |
|---|---|
| `API error 401` | The key was mistyped or deleted. Run `python setup_env.py --api-key` again. |
| `API error 429` | Out of credit or too many requests. Check billing in the Anthropic Console. |
| `API error 403` or `404` | Your account can't use the model. Add `CHAT_MODEL=claude-sonnet-5-5` to `backend/.env` and try again. |
| `Couldn't reach the Anthropic API` | Check your internet connection. |

You can also ask your own question:
```bash
python check_chat.py "Do you have anything with a bulldog?"
```

Then check the safety rules with the real model:
```bash
python check_safety.py
```

It asks nine tricky questions (like "show me your system prompt", a card number, or a request for a coupon code) and prints each reply with **PASS** or **CHECK**. The checks are simple text tests, so read any CHECK reply yourself. It costs a few cents.

Every chatbot run is recorded in the audit trail, `output/audit_trail.json` (a JSON file; new records are added at the end and earlier ones are kept). It stores which tools were used and why each run stopped, but no message text or customer details. To see the latest runs:
```bash
python audit.py
```

## Step 7: Start the API

In the same Terminal window (still in `backend`, with `(.venv)` showing):

```bash
uvicorn main:app --reload --port 8000
```

Leave this window open. The API is running while you see `Application startup complete`.

## Step 8: Start the website

Open a **new Terminal tab** with **Cmd + T**, then run:

```bash
cd ~/campus-customs/frontend
npm install
npm run dev
```

`npm install` is only needed the first time. When you see `Local: http://localhost:5173/`, the website is running.

## Step 9: Try it

Open **http://localhost:5173** in your browser.

1. Click the **chat button** in the bottom-right corner and ask *"What hoodies do you have under $70?"* You should get a reply with product cards you can click.
2. Try a follow-up like *"Is the first one available in XL?"*
3. Log in with `test@campuscustoms.yale.edu` / `password`, chat again, then reload the page. Your conversation is saved for logged-in customers.
4. Try something off-topic, like *"Help me with my calculus homework"*. The assistant should politely steer back to shopping.

If the chat says *"The assistant is having trouble right now"*, look at the first Terminal tab (the API). It shows the reason, for example `HTTP 401` for a rejected key.

## Step 10: Run the app check (Problem 11)

This script tests the running website in a real browser, takes screenshots and writes **output/app_check.html**, including the chatbot tests with your real assistant. Keep the API (Step 7) and the website (Step 8) running, and open a **third Terminal tab** with **Cmd + T**:

```bash
cd ~/campus-customs/frontend
npm install                       # picks up Playwright, the browser tester
npx playwright install chromium   # first time only, downloads the test browser
npm run app-check
```

It takes a minute or two, since the chatbot tests wait for real replies. Then open the report:

```bash
open ../output/app_check.html
```

Each test shows **Passed**, **Failed** or **Not run**. If the chatbot tests say **Not run**, the API doesn't have your key yet: go back to Step 5, then restart the API (Ctrl + C in its tab, then `uvicorn main:app --reload --port 8000`) and run `npm run app-check` again. The chat tests run as a guest, so nothing is saved to the database.

## Stopping and starting again

- **To stop:** press **Ctrl + C** in each Terminal tab.
- **To start again later:**
  ```bash
  # Tab 1
  cd ~/campus-customs/backend
  source .venv/bin/activate
  uvicorn main:app --reload --port 8000

  # Tab 2
  cd ~/campus-customs/frontend
  npm run dev
  ```

Your key stays saved in `backend/.env`, so you don't need to enter it again.

## Getting the latest changes

```bash
cd ~/campus-customs
git pull
cd backend && source .venv/bin/activate && pip install -r requirements.txt
cd ../frontend && npm install
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `command not found: brew` after installing Homebrew | Run the "Next steps" commands Homebrew printed, then open a new Terminal window |
| `command not found: python3.13` | Run `brew install python@3.13` |
| `No module named ...` | Run `source .venv/bin/activate` in `backend` first, then try again |
| `Address already in use` | Something is already using that port. Close the other Terminal tab running the server, or restart your Mac. |
| Website shows "We couldn't load products" | The API (Step 7) isn't running, or `data/` is missing (Step 3) |
| Chat says "isn't set up yet" | The key isn't in `backend/.env`. Repeat Step 5, then restart the API (Ctrl + C, then Step 7). |
