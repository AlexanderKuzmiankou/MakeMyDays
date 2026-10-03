import copy
import re
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from app.auth.dependencies import get_current_user
from app.main import app
from app.shared_costs import service

ALICE = {"user_id": "alice", "email": "alice@example.com", "name": "Alice", "avatar_url": None, "created_at": "2026-06-01"}
BOB = {"user_id": "bob", "email": "bob@example.com", "name": "Bob", "avatar_url": None, "created_at": "2026-06-01"}
CAROL = {"user_id": "carol", "email": "carol@example.com", "name": "Carol", "avatar_url": None, "created_at": "2026-06-01"}
USERS_BY_EMAIL = {u["email"]: u for u in (ALICE, BOB, CAROL)}

client = TestClient(app)


# ── in-memory DynamoDB fake ──────────────────────────────────────────────────
# Supports exactly the operations service.py uses, so tests exercise the real
# request shapes (filters, update expressions, conditional puts).

class FakeTable:
    def __init__(self, key):
        self.key = key
        self.items = {}

    def get_item(self, Key):
        item = self.items.get(Key[self.key])
        return {"Item": copy.deepcopy(item)} if item else {}

    def put_item(self, Item, ConditionExpression=None):
        if ConditionExpression == f"attribute_not_exists({self.key})" and Item[self.key] in self.items:
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "PutItem")
        self.items[Item[self.key]] = copy.deepcopy(Item)

    def delete_item(self, Key):
        self.items.pop(Key[self.key], None)

    def scan(self, FilterExpression, ExclusiveStartKey=None):
        expr = FilterExpression.get_expression()
        attr, value = expr["values"][0].name, expr["values"][1]
        if expr["operator"] == "=":
            match = lambda i: i.get(attr) == value  # noqa: E731
        elif expr["operator"] == "contains":
            match = lambda i: value in i.get(attr, ())  # noqa: E731
        else:
            raise NotImplementedError(expr["operator"])
        return {"Items": [copy.deepcopy(i) for i in self.items.values() if match(i)]}

    def update_item(self, Key, UpdateExpression, ExpressionAttributeValues,
                    ExpressionAttributeNames=None, ConditionExpression=None):
        item = self.items.get(Key[self.key])
        if item is None:
            if ConditionExpression:
                raise ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem")
            item = self.items[Key[self.key]] = dict(Key)
        names = ExpressionAttributeNames or {}
        resolve = lambda token: names.get(token, token)  # noqa: E731
        for action, body in re.findall(r"(SET|ADD)\s+(.*?)(?=\s+(?:SET|ADD)\s|$)", UpdateExpression):
            for clause in body.split(","):
                if action == "SET":
                    path, placeholder = [p.strip() for p in clause.split("=")]
                    *parents, leaf = [resolve(p) for p in path.split(".")]
                    target = item
                    for p in parents:
                        target = target.setdefault(p, {})
                    target[resolve(leaf)] = copy.deepcopy(ExpressionAttributeValues[placeholder])
                else:
                    attr, placeholder = clause.split()
                    item[attr] = set(item.get(attr, set())) | ExpressionAttributeValues[placeholder]


@pytest.fixture
def tables():
    fakes = {
        "groups": FakeTable("group_id"),
        "expenses": FakeTable("expense_id"),
        "recurring": FakeTable("recurring_id"),
    }
    with patch.object(service, "_groups", lambda: fakes["groups"]), \
         patch.object(service, "_expenses", lambda: fakes["expenses"]), \
         patch.object(service, "_recurring", lambda: fakes["recurring"]), \
         patch.object(service, "get_user_by_email", lambda email: USERS_BY_EMAIL.get(email)):
        yield fakes


@pytest.fixture
def as_user():
    def login(user):
        app.dependency_overrides[get_current_user] = lambda: user
    login(ALICE)
    yield login
    app.dependency_overrides.pop(get_current_user, None)


def _group_with(*users, currency="EUR"):
    group = service.create_group(users[0], "Flat", currency)
    for u in users[1:]:
        group = service.add_member(users[0]["user_id"], group["group_id"], u["email"])
    return group


# ── splitting and settling ───────────────────────────────────────────────────

def test_split_amount_distributes_leftover_cents():
    shares = service.split_amount(Decimal("10.00"), ["a", "b", "c"])
    assert shares == {"a": Decimal("3.34"), "b": Decimal("3.33"), "c": Decimal("3.33")}
    assert sum(shares.values()) == Decimal("10.00")


