"""Export the catalogue and stock to JSON for the static preview build.

Usage: python export_static.py <output_dir>
Writes <output_dir>/data/catalog.json and copies images to <output_dir>/media/products/.
Only product and stock data is exported; user accounts and chats are not.
"""

import json
import shutil
import sys
from pathlib import Path

from app import db


def main(out: Path) -> None:
    products = [db.get_product(p["product_id"]) for p in db.list_products()]
    for p in products:
        p["image_url"] = p["image_url"].lstrip("/")  # relative, so it works from any URL
    catalog = {
        "categories": [{"slug": slug, "name": name} for slug, name, _ in db.CATEGORIES],
        "products": products,
    }
    (out / "data").mkdir(parents=True, exist_ok=True)
    (out / "data" / "catalog.json").write_text(json.dumps(catalog))
    shutil.copytree(db.IMAGES_DIR, out / "media" / "products", dirs_exist_ok=True)
    print(f"Exported {len(products)} products to {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
