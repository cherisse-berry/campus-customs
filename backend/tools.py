"""Read-only catalogue tools the assistant calls to look up products, prices and stock.

Every call reads the catalogue and inventory tables directly, so answers reflect the
database at that moment. The results are typed models from models.py.
"""

from pydantic_ai import RunContext

import db
from models import (
    CategoryInfo,
    ChatDeps,
    LookupProblem,
    ProductDetails,
    ProductSummary,
    SearchResults,
    SizeAvailability,
    SizeStock,
    StockStatus,
)

MAX_RESULTS = 8
LOW_STOCK = 5  # 1-5 units counts as "only a few left"

SIZE_WORDS = {
    "XS": "XS", "XSMALL": "XS", "EXTRASMALL": "XS", "XSM": "XS",
    "S": "S", "SM": "S", "SMALL": "S",
    "M": "M", "MD": "M", "MED": "M", "MEDIUM": "M",
    "L": "L", "LG": "L", "LARGE": "L",
    "XL": "XL", "XLARGE": "XL", "EXTRALARGE": "XL", "1XL": "XL",
    "XXL": "XXL", "2XL": "XXL", "XXLARGE": "XXL", "2XLARGE": "XXL", "EXTRAEXTRALARGE": "XXL",
    "DOUBLEXL": "XXL", "DOUBLEEXTRALARGE": "XXL",
}


def normalize_size(text: str) -> str | None:
    """'medium' -> 'M', '2xl' -> 'XXL', 'Extra Large' -> 'XL'. None if it isn't a size we stock."""
    key = "".join(ch for ch in text.upper() if ch.isalnum())
    return SIZE_WORDS.get(key)


def format_price(price: float) -> str:
    return f"${price:,.2f}"


def _status(quantity: int) -> StockStatus:
    if quantity <= 0:
        return "sold out"
    return "only a few left" if quantity <= LOW_STOCK else "in stock"


def _summary_fields(product: dict, sizes: list[dict]) -> dict:
    return {
        "product_id": product["product_id"],
        "name": product["name"],
        "type": product["garment_type"],
        "category": product["category"],
        "price_usd": product["price"],
        "price": format_price(product["price"]),
        "colors": product["colors"],
        "description": product["description"],
        "total_in_stock": sum(s["quantity"] for s in sizes),
        "sold_out": all(s["quantity"] <= 0 for s in sizes),
        "sizes_in_stock": [s["size"] for s in sizes if s["quantity"] > 0],
        "sizes_with_only_a_few_left": [s["size"] for s in sizes if 0 < s["quantity"] <= LOW_STOCK],
        "sold_out_sizes": [s["size"] for s in sizes if s["quantity"] <= 0],
        "product_page": f"/products/{product['product_id']}",
    }


def _remember(ctx: RunContext[ChatDeps], product: dict) -> None:
    """Note a looked-up product for the reply's product cards and price check."""
    ctx.deps.known_prices.add(round(product["price"], 2))
    ctx.deps.seen_products.setdefault(
        product["product_id"],
        {
            "product_id": product["product_id"],
            "name": product["name"],
            "price": product["price"],
            "image_url": product["image_url"],
        },
    )


def list_categories(ctx: RunContext[ChatDeps]) -> list[CategoryInfo]:
    """List the shop's product categories with how many styles each has and their price range."""
    products = db.list_products()
    result = []
    for slug, name, _ in db.CATEGORIES:
        prices = [p["price"] for p in products if p["category"] == slug]
        if prices:
            ctx.deps.known_prices.update({round(min(prices), 2), round(max(prices), 2)})
            result.append(CategoryInfo(
                category=slug, name=name, styles=len(prices),
                lowest_price=format_price(min(prices)), highest_price=format_price(max(prices)),
            ))
    return result


