# mult_agent_hp_tokenomics — Harry Potter multi-agent + token meter starter

Chat app with a **boss agent** and **book specialist workers** (one per Harry Potter novel). Starting point for Lecture 11 tokenomics: same multi-agent desk as Lecture 10, ready for a token usage meter.

`data/harrypotter.db` is included (SQLite `books` table with per-novel text). Use chunk retrieval — do not dump whole novels into prompts. Source PDFs are not in this repo.

## Quick start

### 1. Env

Copy `.env.example` → `.env`:

```
PORTKEY_API_KEY=your_key
MODEL_NAME=gpt-6-luna
```

### 2. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### 3. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open http://127.0.0.1:5173 — Vite proxies `/api` to port 8000.

## Layout

```
mult_agent_hp_tokenomics/
  .env.example
  README.md
  data/
    harrypotter.db
  backend/
    main.py
    requirements.txt
    models.py
    retrieval.py
    agents/
    prompts/
  frontend/
```
