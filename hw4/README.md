# Campus Customs (hw4)

Campus Customs is an online shop for Yale apparel. The website is built with **React + Vite + TypeScript**, the API with **FastAPI**, and the AI shopping assistant with **PydanticAI** on **Claude**.

- **Pages:** Home, Products (search, category and size-in-stock filters, sorting, stock on every card), product detail (availability summary and stock per size), About Us, Log In and Create Account, plus a Recently viewed section
- **Chat:** an AI shopping assistant in the bottom-right corner. It looks up real products, prices and stock, shows matching products on the page, remembers logged-in customers, suggests in-stock alternatives and asks clarifying questions.
- **Accounts:** customers can register and log in. Passwords are hashed with PBKDF2-HMAC-SHA256 (120,000 rounds).
- **Database:** products and stock are only ever read. The only writes are new `users` rows when someone registers and `chat_messages` rows when a logged-in customer chats.
- **Safety and audit:** written safety rules for the assistant, backed up in code, plus an audit trail of every chatbot run in `output/audit_trail.json`, with no customer details

> **New to running this on a Mac?** Follow the step-by-step guide in [RUN_ON_MAC.md](RUN_ON_MAC.md).

## Project layout

```
hw4/
├── README.md               This file: how to run and test the website
├── AI_prompts.md           Every prompt used to build the project, by problem
├── RUN_ON_MAC.md           Step-by-step setup guide for macOS
├── .env.example            Settings template with placeholders (copy to .env; never commit .env)
├── backend/                FastAPI API and the shopping assistant
│   ├── main.py             The FastAPI app: products, images, accounts and the /api/chat endpoints
│   ├── agent.py            The PydanticAI agent: model, settings, instructions and the price check
│   ├── tools.py            The assistant's read-only catalogue tools
│   ├── models.py           Request, reply and tool-result models, and the agent's dependencies
│   ├── prompts/prompt.md   The assistant's instructions and safety rules
│   ├── audit.py            The audit trail and removal of sensitive details from messages
│   ├── auth.py             Password hashing, login cookies and the /api/auth endpoints
│   ├── db.py               SQLite access (products and stock are read-only)
│   ├── config.py           Loads hw4/.env
│   ├── setup_env.py        Creates .env with a random SESSION_SECRET and asks for your API key
│   ├── check_chat.py       Sends one real question to Claude
│   ├── check_safety.py     Checks the safety rules against the real model
│   ├── export_static.py    Exports data for the static preview
│   ├── requirements.txt    Python packages
│   └── tests/              pytest tests (API, accounts, chatbot, tools, audit trail, safety)
├── frontend/               React + Vite + TypeScript website
│   ├── src/                Pages, components and styles; src/test/ has the Vitest tests
│   ├── scripts/app-check.mjs  Browser check that writes output/app_check.html
│   └── package.json        Scripts: dev, build, test, lint, app-check, build:preview
├── output/                 Assignment write-ups and results
│   ├── harness.md          How everything works: database, accounts, models, tools, safety rules, limits, audit trail
│   ├── usability.md        Problem 9: usability improvements
│   ├── design.md           Problem 10: design improvements
│   ├── app_check.html      Problem 11: tested features with screenshots
│   ├── app_check_images/   Screenshots used by app_check.html
│   └── audit_trail.json    Problem 12: the chatbot audit trail (created by the first chat)
└── data/                   NOT in GitHub: the database and original product images
```

## What's not in GitHub

| Excluded | Why | How you get it |
|---|---|---|
| `data/campus_customs.db` and `data/products/*.jpg` | The database and original product images are provided separately | Unzip `data.zip` into `hw4/` |
| `.env` | Holds the API key and the login secret | `python setup_env.py --api-key` creates it from `.env.example` |
| `node_modules/`, `.venv/`, `dist/`, caches | Installed or generated | Created by `npm install`, `pip install` and the builds |

These are listed in the repository's `.gitignore`.

## How to run the website

