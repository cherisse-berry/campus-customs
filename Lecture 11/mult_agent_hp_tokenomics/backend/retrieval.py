"""Helpers to pull text chunks from harrypotter.db.

Each novel is cleaned once (front matter and copyright page dropped, PDF line
wraps undone), split by chapter, then packed into small overlapping chunks of
whole sentences. A question is scored against those chunks with BM25 and only
the best few go to a specialist — never an entire novel.
"""

from __future__ import annotations

import math
import os
import re
import sqlite3
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "harrypotter.db"

# Chunk sizing: ~1,200 chars is roughly 300 tokens — big enough to hold a scene
# beat, small enough that the best matches don't drag in pages of filler.
CHUNK_CHARS = int(os.getenv("CHUNK_CHARS", "1200"))
CHUNK_OVERLAP_CHARS = int(os.getenv("CHUNK_OVERLAP_CHARS", "200"))
# Evidence budget per specialist call. 10k chars ≈ 2.5k tokens; 7 books stays
# well under the course Portkey budget. Raise toward 40k if answers feel thin.
MAX_EVIDENCE_CHARS = int(os.getenv("MAX_EVIDENCE_CHARS", "10000"))
MAX_CHUNKS = int(os.getenv("MAX_CHUNKS", "8"))

STOPWORDS = set(
    """a about above after again against all am an and any are as at be because been
    before being below between both but by can could did do does doing down during each
    few for from further had has have having he her here hers herself him himself his how
    i if in into is it its itself just me more most my myself no nor not now of off on
    once only or other our ours out over own same she should so some such than that the
    their theirs them themselves then there these they this those through to too under
    until up very was we were what when where which while who whom why will with would
    you your yours yourself book books series harry potter tell explain describe happen
    happens happened does did across each every find found get got make made say said
    give list detail details kind way thing things also ever""".split()
)

_WORD = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")
_SENTENCE_END = re.compile(r"(?<=[.!?…”])\s+(?=[“\"A-Z])")
_CHAPTER_HEAD = re.compile(
    r"(?:(\S)\s*\n[ \t]*\n)?CHAPTER ([A-Z][A-Z\-]*(?: [A-Z\-]+)*)\n([^\n]+)\n"
)


@dataclass
class Chunk:
    book_number: int
    chunk_id: int
    chapter: str
    text: str
    score: float = 0.0
    matched_terms: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "book_number": self.book_number,
            "chunk_id": self.chunk_id,
            "chapter": self.chapter,
            "chars": len(self.text),
            "score": round(self.score, 2),
            "matched_terms": self.matched_terms,
            "preview": self.text[:160],
        }


def _connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise FileNotFoundError(f"Missing {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def list_books() -> list[dict]:
    """Metadata for all novels (no text)."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT book_number, title, page_count, char_count, token_count "
            "FROM books ORDER BY book_number"
        ).fetchall()
    return [dict(r) for r in rows]


def get_book_meta(book_number: int) -> dict:
    """Title and counts for one novel."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT book_number, title, page_count, char_count, token_count "
            "FROM books WHERE book_number = ?",
            (book_number,),
        ).fetchone()
    if row is None:
        raise ValueError(f"No book {book_number} in {DB_PATH.name}")
    return dict(row)


def _tokens(text: str) -> list[str]:
    out = []
    for w in _WORD.findall(text.lower().replace("’", "'")):
        w = w.removesuffix("'s")
        if len(w) > 4 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]  # horcruxes → horcruxe ≈ horcrux-ish; wands → wand
        if w.endswith("xe"):
            w = w[:-1]
        if w not in STOPWORDS and len(w) > 1:
            out.append(w)
    return out


def _unwrap(text: str) -> str:
    """Undo PDF hard line wraps and squash whitespace."""
    text = re.sub(r"-\n(?=[a-z])", "", text)  # hyphenated line breaks
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r" ([,.;:!?])", r"\1", text)
    return text.strip()


def _split_chapters(raw: str) -> list[tuple[str, str]]:
    """Return [(chapter label, cleaned body)], dropping front and back matter."""
    cut = raw.find("\n\nText copyright ©")
    if cut != -1:
        raw = raw[:cut]
    heads = list(_CHAPTER_HEAD.finditer(raw))
    chapters = []
    for i, m in enumerate(heads):
        drop_cap, number, title = m.group(1) or "", m.group(2), m.group(3).strip()
        end = heads[i + 1].start() if i + 1 < len(heads) else len(raw)
        body = drop_cap + raw[m.end() : end]
        label = f"Ch. {number.capitalize()}: {' '.join(w.capitalize() for w in title.lower().split())}"
        chapters.append((label, _unwrap(body)))
    return chapters


