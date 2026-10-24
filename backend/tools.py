"""Read-only catalogue tools the assistant calls to look up products, prices and stock.

Every call reads the catalogue and inventory tables directly, so answers reflect the
database at that moment. The results are typed models from models.py.
"""

import re
from urllib.parse import urlencode

from pydantic_ai import ModelRetry, RunContext

import db
from models import (
    CategoryInfo,
    ChatDeps,
    LookupProblem,
    ProductDetails,
    ProductSummary,
    SearchResults,
    SimilarProduct,
    SimilarProducts,
    SizeAvailability,
    SizeStock,
    StockStatus,
)

MAX_RESULTS = 8  # products the model sees per search
MAX_PAGE_RESULTS = 24  # products shown on the page per reply
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


def _add_to_page(ctx: RunContext[ChatDeps], product: dict, sizes: list[dict]) -> None:
    """Queue a found product (with its stock per size) for the results panel on the page."""
    if len(ctx.deps.matches) >= MAX_PAGE_RESULTS:
        return
    ctx.deps.matches.setdefault(product["product_id"], {
        "product_id": product["product_id"],
        "name": product["name"],
        "garment_type": product["garment_type"],
        "price": product["price"],
        "image_url": product["image_url"],
        "description": product["description"],
        "sold_out": all(s["quantity"] <= 0 for s in sizes),
        "stock": [{"size": s["size"], "quantity": s["quantity"]} for s in sizes],
    })


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
    for p in items:  # the page shows every match (up to MAX_PAGE_RESULTS), not just the first few
        sizes = stock.get(p["product_id"], [])
        _add_to_page(ctx, p, sizes)
    if len(items) > MAX_PAGE_RESULTS:
        params = {k: v for k, v in (("category", category), ("q", query.strip())) if v}
        ctx.deps.more_results = {"total": len(items), "link": "/products" + (f"?{urlencode(params)}" if params else "")}
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
    _add_to_page(ctx, data, sizes)
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
    _add_to_page(ctx, data, sizes)
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


# --- Alternatives and clarifying questions --------------------------------------

MAX_SIMILAR = 5
# Tags nearly every product has; sharing them says nothing about similarity.
GENERIC_TAGS = {
    "yale", "yale university", "campus customs", "yale merch", "college apparel", "campus apparel",
    "college merch", "college sweatshirt", "college hoodie", "college sports", "graphic sweatshirt",
}
COLOR_WORDS = {
    "navy", "blue", "white", "gray", "grey", "charcoal", "heather", "black", "red", "green", "pink",
    "purple", "orange", "yellow", "cream", "oatmeal", "maroon", "royal", "light", "dark", "tan", "brown",
}
SAME_COLOR = {"grey": "gray", "charcoal": "gray", "heather": "gray"}


def _color_words(colors: list[str]) -> set[str]:
    words = {w for c in colors for w in c.lower().replace("-", " ").split() if w in COLOR_WORDS}
    words -= {"light", "dark", "royal"}  # shades, not colors
    return {SAME_COLOR.get(w, w) for w in words}


# Words that only restate a product's type or color; tags made of these say nothing new.
PLAIN_WORDS = {
    "hoodie", "hoodies", "hooded", "sweatshirt", "sweatshirts", "crewneck", "crew", "neck", "pullover",
    "t-shirt", "tshirt", "tee", "shirt", "quarter-zip", "quarter", "zip", "full-zip", "fleece", "jacket",
    "long", "sleeve", "long-sleeve", "short-sleeve", "apparel", "merch", "college", "yale", "logo",
    "graphic", "lettering", "wordmark", "drawstring", "hood", "ribbed", "cuffs", "campus", "clothing",
}


def _tags(product: dict) -> set[str]:
    """Themed tags (bulldog, hockey, vintage, a college name...), not ones that restate type or color."""
    themed = set()
    for tag in product["search_tags"]:
        words = set(tag.lower().replace("/", " ").split())
        if tag.lower() not in GENERIC_TAGS and words - PLAIN_WORDS - COLOR_WORDS:
            themed.add(tag.lower())
    return themed


# Broad themes that link products whose tags differ (a Mom hoodie and a Dad crewneck).
THEMES = {
    "a family style": {"mom", "dad", "grandma", "grandpa", "aunt", "uncle", "brother", "sister", "cousin"},
    "a sports design": {"baseball", "basketball", "football", "hockey", "soccer", "tennis", "golf", "volleyball",
                        "diving", "swimming", "lacrosse", "squash", "fencing", "sailing", "crew", "track",
                        "field hockey", "rowing"},
    "a residential college design": {"branford", "davenport", "berkeley", "trumbull", "morse", "pierson",
                                     "saybrook", "timothy dwight", "jonathan edwards", "grace hopper",
                                     "benjamin franklin", "silliman", "ezra stiles", "pauli murray"},
    "a professional school design": {"school of", "law school", "divinity", "forest school", "management",
                                     "nursing", "medicine", "public health", "engineering", "architecture"},
    "a bulldog design": {"bulldog", "handsome dan"},
}


def _themes(product: dict) -> set[str]:
    text = " ".join([product["name"], *product["search_tags"]]).lower()
    return {
        theme for theme, words in THEMES.items()
        if any(re.search(rf"\b{re.escape(w)}\b", text) for w in words)  # whole words: "crew" isn't "crewneck"
    }


