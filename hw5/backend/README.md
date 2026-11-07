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
| `approve.py` | Where a person approves or rejects payment and discount requests |
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

## Testing

```bash
python -m pytest
```

The tests use a scripted stand-in for the model, so they make no AI calls and need no key. The MCP server is real, but runs on a temporary copy of the database. A check confirms both real database files are unchanged afterwards.

The agents haven't been run with the real model yet. See [What has been verified, and what still needs testing](../output/harness.md#what-has-been-verified-and-what-still-needs-testing) in `harness.md`.