def _pack(sentences: list[str]) -> list[str]:
    """Greedy-pack sentences into ~CHUNK_CHARS chunks with sentence overlap."""
    chunks, cur, cur_len = [], [], 0
    for s in sentences:
        if cur and cur_len + len(s) > CHUNK_CHARS:
            chunks.append(" ".join(cur))
            # carry the tail sentences forward as overlap
            keep, kept = [], 0
            for prev in reversed(cur):
                if kept + len(prev) > CHUNK_OVERLAP_CHARS:
                    break
                keep.insert(0, prev)
                kept += len(prev)
            cur, cur_len = keep, kept
        cur.append(s)
        cur_len += len(s) + 1
    if cur:
        chunks.append(" ".join(cur))
    return chunks


@dataclass
class _BookIndex:
    chunks: list[Chunk]
    term_freqs: list[Counter]
    doc_freq: Counter
    avg_len: float


@lru_cache(maxsize=7)
def _book_index(book_number: int) -> _BookIndex:
    with _connect() as conn:
        row = conn.execute("SELECT text FROM books WHERE book_number = ?", (book_number,)).fetchone()
    if row is None:
        raise ValueError(f"No book {book_number} in {DB_PATH.name}")
    chunks: list[Chunk] = []
    for label, body in _split_chapters(row["text"]):
        for piece in _pack(_SENTENCE_END.split(body)):
            chunks.append(Chunk(book_number, len(chunks), label, piece))
    term_freqs = [Counter(_tokens(c.text)) for c in chunks]
    doc_freq: Counter = Counter()
    for tf in term_freqs:
        doc_freq.update(tf.keys())
    avg_len = sum(sum(tf.values()) for tf in term_freqs) / max(len(term_freqs), 1)
    return _BookIndex(chunks, term_freqs, doc_freq, avg_len)


def chunk_stats(book_number: int) -> dict:
    idx = _book_index(book_number)
    return {"chunks": len(idx.chunks), "avg_chunk_chars": round(sum(len(c.text) for c in idx.chunks) / len(idx.chunks))}


def retrieve_chunks(
    book_number: int,
    question: str,
    max_chars: int = MAX_EVIDENCE_CHARS,
    max_chunks: int = MAX_CHUNKS,
    exclude: set[int] | None = None,
) -> list[Chunk]:
    """BM25-score this book's chunks against the question; return the best few.

    Results are capped by count and total characters, then returned in story
    order so the specialist reads them as a timeline.
    """
    idx = _book_index(book_number)
    terms = list(dict.fromkeys(_tokens(question)))
    if not terms:
        return []
    n = len(idx.chunks)
    k1, b = 1.4, 0.75
    q_lower = question.lower()
    scored: list[tuple[float, int, list[str]]] = []
    for i, tf in enumerate(idx.term_freqs):
        length = sum(tf.values()) or 1
        score, hits = 0.0, []
        for t in terms:
            f = tf.get(t)
            if not f:
                continue
            idf = math.log(1 + (n - idx.doc_freq[t] + 0.5) / (idx.doc_freq[t] + 0.5))
            score += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * length / idx.avg_len))
            hits.append(t)
        if not hits or (exclude and i in exclude):
            continue
        # Reward chunks that cover more of the question, and exact phrases.
        score *= 1 + 0.25 * (len(hits) - 1)
        text_lower = idx.chunks[i].text.lower()
        for phrase in re.findall(r"[a-z]+ [a-z]+", q_lower):
            if phrase.split()[0] not in STOPWORDS and phrase in text_lower:
                score += 2.0
        scored.append((score, i, hits))

    scored.sort(reverse=True)
    picked: list[Chunk] = []
    used = 0
    for score, i, hits in scored:
        if len(picked) >= max_chunks:
            break
        c = idx.chunks[i]
        # neighbours overlap by ~200 chars; skip a chunk if its neighbour is in
        if any(abs(p.chunk_id - i) == 1 for p in picked) and len(picked) >= 3:
            continue
        if used + len(c.text) > max_chars:
            continue
        picked.append(Chunk(c.book_number, c.chunk_id, c.chapter, c.text, score, hits))
        used += len(c.text)
    return sorted(picked, key=lambda c: c.chunk_id)


def format_evidence(chunks: list[Chunk], start: int = 1) -> str:
    """Join chunks into a prompt-ready block with stable passage labels."""
    if not chunks:
        return "(no matching passages found)"
    return "\n\n".join(f"[P{n}] ({c.chapter})\n{c.text}" for n, c in enumerate(chunks, start))
