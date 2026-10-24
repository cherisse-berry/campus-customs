"""Yale SOM course catalogue MCP server (from the Lecture 9 starter).

Tools: search_courses (keyword search) and search_courses_by_professor.
Reads yale_som.db in this folder.

Claude Code starts it through launch.py (see ../../.mcp.json).
Run from this folder (stdio):  python mcp_server.py
Run (HTTP):                    python mcp_server.py --http
HTTP URL:                      http://127.0.0.1:8001/mcp
"""

from __future__ import annotations

import argparse
import re
import sqlite3
from pathlib import Path

from fastmcp import FastMCP

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "yale_som.db"

mcp = FastMCP("yale-som-courses")


# Text columns searched by search_courses, in ranking order (a title hit
# outranks a description hit). URLs, times and rooms are left out on purpose.
SEARCH_FIELDS = [
    "course_title",
    "course_number",
    "faculty_1",
    "course_category",
    "course_type",
    "course_description",
    "faculty_bio",
]


def _keyword_pattern(keyword: str) -> re.Pattern[str]:
    """Case-insensitive pattern that matches the keyword at a word boundary.

    Short keywords (3 letters or fewer, like "AI") must be a whole word so
    they don't hit "said" or "maintain". Longer ones match the start of a
    word, so "statistic" also finds "statistics" and "statistical".
    """
    words = keyword.split()
    phrase = r"\s+".join(re.escape(w) for w in words)
    end = r"\b" if len(keyword.strip()) <= 3 else ""
    return re.compile(rf"\b{phrase}{end}", re.IGNORECASE)


@mcp.tool
def search_courses(keyword: str) -> list[dict]:
    """Search every course for a keyword or phrase (e.g. "AI", "competitor", "statistics").

    Looks in the course title, course number, professor name, category,
    course type, course description and the professor's bio. Matching is
    case-insensitive. Each result lists `matched_fields` so you can tell
    where the keyword was found; courses that match in the title come first.
    """
    keyword = keyword.strip()
    if not keyword:
        return []
    pattern = _keyword_pattern(keyword)
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT course_number, course_title, course_category, course_type,
                   course_description, faculty_1, faculty_1_email, faculty_bio,
                   course_session, daytimes, room, section, units
            FROM courses
            ORDER BY course_number, section
            """
        ).fetchall()

    results = []
    for row in rows:
        matched = [f for f in SEARCH_FIELDS if row[f] and pattern.search(row[f])]
        if not matched:
            continue
        course = dict(row)
        course.pop("faculty_bio")  # searched, but too long to send back
        course["matched_fields"] = matched
        results.append(course)
    results.sort(key=lambda c: SEARCH_FIELDS.index(c["matched_fields"][0]))
    return results


@mcp.tool
def search_courses_by_professor(name: str) -> list[dict]:
    """Find courses taught by a professor.

    Matches any part of the name, case-insensitive, in either order
    ("Rudi", "Nils Rudi", or "Rudi, Nils" all work).
    """
    words = [w for w in name.replace(",", " ").split() if w]
    if not words:
        return []
    where = " AND ".join("faculty_1 LIKE ?" for _ in words)
    params = [f"%{w}%" for w in words]
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            f"""
            SELECT course_number, course_title, faculty_1, faculty_1_email,
                   course_session, daytimes, room, section, units
            FROM courses
            WHERE {where}
            ORDER BY course_number, section
            """,
            params,
        ).fetchall()
    return [dict(r) for r in rows]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Yale SOM courses MCP server")
    parser.add_argument(
        "--http",
        action="store_true",
        help="Serve Streamable HTTP on port 8001 (keeps FastAPI free on 8000)",
    )
    args = parser.parse_args()
    if args.http:
        mcp.run(transport="http", host="127.0.0.1", port=8001)
    else:
        mcp.run()
