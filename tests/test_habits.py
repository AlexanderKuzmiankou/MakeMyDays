import copy
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from app.auth.dependencies import get_current_user
from app.habits import service
from app.main import app

TEST_USER = {"user_id": "user-1", "email": "test@example.com", "name": "Test", "avatar_url": None, "created_at": "2026-06-01"}
OTHER_USER = {**TEST_USER, "user_id": "user-2", "email": "other@example.com"}

client = TestClient(app)


# ── in-memory DynamoDB fake ──────────────────────────────────────────────────
# Enforces the table's real key schema (user_id + habit_id), so a request that
# addresses habits by the wrong key fails here just like it does in AWS.

KEY_ATTRS = ("user_id", "habit_id")


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

    def update_item(self, Key, UpdateExpression, ExpressionAttributeValues):
        item = self.items[self._key(Key, "UpdateItem")]
        action, attr, placeholder = UpdateExpression.split()
        current = set(item.get(attr, set()))
        current = current | ExpressionAttributeValues[placeholder] if action == "ADD" else current - ExpressionAttributeValues[placeholder]
        if current:
            item[attr] = current
        else:
            item.pop(attr, None)  # DynamoDB drops a set once it is empty


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
    return client.post("/api/habits", json={"name": "Read", **fields}).json()


TODAY = date.today()


def _day(offset: int) -> str:
    return (TODAY - timedelta(days=offset)).isoformat()


# ── streaks ──────────────────────────────────────────────────────────────────

def test_streak_counts_consecutive_days_up_to_today():
    assert service._calculate_current_streak({_day(0), _day(1), _day(2), _day(4)}) == 3


def test_streak_that_ended_yesterday_still_counts():
    assert service._calculate_current_streak({_day(1), _day(2)}) == 2


def test_no_completions_means_no_streak():
    assert service._calculate_current_streak(set()) == 0


# ── the bug this table layout fixes ──────────────────────────────────────────

def test_user_can_have_many_habits(table):
    for name in ("Read", "Run", "Meditate"):
        assert client.post("/api/habits", json={"name": name}).status_code == 201
    assert sorted(h["name"] for h in client.get("/api/habits").json()) == ["Meditate", "Read", "Run"]


def test_delete_removes_only_that_habit(table):
    a = _add(name="A")
    _add(name="B")
    assert client.delete(f"/api/habits/{a['habit_id']}").status_code == 204
    assert [h["name"] for h in client.get("/api/habits").json()] == ["B"]


def test_delete_missing_habit_returns_404(table):
    assert client.delete("/api/habits/no-such-id").status_code == 404


def test_habits_are_private_to_their_owner(table):
    habit = _add()
    app.dependency_overrides[get_current_user] = lambda: OTHER_USER
    assert client.get("/api/habits").json() == []
    assert client.delete(f"/api/habits/{habit['habit_id']}").status_code == 404
    assert client.post(f"/api/habits/{habit['habit_id']}/toggle", json={"date": _day(0)}).status_code == 404
    assert len(table.items) == 1


# ── create / list ────────────────────────────────────────────────────────────

def test_habits_require_auth():
    app.dependency_overrides.pop(get_current_user, None)
    assert client.get("/api/habits").status_code == 401


def test_create_habit_defaults(table):
    res = client.post("/api/habits", json={"name": " Read "})
    assert res.status_code == 201
    data = res.json()
    assert (data["name"], data["emoji"], data["goal_streak"]) == ("Read", "⭐", 30)
    assert (data["current_streak"], data["completions"]) == (0, [])
    assert "completions" not in next(iter(table.items.values()))  # no empty sets in DynamoDB


@pytest.mark.parametrize("body", [{"emoji": "📚"}, {"name": "  "}, {"name": "X", "goal_streak": 0}, {"name": "X", "goal_streak": 400}])
def test_create_rejects_invalid_input(table, body):
    assert client.post("/api/habits", json=body).status_code == 422


def test_list_sorted_by_created_at(table):
    table.put_item(Item={"user_id": "user-1", "habit_id": "b", "name": "B", "created_at": "2026-06-29"})
    table.put_item(Item={"user_id": "user-1", "habit_id": "a", "name": "A", "created_at": "2026-06-28"})
    assert [h["habit_id"] for h in client.get("/api/habits").json()] == ["a", "b"]


# ── toggle ───────────────────────────────────────────────────────────────────

def test_toggle_marks_and_unmarks_a_day(table):
    habit = _add()
    url = f"/api/habits/{habit['habit_id']}/toggle"

    data = client.post(url, json={"date": _day(0)}).json()
    assert (data["done"], data["current_streak"], data["completions"]) == (True, 1, [_day(0)])

    data = client.post(url, json={"date": _day(0)}).json()
    assert (data["done"], data["current_streak"], data["completions"]) == (False, 0, [])
    assert client.get("/api/habits").json()[0]["completions"] == []


def test_toggle_builds_streak_across_days(table):
    habit = _add()
    for offset in (2, 1, 0):
        client.post(f"/api/habits/{habit['habit_id']}/toggle", json={"date": _day(offset)})
    assert client.get("/api/habits").json()[0]["current_streak"] == 3


def test_toggle_rejects_bad_date(table):
    habit = _add()
    assert client.post(f"/api/habits/{habit['habit_id']}/toggle", json={"date": "tomorrow"}).status_code == 422


def test_toggle_missing_returns_404(table):
    assert client.post("/api/habits/no-such-id/toggle", json={"date": _day(0)}).status_code == 404
