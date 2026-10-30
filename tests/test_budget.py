import copy
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from app.auth.dependencies import get_current_user
from app.budget import service
from app.main import app

ALICE = {"user_id": "alice", "email": "alice@example.com", "name": "Alice", "avatar_url": None, "created_at": "2026-06-01"}
BOB = {"user_id": "bob", "email": "bob@example.com", "name": "Bob", "avatar_url": None, "created_at": "2026-06-01"}

client = TestClient(app)


# ── in-memory DynamoDB fake ──────────────────────────────────────────────────
# Enforces the real key schema (user_id + item_id) and supports exactly the
# request shapes service.py sends: key-condition queries with begins_with,
# conditional puts, and SET / REMOVE updates.

KEY_ATTRS = ("user_id", "item_id")


def _conditional_failed(op):
    return ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, op)


class FakeTable:
    def __init__(self):
        self.items: dict[tuple, dict] = {}

    def _key(self, key, op):
        if set(key) != set(KEY_ATTRS):
            raise ClientError({"Error": {"Code": "ValidationException", "Message": "key schema mismatch"}}, op)
        return tuple(key[a] for a in KEY_ATTRS)

    def get_item(self, Key):
        item = self.items.get(self._key(Key, "GetItem"))
        return {"Item": copy.deepcopy(item)} if item else {}

    def put_item(self, Item, ConditionExpression=None):
        key = self._key({a: Item.get(a) for a in KEY_ATTRS}, "PutItem")
        if ConditionExpression == "attribute_not_exists(item_id)" and key in self.items:
            raise _conditional_failed("PutItem")
        self.items[key] = copy.deepcopy(Item)

    def delete_item(self, Key):
        self.items.pop(self._key(Key, "DeleteItem"), None)

    def query(self, KeyConditionExpression, ExclusiveStartKey=None):
        def matches(cond, item):
            expr = cond.get_expression()
            if expr["operator"] == "AND":
                return all(matches(c, item) for c in expr["values"])
            attr, value = expr["values"][0].name, expr["values"][1]
            if expr["operator"] == "=":
                return item.get(attr) == value
            if expr["operator"] == "begins_with":
                return item.get(attr, "").startswith(value)
            raise NotImplementedError(expr["operator"])

        return {"Items": [copy.deepcopy(i) for i in self.items.values() if matches(KeyConditionExpression, i)]}

    def update_item(self, Key, UpdateExpression, ExpressionAttributeValues=None,
                    ExpressionAttributeNames=None, ConditionExpression=None):
        key = self._key(Key, "UpdateItem")
        if key not in self.items:
            if ConditionExpression:
                raise _conditional_failed("UpdateItem")
            self.items[key] = dict(Key)
        item = self.items[key]
        names = ExpressionAttributeNames or {}
        action, body = UpdateExpression.split(" ", 1)
        for clause in body.split(","):
            if action == "SET":
                path, placeholder = [p.strip() for p in clause.split("=")]
                item[names.get(path, path)] = copy.deepcopy(ExpressionAttributeValues[placeholder])
            elif action == "REMOVE":
                item.pop(names.get(clause.strip(), clause.strip()), None)
            else:
                raise NotImplementedError(action)


@pytest.fixture
def table():
    fake = FakeTable()
    with patch.object(service, "_table", lambda: fake):
        yield fake


@pytest.fixture
def as_user():
    def login(user):
        app.dependency_overrides[get_current_user] = lambda: user
    login(ALICE)
    yield login
    app.dependency_overrides.pop(get_current_user, None)


def _category(name, kind="expense"):
    return next(c for c in service.list_categories("alice") if c["name"] == name and c["kind"] == kind)


def _add(kind, amount, on, category=None, description="x"):
    body = {"kind": kind, "amount": amount, "date": on, "description": description}
    if category:
        body["category_id"] = category["category_id"]
    res = client.post("/api/budget/transactions", json=body)
    assert res.status_code == 201, res.text
    return res.json()


# ── settings and categories ──────────────────────────────────────────────────