You need **Python 3.11+**, **Node.js 20+**, `data.zip`, and an Anthropic API key from https://platform.claude.com/settings/keys (the site works without a key, but the chat won't answer).

### 1. Add the data

Unzip `data.zip` into this `hw4` folder so you have:

```
hw4/data/campus_customs.db
hw4/data/products/*.jpg
```

To keep the data somewhere else, set `CAMPUS_DATA_DIR=/path/to/data`.

### 2. Set up and start the API (port 8000)

```bash
cd hw4/backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python setup_env.py --api-key      # first time only: creates hw4/.env; typing the key is hidden
python check_chat.py               # optional: one real question to Claude, to check the key
uvicorn main:app --reload --port 8000
```

`setup_env.py` copies `.env.example` to `hw4/.env`, fills in a random 64-character `SESSION_SECRET`, and with `--api-key` asks for your key. It never prints secrets, and it makes the file readable only by you. It won't replace the session secret unless you pass `--force`, which logs everyone out. Settings already set in your shell take priority over `.env`.

### 3. Start the website (port 5173)

In a second terminal:

```bash
cd hw4/frontend
npm install                        # first time only
npm run dev
```

Open **http://localhost:5173**. Vite forwards `/api` and `/media` requests to the API.

- **Test account:** `test@campuscustoms.yale.edu` / `password`, or create your own.
- **Things to try in the chat:** "What hoodies do you have?", "Is the Champion Reverse Weave Hoodie 1 in stock in XL?", or "Do you have this in pink?" on a product page.

## How to test it

| Command | Run in | What it checks | Needs the API key |
|---|---|---|---|
| `python -m pytest` | `hw4/backend` | 132 tests: API, accounts, chatbot, tools and accuracy against the database, audit trail, safety rules, setup | No (needs `data/`) |
| `npm test` | `hw4/frontend` | 32 component tests: pages, filters, stock, chat, results panel, memory | No |
| `npm run lint` and `npm run build` | `hw4/frontend` | Code style and the production build | No |
| `python check_chat.py` | `hw4/backend` | One real question to Claude | Yes |
| `python check_safety.py` | `hw4/backend` | Nine tricky questions against the safety rules | Yes |
| `npm run app-check` | `hw4/frontend`, with the API and website running | Drives the real site in a browser and writes `output/app_check.html` with screenshots. First time: `npx playwright install chromium` | For the chatbot tests |
| `python audit.py` | `hw4/backend` | Shows the latest chatbot runs from `output/audit_trail.json` | No |

The automated tests use a scripted stand-in for Claude, so they're free. They never change the real database (tests that write use a copy) or the real audit trail.

## API

| Endpoint | Description |
|---|---|
| `GET /api/products?category=&q=&sort=&size=` | Product list, with stock per size. `sort` is `name`, `price-asc` or `price-desc`; `size` (XS-XXL) keeps only products in stock in that size |
| `GET /api/products/{product_id}` | One product, with stock for each size |
| `GET /api/categories` | Product categories with counts |
| `GET /media/products/{file}.jpg` | Product images |
| `POST /api/auth/register` | Create an account and log in |
| `POST /api/auth/login` | Log in (sets a session cookie) |
| `POST /api/auth/logout` | Log out |
| `GET /api/auth/me` | The logged-in customer |
| `POST /api/chat` | Send a message to the shopping assistant |
| `GET /api/chat/history` | The logged-in customer's saved chat |
| `GET /api/health` | Health check |

## More documentation

- **`output/harness.md`:** the database tables, accounts, how a chat message travels, the models, tools, accuracy checks, safety rules, limits, audit trail and all settings
- **`output/usability.md`**, **`output/design.md`**, **`output/app_check.html`:** Problems 9, 10 and 11
- **`AI_prompts.md`:** the prompts behind each problem

## Static preview

`npm run build:preview` (in `frontend/`) builds a version of the site that needs no server, in `frontend/dist-preview/`. It exports product and stock data (no accounts or chats) to `data/catalog.json` and copies the product images, so it's git-ignored. Log In, Create Account and the chat are turned off in it.