def test_compute_balances_sums_to_zero_per_currency():
    expenses = [
        {"amount": 90, "currency": "EUR", "paid_by": "a", "split_between": ["a", "b", "c"]},
        {"amount": 30, "currency": "EUR", "paid_by": "b", "split_between": ["a", "b"]},
        {"amount": 20, "currency": "USD", "paid_by": "c", "split_between": ["a", "c"]},
    ]
    balances = service.compute_balances(expenses)
    assert balances["EUR"] == {"a": Decimal("45.00"), "b": Decimal("-15.00"), "c": Decimal("-30.00")}
    assert sum(balances["EUR"].values()) == 0
    assert balances["USD"] == {"c": Decimal("10.00"), "a": Decimal("-10.00")}


def test_settle_up_zeroes_every_balance():
    net = {"a": Decimal("50"), "b": Decimal("-20"), "c": Decimal("-30"), "d": Decimal("0")}
    transfers = service.settle_up(net)
    after = dict(net)
    for t in transfers:
        after[t["from"]] += t["amount"]
        after[t["to"]] -= t["amount"]
    assert all(v == 0 for v in after.values())
    assert len(transfers) == 2


# ── groups and members ───────────────────────────────────────────────────────

def test_create_group_defaults_to_euro(tables, as_user):
    res = client.post("/api/shared-costs/groups", json={"name": "Rome trip"})
    assert res.status_code == 201
    data = res.json()
    assert data["currency"] == "EUR"
    assert [m["user_id"] for m in data["members"]] == ["alice"]


def test_create_group_with_custom_currency_normalizes_code(tables, as_user):
    res = client.post("/api/shared-costs/groups", json={"name": "NYC", "currency": "usd"})
    assert res.status_code == 201
    assert res.json()["currency"] == "USD"


@pytest.mark.parametrize("currency", ["EURO", "E1", ""])
def test_create_group_rejects_invalid_currency(tables, as_user, currency):
    res = client.post("/api/shared-costs/groups", json={"name": "X", "currency": currency})
    assert res.status_code == 422


def test_create_group_rejects_blank_name(tables, as_user):
    assert client.post("/api/shared-costs/groups", json={"name": "   "}).status_code == 422


def test_change_group_currency(tables, as_user):
    group = _group_with(ALICE)
    res = client.patch(f"/api/shared-costs/groups/{group['group_id']}", json={"currency": "GBP"})
    assert res.status_code == 200
    assert res.json()["currency"] == "GBP"
    assert tables["groups"].items[group["group_id"]]["currency"] == "GBP"


AVATAR = "data:image/jpeg;base64,/9j/4AAQ"


def test_set_and_remove_group_avatar(tables, as_user):
    gid = _group_with(ALICE)["group_id"]
    assert client.get(f"/api/shared-costs/groups/{gid}").json()["avatar_url"] is None

    res = client.patch(f"/api/shared-costs/groups/{gid}", json={"avatar_url": AVATAR})
    assert res.status_code == 200
    assert res.json()["avatar_url"] == AVATAR
    assert client.get("/api/shared-costs/groups").json()[0]["avatar_url"] == AVATAR

    res = client.patch(f"/api/shared-costs/groups/{gid}", json={"avatar_url": ""})
    assert res.json()["avatar_url"] is None


@pytest.mark.parametrize("avatar", ["https://example.com/x.png", "data:text/html,<script>", "data:image/png;" + "A" * 200_000])
def test_group_avatar_rejects_non_images_and_oversized(tables, as_user, avatar):
    gid = _group_with(ALICE)["group_id"]
    res = client.patch(f"/api/shared-costs/groups/{gid}", json={"avatar_url": avatar})
    assert res.status_code == 422


def test_members_show_live_profile_avatar(tables, as_user):
    group = _group_with(ALICE, BOB)
    bob_with_photo = {**BOB, "name": "Bobby", "avatar_url": AVATAR}
    with patch.dict(USERS_BY_EMAIL, {BOB["email"]: bob_with_photo}):
        members = client.get(f"/api/shared-costs/groups/{group['group_id']}").json()["members"]
    by_id = {m["user_id"]: m for m in members}
    assert by_id["bob"]["avatar_url"] == AVATAR
    assert by_id["bob"]["name"] == "Bobby"
    assert by_id["alice"]["avatar_url"] is None


def test_add_member_by_email(tables, as_user):
    group = _group_with(ALICE)
    res = client.post(f"/api/shared-costs/groups/{group['group_id']}/members", json={"email": " Bob@Example.com "})
    assert res.status_code == 201
    assert {m["user_id"] for m in res.json()["members"]} == {"alice", "bob"}


def test_add_unknown_email_returns_400(tables, as_user):
    group = _group_with(ALICE)
    res = client.post(f"/api/shared-costs/groups/{group['group_id']}/members", json={"email": "nobody@example.com"})
    assert res.status_code == 400