def test_first_use_seeds_default_categories_once(table, as_user):
    first = client.get("/api/budget/categories").json()
    names = [c["name"] for c in first]
    assert "Housing" in names and "Salary" in names
    assert [c["kind"] for c in first] == sorted((c["kind"] for c in first), key=service.KINDS.index)

    # Deleting every category must not bring the defaults back.
    for c in first:
        assert client.delete(f"/api/budget/categories/{c['category_id']}").status_code == 204
    assert client.get("/api/budget/categories").json() == []


def test_settings_currency_defaults_to_euro_and_can_change(table, as_user):
    assert client.get("/api/budget/settings").json() == {"currency": "EUR"}
    res = client.patch("/api/budget/settings", json={"currency": "usd"})
    assert res.json() == {"currency": "USD"}
    assert client.patch("/api/budget/settings", json={"currency": "dollars"}).status_code == 422


def test_custom_category_create_rename_and_validation(table, as_user):
    res = client.post("/api/budget/categories", json={"name": "Pets", "kind": "expense", "color": "#E87BA4"})
    assert res.status_code == 201
    pet = res.json()
    assert pet["color"] == "#e87ba4"

    res = client.patch(f"/api/budget/categories/{pet['category_id']}", json={"name": "Dog"})
    assert res.json()["name"] == "Dog"

    assert client.post("/api/budget/categories", json={"name": "  "}).status_code == 422
    assert client.post("/api/budget/categories", json={"name": "X", "kind": "savings"}).status_code == 422
    assert client.post("/api/budget/categories", json={"name": "X", "color": "red"}).status_code == 422
    assert client.patch("/api/budget/categories/missing", json={"name": "Y"}).status_code == 404


def test_users_cannot_see_each_others_budget(table, as_user):
    tx = _add("expense", 10, "2026-03-01")
    as_user(BOB)
    assert client.get("/api/budget/transactions").json() == []
    assert client.delete(f"/api/budget/transactions/{tx['transaction_id']}").status_code == 404


# ── transactions ─────────────────────────────────────────────────────────────

def test_transaction_crud_and_period_filter(table, as_user):
    food = _category("Food & groceries")
    tx = _add("expense", 12.345, "2026-03-05", food, "Groceries")
    assert tx["amount"] == 12.35
    _add("income", 1000, "2026-04-01")

    march = client.get("/api/budget/transactions", params={"year": 2026, "month": 3}).json()
    assert [t["transaction_id"] for t in march] == [tx["transaction_id"]]
    assert len(client.get("/api/budget/transactions", params={"year": 2026}).json()) == 2

    res = client.patch(f"/api/budget/transactions/{tx['transaction_id']}", json={"amount": 20, "category_id": ""})
    assert res.json()["amount"] == 20 and res.json()["category_id"] is None
    assert res.json()["description"] == "Groceries"

    assert client.delete(f"/api/budget/transactions/{tx['transaction_id']}").status_code == 204
    assert client.delete(f"/api/budget/transactions/{tx['transaction_id']}").status_code == 404


def test_transaction_category_must_exist_and_match_kind(table, as_user):
    salary = _category("Salary", "income")
    res = client.post("/api/budget/transactions",
                      json={"kind": "expense", "amount": 5, "category_id": salary["category_id"]})
    assert res.status_code == 400
    res = client.post("/api/budget/transactions", json={"kind": "expense", "amount": 5, "category_id": "nope"})
    assert res.status_code == 400
    assert client.post("/api/budget/transactions", json={"kind": "expense", "amount": 0}).status_code == 422


# ── recurring ────────────────────────────────────────────────────────────────

def test_recurring_generates_due_occurrences_once(table, as_user):
    start = (date.today() - timedelta(days=15)).isoformat()
    res = client.post("/api/budget/recurring", json={
        "kind": "expense", "amount": 9.99, "frequency": "weekly", "start_date": start, "description": "Streaming",
    })
    assert res.status_code == 201
    rec = res.json()
    assert rec["next_due"] == (date.today() - timedelta(days=15) + timedelta(weeks=3)).isoformat()

    for _ in range(2):  # reading twice must not double-book
        txs = client.get("/api/budget/transactions").json()
    assert len(txs) == 3
    assert {t["recurring_id"] for t in txs} == {rec["recurring_id"]}


