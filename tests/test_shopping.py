import copy
import re
from contextlib import contextmanager
from decimal import Decimal
from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from app.auth.dependencies import get_current_user
from app.main import app
from app.shopping import service

ALICE = {"user_id": "alice", "email": "alice@example.com", "name": "Alice", "avatar_url": None, "created_at": "2026-06-01"}
BOB = {"user_id": "bob", "email": "bob@example.com", "name": "Bob", "avatar_url": None, "created_at": "2026-06-01"}
CAROL = {"user_id": "carol", "email": "carol@example.com", "name": "Carol", "avatar_url": None, "created_at": "2026-06-01"}
USERS_BY_EMAIL = {u["email"]: u for u in (ALICE, BOB, CAROL)}

client = TestClient(app)


# ── in-memory DynamoDB fake ──────────────────────────────────────────────────
# Enforces each table's real key schema, so a request that addresses items by
# the wrong key fails here just like it does in AWS.

class FakeTable:
    def __init__(self, *key_attrs):
        self.key_attrs = key_attrs
        self.items: dict[tuple, dict] = {}

    def _key(self, key, op):
        if set(key) != set(self.key_attrs):
            raise ClientError({"Error": {"Code": "ValidationException", "Message": "key schema mismatch"}}, op)
        return tuple(key[a] for a in self.key_attrs)

    def get_item(self, Key):
        item = self.items.get(self._key(Key, "GetItem"))
        return {"Item": copy.deepcopy(item)} if item else {}

    def put_item(self, Item):
        self.items[self._key({a: Item.get(a) for a in self.key_attrs}, "PutItem")] = copy.deepcopy(Item)

    def delete_item(self, Key, ConditionExpression=None):
        key = self._key(Key, "DeleteItem")
        if ConditionExpression and key not in self.items:
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "DeleteItem")
        self.items.pop(key, None)

    @contextmanager
    def batch_writer(self):
        yield self

    def _condition(self, expression):
        expr = expression.get_expression()
        attr, value = expr["values"][0].name, expr["values"][1]
        if expr["operator"] == "=":
            return lambda i: i.get(attr) == value
        if expr["operator"] == "contains":
            return lambda i: value in i.get(attr, ())
        raise NotImplementedError(expr["operator"])

    def query(self, KeyConditionExpression, ExclusiveStartKey=None):
        match = self._condition(KeyConditionExpression)
        return {"Items": [copy.deepcopy(i) for i in self.items.values() if match(i)]}

    def scan(self, FilterExpression, ExclusiveStartKey=None):
        match = self._condition(FilterExpression)
        return {"Items": [copy.deepcopy(i) for i in self.items.values() if match(i)]}

    def update_item(self, Key, UpdateExpression, ExpressionAttributeValues=None, ExpressionAttributeNames=None):
        item = self.items[self._key(Key, "UpdateItem")]
        names, values = ExpressionAttributeNames or {}, ExpressionAttributeValues or {}
        resolve = lambda path: [names.get(p, p) for p in path.strip().split(".")]  # noqa: E731
        for action, body in re.findall(r"(SET|ADD|DELETE|REMOVE)\s+(.*?)(?=\s+(?:SET|ADD|DELETE|REMOVE)\s|$)", UpdateExpression):
            for clause in body.split(","):
                if action == "SET":
                    path, placeholder = clause.split("=")
                    *parents, leaf = resolve(path)
                    target = item
                    for p in parents:
                        target = target.setdefault(p, {})
                    target[leaf] = copy.deepcopy(values[placeholder.strip()])
                elif action == "REMOVE":
                    *parents, leaf = resolve(clause)
                    target = item
                    for p in parents:
                        target = target[p]
                    target.pop(leaf, None)
                else:
                    attr, placeholder = clause.split()
                    current = set(item.get(attr, set()))
                    item[attr] = current | values[placeholder] if action == "ADD" else current - values[placeholder]


@pytest.fixture
def tables():
    fakes = {"lists": FakeTable("list_id"), "items": FakeTable("list_id", "item_id")}
    with patch.object(service, "_lists", lambda: fakes["lists"]), \
         patch.object(service, "_items", lambda: fakes["items"]), \
         patch.object(service, "get_user_by_email", lambda email: USERS_BY_EMAIL.get(email)):
        yield fakes


@pytest.fixture(autouse=True)
def as_user():
    def login(user):
        app.dependency_overrides[get_current_user] = lambda: user
    login(ALICE)
    yield login
    app.dependency_overrides.pop(get_current_user, None)


def _list(name="Groceries"):
    res = client.post("/api/shopping/lists", json={"name": name})
    assert res.status_code == 201, res.text
    return res.json()


