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


# --- Catalogue tool results (what the assistant reads from the database) ------
#
# These are the only source of product facts the assistant has. Prices and
# quantities are copied straight from the catalogue and inventory tables.

Size = Literal["XS", "S", "M", "L", "XL", "XXL"]
StockStatus = Literal["in stock", "only a few left", "sold out"]


class SizeStock(BaseModel):
    size: Size
    quantity: int = Field(description="Exact units in stock right now")
    status: StockStatus


class ProductSummary(BaseModel):
    product_id: str
    name: str
    type: str
    category: str
    price_usd: float
    price: str = Field(description='Formatted price to quote, e.g. "$68.00"')
    colors: list[str]
    description: str
    total_in_stock: int
    sold_out: bool = Field(description="True when every size has 0 in stock")
    sizes_in_stock: list[Size]
    sizes_with_only_a_few_left: list[Size]
    sold_out_sizes: list[Size]
    product_page: str


class ProductDetails(ProductSummary):
    stock_by_size: list[SizeStock]


class SearchResults(BaseModel):
    total_matches: int
    showing: int
    products: list[ProductSummary]
    note: str | None = None


class SizeAvailability(BaseModel):
    product_id: str
    name: str
    price: str
    size: Size
    quantity: int
    status: StockStatus
    other_sizes_in_stock: list[Size]
    product_page: str


class CategoryInfo(BaseModel):
    category: str
    name: str
    styles: int
    lowest_price: str
    highest_price: str


class LookupProblem(BaseModel):
    """Returned instead of a result when a product or size can't be found."""

    error: str


# --- Chat agent ------------------------------------------------------------------


@dataclass
class ChatDeps:
    """What the agent's tools can see while answering one message."""

    customer_first_name: str | None = None
    # Every product a tool returned during this reply, by id, for the product cards.
    seen_products: dict[str, dict] = field(default_factory=dict)
    # Every dollar amount the tools returned this reply. The reply may only quote these.
    known_prices: set[float] = field(default_factory=set)
    # Dollar amounts the customer typed (e.g. "under $70"); the reply may repeat them.
    customer_amounts: set[float] = field(default_factory=set)
