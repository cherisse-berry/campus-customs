"""Portkey / model configuration for the Lecture 12 Scraper Trap.

Loads PORTKEY_API_KEY from a .env in this folder, the Lecture 12 folder, or zlisto/.
Never print the key.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from openai import AsyncOpenAI
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.providers.openai import OpenAIProvider

HERE = Path(__file__).resolve().parent
for env in (HERE / ".env", HERE.parent / ".env", HERE.parent.parent / ".env"):
    load_dotenv(env)

MODELS = ["gpt-6-luna", "gpt-6-astra"]
DEFAULT_MODEL = MODELS[0]
PORTKEY_BASE_URL = os.getenv("PORTKEY_BASE_URL", "https://api.portkey.ai/v1").rstrip("/")


def key_is_set() -> bool:
    return bool(os.getenv("PORTKEY_API_KEY", "").strip())


def require_api_key() -> str:
    key = os.getenv("PORTKEY_API_KEY", "").strip()
    if not key:
        raise RuntimeError("PORTKEY_API_KEY is missing. Put it in zlisto/.env (or a .env next to this app).")
    return key


@lru_cache(maxsize=4)
def build_model(model_name: str) -> OpenAIResponsesModel:
    if model_name not in MODELS:
        raise ValueError(f"Unknown model {model_name!r}. Pick one of {MODELS}.")
    client = AsyncOpenAI(
        api_key=require_api_key(),
        base_url=PORTKEY_BASE_URL,
        default_headers={"x-portkey-provider": "openai"},
    )
    return OpenAIResponsesModel(model_name, provider=OpenAIProvider(openai_client=client))
