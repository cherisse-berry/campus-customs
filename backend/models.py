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
MAX_HISTORY = 40  # messages the assistant remembers (20 back-and-forth exchanges)


class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)
    # The product page the customer was on when they sent this message, if any.
    viewing_product_id: str | None = Field(None, max_length=200)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)
    # Earlier turns, sent by the browser for guests. Logged-in customers' history
    # comes from the database instead, so this is ignored for them.
    history: list[HistoryMessage] = Field(default_factory=list, max_length=MAX_HISTORY)
    # The product page the customer is on right now, so "this" and "it" make sense.
    viewing_product_id: str | None = Field(None, max_length=200)


class ProductCard(BaseModel):
    """A small card in the chat window for a product the reply mentions by name."""

    product_id: str
    name: str
    price: float
    image_url: str


class SizeQuantity(BaseModel):
    size: str
    quantity: int


class ProductResult(BaseModel):
    """A product the assistant found, shown in the results panel on the page."""

    product_id: str
    name: str
    garment_type: str
    price: float
    image_url: str
    description: str
    sold_out: bool = False
    stock: list[SizeQuantity] = []  # quantity per size, so the card can show availability


class MoreResults(BaseModel):
    """A search matched more products than the page shows."""

    total: int
    link: str  # the same search on the Products page


class ChatReply(BaseModel):
    reply: str
    # Products named in the reply, shown as small cards in the chat window.
    products: list[ProductCard] = []
    # Every product the assistant's searches and lookups found, shown on the page.
    results: list[ProductResult] = []
    # When a search matched more products than the page shows: how many, and a link to
    # the same search on the Products page.
    more_results: MoreResults | None = None
    # Short answers the customer can tap, when the assistant asks a clarifying question.
    suggestions: list[str] = []


class ViewedProduct(BaseModel):
    """The product page a customer was on when they sent a message."""

    product_id: str
    name: str


class HistoryEntry(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    products: list[ProductCard] = []
    results: list[ProductResult] = []
    viewing: ViewedProduct | None = None  # customer messages only


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


class SimilarProduct(ProductSummary):
    why_similar: str = Field(description="Why this is a good alternative, e.g. 'also a hoodie, also navy'")


class SimilarProducts(BaseModel):
    based_on: str
    looking_for: str = Field(description="What the alternatives had to match, e.g. 'in stock in XL'")
    alternatives: list[SimilarProduct]
    note: str | None = None


class LookupProblem(BaseModel):
    """Returned instead of a result when a product or size can't be found."""

    error: str


# --- Chat agent ------------------------------------------------------------------


@dataclass
class ChatDeps:
    """What the agent's tools can see while answering one message."""

    # The logged-in customer ({"first_name", "name", "email"}), or None for a guest.
    customer: dict | None = None
    # The product page the customer is on ({"product_id", "name", "garment_type", "colors"}).
    viewing: dict | None = None
    # Every product a tool showed the model during this reply, by id, for the chat cards.
    seen_products: dict[str, dict] = field(default_factory=dict)
    # Every product the tools found this reply (including search matches beyond the ones
    # the model saw), in the order found, for the results panel on the page.
    matches: dict[str, dict] = field(default_factory=dict)
    # Set when a search matched more products than the page can show.
    more_results: dict | None = None
    # Every dollar amount the tools returned this reply. The reply may only quote these.
    known_prices: set[float] = field(default_factory=set)
    # Dollar amounts the customer typed (e.g. "under $70"); the reply may repeat them.
    customer_amounts: set[float] = field(default_factory=set)
    # Tappable answers offered with a clarifying question (set by suggest_replies).
    suggestions: list[str] = field(default_factory=list)
