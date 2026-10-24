import base64
import shutil
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import auth, db
from app.main import app

pytestmark = pytest.mark.skipif(
    not db.DB_PATH.exists(), reason="database not present (it is not committed to git)"
)

NEW_USER = {
    "first_name": "Grace",
    "last_name": "Hopper",
    "email": "grace.hopper@yale.edu",
    "password": "cobol-1959",
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A client backed by a throwaway copy of the database."""
    copy = tmp_path / "campus_customs.db"
    shutil.copy(db.DB_PATH, copy)
    monkeypatch.setattr(db, "DB_PATH", copy)
    return TestClient(app)


def user_row(email):
    with sqlite3.connect(db.DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


def test_hash_matches_existing_database_format():
    stored = user_row("test@campuscustoms.yale.edu")["password_hash"]
    algorithm, salt, _ = stored.split("$")
    assert algorithm == "pbkdf2_sha256"
    assert auth.hash_password("password", salt) == stored
    assert auth.verify_password("password", stored)
    assert not auth.verify_password("Password", stored)


def test_new_hashes_use_fresh_salts():
    a, b = auth.hash_password("same-password"), auth.hash_password("same-password")
    assert a != b
    assert auth.verify_password("same-password", a) and auth.verify_password("same-password", b)
    algorithm, salt, digest = a.split("$")
    assert (algorithm, len(salt), len(digest)) == ("pbkdf2_sha256", 16, 64)


def test_existing_account_can_log_in(client):
    r = client.post("/api/auth/login", json={"email": "test@campuscustoms.yale.edu", "password": "password"})
    assert r.status_code == 200
    assert r.json()["email"] == "test@campuscustoms.yale.edu"
    assert "password_hash" not in r.json()
    assert client.get("/api/auth/me").json()["first_name"] == "Test"


def test_login_is_case_insensitive_for_email(client):
    r = client.post("/api/auth/login", json={"email": " TEST@CampusCustoms.yale.edu ", "password": "password"})
    assert r.status_code == 200


@pytest.mark.parametrize(
    "email,password",
    [("test@campuscustoms.yale.edu", "wrong-password"), ("nobody@yale.edu", "password")],
)
def test_bad_login_gives_the_same_error(client, email, password):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 401
    assert r.json()["detail"] == "Incorrect email or password."
    assert client.get("/api/auth/me").status_code == 401


def test_register_saves_user_and_logs_in(client):
    r = client.post("/api/auth/register", json=NEW_USER)
    assert r.status_code == 201
    assert r.json()["name"] == "Grace Hopper"
    assert client.get("/api/auth/me").json()["email"] == NEW_USER["email"]

    row = user_row(NEW_USER["email"])
    assert (row["name"], row["first_name"], row["last_name"]) == ("Grace Hopper", "Grace", "Hopper")
    assert row["created_at"]
    assert NEW_USER["password"] not in row["password_hash"]
    assert auth.verify_password(NEW_USER["password"], row["password_hash"])


def test_new_account_can_log_out_and_back_in(client):
    client.post("/api/auth/register", json=NEW_USER)
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401

    r = client.post("/api/auth/login", json={"email": NEW_USER["email"], "password": NEW_USER["password"]})
    assert r.status_code == 200
    assert client.get("/api/auth/me").json()["name"] == "Grace Hopper"


def test_duplicate_email_is_rejected(client):
    assert client.post("/api/auth/register", json=NEW_USER).status_code == 201
    r = client.post("/api/auth/register", json={**NEW_USER, "email": NEW_USER["email"].upper()})
    assert r.status_code == 409


@pytest.mark.parametrize(
    "change,message",
    [
        ({"first_name": " "}, "first and last name"),
        ({"email": "not-an-email"}, "valid email"),
        ({"password": "short"}, "at least 8"),
    ],
)
def test_register_validates_input(client, change, message):
    r = client.post("/api/auth/register", json={**NEW_USER, **change})
    assert r.status_code == 422
    assert message in r.json()["detail"]
    assert user_row(NEW_USER["email"]) is None


def test_session_cookie_is_http_only_and_tamper_proof(client):
    r = client.post("/api/auth/login", json={"email": "test@campuscustoms.yale.edu", "password": "password"})
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie

    token = auth.make_session_token(1)
    assert auth.read_session_token(token) == 1
    # Swap in another user's id but keep the original signature.
    _, expires, signature = base64.urlsafe_b64decode(token).decode().split(".")
    forged = base64.urlsafe_b64encode(f"2.{expires}.{signature}".encode()).decode()
    assert auth.read_session_token(forged) is None
    assert auth.read_session_token(auth.make_session_token(1, now=0)) is None  # expired
    assert auth.read_session_token("garbage") is None