def search_products(
    ctx: RunContext[ChatDeps],
    query: str = "",
    category: str | None = None,
    max_price: float | None = None,
    in_stock_size: str | None = None,
    sort: str = "relevance",
) -> SearchResults | LookupProblem:
    """Search the catalogue. Each result includes its price, description and which sizes are in stock.

    Args:
        query: Words to match against product names, descriptions, colors and tags. Every word
            must match, so use one to three simple words (e.g. "bulldog", "navy hoodie", "hockey").
            Leave empty to browse a whole category.
        category: Optional category slug: t-shirts, quarter-zips, hoodies, fleece-jackets,
            crewnecks or long-sleeves.
        max_price: Optional highest price in US dollars.
        in_stock_size: Optional size (XS, S, M, L, XL or XXL, or words like "medium");
            only return products that have this size in stock.
        sort: "relevance" (default), "price-asc" or "price-desc".
    """
    size = None
    if in_stock_size:
        size = normalize_size(in_stock_size)
        if size is None:
            return LookupProblem(error=f"'{in_stock_size}' isn't a size we carry. Sizes are XS, S, M, L, XL and XXL.")

    order = sort if sort in ("price-asc", "price-desc") else "name"
    items = db.search_products(category or None, query.strip() or None, order)
    if max_price is not None:
        items = [p for p in items if p["price"] <= max_price]
    stock = db.stock_by_product()
    if size:
        items = [
            p for p in items
            if any(s["size"] == size and s["quantity"] > 0 for s in stock.get(p["product_id"], []))
        ]

    shown = items[:MAX_RESULTS]
    for p in shown:
        _remember(ctx, p)
    note = None
    if not items:
        note = "No products matched. Try fewer or simpler words, or a category."
    elif len(items) > len(shown):
        note = f"Showing the first {len(shown)} of {len(items)}. Narrow the search to see others."
    return SearchResults(
        total_matches=len(items),
        showing=len(shown),
        products=[ProductSummary(**_summary_fields(p, stock.get(p["product_id"], []))) for p in shown],
        note=note,
    )


def get_product_details(ctx: RunContext[ChatDeps], product: str) -> ProductDetails | LookupProblem:
    """Get one product's full description, price, colors and the exact stock for every size.

    Args:
        product: The product_id from search_products (e.g. "basic-hoodie-big-yale") or the
            product's exact name.
    """
    product_id = db.find_product_id(product)
    data = db.get_product(product_id) if product_id else None
    if data is None:
        return LookupProblem(error=f"No product called '{product}'. Use search_products to find it.")
    _remember(ctx, data)
    sizes = data["inventory"]
    return ProductDetails(
        **_summary_fields(data, sizes),
        stock_by_size=[
            SizeStock(size=s["size"], quantity=s["quantity"], status=_status(s["quantity"])) for s in sizes
        ],
    )


def check_size(ctx: RunContext[ChatDeps], product: str, size: str) -> SizeAvailability | LookupProblem:
    """Check whether one product is in stock in one size, and exactly how many are left.

    Args:
        product: The product_id from search_products or the product's exact name.
        size: XS, S, M, L, XL or XXL (words like "medium" or "2XL" also work).
    """
    wanted = normalize_size(size)
    if wanted is None:
        return LookupProblem(error=f"'{size}' isn't a size we carry. Sizes are XS, S, M, L, XL and XXL.")
    product_id = db.find_product_id(product)
    data = db.get_product(product_id) if product_id else None
    if data is None:
        return LookupProblem(error=f"No product called '{product}'. Use search_products to find it.")
    _remember(ctx, data)
    sizes = data["inventory"]
    quantity = next((s["quantity"] for s in sizes if s["size"] == wanted), 0)
    return SizeAvailability(
        product_id=data["product_id"],
        name=data["name"],
        price=format_price(data["price"]),
        size=wanted,
        quantity=quantity,
        status=_status(quantity),
        other_sizes_in_stock=[s["size"] for s in sizes if s["quantity"] > 0 and s["size"] != wanted],
        product_page=f"/products/{data['product_id']}",
    )


TOOLS = [list_categories, search_products, get_product_details, check_size]
