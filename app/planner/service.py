"""Per-user tasks and schedule (appointments), stored in DynamoDB.

Both tables use partition key user_id + a sort key (task_id / event_id), so a
user's items are a single query and can only be addressed through their
owner's user_id.

Dates are "YYYY-MM-DD" and times "HH:MM" in the user's own wall-clock time;
the server never converts time zones.
"""
import uuid
from datetime import date

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

TASKS_TABLE = "makemydays-user-tasks"
EVENTS_TABLE = "makemydays-user-events"

UNSET = object()

_dynamodb = None


def _resource():
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb", region_name="eu-central-1")
    return _dynamodb


def _tasks():
    return _resource().Table(TASKS_TABLE)


def _events():
    return _resource().Table(EVENTS_TABLE)


# ── shared helpers ───────────────────────────────────────────────────────────

def _query_user(table, user_id: str) -> list[dict]:
    kwargs = {"KeyConditionExpression": Key("user_id").eq(user_id)}
    items: list[dict] = []
    while True:
        response = table.query(**kwargs)
        items.extend(response.get("Items", []))
        if "LastEvaluatedKey" not in response:
            return items
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]


def _get_owned(table, key: dict, label: str) -> dict:
    item = table.get_item(Key=key).get("Item")
    if not item:
        raise ValueError(f"{label} not found")
    return item


def _delete_owned(table, key: dict, id_attr: str, label: str) -> None:
    try:
        table.delete_item(Key=key, ConditionExpression=f"attribute_exists({id_attr})")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise ValueError(f"{label} not found")
        raise


def _apply_update(table, key: dict, item: dict, changes: dict) -> None:
    """Write `changes` to the item: a value of None removes the attribute."""
    sets = {k: v for k, v in changes.items() if v is not None}
    removes = [k for k, v in changes.items() if v is None]
    if not sets and not removes:
        return
    parts = []
    if sets:
        parts.append("SET " + ", ".join(f"#{k} = :{k}" for k in sets))
    if removes:
        parts.append("REMOVE " + ", ".join(f"#{k}" for k in removes))
    # Several attribute names ("date", "name"...) are reserved words, so alias all.
    kwargs = {
        "Key": key,
        "UpdateExpression": " ".join(parts),
        "ExpressionAttributeNames": {f"#{k}": k for k in changes},
    }
    if sets:
        kwargs["ExpressionAttributeValues"] = {f":{k}": v for k, v in sets.items()}
    table.update_item(**kwargs)
    for k, v in changes.items():
        if v is None:
            item.pop(k, None)
        else:
            item[k] = v


def _text(value: str | None) -> str | None:
    """Trimmed text; empty optional text is stored as absent."""
    if value is None:
        return None
    return value.strip() or None


# ── tasks ────────────────────────────────────────────────────────────────────

def _task_key(user_id: str, task_id: str) -> dict:
    return {"user_id": user_id, "task_id": task_id}


def _serialize_task(item: dict) -> dict:
    return {
        "task_id": item["task_id"],
        "title": item["title"],
        "notes": item.get("notes") or "",
        "due": item.get("due"),
        "completed": bool(item.get("completed", False)),
        "completed_at": item.get("completed_at"),
        "created_at": item.get("created_at", ""),
    }


def list_tasks(user_id: str) -> list[dict]:
    """Open tasks by due date (undated last), then completed ones, newest first."""
    tasks = [_serialize_task(i) for i in _query_user(_tasks(), user_id)]
    open_tasks = sorted(
        (t for t in tasks if not t["completed"]),
        key=lambda t: (t["due"] is None, t["due"] or "", t["created_at"], t["task_id"]),
    )
    done_tasks = sorted(
        (t for t in tasks if t["completed"]),
        key=lambda t: (t["completed_at"] or "", t["task_id"]),
        reverse=True,
    )
    return open_tasks + done_tasks


def create_task(user_id: str, title: str, notes: str = "", due: str | None = None) -> dict:
    record = {
        "user_id": user_id,
        "task_id": str(uuid.uuid4()),
        "title": title.strip(),
        "completed": False,
        "created_at": date.today().isoformat(),
    }
    if _text(notes):
        record["notes"] = _text(notes)
    if due:
        record["due"] = due
    _tasks().put_item(Item=record)
    return _serialize_task(record)


