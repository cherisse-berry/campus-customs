# Campus Customs Desk (dashboard)

React + Vite + TypeScript dashboard for the Campus Customs agents (Problem 8). It shows the three tickets, runs the agents on a ticket, shows what each agent says and does as it works, summarises each run, and lets a person approve or reject payments, purchases and discounts. All data comes from the FastAPI backend at `http://localhost:8000`.

The design is explained in `hw5/output/design.md`.

## Running it

1. Start the backend (see `hw5/backend/README.md`):

   ```bash
   cd hw5/backend && uvicorn main:app --reload --port 8000
   ```

2. Start the dashboard:

   ```bash
   cd hw5/frontend
   npm install
   npm run dev          # http://localhost:5173
   ```

To use a different backend address, set `VITE_API_URL` (see `.env.example`).

## Files

| File | What it is |
|---|---|
| `src/App.tsx` | Loads data, starts runs, polls activity while a run is going, refreshes after decisions |
| `src/api.ts` | Typed client for the backend routes |
| `src/agents.ts` | The five agents' names, roles, colors and marks |
| `src/status.ts` | Ticket status ("Resolved" only when nothing is left for a person; failed runs never resolved), run outcome and each agent's contribution |
| `src/components/` | Header, ticket stubs, workspace (team strip, run summary, live activity), approvals and cash |
| `src/styles.css` | All styles, with light and dark versions |
| `scripts/e2e.mjs` | End-to-end test in Chromium |

## Testing

```bash
npm test             # unit tests for the status and summary logic
npm run build        # type check (strict) and production build
npm run e2e          # end-to-end test (needs hw5/backend/.venv; uses ports 8000 and 5173)
```

`npm run e2e` starts `hw5/backend/tests/scripted_server.py`: the real backend and MCP server on temporary copies of the database and audit trail, with scripted agents instead of gpt-6-luna (no AI calls, no real money). It also starts `npm run dev`, then drives the dashboard in Chromium. Screenshots go to `e2e-screenshots/`, which isn't committed.