def _similarity(base: dict, other: dict) -> tuple[float, list[str]]:
    """How alike two products are, with the reasons in plain words."""
    score, reasons = 0.0, []
    if other["garment_type"].lower() == base["garment_type"].lower():
        score += 4
        reasons.append(f"also a {other['garment_type']}")
    elif other["category"] == base["category"]:
        score += 3
        reasons.append(f"also in {dict((c[0], c[1]) for c in db.CATEGORIES)[other['category']]}")
    shared_colors = _color_words(base["colors"]) & _color_words(other["colors"])
    if shared_colors:
        score += min(len(shared_colors), 2)
        reasons.append("also " + " and ".join(sorted(shared_colors)))
    shared_themes = sorted(_themes(base) & _themes(other))
    if shared_themes:
        score += 2
        reasons.append("also " + " and ".join(shared_themes))
    shared_tags = sorted(_tags(base) & _tags(other))
    if shared_tags:
        score += min(len(shared_tags), 3)
        reasons.append("also " + ", ".join(shared_tags[:2]))
    price_gap = abs(other["price"] - base["price"])
    score -= price_gap / 20
    if price_gap <= 10:
        reasons.append("similar price" if price_gap else "same price")
    return score, reasons


def find_similar_products(
    ctx: RunContext[ChatDeps],
    product: str,
    size: str | None = None,
    color: str | None = None,
    max_price: float | None = None,
) -> SimilarProducts | LookupProblem:
    """Find in-stock alternatives to a product, e.g. when it's sold out in the customer's size or
    doesn't come in the color they want. Results are ranked by how alike they are (same type and
    category, shared colors and themes, close price) and every one is in stock.

    Args:
        product: The product to find alternatives for (product_id or exact name).
        size: Only suggest products in stock in this size (e.g. the size the customer needs).
        color: Only suggest products that come in this color (e.g. "pink"). If none do, the
            closest products in other colors are returned with a note saying so.
        max_price: Optional highest price in US dollars.
    """
    product_id = db.find_product_id(product)
    base = next((p for p in db.list_products() if p["product_id"] == product_id), None)
    if base is None:
        return LookupProblem(error=f"No product called '{product}'. Use search_products to find it.")
    wanted_size = None
    if size:
        wanted_size = normalize_size(size)
        if wanted_size is None:
            return LookupProblem(error=f"'{size}' isn't a size we carry. Sizes are XS, S, M, L, XL and XXL.")
    wanted_colors = _color_words([color]) if color else set()
    if color and not wanted_colors:
        wanted_colors = {color.strip().lower()}

    stock = db.stock_by_product()

    def available(p: dict) -> bool:
        sizes = stock.get(p["product_id"], [])
        if wanted_size:
            return any(s["size"] == wanted_size and s["quantity"] > 0 for s in sizes)
        return any(s["quantity"] > 0 for s in sizes)

    candidates = [
        p for p in db.list_products()
        if p["product_id"] != base["product_id"] and available(p)
        and (max_price is None or p["price"] <= max_price)
    ]
    note = None
    if wanted_colors:
        in_color = [p for p in candidates if wanted_colors & _color_words(p["colors"])]
        if in_color:
            candidates = in_color
        else:
            note = (f"Nothing else in the shop comes in {color}. These are the closest alternatives "
                    "in other colors; say so to the customer.")

    ranked = sorted(
        ((*_similarity(base, p), p) for p in candidates), key=lambda t: (-t[0], t[2]["name"])
    )
    best = [(reasons, p) for score, reasons, p in ranked if score > 0][:MAX_SIMILAR]
    if not best:
        return LookupProblem(error="No similar products are in stock right now. Suggest browsing with search_products.")

    alternatives = []
    for reasons, p in best:
        sizes = stock.get(p["product_id"], [])
        _remember(ctx, p)
        _add_to_page(ctx, p, sizes)
        alternatives.append(SimilarProduct(
            **_summary_fields(p, sizes),
            why_similar=", ".join(reasons + ([f"in stock in {wanted_size}"] if wanted_size else [])),
        ))
    looking_for = ", ".join(filter(None, [
        f"in stock in {wanted_size}" if wanted_size else "in stock",
        f"in {color}" if color and not note else None,
        f"up to ${max_price:,.2f}" if max_price is not None else None,
    ]))
    return SimilarProducts(based_on=base["name"], looking_for=looking_for, alternatives=alternatives, note=note)


MAX_SUGGESTIONS = 4
MAX_SUGGESTION_LENGTH = 40


def suggest_replies(ctx: RunContext[ChatDeps], options: list[str]) -> str:
    """Show 2-4 short answers as buttons under your reply, so the customer can answer a clarifying
    question with one tap. Use it only when your reply asks the customer a question.

    Args:
        options: 2 to 4 short answers (each under 40 characters), written as the customer would
            say them, e.g. ["For myself", "A gift for my dad", "A gift for a student"].
    """
    cleaned = []
    for o in options:
        o = " ".join(str(o).split())
        if o and o.lower() not in {c.lower() for c in cleaned}:
            cleaned.append(o)
    if not 2 <= len(cleaned) <= MAX_SUGGESTIONS or any(len(o) > MAX_SUGGESTION_LENGTH for o in cleaned):
        raise ModelRetry(
            f"Give 2 to {MAX_SUGGESTIONS} different options, each under {MAX_SUGGESTION_LENGTH} characters."
        )
    ctx.deps.suggestions = cleaned
    return f"The customer will see these buttons under your reply: {', '.join(cleaned)}"


TOOLS = [list_categories, search_products, get_product_details, check_size, find_similar_products, suggest_replies]
