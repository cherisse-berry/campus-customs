import hashlib
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app

pytestmark = pytest.mark.skipif(
    not db.DB_PATH.exists(), reason="database not present (it is not committed to git)"
)

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"status": "ok", "database": True}


def test_lists_all_products_with_images_and_prices():
    products = client.get("/api/products").json()
    assert len(products) == 102
    for p in products:
        assert p["image_url"].startswith("/media/products/")
        assert p["price"] > 0
        assert p["description"]
        assert p["category"] != "other", p["garment_type"]


def test_categories_cover_every_product():
    cats = client.get("/api/categories").json()
    assert sum(c["count"] for c in cats) == 102


def test_filter_search_and_sort():
    hoodies = client.get("/api/products", params={"category": "hoodies"}).json()
    assert hoodies and all(p["category"] == "hoodies" for p in hoodies)

    bulldog = client.get("/api/products", params={"q": "bulldog"}).json()
    assert bulldog

    prices = [p["price"] for p in client.get("/api/products", params={"sort": "price-asc"}).json()]
    assert prices == sorted(prices)


def test_product_detail_has_sizes_in_order():
    p = client.get("/api/products/basic-hoodie-big-yale").json()
    assert [s["size"] for s in p["inventory"]] == ["XS", "S", "M", "L", "XL", "XXL"]
    assert p["total_stock"] == sum(s["quantity"] for s in p["inventory"])


def test_unknown_product_is_404():
    assert client.get("/api/products/does-not-exist").status_code == 404


def test_serves_images_but_not_the_database():
    r = client.get("/media/products/basic-hoodie-big-yale.jpg")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert client.get("/media/campus_customs.db").status_code == 404
    assert client.get("/media/products/../campus_customs.db").status_code == 404


def test_database_is_read_only():
    before = hashlib.sha256(db.DB_PATH.read_bytes()).hexdigest()
    with pytest.raises(Exception):
        with closing(db.connect()) as conn:
            conn.execute("UPDATE catalogue SET price = 0")
    client.get("/api/products")
    assert hashlib.sha256(db.DB_PATH.read_bytes()).hexdigest() == before
