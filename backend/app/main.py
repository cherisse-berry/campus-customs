"""Campus Customs API: product catalogue, stock, images, customer accounts and chat."""

import os
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import auth, db
from .chat.router import router as chat_router

app = FastAPI(title="Campus Customs API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(auth.router)
app.include_router(chat_router)

# Serve only the images folder, never the data folder (which holds the database).
app.mount(
    "/media/products",
    StaticFiles(directory=db.IMAGES_DIR, check_dir=False),
    name="product-images",
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "database": db.DB_PATH.exists()}


@app.get("/api/categories")
def categories() -> list[dict]:
    products = db.list_products()
    return [
        {
            "slug": slug,
            "name": name,
            "count": sum(p["category"] == slug for p in products),
        }
        for slug, name, _ in db.CATEGORIES
    ]


@app.get("/api/products")
def products(
    category: str | None = None,
    q: str | None = Query(None, description="Search name, description, colors and tags"),
    sort: Literal["name", "price-asc", "price-desc"] = "name",
) -> list[dict]:
    return db.search_products(category, q, sort)


@app.get("/api/products/{product_id}")
def product_detail(product_id: str) -> dict:
    product = db.get_product(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product
