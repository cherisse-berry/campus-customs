"""Book specialist workers — one focused answer path per novel (1–7).

run_specialist() pulls the best-matching chunks for its book, puts them in the
agent's instructions as EVIDENCE, and lets the agent do at most one follow-up
search_book() call before answering. Every step goes out through `emit`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from pydantic_ai import Agent, RunContext

from agents.config import build_model
from agents.events import Emit, clip, run_traced
from models import BOOK_TITLES
from retrieval import Chunk, format_evidence, retrieve_chunks

PROMPT = (Path(__file__).resolve().parents[1] / "prompts" / "specialist.md").read_text(encoding="utf-8")
FOLLOW_UP_SEARCHES = 1
FOLLOW_UP_CHARS = 5000
FOLLOW_UP_CHUNKS = 4


def specialist_name(book_number: int) -> str:
    return f"Book {book_number} Labubu"


def _noop(*_args, **_kwargs) -> None:
    pass


@dataclass
class SpecialistDeps:
    book_number: int
    book_title: str
    emit: Emit
    chunks: list[Chunk] = field(default_factory=list)
    searches_left: int = FOLLOW_UP_SEARCHES


specialist_agent = Agent(deps_type=SpecialistDeps, output_type=str, name="book_specialist")


@specialist_agent.instructions
def _instructions(ctx: RunContext[SpecialistDeps]) -> str:
    d = ctx.deps
    return (
        PROMPT.replace("{book_title}", d.book_title)
        .replace("{book_number}", str(d.book_number))
        .replace("{evidence}", format_evidence(d.chunks))
    )


@specialist_agent.tool
async def search_book(ctx: RunContext[SpecialistDeps], keywords: str) -> str:
    """Search your book again with different keywords (character names, places, objects, spells).

    Only use this when the EVIDENCE you already have does not answer the question.
    """
    d = ctx.deps
    if d.searches_left <= 0:
        return "No searches left. Answer from the passages you already have."
    d.searches_left -= 1
    seen = {c.chunk_id for c in d.chunks}
    found = retrieve_chunks(
        d.book_number, keywords, max_chars=FOLLOW_UP_CHARS, max_chunks=FOLLOW_UP_CHUNKS, exclude=seen
    )
    start = len(d.chunks) + 1
    d.chunks.extend(found)
    d.emit(
        "agent_step",
        agent=specialist_name(d.book_number),
        book_number=d.book_number,
        kind="retrieval",
        query=keywords,
        follow_up=True,
        chunks=[c.as_dict() for c in found],
        evidence_chars=sum(len(c.text) for c in found),
    )
    if not found:
        return "No new passages matched those keywords."
    return format_evidence(found, start=start)


async def run_specialist(book_number: int, question: str, emit: Emit | None = None) -> dict:
    """Answer `question` from book `book_number`'s retrieved passages only."""
    emit = emit or _noop
    name = specialist_name(book_number)
    title = BOOK_TITLES.get(book_number, f"Book {book_number}")
    base = {"agent": name, "book_number": book_number, "book_title": title}
    try:
        chunks = retrieve_chunks(book_number, question)
        emit(
            "agent_step",
            **base,
            kind="retrieval",
            query=question,
            follow_up=False,
            chunks=[c.as_dict() for c in chunks],
            evidence_chars=sum(len(c.text) for c in chunks),
        )
        deps = SpecialistDeps(book_number, title, emit, chunks=chunks)
        reply, usage = await run_traced(
            specialist_agent,
            question,
            emit=emit,
            agent_name=name,
            deps=deps,
            model=build_model(),
            book_number=book_number,
        )
        return {
            **base,
            "reply": reply.strip(),
            "status": "done",
            "passages_used": len(deps.chunks),
            "evidence_chars": sum(len(c.text) for c in deps.chunks),
            "chapters": list(dict.fromkeys(c.chapter for c in deps.chunks)),
            "usage": usage,
        }
    except Exception as exc:  # report the failure to the boss rather than crash the run
        return {
            **base,
            "reply": f"Specialist error: {clip(exc, 300)}",
            "status": "error",
            "passages_used": 0,
            "usage": None,
        }
