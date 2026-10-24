"""Customer accounts: registration, log in, log out and the current session.

Passwords are stored as `pbkdf2_sha256$<salt>$<hex digest>`, the format already
used in the users table: PBKDF2-HMAC-SHA256, 120,000 iterations, with the salt
string's UTF-8 bytes as the salt.

Sessions are a signed cookie holding the user's id and an expiry time, so no
session table is needed. The signing key comes from SESSION_SECRET.
"""

import base64
import hashlib
import hmac
import logging
import os
import re
import secrets
import time

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel

from . import db

ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 120_000
MIN_PASSWORD_LENGTH = 8

COOKIE_NAME = "cc_session"
SESSION_SECONDS = 7 * 24 * 60 * 60
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "").lower() in ("1", "true", "yes")

_secret_env = os.environ.get("SESSION_SECRET")
if not _secret_env:
    logging.getLogger(__name__).warning(
        "SESSION_SECRET is not set; using a random key, so sessions end when the server restarts."
    )
SESSION_SECRET = (_secret_env or secrets.token_hex(32)).encode()

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


# --- Passwords ---------------------------------------------------------------

def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(8)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), ITERATIONS)
    return f"{ALGORITHM}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, salt, expected = stored.split("$")
    except ValueError:
        return False
    if algorithm != ALGORITHM:
        return False
    actual = hash_password(password, salt).split("$")[2]
    return hmac.compare_digest(actual, expected)


# Checked against when an email isn't registered, so a login takes the same
# time whether or not the account exists.
_DUMMY_HASH = hash_password(secrets.token_hex(16))


# --- Session tokens ----------------------------------------------------------

def _sign(payload: str) -> str:
    return hmac.new(SESSION_SECRET, payload.encode(), hashlib.sha256).hexdigest()


def make_session_token(user_id: int, now: float | None = None) -> str:
    expires = int((time.time() if now is None else now) + SESSION_SECONDS)
    payload = f"{user_id}.{expires}"
    raw = f"{payload}.{_sign(payload)}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def read_session_token(token: str, now: float | None = None) -> int | None:
    """Returns the user id for a valid, unexpired token, otherwise None."""
    try:
        user_id, expires, signature = base64.urlsafe_b64decode(token.encode()).decode().split(".")
    except (ValueError, UnicodeDecodeError):
        return None
    if not hmac.compare_digest(signature, _sign(f"{user_id}.{expires}")):
        return None
    if not expires.isdigit() or int(expires) < (time.time() if now is None else now):
        return None
    return int(user_id) if user_id.isdigit() else None


# --- API ---------------------------------------------------------------------

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    first_name: str
    last_name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


def public_user(row) -> dict:
    """The user fields that are safe to send to the browser (never the hash)."""
    return {
        "id": row["id"],
        "name": row["name"],
        "first_name": row["first_name"] or row["name"].split(" ")[0],
        "last_name": row["last_name"] or "",
        "email": row["email"],
    }


def _start_session(response: Response, user_id: int) -> None:
    response.set_cookie(
        COOKIE_NAME,
        make_session_token(user_id),
        max_age=SESSION_SECONDS,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
    )


def current_user(request: Request):
    token = request.cookies.get(COOKIE_NAME)
    user_id = read_session_token(token) if token else None
    return db.get_user_by_id(user_id) if user_id is not None else None


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, response: Response) -> dict:
    first, last = body.first_name.strip(), body.last_name.strip()
    email = body.email.strip().lower()
    if not first or not last:
        raise HTTPException(422, "Please enter your first and last name.")
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "Please enter a valid email address.")
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(422, f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    try:
        user = db.create_user(first, last, email, hash_password(body.password))
    except db.EmailTaken:
        raise HTTPException(409, "An account with this email already exists. Try logging in.")
    _start_session(response, user["id"])
    return public_user(user)


@router.post("/login")
def login(body: LoginRequest, response: Response) -> dict:
    user = db.get_user_by_email(body.email.strip())
    stored = user["password_hash"] if user else _DUMMY_HASH
    if not verify_password(body.password, stored) or user is None:
        raise HTTPException(401, "Incorrect email or password.")
    _start_session(response, user["id"])
    return public_user(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, httponly=True, samesite="lax", secure=COOKIE_SECURE)


@router.get("/me")
def me(request: Request) -> dict:
    user = current_user(request)
    if user is None:
        raise HTTPException(401, "Not logged in.")
    return public_user(user)