def _add(list_id, **fields):
    res = client.post(f"/api/shopping/lists/{list_id}/items", json={"name": "Headphones", **fields})
    assert res.status_code == 201, res.text
    return res.json()


def _items(list_id):
    return client.get(f"/api/shopping/lists/{list_id}/items").json()


# ── lists ────────────────────────────────────────────────────────────────────

def test_shopping_requires_auth():
    app.dependency_overrides.pop(get_current_user, None)
    assert client.get("/api/shopping/lists").status_code == 401


def test_create_and_list_several_lists(tables):
    groceries = _list(" Groceries ")
    gifts = _list("Gifts")
    assert groceries["name"] == "Groceries"
    assert [m["user_id"] for m in groceries["members"]] == ["alice"]

    lists = client.get("/api/shopping/lists").json()
    assert {lst["list_id"] for lst in lists} == {groceries["list_id"], gifts["list_id"]}


def test_list_reports_item_counts(tables):
    lst = _list()
    a = _add(lst["list_id"], name="A")
    _add(lst["list_id"], name="B")
    client.post(f"/api/shopping/lists/{lst['list_id']}/items/{a['item_id']}/toggle")
    summary = client.get("/api/shopping/lists").json()[0]
    assert (summary["item_count"], summary["pending_count"]) == (2, 1)


@pytest.mark.parametrize("name", ["", "   ", "x" * 61])
def test_create_list_rejects_bad_name(tables, name):
    assert client.post("/api/shopping/lists", json={"name": name}).status_code == 422


def test_rename_list(tables):
    lst = _list()
    res = client.patch(f"/api/shopping/lists/{lst['list_id']}", json={"name": "Weekly shop"})
    assert res.status_code == 200
    assert client.get("/api/shopping/lists").json()[0]["name"] == "Weekly shop"


def test_items_are_kept_per_list(tables):
    a, b = _list("A"), _list("B")
    _add(a["list_id"], name="Milk")
    _add(b["list_id"], name="Socks")
    assert [i["name"] for i in _items(a["list_id"])] == ["Milk"]
    assert [i["name"] for i in _items(b["list_id"])] == ["Socks"]


# ── sharing ──────────────────────────────────────────────────────────────────

def test_add_member_shares_the_list(tables, as_user):
    lst = _list()
    res = client.post(f"/api/shopping/lists/{lst['list_id']}/members", json={"email": " Bob@Example.com "})
    assert res.status_code == 201
    assert {m["user_id"] for m in res.json()["members"]} == {"alice", "bob"}

    _add(lst["list_id"], name="Milk")
    as_user(BOB)
    assert [x["list_id"] for x in client.get("/api/shopping/lists").json()] == [lst["list_id"]]
    item = _add(lst["list_id"], name="Bread")
    assert item["added_by"] == "bob"
    assert sorted(i["name"] for i in _items(lst["list_id"])) == ["Bread", "Milk"]


def test_member_avatars_come_from_live_profile(tables):
    lst = _list()
    client.post(f"/api/shopping/lists/{lst['list_id']}/members", json={"email": BOB["email"]})
    with patch.dict(USERS_BY_EMAIL, {BOB["email"]: {**BOB, "avatar_url": "data:image/jpeg;base64,xx"}}):
        members = client.get("/api/shopping/lists").json()[0]["members"]
    assert {m["user_id"]: m["avatar_url"] for m in members} == {"alice": None, "bob": "data:image/jpeg;base64,xx"}


@pytest.mark.parametrize("email", ["nobody@example.com", "alice@example.com"])
def test_add_unknown_or_existing_member_returns_400(tables, email):
    lst = _list()
    assert client.post(f"/api/shopping/lists/{lst['list_id']}/members", json={"email": email}).status_code == 400


def test_non_member_cannot_see_or_touch_list(tables, as_user):
    lst = _list()
    item = _add(lst["list_id"])
    lid, iid = lst["list_id"], item["item_id"]
    as_user(CAROL)
    assert client.get("/api/shopping/lists").json() == []
    assert client.get(f"/api/shopping/lists/{lid}/items").status_code == 404
    assert client.post(f"/api/shopping/lists/{lid}/items", json={"name": "X"}).status_code == 404
    assert client.patch(f"/api/shopping/lists/{lid}/items/{iid}", json={"name": "X"}).status_code == 404
    assert client.post(f"/api/shopping/lists/{lid}/items/{iid}/toggle").status_code == 404
    assert client.delete(f"/api/shopping/lists/{lid}/items/{iid}").status_code == 404
    assert client.patch(f"/api/shopping/lists/{lid}", json={"name": "Mine"}).status_code == 404
    assert client.post(f"/api/shopping/lists/{lid}/members", json={"email": CAROL["email"]}).status_code == 404
    assert client.delete(f"/api/shopping/lists/{lid}").status_code == 404
    assert len(tables["items"].items) == 1