def test_recurring_month_end_does_not_drift():
    start = date(2026, 1, 31)
    dates = [service._occurrence_date(start, "monthly", n) for n in range(3)]
    assert dates == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31)]


def test_recurring_update_and_delete_keep_past_occurrences(table, as_user):
    start = (date.today() - timedelta(days=40)).isoformat()
    rec = client.post("/api/budget/recurring", json={
        "kind": "income", "amount": 100, "frequency": "monthly", "start_date": start,
    }).json()
    end = date.today().isoformat()
    res = client.patch(f"/api/budget/recurring/{rec['recurring_id']}", json={"amount": 150, "end_date": end})
    assert res.json()["amount"] == 150 and res.json()["end_date"] == end
    assert res.json()["next_due"] is None

    res = client.patch(f"/api/budget/recurring/{rec['recurring_id']}", json={"end_date": ""})
    assert res.json()["end_date"] is None

    salary = _category("Salary", "income")
    res = client.patch(f"/api/budget/recurring/{rec['recurring_id']}", json={"category_id": salary["category_id"]})
    assert res.json()["category_id"] == salary["category_id"]
    res = client.patch(f"/api/budget/recurring/{rec['recurring_id']}", json={"category_id": ""})
    assert res.json()["category_id"] is None

    before = client.get("/api/budget/transactions").json()
    assert client.delete(f"/api/budget/recurring/{rec['recurring_id']}").status_code == 204
    assert client.get("/api/budget/transactions").json() == before
    assert client.get("/api/budget/recurring").json() == []


def test_recurring_validation(table, as_user):
    base = {"kind": "expense", "amount": 5, "frequency": "monthly", "start_date": "2026-05-01"}
    assert client.post("/api/budget/recurring", json={**base, "frequency": "daily"}).status_code == 422
    assert client.post("/api/budget/recurring", json={**base, "end_date": "2026-04-01"}).status_code == 400


# ── caps ─────────────────────────────────────────────────────────────────────

def test_caps_set_list_delete_and_validate(table, as_user):
    food = _category("Food & groceries")
    salary = _category("Salary", "income")

    res = client.put("/api/budget/caps/monthly", json={"total": 2000, "categories": {food["category_id"]: 400}})
    assert res.status_code == 200
    assert res.json() == {"period": "monthly", "total": 2000.0, "categories": {food["category_id"]: 400.0}}
    assert client.put("/api/budget/caps/2026-03", json={"total": 1500}).status_code == 200
    assert [c["period"] for c in client.get("/api/budget/caps").json()] == ["2026-03", "monthly"]

    assert client.put("/api/budget/caps/2026-13", json={"total": 1}).status_code == 400
    assert client.put("/api/budget/caps/weekly", json={"total": 1}).status_code == 400
    assert client.put("/api/budget/caps/2026", json={}).status_code == 400
    assert client.put("/api/budget/caps/2026", json={"categories": {salary["category_id"]: 5}}).status_code == 400
    assert client.put("/api/budget/caps/2026", json={"total": -5}).status_code == 422

    assert client.delete("/api/budget/caps/2026-03").status_code == 204
    assert client.delete("/api/budget/caps/2026-03").status_code == 404


def test_effective_cap_precedence():
    caps = {
        "monthly": {"total": 100.0, "categories": {"food": 30.0}},
        "2026-02": {"total": 50.0, "categories": {}},
    }
    assert service.effective_cap(caps, 2026, 2)["source"] == "month"
    assert service.effective_cap(caps, 2026, 3) == {"total": 100.0, "categories": {"food": 30.0}, "source": "default"}

    # No yearly cap: derived from the twelve monthly ones.
    year = service.effective_cap(caps, 2026)
    assert year["source"] == "months"
    assert year["total"] == 11 * 100 + 50
    assert year["categories"] == {}  # February has no food cap, so no yearly food cap

    caps["yearly"] = {"total": 999.0, "categories": {}}
    assert service.effective_cap(caps, 2026)["total"] == 999.0
    caps["2026"] = {"total": 5.0, "categories": {}}
    assert service.effective_cap(caps, 2026)["source"] == "year"
    assert service.effective_cap({}, 2026) == {"total": None, "categories": {}, "source": None}


