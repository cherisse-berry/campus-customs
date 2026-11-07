"""Settings for the Campus Customs agents.

PORTKEY_API_KEY is read from hw5/.env (or the environment). The .env file is
kept out of GitHub by .gitignore; hw5/.env.example shows what goes in it.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parent
HW5 = BACKEND.parent
REPO_ROOT = HW5.parent
ENV_FILE = HW5 / ".env"
load_dotenv(ENV_FILE)  # never overrides a variable that's already set
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

# ---- Model: every agent uses this one model, through Portkey's AI gateway.
MODEL_NAME = "gpt-6-luna"
PORTKEY_BASE_URL = "https://api.portkey.ai/v1"
PORTKEY_API_KEY_VAR = "PORTKEY_API_KEY"

# ---- MCP server: all shop information comes from it.
MCP_SERVER_SCRIPT = HW5 / "mcp_server" / "server.py"
_venv_python = ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
MCP_PYTHON = Path(os.environ.get("MCP_PYTHON") or HW5 / "mcp_server" / ".venv" / _venv_python)

# ---- Audit trail: appended to, never overwritten.
AUDIT_TRAIL = Path(os.environ.get("CAMPUS_AUDIT_TRAIL") or HW5 / "output" / "audit_trail.json")

# ---- Limits on AI usage (per ticket, shared by every agent working on it).
REQUEST_LIMIT = 30            # model calls
TOOL_CALLS_LIMIT = 40         # MCP tool calls + delegations
TOTAL_TOKENS_LIMIT = 150_000  # input + output tokens
MAX_OUTPUT_TOKENS = 2_000     # per model response
MAX_DELEGATION_DEPTH = 2      # Boss -> specialist -> specialist, no deeper
MAX_DELEGATIONS = 8           # delegations per ticket
MODEL_TIMEOUT_SECONDS = 120