def test_item_cannot_be_reached_through_another_list(tables):
    a, b = _list("A"), _list("B")
    item = _add(a["list_id"])
    assert client.delete(f"/api/shopping/lists/{b['list_id']}/items/{item['item_id']}").status_code == 404
    assert len(tables["items"].items) == 1


def test_member_can_leave_shared_list(tables, as_user):
    lst = _list()
    client.post(f"/api/shopping/lists/{lst['list_id']}/members", json={"email": BOB["email"]})
    as_user(BOB)
    assert client.post(f"/api/shopping/lists/{lst['list_id']}/leave").status_code == 204
    assert client.get("/api/shopping/lists").json() == []
    as_user(ALICE)
    assert [m["user_id"] for m in client.get("/api/shopping/lists").json()[0]["members"]] == ["alice"]


def test_last_member_cannot_leave(tables):
    lst = _list()
    assert client.post(f"/api/shopping/lists/{lst['list_id']}/leave").status_code == 400


def test_creator_deletes_list_with_its_items(tables):
    keep, doomed = _list("Keep"), _list("Doomed")
    _add(keep["list_id"])
    _add(doomed["list_id"])
    _add(doomed["list_id"])
    assert client.delete(f"/api/shopping/lists/{doomed['list_id']}").status_code == 204
    assert [x["list_id"] for x in client.get("/api/shopping/lists").json()] == [keep["list_id"]]
    assert len(tables["items"].items) == 1


def test_only_creator_can_delete_shared_list(tables, as_user):
    lst = _list()
    client.post(f"/api/shopping/lists/{lst['list_id']}/members", json={"email": BOB["email"]})
    as_user(BOB)
    assert client.delete(f"/api/shopping/lists/{lst['list_id']}").status_code == 403


# ── items ────────────────────────────────────────────────────────────────────

def test_create_full_item(tables):
    lst = _list()
    data = _add(lst["list_id"], name=" Monitor ", description="4K", price_min=200, price_max=400, url="https://m.com")
    assert (data["name"], data["price_min"], data["price_max"]) == ("Monitor", 200.0, 400.0)
    assert (data["purchased"], data["added_by"]) == (False, "alice")
    assert next(iter(tables["items"].items.values()))["price_min"] == Decimal("200")


def test_create_minimal_item_has_no_prices(tables):
    data = _add(_list()["list_id"], name="Coffee")
    assert (data["price_min"], data["price_max"], data["url"]) == (None, None, "")
    assert "price_min" not in next(iter(tables["items"].items.values()))


@pytest.mark.parametrize("body", [
    {"description": "no name"},
    {"name": "   "},
    {"name": "X", "price_min": -1},
    {"name": "X", "price_min": 50, "price_max": 10},
])
def test_create_item_rejects_invalid_input(tables, body):
    lst = _list()
    assert client.post(f"/api/shopping/lists/{lst['list_id']}/items", json=body).status_code == 422


def test_toggle_flips_purchased(tables):
    lst = _list()
    item = _add(lst["list_id"])
    url = f"/api/shopping/lists/{lst['list_id']}/items/{item['item_id']}/toggle"
    assert client.post(url).json()["purchased"] is True
    assert client.post(url).json()["purchased"] is False


def test_edit_changes_given_fields_only(tables):
    lst = _list()
    item = _add(lst["list_id"], description="Noise cancelling", price_min=100, price_max=300, url="https://a.com")
    res = client.patch(
        f"/api/shopping/lists/{lst['list_id']}/items/{item['item_id']}", json={"name": "Better", "price_max": 250}
    )
    data = res.json()
    assert (data["name"], data["description"], data["price_min"], data["price_max"]) == ("Better", "Noise cancelling", 100.0, 250.0)
    assert _items(lst["list_id"])[0] == data


def test_edit_null_price_clears_it(tables):
    lst = _list()
    item = _add(lst["list_id"], price_min=10, price_max=20)
    data = client.patch(
        f"/api/shopping/lists/{lst['list_id']}/items/{item['item_id']}", json={"price_min": None, "price_max": None}
    ).json()
    assert (data["price_min"], data["price_max"]) == (None, None)


def test_delete_item(tables):
    lst = _list()
    a = _add(lst["list_id"], name="A")
    _add(lst["list_id"], name="B")
    url = f"/api/shopping/lists/{lst['list_id']}/items/{a['item_id']}"
    assert client.delete(url).status_code == 204
    assert [i["name"] for i in _items(lst["list_id"])] == ["B"]
    assert client.delete(url).status_code == 404