# ── summary / overview ───────────────────────────────────────────────────────

def test_summary_totals_categories_and_monthly_series():
    categories = [
        {"category_id": "food", "name": "Food", "kind": "expense", "color": "#eb6834"},
        {"category_id": "rent", "name": "Rent", "kind": "expense", "color": "#2a78d6"},
        {"category_id": "pay", "name": "Pay", "kind": "income", "color": "#2a78d6"},
    ]
    transactions = [
        {"kind": "income", "amount": 3000, "category_id": "pay", "date": "2026-03-01"},
        {"kind": "expense", "amount": 1200, "category_id": "rent", "date": "2026-03-01"},
        {"kind": "expense", "amount": 80.5, "category_id": "food", "date": "2026-03-10"},
        {"kind": "expense", "amount": 20, "category_id": "deleted", "date": "2026-03-11"},
        {"kind": "expense", "amount": 999, "category_id": "food", "date": "2025-12-31"},
    ]
    caps = {"monthly": {"total": 1500.0, "categories": {"food": 50.0}}}

    s = service.build_summary(transactions, [], categories, caps, 2026, today=date(2026, 12, 31))
    assert (s["income"], s["expenses"], s["balance"]) == (3000.0, 1300.5, 1699.5)
    assert s["cap"]["total"] == 18000.0
    assert len(s["series"]) == 12
    assert s["series"][2] == {"period": "2026-03", "income": 3000.0, "expenses": 1300.5,
                              "projected_income": 0.0, "projected_expenses": 0.0, "cap": 1500.0}

    by_name = {c["name"]: c for c in s["categories"]}
    assert by_name["Rent"]["amount"] == 1200.0
    assert by_name["Uncategorized"]["amount"] == 20.0
    assert by_name["Food"]["cap"] == 600.0  # 12 x 50

    m = service.build_summary(transactions, [], categories, caps, 2026, 3, today=date(2026, 12, 31))
    assert m["cap"]["source"] == "default"
    assert len(m["series"]) == 31
    assert m["series"][9]["cumulative_expenses"] == 1280.5
    assert m["series"][-1]["cumulative_expenses"] == 1300.5


def test_summary_projects_upcoming_recurring():
    template = {"item_id": "REC#r1", "kind": "expense", "amount": 100, "frequency": "monthly",
                "start_date": "2026-01-15", "occurrences": 3, "category_id": "rent"}
    categories = [{"category_id": "rent", "name": "Rent", "kind": "expense", "color": "#2a78d6"}]
    # Today is 2026-04-10: April 15 .. December 15 are still to come.
    s = service.build_summary([], [template], categories, {}, 2026, today=date(2026, 4, 10))
    assert s["projected_expenses"] == 900.0
    assert s["series"][3]["projected_expenses"] == 100.0
    assert s["series"][2]["projected_expenses"] == 0.0

    past = service.build_summary([], [template], categories, {}, 2026, 3, today=date(2026, 4, 10))
    assert past["projected_expenses"] == 0.0


def test_overview_returns_everything_for_the_page(table, as_user):
    food = _category("Food & groceries")
    _add("expense", 40, "2026-03-03", food)
    _add("expense", 70, "2026-02-03", food)
    client.put("/api/budget/caps/2026-03", json={"total": 500})

    res = client.get("/api/budget/overview", params={"year": 2026, "month": 3})
    assert res.status_code == 200
    data = res.json()
    assert data["settings"] == {"currency": "EUR"}
    assert len(data["transactions"]) == 1
    assert data["summary"]["expenses"] == 40.0
    assert data["summary"]["cap"]["total"] == 500.0
    assert data["caps"][0]["period"] == "2026-03"

    assert client.get("/api/budget/overview", params={"year": 2026, "month": 13}).status_code == 422
    assert client.get("/api/budget/overview").status_code == 422


def test_budget_requires_login(table):
    assert client.get("/api/budget/overview", params={"year": 2026}).status_code == 401
