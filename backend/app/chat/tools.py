"""Read-only catalogue tools the assistant calls to look up products and stock."""

from dataclasses import dataclass, field

from pydantic_ai import RunContext

from .. import db

MAX_RESULTS = 8
LOW_STOCK = 5


@dataclass
class ChatDeps:
    customer_first_name: str | None = None
    # Every product a tool returned during this reply, by id, for the product cards.
    seen_products: dict[str, dict] = field(default_factory=dict)


def _remember(ctx: RunContext[ChatDeps], product: dict) -> None:
    ctx.deps.seen_products.setdefault(
        product["product_id"],
        {
            "product_id": product["product_id"],
            "name": product["name"],
            "price": product["price"],
            "image_url": product["image_url"],
        },
    )


def _summary(product: dict) -> dict:
    return {
        "product_id": product["product_id"],
        "name": product["name"],
        "type": product["garment_type"],
        "category": product["category"],
        "price_usd": product["price"],
        "colors": product["colors"],
        "total_in_stock": product["total_stock"],
    }


def list_categories(ctx: RunContext[ChatDeps]) -> list[dict]:
    """List the shop's product categories with how many styles each has and their price range."""
    products = db.list_products()
    result = []
    for slug, name, _ in db.CATEGORIES:
        prices = [p["price"] for p in products if p["category"] == slug]
        if prices:
            result.append(
                {"category": slug, "name": name, "styles": len(prices),
                 "min_price_usd": min(prices), "max_price_usd": max(prices)}
            )
    return result


def search_products(
    ctx: RunContext[ChatDeps],
    query: str = "",
    category: str | None = None,
    max_price: float | None = None,
    in_stock_size: str | None = None,
    sort: str = "relevance",
) -> dict:
    """Search the catalogue.

    Args:
        query: Words to match against product names, descriptions, colors and tags. Every word
            must match, so use one to three simple words (e.g. "bulldog", "navy hoodie", "hockey").
            Leave empty to browse a whole category.
        category: Optional category slug: t-shirts, quarter-zips, hoodies, fleece-jackets,
            crewnecks or long-sleeves.
        max_price: Optional highest price in US dollars.
        in_stock_size: Optional size (XS, S, M, L, XL or XXL); only return products in stock in it.
        sort: "relevance" (default), "price-asc" or "price-desc".
    """
    order = sort if sort in ("price-asc", "price-desc") else "name"
    items = db.search_products(category or None, query.strip() or None, order)
    if max_price is not None:
        items = [p for p in items if p["price"] <= max_price]
    if in_stock_size:
        size = in_stock_size.strip().upper()
        details = (db.get_product(p["product_id"]) for p in items)
        items = [
            d for d in details
            if d and any(s["size"] == size and s["quantity"] > 0 for s in d["inventory"])
        ]
    for p in items[:MAX_RESULTS]:
        _remember(ctx, p)
    return {
        "total_matches": len(items),
        "showing": len(items[:MAX_RESULTS]),
        "products": [_summary(p) for p in items[:MAX_RESULTS]],
    }


def get_product_details(ctx: RunContext[ChatDeps], product_id: str) -> dict:
    """Get one product's full description, colors, price and stock for every size.

    Args:
        product_id: The product_id from search_products, e.g. "basic-hoodie-big-yale".
    """
    product = db.get_product(product_id.strip())
    if product is None:
        return {"error": f"No product with id '{product_id}'. Use search_products to find the id."}
    _remember(ctx, product)
    return {
        **_summary(product),
        "description": product["description"],
        "stock_by_size": {
            s["size"]: (
                "sold out" if s["quantity"] == 0
                else f"only {s['quantity']} left" if s["quantity"] <= LOW_STOCK
                else f"{s['quantity']} in stock"
            )
            for s in product["inventory"]
        },
        "product_page": f"/products/{product['product_id']}",
    }


TOOLS = [list_categories, search_products, get_product_details]