def update_task(user_id: str, task_id: str, title: str | None = None, notes: str | None = None, due=UNSET) -> dict:
    """None keeps title/notes; due is changed only when passed (None clears it)."""
    key = _task_key(user_id, task_id)
    item = _get_owned(_tasks(), key, "Task")
    changes: dict = {}
    if title is not None and title.strip():
        changes["title"] = title.strip()
    if notes is not None:
        changes["notes"] = _text(notes)
    if due is not UNSET:
        changes["due"] = due or None
    _apply_update(_tasks(), key, item, changes)
    return _serialize_task(item)


def toggle_task(user_id: str, task_id: str) -> dict:
    key = _task_key(user_id, task_id)
    item = _get_owned(_tasks(), key, "Task")
    completed = not item.get("completed", False)
    _apply_update(_tasks(), key, item, {
        "completed": completed,
        "completed_at": date.today().isoformat() if completed else None,
    })
    return _serialize_task(item)


def delete_task(user_id: str, task_id: str) -> None:
    _delete_owned(_tasks(), _task_key(user_id, task_id), "task_id", "Task")


# ── schedule (events / appointments) ─────────────────────────────────────────

def _event_key(user_id: str, event_id: str) -> dict:
    return {"user_id": user_id, "event_id": event_id}


def _serialize_event(item: dict) -> dict:
    return {
        "event_id": item["event_id"],
        "title": item["title"],
        "date": item["date"],
        "start_time": item.get("start_time"),
        "end_time": item.get("end_time"),
        "all_day": not item.get("start_time"),
        "location": item.get("location") or "",
        "notes": item.get("notes") or "",
        "created_at": item.get("created_at", ""),
    }


def _check_times(start_time: str | None, end_time: str | None) -> None:
    if end_time and not start_time:
        raise LookupError("An end time needs a start time")
    if start_time and end_time and end_time <= start_time:
        raise LookupError("The end time must be after the start time")


def list_events(user_id: str, start: str | None = None, end: str | None = None) -> list[dict]:
    """Events between start and end dates (inclusive), in chronological order."""
    events = [
        _serialize_event(i)
        for i in _query_user(_events(), user_id)
        if (start is None or i["date"] >= start) and (end is None or i["date"] <= end)
    ]
    # All-day events first on their day, then by start time.
    events.sort(key=lambda e: (e["date"], e["start_time"] or "", e["created_at"], e["event_id"]))
    return events


def create_event(
    user_id: str,
    title: str,
    event_date: str,
    start_time: str | None = None,
    end_time: str | None = None,
    location: str = "",
    notes: str = "",
) -> dict:
    _check_times(start_time, end_time)
    record = {
        "user_id": user_id,
        "event_id": str(uuid.uuid4()),
        "title": title.strip(),
        "date": event_date,
        "created_at": date.today().isoformat(),
    }
    optional = {"start_time": start_time, "end_time": end_time, "location": _text(location), "notes": _text(notes)}
    record.update({k: v for k, v in optional.items() if v})
    _events().put_item(Item=record)
    return _serialize_event(record)


def update_event(
    user_id: str,
    event_id: str,
    title: str | None = None,
    event_date: str | None = None,
    start_time=UNSET,
    end_time=UNSET,
    location: str | None = None,
    notes: str | None = None,
) -> dict:
    """None keeps title/date/location/notes; times change only when passed
    (None clears them, making the event all-day)."""
    key = _event_key(user_id, event_id)
    item = _get_owned(_events(), key, "Event")

    new_start = item.get("start_time") if start_time is UNSET else (start_time or None)
    new_end = item.get("end_time") if end_time is UNSET else (end_time or None)
    if new_start is None:
        new_end = None  # an all-day event has no end time
    _check_times(new_start, new_end)

    changes: dict = {}
    if title is not None and title.strip():
        changes["title"] = title.strip()
    if event_date is not None:
        changes["date"] = event_date
    if new_start != item.get("start_time"):
        changes["start_time"] = new_start
    if new_end != item.get("end_time"):
        changes["end_time"] = new_end
    if location is not None:
        changes["location"] = _text(location)
    if notes is not None:
        changes["notes"] = _text(notes)
    _apply_update(_events(), key, item, changes)
    return _serialize_event(item)


def delete_event(user_id: str, event_id: str) -> None:
    _delete_owned(_events(), _event_key(user_id, event_id), "event_id", "Event")
