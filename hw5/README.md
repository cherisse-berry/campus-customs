# Campus Customs — Homework 5

| File | What it is |
|---|---|
| `AI_prompts.md` | The prompts given to the AI assistant for each problem, with follow-ups and what they fixed |
| `output/harness.md` | Plain-language guide to the database, the three open tickets, the MCP server tools and what the agents need |
| `setup_db.py` | Sets up the database files (see below) |
| `mcp_server/` | The FastMCP server the agents use for all shop information (see `mcp_server/README.md`) |
| `backend/` | Problem 5: the five PydanticAI agents (Boss, Inventory, Accounting, Facilities, Customer Service), their prompts and data types (see `backend/README.md`) |
| `output/audit_trail.json` | Problem 5: every agent action, delegation, decision and human approval, added to and never overwritten |
| `.env.example` | Where `PORTKEY_API_KEY` goes. Copy it to `.env`, which is never committed. |
| `output/mcp_smoke.json` | Problem 4: the required smoke-test results in JSON (question asked, tool used, arguments, what it returned, database check) |
| `output/mcp_tests.md` | Problem 4: the same tests explained in plain language, plus how the server is connected to Claude Code |
| `../.mcp.json` | The Claude Code connection settings for the MCP server (at the repository root) |
| `data/` | The database files. They are not in the repository; create them with the steps below. |

## Setting up the database

The database is not stored in this repository. You need the `data_2.zip` file provided with the assignment.

You need Python 3 (no extra packages). From the repository's root folder, run:

```bash
cd hw5
python3 setup_db.py path/to/data_2.zip
```

On Windows, use `python` instead of `python3` if `python3` isn't found.

This creates two files in `hw5/data/`:

| File | Purpose |
|---|---|
| `campus_customs.db` | The **original** database, exactly as delivered. It is set to read-only so it isn't changed by accident. |
| `campus_customs_new.db` | The **working copy**. This is the file the agents read and change. |

The script checks the database against the SHA-256 fingerprint of the one delivered in `data_2.zip` (`23686a90d698f7fa6f901a3f0a9774db9cbb31e13151c9e5717275f3321f360a`). **If it doesn't match, the script stops and changes nothing.** It never replaces the original with the wrong data, and it won't create or reset the working copy from an original that has been altered. If that happens, run the script again with `data_2.zip` to restore the original.

If you've already unzipped the file, you can pass the database directly instead:

```bash
python3 setup_db.py path/to/data/campus_customs.db
```

### Starting over

Running the script again never overwrites an existing working copy. To throw away changes and start from a fresh copy of the original:

```bash
python3 setup_db.py --reset
```

### Setting it up by hand

If you'd rather not run the script:

1. Unzip `data_2.zip`. It contains `data/campus_customs.db`.
2. Copy that file to `hw5/data/campus_customs.db` (the original). Optionally make it read-only.
3. Copy it again to `hw5/data/campus_customs_new.db` (the working copy).

### Why the database isn't in the repository

The repository's `.gitignore` excludes `data/` folders and `*.db` files, the same rule used for Homework 4, so database files are never committed.
