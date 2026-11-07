# Campus Customs Agents (Problem 5)

Five PydanticAI agents that work the shop's open tickets: **Boss, Inventory, Accounting, Facilities and Customer Service**. They use gpt-6-luna through Portkey and get all shop information from the Campus Customs MCP server, which reads the working database. They follow the shop's rules, and every action is added to `hw5/output/audit_trail.json`.

`hw5/output/harness.md` explains the agents, their tools, the rules and how each rule is enforced.

| File | What it is |
|---|---|
| `agents.py` | The five agents, the Portkey model, delegation, audit logging and the output checks |
| `models.py` | The data types the agents return |
| `prompts/` | `shop_rules.md` (every agent) and one instruction file per agent |
| `config.py` | Model, Portkey, paths and usage limits |
| `audit.py` | The audit trail (`python audit.py` shows recent entries) |
| `run.py` | Runs the team on tickets |
| `check_portkey.py` | Checks that gpt-6-luna works through Portkey before any run |
| `approve.py` | Where a person approves or rejects payment and discount requests at a terminal |
| `approvals.py` | The approval safeguards, shared by `approve.py` and the API |
| `main.py` | The FastAPI backend for the dashboard (Problem 7) |
| `tests/` | Offline tests: no AI calls, no Portkey key, and a temporary copy of the database |

## Setting up

1. Set up the database: see [Setting up the database](../README.md#setting-up-the-database).
2. Set up the MCP server's virtual environment: see [Setting it up](../mcp_server/README.md#setting-it-up). The agents start the server with `hw5/mcp_server/.venv`.
3. Create the agents' virtual environment (Python 3.10 or newer):

   ```bash
   cd hw5/backend
   python3 -m venv .venv
   source .venv/bin/activate        # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

4. Add the Portkey key. Copy `hw5/.env.example` to `hw5/.env` and set `PORTKEY_API_KEY`. `.env` is kept out of GitHub by `.gitignore`. Never commit it or paste the key anywhere else.

## Checking the model first

Before running the agents, check that gpt-6-luna works through Portkey:

```bash
python check_portkey.py
```

It makes three tiny calls (a plain reply, a tool call and structured output) and prints PASS or FAIL for each. It doesn't touch the database, the MCP server, the agents or the audit trail.

The agents use Portkey's **Responses endpoint** (`/v1/responses`) with low reasoning effort, because gpt-6-luna doesn't allow function tools on the chat-completions endpoint while it reasons. If the Responses endpoint doesn't work with your Portkey key, add `OPENAI_ENDPOINT=chat` to `hw5/.env` to use chat completions with reasoning turned off, and run the check again. `OPENAI_REASONING_EFFORT` (`none`, `minimal`, `low`, `medium`, `high`) changes the effort on the Responses endpoint. See `hw5/.env.example`.

## Running

From `hw5/backend`, with the virtual environment active:

```bash
python run.py --ticket 101     # one ticket
python run.py --all            # every open ticket, one at a time
python approve.py --list       # requests waiting for a person
python approve.py              # a person approves or rejects them (typed at a terminal)
python audit.py --last 50      # recent audit trail entries
```

`run.py` prints the Boss's plan for each ticket. Nothing is paid and no message is sent. Payment and discount requests wait in the audit trail until a person decides them with `approve.py`. An approved payment is recorded in the working database through the MCP server's `record_payment` tool, which re-checks the shop's payment rules first.

## The API (Problem 7)

From `hw5/backend`, with the virtual environment active:

```bash
uvicorn main:app --reload --port 8000
```

It's then at http://localhost:8000, with interactive docs at http://localhost:8000/docs. The routes are listed in `hw5/output/harness.md` under "The backend API".

## Building the Problem 9 results

After the real runs, on the computer that ran them:

```bash
python build_results.py
```

It reads only the real audit trail (`hw5/output/audit_trail.json`) and the working database (read-only, through the MCP server). It writes `output/resolved_tickets.json`, fills in the Actual sections and Cash tab of `output/desk_tickets.html` (the Expected plans aren't touched), and builds `output/resolved_board.html` with any dashboard screenshots saved as `output/resolved_screenshots/ticket-101-….png` (and `102`, `103`). It checks:
- the starting balance minus the recorded payments equals the balance in the database
- each payment's balance matches the running total
- every payment has a named approver
- no agent called `record_payment`
- every draft is unsent
- your Portkey key appears in none of the files you'll commit

It never approves, pays, resets or calls the AI, and running it again rebuilds the same files.

## Testing

```bash
python -m pytest
```

The tests use a scripted stand-in for the model, so they make no AI calls and need no key. The MCP server is real, but runs on a temporary copy of the database. A check confirms both real database files are unchanged afterwards.

The agents haven't been run with the real model yet. See [What has been verified, and what still needs testing](../output/harness.md#what-has-been-verified-and-what-still-needs-testing) in `harness.md`.
