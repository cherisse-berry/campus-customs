# campus-customs

The Campus Customs website: a Yale apparel shop built with **React + Vite + TypeScript** on the front end and **FastAPI** on the back end.

- **Pages:** Home, Products (search, category filters, sorting), product detail (sizes and current stock), About Us, Log In and Create Account
- **Chat:** an AI shopping assistant (PydanticAI + Claude) in the bottom-right corner that looks up real products and stock (see `output/harness.md`)
- **Accounts:** customers can register and log in; passwords are hashed with PBKDF2-HMAC-SHA256 (see `output/harness.md`)
- **Database:** product and stock data is only ever read; the only writes are new `users` rows when someone registers and `chat_messages` rows when a logged-in customer chats

> **New to running this locally on a Mac?** Follow the step-by-step guide in [RUN_ON_MAC.md](RUN_ON_MAC.md).

## Project layout

```
backend/    FastAPI app: product, stock and image API (+ pytest tests)
frontend/   React + Vite + TypeScript website (+ Vitest tests)
data/       Database and product images (local only, not in GitHub)
output/     Notes, e.g. harness.md (database guide)
```

## Setup

### 1. Add the data

The database and images are **not** stored in GitHub. Unzip `data.zip` into the project root so you have:

```
data/campus_customs.db
data/products/*.jpg
```

To keep the data somewhere else, set `CAMPUS_DATA_DIR=/path/to/data`.

### 2. Start the API (port 8000)

```bash
cd backend
pip install -r requirements.txt
python setup_env.py --api-key   # one time: creates .env, asks for your Anthropic API key
python check_chat.py            # optional: sends one test question to Claude
uvicorn app.main:app --reload --port 8000
```

`setup_env.py` writes a 64-character random `SESSION_SECRET` to `backend/.env`, which the API loads automatically. With `--api-key`, it also asks for your Anthropic API key (create one at https://platform.claude.com/settings/keys). What you type is hidden, and the key is saved only to `.env`. Run it once on each computer that runs the site. It never prints secrets and won't replace the session secret unless you pass `--force`, which also logs everyone out. Without an API key the site still works, but the chat says the assistant isn't set up yet.

### 3. Start the website (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite forwards `/api` and `/media` requests to the API.

## API

| Endpoint | Description |
|---|---|
| `GET /api/products?category=&q=&sort=` | Product list. `sort` is `name`, `price-asc` or `price-desc` |
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

## Tests

```bash
cd backend && python -m pytest       # API tests (need data/ present)
cd frontend && npm test              # Component tests
cd frontend && npm run lint && npm run build
```

## Static preview

`npm run build:preview` (in `frontend/`) builds a version of the site that needs no server, in `frontend/dist-preview/`. It exports product and stock data (no user accounts or chats) to `data/catalog.json` and copies the product images. Log In, Create Account and the chat assistant are turned off in it, since they need the server. It's used for sharing a live preview and is git-ignored.

## Secrets

`ANTHROPIC_API_KEY` and `SESSION_SECRET` go in a local `backend/.env` file, which is git-ignored (`backend/.env.example` shows the format). Never commit keys, the database or the images.
