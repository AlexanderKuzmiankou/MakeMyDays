import copy
import re
from datetime import date
from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from app.auth.dependencies import get_current_user
from app.main import app
from app.planner import service

TEST_USER = {"user_id": "user-1", "email": "test@example.com", "name": "Test", "avatar_url": None, "created_at": "2026-06-01"}
OTHER_USER = {**TEST_USER, "user_id": "user-2", "email": "other@example.com"}

client = TestClient(app)
TODAY = date.today().isoformat()


# ── in-memory DynamoDB fake ──────────────────────────────────────────────────
# Enforces the real key schema (user_id + sort key), so a request that
# addresses items by the wrong key fails here just like it does in AWS.

class FakeTable:
    def __init__(self, sort_key):
        self.key_attrs = ("user_id", sort_key)
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

    def update_item(self, Key, UpdateExpression, ExpressionAttributeNames, ExpressionAttributeValues=None):
        item = self.items[self._key(Key, "UpdateItem")]
        names, values = ExpressionAttributeNames, ExpressionAttributeValues or {}
        for action, body in re.findall(r"(SET|REMOVE)\s+(.*?)(?=\s+(?:SET|REMOVE)\s|$)", UpdateExpression):
            for clause in body.split(","):
                if action == "SET":
                    path, placeholder = [p.strip() for p in clause.split("=")]
                    item[names[path]] = copy.deepcopy(values[placeholder])
                else:
                    item.pop(names[clause.strip()], None)


@pytest.fixture
def tables():
    fakes = {"tasks": FakeTable("task_id"), "events": FakeTable("event_id")}
    with patch.object(service, "_tasks", lambda: fakes["tasks"]), \
         patch.object(service, "_events", lambda: fakes["events"]):
        yield fakes


@pytest.fixture(autouse=True)
def _authenticated():
    app.dependency_overrides[get_current_user] = lambda: TEST_USER
    yield
    app.dependency_overrides.pop(get_current_user, None)


def _task(**fields):
    res = client.post("/api/tasks", json={"title": "Call mum", **fields})
    assert res.status_code == 201, res.text
    return res.json()


def _event(**fields):
    res = client.post("/api/events", json={"title": "Dentist", "date": "2026-10-05", **fields})
    assert res.status_code == 201, res.text
    return res.json()


# ── Google integration is gone ───────────────────────────────────────────────

@pytest.mark.parametrize("url", ["/api/tasks", "/api/events"])
def test_endpoints_require_login(url):
    app.dependency_overrides.pop(get_current_user, None)
    assert client.get(url).status_code == 401


def test_no_code_reads_google_credentials():
    import importlib.util
    assert importlib.util.find_spec("app.briefing.calendar_client") is None


# ── tasks ────────────────────────────────────────────────────────────────────

def test_create_task(tables):
    task = _task(title=" Call mum ", notes="About Sunday", due="2026-10-04")
    assert (task["title"], task["notes"], task["due"]) == ("Call mum", "About Sunday", "2026-10-04")
    assert (task["completed"], task["completed_at"]) == (False, None)


def test_user_can_have_many_tasks(tables):
    for title in ("A", "B", "C"):
        _task(title=title)
    assert sorted(t["title"] for t in client.get("/api/tasks").json()) == ["A", "B", "C"]


@pytest.mark.parametrize("body", [{"title": "  "}, {}, {"title": "X", "due": "next week"}, {"title": "x" * 121}])
def test_create_task_rejects_invalid_input(tables, body):
    assert client.post("/api/tasks", json=body).status_code == 422


def test_complete_and_reopen_task(tables):
    task = _task()
    done = client.post(f"/api/tasks/{task['task_id']}/toggle").json()
    assert (done["completed"], done["completed_at"]) == (True, TODAY)

    reopened = client.post(f"/api/tasks/{task['task_id']}/toggle").json()
    assert (reopened["completed"], reopened["completed_at"]) == (False, None)
    assert "completed_at" not in next(iter(tables["tasks"].items.values()))


def test_list_puts_open_tasks_by_due_date_then_completed(tables):
    _task(title="later", due="2026-12-01")
    _task(title="undated")
    _task(title="soon", due="2026-10-04")
    done = _task(title="done", due="2026-01-01")
    client.post(f"/api/tasks/{done['task_id']}/toggle")

    titles = [t["title"] for t in client.get("/api/tasks").json()]
    assert titles == ["soon", "later", "undated", "done"]


def test_edit_task_fields(tables):
    task = _task(notes="old", due="2026-10-04")
    res = client.patch(f"/api/tasks/{task['task_id']}", json={"title": "Call dad"})
    assert res.json()["title"] == "Call dad"
    assert (res.json()["notes"], res.json()["due"]) == ("old", "2026-10-04")

    res = client.patch(f"/api/tasks/{task['task_id']}", json={"notes": "", "due": None})
    assert (res.json()["notes"], res.json()["due"]) == ("", None)
    assert client.get("/api/tasks").json()[0] == res.json()


