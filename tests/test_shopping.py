import copy
import re
from decimal import Decimal
from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from app.auth.dependencies import get_current_user
from app.main import app
from app.shopping import service

TEST_USER = {"user_id": "user-1", "email": "test@example.com", "name": "Test", "avatar_url": None, "created_at": "2026-06-01"}
OTHER_USER = {**TEST_USER, "user_id": "user-2", "email": "other@example.com"}

client = TestClient(app)


# ── in-memory DynamoDB fake ──────────────────────────────────────────────────
# Enforces the table's real key schema (user_id + item_id), so a request that
# addresses items by the wrong key fails here just like it does in AWS.

KEY_ATTRS = ("user_id", "item_id")


def _validation_error(op):
    return ClientError({"Error": {"Code": "ValidationException", "Message": "key schema mismatch"}}, op)


class FakeTable:
    def __init__(self):
        self.items: dict[tuple, dict] = {}

    def _key(self, key, op):
        if set(key) != set(KEY_ATTRS):
            raise _validation_error(op)
        return tuple(key[a] for a in KEY_ATTRS)

    def get_item(self, Key):
        item = self.items.get(self._key(Key, "GetItem"))
        return {"Item": copy.deepcopy(item)} if item else {}

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

    def update_item(self, Key, UpdateExpression, ExpressionAttributeNames=None, ExpressionAttributeValues=None):
        item = self.items[self._key(Key, "UpdateItem")]
        names = ExpressionAttributeNames or {}
        values = ExpressionAttributeValues or {}
        for action, body in re.findall(r"(SET|REMOVE)\s+(.*?)(?=\s+(?:SET|REMOVE)\s|$)", UpdateExpression):
            for clause in body.split(","):
                if action == "SET":
                    path, placeholder = [p.strip() for p in clause.split("=")]
                    item[names.get(path, path)] = copy.deepcopy(values[placeholder])
                else:
                    item.pop(names.get(clause.strip(), clause.strip()), None)


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


def _add(**fields):
    return client.post("/api/shopping", json={"name": "Headphones", **fields}).json()


# ── the bug this table layout fixes ──────────────────────────────────────────

def test_user_can_have_many_items(table):
    for name in ("Headphones", "Keyboard", "Monitor"):
        assert client.post("/api/shopping", json={"name": name}).status_code == 201
    names = [i["name"] for i in client.get("/api/shopping").json()]
    assert sorted(names) == ["Headphones", "Keyboard", "Monitor"]


def test_delete_removes_only_that_item(table):
    a = _add(name="A")
    _add(name="B")
    assert client.delete(f"/api/shopping/{a['item_id']}").status_code == 204
    assert [i["name"] for i in client.get("/api/shopping").json()] == ["B"]


def test_delete_missing_item_returns_404(table):
    assert client.delete("/api/shopping/no-such-id").status_code == 404


def test_items_are_private_to_their_owner(table):
    item = _add()
    app.dependency_overrides[get_current_user] = lambda: OTHER_USER
    assert client.get("/api/shopping").json() == []
    assert client.delete(f"/api/shopping/{item['item_id']}").status_code == 404
    assert client.post(f"/api/shopping/{item['item_id']}/toggle").status_code == 404
    assert client.patch(f"/api/shopping/{item['item_id']}", json={"name": "Mine"}).status_code == 404
    assert len(table.items) == 1


# ── create / list ────────────────────────────────────────────────────────────

def test_shopping_requires_auth():
    app.dependency_overrides.pop(get_current_user, None)
    assert client.get("/api/shopping").status_code == 401


def test_list_empty(table):
    assert client.get("/api/shopping").json() == []


def test_list_sorted_by_created_at(table):
    table.put_item(Item={"user_id": "user-1", "item_id": "b", "name": "B", "created_at": "2026-06-29"})
    table.put_item(Item={"user_id": "user-1", "item_id": "a", "name": "A", "created_at": "2026-06-28"})
    assert [i["item_id"] for i in client.get("/api/shopping").json()] == ["a", "b"]


def test_create_full_item(table):
    res = client.post("/api/shopping", json={
        "name": " Monitor ", "description": "4K display", "price_min": 200, "price_max": 400, "url": "https://monitor.com",
    })
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "Monitor"
    assert (data["price_min"], data["price_max"]) == (200.0, 400.0)
    assert data["purchased"] is False
    stored = next(iter(table.items.values()))
    assert stored["user_id"] == "user-1"
    assert stored["price_min"] == Decimal("200")


def test_create_minimal_item_has_no_prices(table):
    data = _add(name="Coffee")
    assert (data["price_min"], data["price_max"], data["url"]) == (None, None, "")
    assert "price_min" not in next(iter(table.items.values()))


@pytest.mark.parametrize("body", [
    {"description": "no name"},
    {"name": "   "},
    {"name": "X", "price_min": -1},
    {"name": "X", "price_min": 50, "price_max": 10},
])
def test_create_rejects_invalid_input(table, body):
    assert client.post("/api/shopping", json=body).status_code == 422


# ── toggle ───────────────────────────────────────────────────────────────────

def test_toggle_flips_purchased(table):
    item = _add()
    assert client.post(f"/api/shopping/{item['item_id']}/toggle").json()["purchased"] is True
    assert client.post(f"/api/shopping/{item['item_id']}/toggle").json()["purchased"] is False


def test_toggle_missing_returns_404(table):
    assert client.post("/api/shopping/no-such-id/toggle").status_code == 404


# ── edit ─────────────────────────────────────────────────────────────────────

def test_edit_changes_given_fields_only(table):
    item = _add(description="Noise cancelling", price_min=100, price_max=300, url="https://a.com")
    res = client.patch(f"/api/shopping/{item['item_id']}", json={"name": "Better headphones", "price_max": 250})
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "Better headphones"
    assert data["description"] == "Noise cancelling"
    assert (data["price_min"], data["price_max"]) == (100.0, 250.0)
    assert data["url"] == "https://a.com"
    assert client.get("/api/shopping").json()[0] == data


def test_edit_null_price_clears_it(table):
    item = _add(price_min=10, price_max=20)
    data = client.patch(f"/api/shopping/{item['item_id']}", json={"price_min": None, "price_max": None}).json()
    assert (data["price_min"], data["price_max"]) == (None, None)
    assert "price_min" not in next(iter(table.items.values()))


def test_edit_keeps_purchased_state(table):
    item = _add()
    client.post(f"/api/shopping/{item['item_id']}/toggle")
    data = client.patch(f"/api/shopping/{item['item_id']}", json={"description": "Wireless"}).json()
    assert data["purchased"] is True


@pytest.mark.parametrize("body", [{"name": ""}, {"price_min": 50, "price_max": 10}, {"price_max": -5}])
def test_edit_rejects_invalid_input(table, body):
    item = _add()
    assert client.patch(f"/api/shopping/{item['item_id']}", json=body).status_code == 422


def test_edit_missing_returns_404(table):
    assert client.patch("/api/shopping/no-such-id", json={"name": "X"}).status_code == 404
