"""Create backend/.env with a strong, random SESSION_SECRET.

Usage (from the backend/ folder):
    python setup_env.py           # create .env, or add a secret if it has none
    python setup_env.py --force   # replace the existing secret (logs everyone out)

The secret is written only to .env (git-ignored) and is never printed.
"""

import os
import re
import secrets
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE / ".env"
EXAMPLE_FILE = HERE / ".env.example"
LINE = re.compile(r"^SESSION_SECRET=(.*)$", re.MULTILINE)


def main(force: bool) -> None:
    text = ENV_FILE.read_text() if ENV_FILE.exists() else EXAMPLE_FILE.read_text()
    match = LINE.search(text)
    if match and match.group(1).strip() and not force:
        print(f"SESSION_SECRET is already set in {ENV_FILE}. Use --force to replace it.")
        return

    line = f"SESSION_SECRET={secrets.token_hex(32)}"  # 64 hex characters = 256 bits
    text = LINE.sub(line, text, count=1) if match else text.rstrip("\n") + f"\n{line}\n"
    ENV_FILE.write_text(text)
    if os.name == "posix":
        ENV_FILE.chmod(0o600)  # readable only by you
    print(f"Wrote a new SESSION_SECRET to {ENV_FILE}.")
    if force:
        print("Existing login cookies no longer work, so everyone will need to log in again.")


if __name__ == "__main__":
    main(force="--force" in sys.argv[1:])
