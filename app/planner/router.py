import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from app.auth.dependencies import get_current_user
from app.planner import service

router = APIRouter()

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _not_blank(value: str | None) -> str | None:
    if value is not None and not value.strip():
        raise ValueError("Must not be empty")
    return value


def _valid_date(value: str | None) -> str | None:
    if value is None or value == "":
        return value or None
    return date.fromisoformat(value).isoformat()


def _valid_time(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    if not _TIME_RE.match(value):
        raise ValueError("Time must be HH:MM (24-hour)")
    return value


def _call(fn, *args, **kwargs):
    """ValueError -> 404 (missing / not yours), LookupError -> 400 (bad input)."""
    try:
        return fn(*args, **kwargs)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except LookupError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _passed(body: BaseModel, *fields: str) -> dict:
    """Only the fields the client actually sent, so null can mean "clear"."""
    return {f: getattr(body, f) for f in fields if f in body.model_fields_set}


# ── tasks ────────────────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    title: str = Field(max_length=120)
    notes: str = Field(default="", max_length=500)
    due: str | None = None  # YYYY-MM-DD

    _title = field_validator("title")(_not_blank)
    _due = field_validator("due")(_valid_date)


class TaskUpdate(BaseModel):
    """Omitted fields are unchanged; "due": null removes the due date."""

    title: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=500)
    due: str | None = None

    _title = field_validator("title")(_not_blank)
    _due = field_validator("due")(_valid_date)


@router.get("/api/tasks")
def get_tasks(user: dict = Depends(get_current_user)) -> list[dict]:
    return service.list_tasks(user["user_id"])


@router.post("/api/tasks", status_code=201)
def post_task(body: TaskCreate, user: dict = Depends(get_current_user)) -> dict:
    return service.create_task(user["user_id"], body.title, body.notes, body.due)


@router.patch("/api/tasks/{task_id}")
def patch_task(task_id: str, body: TaskUpdate, user: dict = Depends(get_current_user)) -> dict:
    return _call(
        service.update_task, user["user_id"], task_id, title=body.title, notes=body.notes, **_passed(body, "due")
    )


@router.post("/api/tasks/{task_id}/toggle")
def post_toggle_task(task_id: str, user: dict = Depends(get_current_user)) -> dict:
    return _call(service.toggle_task, user["user_id"], task_id)


@router.delete("/api/tasks/{task_id}", status_code=204)
def delete_task(task_id: str, user: dict = Depends(get_current_user)) -> None:
    _call(service.delete_task, user["user_id"], task_id)


# ── schedule ─────────────────────────────────────────────────────────────────

class EventCreate(BaseModel):
    title: str = Field(max_length=120)
    date: str  # YYYY-MM-DD
    start_time: str | None = None  # HH:MM; omitted = all-day
    end_time: str | None = None
    location: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=500)

    _title = field_validator("title")(_not_blank)
    _date = field_validator("date")(_valid_date)
    _times = field_validator("start_time", "end_time")(_valid_time)


class EventUpdate(BaseModel):
    """Omitted fields are unchanged; "start_time": null makes the event all-day."""

    title: str | None = Field(default=None, max_length=120)
    date: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    location: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=500)

    _title = field_validator("title")(_not_blank)
    _date = field_validator("date")(_valid_date)
    _times = field_validator("start_time", "end_time")(_valid_time)


@router.get("/api/events")
def get_events(
    start: str | None = Query(default=None, description="First date, YYYY-MM-DD"),
    end: str | None = Query(default=None, description="Last date, YYYY-MM-DD"),
    user: dict = Depends(get_current_user),
) -> list[dict]:
    try:
        start, end = _valid_date(start), _valid_date(end)
    except ValueError:
        raise HTTPException(status_code=422, detail="start and end must be YYYY-MM-DD")
    return service.list_events(user["user_id"], start, end)


@router.post("/api/events", status_code=201)
def post_event(body: EventCreate, user: dict = Depends(get_current_user)) -> dict:
    return _call(
        service.create_event,
        user["user_id"],
        body.title,
        body.date,
        start_time=body.start_time,
        end_time=body.end_time,
        location=body.location,
        notes=body.notes,
    )


@router.patch("/api/events/{event_id}")
def patch_event(event_id: str, body: EventUpdate, user: dict = Depends(get_current_user)) -> dict:
    return _call(
        service.update_event,
        user["user_id"],
        event_id,
        title=body.title,
        event_date=body.date,
        location=body.location,
        notes=body.notes,
        **_passed(body, "start_time", "end_time"),
    )


@router.delete("/api/events/{event_id}", status_code=204)
def delete_event(event_id: str, user: dict = Depends(get_current_user)) -> None:
    _call(service.delete_event, user["user_id"], event_id)
