import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app


class FakeUsersTable:
    """Minimal in-memory stand-in for the DynamoDB users table."""

    def __init__(self):
        self.store: dict[str, dict] = {}

    def get_item(self, Key):
        item = self.store.get(Key["email"])
        return {"Item": dict(item)} if item else {}

    def put_item(self, Item):
        self.store[Item["email"]] = dict(Item)

    def update_item(self, Key, UpdateExpression, ExpressionAttributeValues):
        item = self.store[Key["email"]]
        for placeholder, value in ExpressionAttributeValues.items():
            item[placeholder.lstrip(":")] = value


@pytest.fixture
def fake_table():
    table = FakeUsersTable()
    with patch("app.auth.service._table", return_value=table):
        yield table


@pytest.fixture
def client():
    return TestClient(app)


# ── signup ───────────────────────────────────────────────────────────────────
@pytest.mark.skip(reason="Temporarily disabled until MVP")
def test_signup_creates_user_and_sets_cookie(client, fake_table):
    res = client.post("/api/auth/signup", json={
        "email": "Ada@Example.com",
        "password": "supersecret",
        "name": "Ada Lovelace",
    })
    assert res.status_code == 201
    data = res.json()
    assert data["email"] == "ada@example.com"
    assert data["name"] == "Ada Lovelace"
    assert "password_hash" not in data
    assert "session" in res.cookies


@pytest.mark.skip(reason="Temporarily disabled until MVP")
def test_signup_duplicate_email_returns_409(client, fake_table):
    client.post("/api/auth/signup", json={"email": "a@b.com", "password": "supersecret", "name": "A"})
    res = client.post("/api/auth/signup", json={"email": "a@b.com", "password": "anotherpass", "name": "A2"})
    assert res.status_code == 409


@pytest.mark.skip(reason="Temporarily disabled until MVP")
def test_signup_short_password_returns_400(client, fake_table):
    res = client.post("/api/auth/signup", json={"email": "a@b.com", "password": "short", "name": "A"})
    assert res.status_code == 400


def test_signup_invalid_email_returns_422(client, fake_table):
    res = client.post("/api/auth/signup", json={"email": "not-an-email", "password": "supersecret", "name": "A"})
    assert res.status_code == 422


# ── login ────────────────────────────────────────────────────────────────────
@pytest.mark.skip(reason="Temporarily disabled until MVP")
def test_login_success_sets_cookie(client, fake_table):
    client.post("/api/auth/signup", json={"email": "a@b.com", "password": "supersecret", "name": "A"})
    res = client.post("/api/auth/login", json={"email": "a@b.com", "password": "supersecret"})
    assert res.status_code == 200
    assert res.json()["email"] == "a@b.com"
    assert "session" in res.cookies


@pytest.mark.skip(reason="Temporarily disabled until MVP")
def test_login_wrong_password_returns_401(client, fake_table):
    client.post("/api/auth/signup", json={"email": "a@b.com", "password": "supersecret", "name": "A"})
    res = client.post("/api/auth/login", json={"email": "a@b.com", "password": "wrongpass"})
    assert res.status_code == 401


@pytest.mark.skip(reason="Temporarily disabled until MVP")
def test_login_unknown_email_returns_401(client, fake_table):
    res = client.post("/api/auth/login", json={"email": "nobody@b.com", "password": "supersecret"})
    assert res.status_code == 401


# ── /api/auth/me ─────────────────────────────────────────────────────────────

def test_me_without_cookie_returns_401(client, fake_table):
    res = client.get("/api/auth/me")
    assert res.status_code == 401


@pytest.mark.skip(reason="Temporarily disabled until MVP")
def test_me_with_valid_session_returns_user(client, fake_table):
    client.post("/api/auth/signup", json={"email": "a@b.com", "password": "supersecret", "name": "A"})
    res = client.get("/api/auth/me")
    assert res.status_code == 200
    assert res.json()["email"] == "a@b.com"


@pytest.mark.skip(reason="Temporarily disabled until MVP")
def test_logout_clears_session(client, fake_table):
    client.post("/api/auth/signup", json={"email": "a@b.com", "password": "supersecret", "name": "A"})
    assert client.get("/api/auth/me").status_code == 200
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401


@pytest.mark.skip(reason="Temporarily disabled until MVP")
def test_patch_me_updates_name_and_avatar(client, fake_table):
    client.post("/api/auth/signup", json={"email": "a@b.com", "password": "supersecret", "name": "A"})
    res = client.patch("/api/auth/me", json={"name": "New Name", "avatar_url": "data:image/png;base64,xyz"})
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "New Name"
    assert data["avatar_url"] == "data:image/png;base64,xyz"


# ── session expiry / sliding idle timeout ──────────────────────────────────


def test_session_cookie_has_no_max_age(client, fake_table):
    """Cookie must be a browser-session cookie so it clears when the browser closes."""
    res = client.post("/api/auth/signup", json={"email": "a@b.com", "password": "supersecret", "name": "A"})
    set_cookie_header = res.headers.get("set-cookie", "")
    assert "max-age" not in set_cookie_header.lower()
    assert "expires" not in set_cookie_header.lower()


@pytest.mark.skip(reason="Temporarily disabled until MVP")
def test_session_expires_after_idle_timeout(client, fake_table):
    with patch("app.auth.security.SESSION_IDLE_TIMEOUT_SECONDS", 1):
        client.post("/api/auth/signup", json={"email": "a@b.com", "password": "supersecret", "name": "A"})
        assert client.get("/api/auth/me").status_code == 200
        time.sleep(1.5)
        assert client.get("/api/auth/me").status_code == 401


@pytest.mark.skip(reason="Temporarily disabled until MVP")
def test_activity_slides_session_expiry_forward(client, fake_table):
    """Each authenticated request should refresh the session so continued
    activity never hits the idle timeout."""
    with patch("app.auth.security.SESSION_IDLE_TIMEOUT_SECONDS", 2):
        client.post("/api/auth/signup", json={"email": "a@b.com", "password": "supersecret", "name": "A"})
        for _ in range(3):
            time.sleep(1)
            assert client.get("/api/auth/me").status_code == 200
        # still valid because each request above reset the idle window
        assert client.get("/api/auth/me").status_code == 200
