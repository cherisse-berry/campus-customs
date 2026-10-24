"""Read-only access to the Campus Customs SQLite database."""

import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DATA_DIR = Path(os.environ.get("CAMPUS_DATA_DIR", DEFAULT_DATA_DIR))
DB_PATH = DATA_DIR / "campus_customs.db"
IMAGES_DIR = DATA_DIR / "products"

SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL"]

# The catalogue has ~22 inconsistent garment_type spellings; group them into
# a few shopper-facing categories. Order matters: first match wins.
CATEGORIES = [
    ("t-shirts", "T-Shirts", ("t-shirt",)),
    ("quarter-zips", "Quarter-Zips", ("quarter-zip",)),
    ("hoodies", "Hoodies", ("hood",)),
    ("fleece-jackets", "Fleece & Jackets", ("fleece", "jacket")),
    ("crewnecks", "Crewnecks", ("crewneck", "mockneck")),
    ("long-sleeves", "Long Sleeves", ("long-sleeve",)),
]


def category_for(garment_type: str) -> str:
    g = garment_type.lower()
    for slug, _name, keywords in CATEGORIES:
        if any(k in g for k in keywords):
            return slug
    return "other"


def connect() -> sqlite3.Connection:
    # mode=ro guarantees the app can never modify the database.
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _product_from_row(row: sqlite3.Row) -> dict:
    return {
        "product_id": row["product_id"],
        "name": row["name"],
        "garment_type": row["garment_type"],
        "category": category_for(row["garment_type"]),
        "description": row["description"],
        "colors": json.loads(row["colors"]),
        "search_tags": json.loads(row["search_tags"]),
        "image_url": f"/media/{row['image_file_path']}",
        "price": row["price"],
        "total_stock": row["total_stock"],
    }


_PRODUCT_QUERY = """
    SELECT c.*, COALESCE(SUM(i.quantity), 0) AS total_stock
    FROM catalogue c
    LEFT JOIN inventory i ON i.product_id = c.product_id
"""


def list_products() -> list[dict]:
    with closing(connect()) as conn:
        rows = conn.execute(
            _PRODUCT_QUERY + " GROUP BY c.product_id ORDER BY c.name"
        ).fetchall()
    return [_product_from_row(r) for r in rows]


def get_product(product_id: str) -> dict | None:
    with closing(connect()) as conn:
        row = conn.execute(
            _PRODUCT_QUERY + " WHERE c.product_id = ? GROUP BY c.product_id",
            (product_id,),
        ).fetchone()
        if row is None:
            return None
        sizes = conn.execute(
            "SELECT size, quantity FROM inventory WHERE product_id = ?",
            (product_id,),
        ).fetchall()
    product = _product_from_row(row)
    rank = {s: i for i, s in enumerate(SIZE_ORDER)}
    product["inventory"] = sorted(
        ({"size": s["size"], "quantity": s["quantity"]} for s in sizes),
        key=lambda s: rank.get(s["size"], len(SIZE_ORDER)),
    )
    return product