def test_add_existing_member_returns_400(tables, as_user):
    group = _group_with(ALICE, BOB)
    res = client.post(f"/api/shared-costs/groups/{group['group_id']}/members", json={"email": "bob@example.com"})
    assert res.status_code == 400


def test_user_can_be_in_multiple_groups(tables, as_user):
    _group_with(ALICE, BOB)
    service.create_group(BOB, "Bob's trip")
    g3 = service.create_group(CAROL, "Carol only")

    as_user(BOB)
    names = {g["name"] for g in client.get("/api/shared-costs/groups").json()}
    assert names == {"Flat", "Bob's trip"}

    as_user(ALICE)
    assert len(client.get("/api/shared-costs/groups").json()) == 1
    assert client.get(f"/api/shared-costs/groups/{g3['group_id']}").status_code == 404


def test_non_member_cannot_touch_group(tables, as_user):
    group = _group_with(ALICE)
    as_user(BOB)
    gid = group["group_id"]
    assert client.get(f"/api/shared-costs/groups/{gid}/expenses").status_code == 404
    assert client.post(f"/api/shared-costs/groups/{gid}/members", json={"email": "bob@example.com"}).status_code == 404
    assert client.post(f"/api/shared-costs/groups/{gid}/expenses", json={"description": "x", "amount": 1}).status_code == 404
    assert client.patch(f"/api/shared-costs/groups/{gid}", json={"currency": "USD"}).status_code == 404


def test_requires_auth():
    app.dependency_overrides.pop(get_current_user, None)
    assert client.get("/api/shared-costs/groups").status_code == 401


# ── expenses ─────────────────────────────────────────────────────────────────

def test_expense_defaults_to_group_currency_payer_and_all_members(tables, as_user):
    group = _group_with(ALICE, BOB, currency="CHF")
    res = client.post(f"/api/shared-costs/groups/{group['group_id']}/expenses", json={"description": "Groceries", "amount": 30})
    assert res.status_code == 201
    data = res.json()
    assert data["currency"] == "CHF"
    assert data["paid_by"] == "alice"
    assert sorted(data["split_between"]) == ["alice", "bob"]
    assert data["date"] == date.today().isoformat()


def test_expense_currency_can_be_overridden(tables, as_user):
    group = _group_with(ALICE, BOB)
    res = client.post(
        f"/api/shared-costs/groups/{group['group_id']}/expenses",
        json={"description": "Taxi", "amount": 12.5, "currency": "usd", "paid_by": "bob", "split_between": ["alice"]},
    )
    assert res.status_code == 201
    assert res.json()["currency"] == "USD"
    assert tables["expenses"].items[res.json()["expense_id"]]["amount"] == Decimal("12.50")


def test_expense_with_non_member_participant_returns_400(tables, as_user):
    group = _group_with(ALICE)
    gid = group["group_id"]
    assert client.post(f"/api/shared-costs/groups/{gid}/expenses",
                       json={"description": "x", "amount": 5, "paid_by": "carol"}).status_code == 400
    assert client.post(f"/api/shared-costs/groups/{gid}/expenses",
                       json={"description": "x", "amount": 5, "split_between": ["alice", "carol"]}).status_code == 400


@pytest.mark.parametrize("amount", [0, -5])
def test_expense_rejects_non_positive_amount(tables, as_user, amount):
    group = _group_with(ALICE)
    res = client.post(f"/api/shared-costs/groups/{group['group_id']}/expenses", json={"description": "x", "amount": amount})
    assert res.status_code == 422


def test_expense_rejects_bad_date(tables, as_user):
    group = _group_with(ALICE)
    res = client.post(f"/api/shared-costs/groups/{group['group_id']}/expenses",
                      json={"description": "x", "amount": 5, "date": "2026-13-01"})
    assert res.status_code == 422


def test_delete_expense(tables, as_user):
    group = _group_with(ALICE)
    gid = group["group_id"]
    expense = service.create_expense("alice", gid, "x", 5)
    assert client.delete(f"/api/shared-costs/groups/{gid}/expenses/{expense['expense_id']}").status_code == 204
    assert tables["expenses"].items == {}


def test_cannot_delete_expense_through_another_group(tables, as_user):
    g1 = _group_with(ALICE)
    g2 = _group_with(ALICE)
    expense = service.create_expense("alice", g1["group_id"], "x", 5)
    res = client.delete(f"/api/shared-costs/groups/{g2['group_id']}/expenses/{expense['expense_id']}")
    assert res.status_code == 404
    assert expense["expense_id"] in tables["expenses"].items


