"""Shared API / agent result models.

- BOOK_CATALOG — roster metadata for books 1–7 (title, specialty, accent, …)
- ChatRequest, ChatResponse, Delegation — shapes used by FastAPI + the front end
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

BOOK_CATALOG: list[dict] = [
    {
        "book_number": 1,
        "title": "Harry Potter and the Sorcerer's Stone",
        "short": "Sorcerer's Stone",
        "specialty": "Harry's first year: Hagrid, Diagon Alley, the Mirror of Erised, Quirrell and the Stone.",
        "accent": "#ff4da6",
        "house_hint": "Gryffindor",
    },
    {
        "book_number": 2,
        "title": "Harry Potter and the Chamber of Secrets",
        "short": "Chamber of Secrets",
        "specialty": "Dobby, the basilisk, Tom Riddle's diary, and the Heir of Slytherin.",
        "accent": "#3fbf7f",
        "house_hint": "Slytherin",
    },
    {
        "book_number": 3,
        "title": "Harry Potter and the Prisoner of Azkaban",
        "short": "Prisoner of Azkaban",
        "specialty": "Sirius Black, Lupin, dementors, the Marauder's Map, and the Time-Turner.",
        "accent": "#6c8cff",
        "house_hint": "Ravenclaw",
    },
    {
        "book_number": 4,
        "title": "Harry Potter and the Goblet of Fire",
        "short": "Goblet of Fire",
        "specialty": "The Triwizard Tournament, Barty Crouch Jr., the graveyard, and Voldemort's return.",
        "accent": "#ffb347",
        "house_hint": "Hufflepuff",
    },
    {
        "book_number": 5,
        "title": "Harry Potter and the Order of the Phoenix",
        "short": "Order of the Phoenix",
        "specialty": "Umbridge, Dumbledore's Army, the prophecy, and the Department of Mysteries.",
        "accent": "#c77dff",
        "house_hint": "Gryffindor",
    },
    {
        "book_number": 6,
        "title": "Harry Potter and the Half-Blood Prince",
        "short": "Half-Blood Prince",
        "specialty": "Pensieve memories of Tom Riddle, Horcruxes, the Prince's book, and the Astronomy Tower.",
        "accent": "#2ec4b6",
        "house_hint": "Slytherin",
    },
    {
        "book_number": 7,
        "title": "Harry Potter and the Deathly Hallows",
        "short": "Deathly Hallows",
        "specialty": "The Horcrux hunt, the Deathly Hallows, and the Battle of Hogwarts.",
        "accent": "#e63946",
        "house_hint": "Gryffindor",
    },
]

BOOK_TITLES = {b["book_number"]: b["title"] for b in BOOK_CATALOG}


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)


class Delegation(BaseModel):
    agent: str
    book_number: int
    book_title: str
    question: str
    reply: str = ""
    status: Literal["pending", "running", "done", "error"] = "pending"


class ChatResponse(BaseModel):
    answer: str
    delegations: list[Delegation] = []
    trace: list[dict[str, Any]] | None = None
    boss_name: str
    usage: dict[str, Any] | None = None
