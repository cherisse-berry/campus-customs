"""Loads settings such as SESSION_SECRET and ANTHROPIC_API_KEY from hw4/.env.

Imported first by the modules that read settings. Variables already set in the
environment take priority over the file. The .env from before the project moved
into hw4/ (campus-customs/backend/.env) is still read if hw4/.env doesn't set a value.
"""

from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parent
ENV_FILE = BACKEND.parent / ".env"
OLD_ENV_FILE = BACKEND.parent.parent / "backend" / ".env"

load_dotenv(ENV_FILE)
load_dotenv(OLD_ENV_FILE)  # never overrides a value that's already set