def test_balances_endpoint(tables, as_user):
    group = _group_with(ALICE, BOB, CAROL)
    gid = group["group_id"]
    service.create_expense("alice", gid, "Dinner", 90)
    service.create_expense("bob", gid, "Taxi", 20, currency="USD", paid_by="bob", split_between=["bob", "carol"])

    res = client.get(f"/api/shared-costs/groups/{gid}/balances")
    assert res.status_code == 200
    by_currency = {c["currency"]: c for c in res.json()["currencies"]}
    eur = {b["user_id"]: b["amount"] for b in by_currency["EUR"]["balances"]}
    assert eur == {"alice": 60.0, "bob": -30.0, "carol": -30.0}
    assert by_currency["USD"]["settlements"] == [{"from": "carol", "to": "bob", "amount": 10.0}]


def test_overview_reports_balances_from_current_users_perspective(tables, as_user):
    g1 = _group_with(ALICE, BOB)
    g2 = _group_with(ALICE, CAROL)
    service.create_expense("alice", g1["group_id"], "Rent", 100)
    service.create_expense("carol", g2["group_id"], "Fuel", 40, paid_by="carol")

    data = client.get("/api/shared-costs/overview").json()
    assert {(b["user_id"], b["currency"], b["amount"]) for b in data["balances"]} == {
        ("bob", "EUR", 50.0),
        ("carol", "EUR", -20.0),
    }
    assert len(data["groups"]) == 2
    assert {g["totals"]["EUR"] for g in data["groups"]} == {100.0, 40.0}
    assert {g["group_id"]: g["balance"] for g in data["groups"]} == {
        g1["group_id"]: {"EUR": 50.0},
        g2["group_id"]: {"EUR": -20.0},
    }
    assert len(data["recent_expenses"]) == 2


def test_overview_group_balance_for_expense_owed_in_full(tables, as_user):
    group = _group_with(ALICE, BOB)
    gid = group["group_id"]
    service.create_expense("alice", gid, "Concert ticket", 60, split_between=["bob"])
    service.create_expense("alice", gid, "Lunch", 20, paid_by="bob")

    data = client.get("/api/shared-costs/overview").json()
    assert data["groups"][0]["balance"] == {"EUR": 50.0}


def test_overview_group_balance_empty_when_settled(tables, as_user):
    group = _group_with(ALICE, BOB)
    gid = group["group_id"]
    service.create_expense("alice", gid, "Coffee", 10)
    service.create_expense("alice", gid, "Coffee", 10, paid_by="bob")

    data = client.get("/api/shared-costs/overview").json()
    assert data["groups"][0]["balance"] == {}


# ── recurring expenses ───────────────────────────────────────────────────────

def test_occurrence_date_does_not_drift_at_month_end():
    start = date(2026, 1, 31)
    assert [service._occurrence_date(start, "monthly", n) for n in range(3)] == [
        date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31),
    ]


def test_create_recurring_materializes_past_occurrences(tables, as_user):
    group = _group_with(ALICE, BOB)
    gid = group["group_id"]
    with patch.object(service, "date", wraps=date) as fake_date:
        fake_date.today.return_value = date(2026, 3, 15)
        res = client.post(f"/api/shared-costs/groups/{gid}/recurring", json={
            "description": "Internet", "amount": 40, "frequency": "monthly", "start_date": "2026-01-10",
        })
    assert res.status_code == 201
    assert res.json()["next_due"] == "2026-04-10"
    dates = sorted(e["date"] for e in tables["expenses"].items.values())
    assert dates == ["2026-01-10", "2026-02-10", "2026-03-10"]
    assert all(e["recurring_id"] == res.json()["recurring_id"] for e in tables["expenses"].items.values())


def test_materialize_is_idempotent_and_catches_up(tables):
    group = _group_with(ALICE)
    gid = group["group_id"]
    with patch.object(service, "date", wraps=date) as fake_date:
        fake_date.today.return_value = date(2026, 1, 1)
        service.create_recurring("alice", gid, "Gym", 30, "weekly", "2026-01-01")
    assert len(tables["expenses"].items) == 1

    assert service.materialize_recurring(gid, today=date(2026, 1, 1)) == 0
    assert service.materialize_recurring(gid, today=date(2026, 1, 22)) == 3
    assert service.materialize_recurring(gid, today=date(2026, 1, 22)) == 0
    assert len(tables["expenses"].items) == 4


def test_materialize_respects_end_date(tables):
    group = _group_with(ALICE)
    gid = group["group_id"]
    recurring = service.create_recurring("alice", gid, "Netflix", 15, "monthly", "2025-01-01", end_date="2025-03-15")
    assert len(tables["expenses"].items) == 3
    assert recurring["next_due"] is None


