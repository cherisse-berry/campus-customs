"""Create or update backend/.env with the backend's secrets.

Usage (from the backend/ folder):
    python setup_env.py             # create .env with a random SESSION_SECRET (if it has none)
    python setup_env.py --api-key   # also ask for your Anthropic API key (typed input is hidden)
    python setup_env.py --force     # replace the existing SESSION_SECRET (logs everyone out)

Secrets are written only to .env (git-ignored) and are never printed.
"""

import getpass
import os
import re
import secrets
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE / ".env"
EXAMPLE_FILE = HERE / ".env.example"


def _line(name: str) -> re.Pattern[str]:
    return re.compile(rf"^{name}=(.*)$", re.MULTILINE)


def get_value(text: str, name: str) -> str:
    match = _line(name).search(text)
    return match.group(1).strip() if match else ""


def set_value(text: str, name: str, value: str) -> str:
    line = f"{name}={value}"
    pattern = _line(name)
    if pattern.search(text):
        return pattern.sub(lambda _: line, text, count=1)
    return text.rstrip("\n") + f"\n{line}\n"


def ensure_session_secret(text: str, force: bool) -> str:
    if get_value(text, "SESSION_SECRET") and not force:
        print("SESSION_SECRET is already set. Use --force to replace it.")
        return text
    print("Wrote a new SESSION_SECRET." + (" Everyone will need to log in again." if force else ""))
    return set_value(text, "SESSION_SECRET", secrets.token_hex(32))  # 256 bits


def ask_api_key(text: str, prompt=getpass.getpass) -> str:
    print("Paste your Anthropic API key from https://platform.claude.com/settings/keys")
    print("(Typing is hidden. Press Enter on an empty line to keep the current key.)")
    key = prompt("ANTHROPIC_API_KEY: ").strip()
    if not key:
        print("No key entered; ANTHROPIC_API_KEY unchanged.")
        return text
    if not key.startswith("sk-ant-"):
        print("Note: Anthropic API keys usually start with 'sk-ant-'. Saved anyway; check it if chat fails.")
    print("Saved ANTHROPIC_API_KEY.")
    return set_value(text, "ANTHROPIC_API_KEY", key)


def main(args: list[str]) -> None:
    text = ENV_FILE.read_text() if ENV_FILE.exists() else EXAMPLE_FILE.read_text()
    text = ensure_session_secret(text, force="--force" in args)
    if "--api-key" in args:
        text = ask_api_key(text)
    ENV_FILE.write_text(text)
    if os.name == "posix":
        ENV_FILE.chmod(0o600)  # readable only by you
    print(f"Settings saved to {ENV_FILE} (git-ignored).")
    if "--api-key" in args and os.environ.get("ANTHROPIC_API_KEY"):
        print("Warning: ANTHROPIC_API_KEY is also set in your shell, and that value wins over .env.")


if __name__ == "__main__":
    main(sys.argv[1:])
