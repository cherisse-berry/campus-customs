"""Start the Yale SOM course MCP server with this folder's own virtual environment.

Claude Code runs this (see .mcp.json at the project root) with any Python 3.
The first time, it creates .venv here and installs requirements.txt; after
that it just starts mcp_server.py with the venv's Python. Works on Windows,
macOS and Linux.

Setup output goes to stderr: stdout is the MCP stdio channel and must stay clean.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENV = HERE / ".venv"
VENV_PYTHON = VENV / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def ensure_venv() -> None:
    if VENV_PYTHON.exists():
        return
    print("Creating mcp/yale_som_courses/.venv (first run only)...", file=sys.stderr)
    subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True, stdout=sys.stderr)
    subprocess.run(
        [str(VENV_PYTHON), "-m", "pip", "install", "-q", "-r", str(HERE / "requirements.txt")],
        check=True,
        stdout=sys.stderr,
    )


if __name__ == "__main__":
    ensure_venv()
    server = [str(VENV_PYTHON), str(HERE / "mcp_server.py"), *sys.argv[1:]]
    sys.exit(subprocess.call(server))
