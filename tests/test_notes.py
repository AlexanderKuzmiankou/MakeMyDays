import copy
from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from app.auth.dependencies import get_current_user
from app.main import app
from app.notes import service

TEST_USER = {"user_id": "user-1", "email": "test@example.com", "name": "Test", "avatar_url": None, "created_at": "2026-06-01"}
OTHER_USER = {**TEST_USER, "user_id": "user-2", "email": "other@example.com"}

client = TestClient(app)


# ── in-memory DynamoDB fake ──────────────────────────────────────────────────
# Enforces the table's real key schema (user_id + note_id).

KEY_ATTRS = ("user_id", "note_id")


class FakeTable:
    def __init__(self):
        self.items: dict[tuple, dict] = {}

    def _key(self, key, op):
        if set(key) != set(KEY_ATTRS):
            raise ClientError({"Error": {"Code": "ValidationException", "Message": "key schema mismatch"}}, op)
        return tuple(key[a] for a in KEY_ATTRS)

    def put_item(self, Item):
        self.items[self._key({a: Item.get(a) for a in KEY_ATTRS}, "PutItem")] = copy.deepcopy(Item)

    def query(self, KeyConditionExpression, ExclusiveStartKey=None):
        expr = KeyConditionExpression.get_expression()
        attr, value = expr["values"][0].name, expr["values"][1]
        assert attr == "user_id" and expr["operator"] == "="
        return {"Items": [copy.deepcopy(i) for i in self.items.values() if i["user_id"] == value]}

    def delete_item(self, Key, ConditionExpression=None):
        key = self._key(Key, "DeleteItem")
        if ConditionExpression and key not in self.items:
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "DeleteItem")
        self.items.pop(key, None)

    def update_item(self, Key, UpdateExpression, ExpressionAttributeValues, ExpressionAttributeNames, ConditionExpression, ReturnValues):
        key = self._key(Key, "UpdateItem")
        if key not in self.items:
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem")
        item = self.items[key]
        assert UpdateExpression.startswith("SET ")
        for clause in UpdateExpression[4:].split(","):
            path, placeholder = [p.strip() for p in clause.split("=")]
            item[ExpressionAttributeNames[path]] = copy.deepcopy(ExpressionAttributeValues[placeholder])
        return {"Attributes": copy.deepcopy(item)}


@pytest.fixture
def table():
    fake = FakeTable()
    with patch.object(service, "_table", lambda: fake):
        yield fake


@pytest.fixture(autouse=True)
def _authenticated():
    app.dependency_overrides[get_current_user] = lambda: TEST_USER
    yield
    app.dependency_overrides.pop(get_current_user, None)


BLOCKS = [
    {"type": "text", "text": "Pack light."},
    {"type": "list", "checklist": True, "items": [{"text": "Passport", "checked": True}, {"text": "Charger"}]},
    {"type": "table", "rows": [["Day", "City"], ["Mon", "Lisbon"]]},
]


def _add(**fields):
    response = client.post("/api/notes", json={"title": "Trip", "blocks": BLOCKS, **fields})
    assert response.status_code == 201
    return response.json()


# ── CRUD ─────────────────────────────────────────────────────────────────────

def test_create_and_list_round_trips_all_block_types(table):
    note = _add()
    assert note["title"] == "Trip"
    assert note["blocks"][1]["items"][1] == {"text": "Charger", "checked": False}  # defaults filled in
    assert client.get("/api/notes").json() == [note]


def test_update_changes_only_given_fields(table):
    note = _add()
    updated = client.patch(f"/api/notes/{note['note_id']}", json={"title": "  Lisbon trip  "}).json()
    assert updated["title"] == "Lisbon trip"
    assert updated["blocks"] == note["blocks"]

    updated = client.patch(f"/api/notes/{note['note_id']}", json={"blocks": [{"type": "text", "text": "x"}]}).json()
    assert updated["blocks"] == [{"type": "text", "text": "x"}]
    assert updated["title"] == "Lisbon trip"


def test_delete_removes_note(table):
    note = _add()
    assert client.delete(f"/api/notes/{note['note_id']}").status_code == 204
    assert client.get("/api/notes").json() == []
    assert client.delete(f"/api/notes/{note['note_id']}").status_code == 404


def test_pinned_notes_come_first(table):
    _add(title="A")
    b = _add(title="B", pinned=True)
    _add(title="C")
    titles = [n["title"] for n in client.get("/api/notes").json()]
    assert titles[0] == "B"
    client.patch(f"/api/notes/{b['note_id']}", json={"pinned": False})
    assert [n["pinned"] for n in client.get("/api/notes").json()] == [False, False, False]


def test_missing_note_returns_404(table):
    assert client.patch("/api/notes/nope", json={"title": "x"}).status_code == 404
    assert client.delete("/api/notes/nope").status_code == 404


# ── ownership ────────────────────────────────────────────────────────────────

def test_other_user_cannot_see_or_touch_notes(table):
    note = _add()
    app.dependency_overrides[get_current_user] = lambda: OTHER_USER
    assert client.get("/api/notes").json() == []
    assert client.patch(f"/api/notes/{note['note_id']}", json={"title": "pwned"}).status_code == 404
    assert client.delete(f"/api/notes/{note['note_id']}").status_code == 404


# ── validation ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "block",
    [
        {"type": "video", "url": "x"},
        {"type": "table", "rows": []},
        {"type": "table", "rows": [["a", "b"], ["c"]]},
        {"type": "table", "rows": [[str(i) for i in range(11)]]},
        {"type": "list", "items": [{"text": "x" * 501}]},
    ],
)
def test_rejects_invalid_blocks(table, block):
    assert client.post("/api/notes", json={"title": "x", "blocks": [block]}).status_code == 422


def test_rejects_note_too_large_for_dynamodb(table):
    blocks = [{"type": "text", "text": "é" * 20_000}] * 10  # ~400 KB in UTF-8
    assert client.post("/api/notes", json={"blocks": blocks}).status_code == 422


def test_requires_login(table):
    app.dependency_overrides.pop(get_current_user, None)
    assert client.get("/api/notes").status_code == 401
