# campus-customs

The Campus Customs website: a Yale apparel shop built with **React + Vite + TypeScript** on the front end and **FastAPI** on the back end.

- **Pages:** Home, Products (search, category filters, sorting), product detail (sizes and current stock), About Us, Log In and Create Account
- **Chat:** a chat window in the bottom-right corner, ready to connect to the AI agent later
- **Database:** opened **read-only**, so the website can never change it

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
uvicorn app.main:app --reload --port 8000
```

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
| `GET /api/health` | Health check |

## Tests

```bash
cd backend && python -m pytest       # API tests (need data/ present)
cd frontend && npm test              # Component tests
cd frontend && npm run lint && npm run build
```

## Static preview

`npm run build:preview` (in `frontend/`) builds a version of the site that needs no server, in `frontend/dist-preview/`. It exports product and stock data (no user accounts or chats) to `data/catalog.json` and copies the product images. It's used for sharing a live preview and is git-ignored.

## Secrets

API keys go in a local `.env` file, which is git-ignored. Never commit keys, the database or the images.
