"""Campus Customs backend."""

from pathlib import Path

from dotenv import load_dotenv

# Load settings such as SESSION_SECRET from backend/.env before any module reads them.
# Variables already set in the environment take priority over the file.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