def test_edit_keeps_completed_state(tables):
    task = _task()
    client.post(f"/api/tasks/{task['task_id']}/toggle")
    assert client.patch(f"/api/tasks/{task['task_id']}", json={"title": "New"}).json()["completed"] is True


def test_delete_task(tables):
    a, b = _task(title="A"), _task(title="B")
    assert client.delete(f"/api/tasks/{a['task_id']}").status_code == 204
    assert [t["task_id"] for t in client.get("/api/tasks").json()] == [b["task_id"]]
    assert client.delete(f"/api/tasks/{a['task_id']}").status_code == 404


def test_tasks_are_private(tables):
    task = _task()
    app.dependency_overrides[get_current_user] = lambda: OTHER_USER
    tid = task["task_id"]
    assert client.get("/api/tasks").json() == []
    assert client.patch(f"/api/tasks/{tid}", json={"title": "Mine"}).status_code == 404
    assert client.post(f"/api/tasks/{tid}/toggle").status_code == 404
    assert client.delete(f"/api/tasks/{tid}").status_code == 404
    assert len(tables["tasks"].items) == 1


# ── schedule ─────────────────────────────────────────────────────────────────

def test_create_timed_event(tables):
    event = _event(start_time="09:30", end_time="10:15", location=" Main St 5 ")
    assert (event["start_time"], event["end_time"], event["all_day"]) == ("09:30", "10:15", False)
    assert event["location"] == "Main St 5"


def test_create_all_day_event(tables):
    event = _event()
    assert (event["start_time"], event["end_time"], event["all_day"]) == (None, None, True)


@pytest.mark.parametrize("fields, status", [
    ({"start_time": "10:00", "end_time": "09:00"}, 400),
    ({"start_time": "10:00", "end_time": "10:00"}, 400),
    ({"end_time": "10:00"}, 400),
    ({"start_time": "25:00"}, 422),
    ({"date": "tomorrow"}, 422),
    ({"title": " "}, 422),
])
def test_create_event_rejects_invalid_input(tables, fields, status):
    body = {"title": "Dentist", "date": "2026-10-05", **fields}
    assert client.post("/api/events", json=body).status_code == status


def test_list_events_in_range_sorted_chronologically(tables):
    _event(title="late", date="2026-10-05", start_time="15:00")
    _event(title="all day", date="2026-10-05")
    _event(title="early", date="2026-10-05", start_time="08:00")
    _event(title="next day", date="2026-10-06", start_time="07:00")
    _event(title="out of range", date="2026-11-01")

    events = client.get("/api/events", params={"start": "2026-10-05", "end": "2026-10-06"}).json()
    assert [e["title"] for e in events] == ["all day", "early", "late", "next day"]
    assert len(client.get("/api/events").json()) == 5


def test_list_events_rejects_bad_range(tables):
    assert client.get("/api/events", params={"start": "soon"}).status_code == 422


def test_edit_event(tables):
    event = _event(start_time="09:00", end_time="10:00", notes="Bring card")
    res = client.patch(f"/api/events/{event['event_id']}", json={"date": "2026-10-07", "end_time": "11:00"})
    data = res.json()
    assert (data["date"], data["start_time"], data["end_time"], data["notes"]) == ("2026-10-07", "09:00", "11:00", "Bring card")


def test_edit_event_to_all_day_clears_times(tables):
    event = _event(start_time="09:00", end_time="10:00")
    data = client.patch(f"/api/events/{event['event_id']}", json={"start_time": None}).json()
    assert (data["start_time"], data["end_time"], data["all_day"]) == (None, None, True)
    stored = next(iter(tables["events"].items.values()))
    assert "start_time" not in stored and "end_time" not in stored


def test_edit_event_rejects_end_before_existing_start(tables):
    event = _event(start_time="09:00")
    assert client.patch(f"/api/events/{event['event_id']}", json={"end_time": "08:00"}).status_code == 400


def test_delete_event(tables):
    event = _event()
    assert client.delete(f"/api/events/{event['event_id']}").status_code == 204
    assert client.get("/api/events").json() == []
    assert client.delete(f"/api/events/{event['event_id']}").status_code == 404


def test_events_are_private(tables):
    event = _event()
    app.dependency_overrides[get_current_user] = lambda: OTHER_USER
    eid = event["event_id"]
    assert client.get("/api/events").json() == []
    assert client.patch(f"/api/events/{eid}", json={"title": "Mine"}).status_code == 404
    assert client.delete(f"/api/events/{eid}").status_code == 404
    assert len(tables["events"].items) == 1
