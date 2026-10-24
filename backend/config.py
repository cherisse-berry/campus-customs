"""Loads settings such as SESSION_SECRET and ANTHROPIC_API_KEY from backend/.env.

Imported first by the modules that read settings. Variables already set in the
environment take priority over the file.
"""

from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")
