# MCP servers for this project

Each server lives in its own folder with its own `.venv`, and is registered in
`.mcp.json` at the project root so Claude Code can use it in this project only.

| Folder | Server name | What it does |
| --- | --- | --- |
| `yale_som_courses/` | `yale-som-courses` | Searches the Yale SOM course catalogue (`yale_som.db`) |
| `outlook/` | `outlook` | *Coming soon* |

## yale-som-courses

Tools:

- `search_courses(keyword)`: finds a keyword or phrase ("AI", "competitor",
  "statistics") in the course title, number, professor name, category, course
  type, description and professor bio. Says which fields matched; title matches
  come first.
- `search_courses_by_professor(name)`: courses taught by a professor.

Claude Code starts it with `python mcp/yale_som_courses/launch.py`. The first
run creates `mcp/yale_som_courses/.venv` and installs `requirements.txt`, so
there is nothing to set up by hand. The database is `yale_som.db` in the same
folder (from [zlisto/yale_som_courses_mcp](https://github.com/zlisto/yale_som_courses_mcp)).

Open Claude Code in the project root and run `/mcp` to check it's connected.

## Adding another server (e.g. Outlook)

1. Make a folder here, e.g. `mcp/outlook/`, with its server and `requirements.txt`.
   Copying `yale_som_courses/launch.py` gives it the same self-installing venv.
2. Add an entry next to `yale-som-courses` in `.mcp.json`:
   ```json
   "outlook": {
     "command": "python",
     "args": ["mcp/outlook/launch.py"]
   }
   ```
3. Add `"outlook"` to `enabledMcpjsonServers` in `.claude/settings.json`.
4. Keep secrets (API keys, tokens) in a `.env` file, never in `.mcp.json`;
   `.env` is already git-ignored.