def test_recurring_rejects_unknown_frequency(tables, as_user):
    group = _group_with(ALICE)
    res = client.post(f"/api/shared-costs/groups/{group['group_id']}/recurring", json={
        "description": "x", "amount": 5, "frequency": "daily", "start_date": "2026-01-01",
    })
    assert res.status_code == 400


def test_recurring_rejects_end_before_start(tables, as_user):
    group = _group_with(ALICE)
    res = client.post(f"/api/shared-costs/groups/{group['group_id']}/recurring", json={
        "description": "x", "amount": 5, "frequency": "weekly", "start_date": "2026-02-01", "end_date": "2026-01-01",
    })
    assert res.status_code == 400


def test_delete_recurring_keeps_generated_expenses(tables, as_user):
    group = _group_with(ALICE)
    gid = group["group_id"]
    recurring = service.create_recurring("alice", gid, "Rent", 500, "monthly", "2026-01-01")
    generated = len(tables["expenses"].items)
    assert generated > 0

    res = client.delete(f"/api/shared-costs/groups/{gid}/recurring/{recurring['recurring_id']}")
    assert res.status_code == 204
    assert tables["recurring"].items == {}
    assert len(tables["expenses"].items) == generated
    assert client.get(f"/api/shared-costs/groups/{gid}/recurring").json() == []


# ── editing expenses ─────────────────────────────────────────────────────────

def test_update_expense_changes_given_fields_only(tables, as_user):
    group = _group_with(ALICE, BOB)
    gid = group["group_id"]
    expense = service.create_expense("alice", gid, "Dinner", 40, expense_date="2026-05-01")

    res = client.patch(f"/api/shared-costs/groups/{gid}/expenses/{expense['expense_id']}",
                       json={"amount": 55.5, "paid_by": "bob", "split_between": ["alice"]})
    assert res.status_code == 200
    data = res.json()
    assert (data["description"], data["amount"], data["paid_by"], data["split_between"], data["date"]) == (
        "Dinner", 55.5, "bob", ["alice"], "2026-05-01",
    )
    stored = tables["expenses"].items[expense["expense_id"]]
    assert stored["amount"] == Decimal("55.50")
    assert stored["created_by"] == "alice"


def test_update_expense_by_another_member(tables, as_user):
    group = _group_with(ALICE, BOB)
    gid = group["group_id"]
    expense = service.create_expense("alice", gid, "Dinner", 40)
    as_user(BOB)
    res = client.patch(f"/api/shared-costs/groups/{gid}/expenses/{expense['expense_id']}", json={"description": "Lunch"})
    assert res.status_code == 200
    assert tables["expenses"].items[expense["expense_id"]]["updated_by"] == "bob"


def test_update_expense_validates_participants(tables, as_user):
    group = _group_with(ALICE)
    gid = group["group_id"]
    expense = service.create_expense("alice", gid, "x", 5)
    res = client.patch(f"/api/shared-costs/groups/{gid}/expenses/{expense['expense_id']}", json={"paid_by": "carol"})
    assert res.status_code == 400


def test_update_expense_rejects_invalid_amount(tables, as_user):
    group = _group_with(ALICE)
    gid = group["group_id"]
    expense = service.create_expense("alice", gid, "x", 5)
    res = client.patch(f"/api/shared-costs/groups/{gid}/expenses/{expense['expense_id']}", json={"amount": 0})
    assert res.status_code == 422


def test_cannot_update_expense_through_another_group(tables, as_user):
    g1 = _group_with(ALICE)
    g2 = _group_with(ALICE)
    expense = service.create_expense("alice", g1["group_id"], "x", 5)
    res = client.patch(f"/api/shared-costs/groups/{g2['group_id']}/expenses/{expense['expense_id']}", json={"amount": 9})
    assert res.status_code == 404


def test_edited_recurring_occurrence_survives_materialization(tables, as_user):
    group = _group_with(ALICE)
    gid = group["group_id"]
    recurring = service.create_recurring("alice", gid, "Rent", 500, "monthly", "2026-01-01")
    first_id = f"{recurring['recurring_id']}#0"

    res = client.patch(f"/api/shared-costs/groups/{gid}/expenses/{first_id.replace('#', '%23')}", json={"amount": 450})
    assert res.status_code == 200
    service.materialize_recurring(gid)
    assert tables["expenses"].items[first_id]["amount"] == Decimal("450.00")
    assert tables["expenses"].items[first_id]["recurring_id"] == recurring["recurring_id"]
