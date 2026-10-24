"""Data models: API request and response shapes, and the chat agent's dependencies."""

from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field

# --- Accounts ------------------------------------------------------------------


class RegisterRequest(BaseModel):
    first_name: str
    last_name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


# --- Chat ----------------------------------------------------------------------

MAX_MESSAGE_LENGTH = 1000
MAX_HISTORY = 20


class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)
    # Earlier turns, sent by the browser for guests. Logged-in customers' history
    # comes from the database instead, so this is ignored for them.
    history: list[HistoryMessage] = Field(default_factory=list, max_length=MAX_HISTORY)


class ProductCard(BaseModel):
    product_id: str
    name: str
    price: float
    image_url: str


class ChatReply(BaseModel):
    reply: str
    products: list[ProductCard] = []


class HistoryEntry(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    products: list[ProductCard] = []


@dataclass
class ChatDeps:
    """What the agent's tools can see while answering one message."""

    customer_first_name: str | None = None
    # Every product a tool returned during this reply, by id, for the product cards.
    seen_products: dict[str, dict] = field(default_factory=dict)
