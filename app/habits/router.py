from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.auth.dependencies import get_current_user
from app.habits.service import create_habit, delete_habit, list_habits, toggle_completion, update_habit

router = APIRouter()


def _not_blank(value: str | None) -> str | None:
    if value is not None and not value.strip():
        raise ValueError("Must not be empty")
    return value


class HabitCreate(BaseModel):
    name: str = Field(max_length=40)
    emoji: str = Field(default="⭐", max_length=16)  # emoji with modifiers span several code points
    goal_streak: int = Field(default=30, ge=1, le=365)

    _name = field_validator("name")(_not_blank)


class HabitUpdate(BaseModel):
    """Omitted fields are unchanged."""

    name: str | None = Field(default=None, max_length=40)
    emoji: str | None = Field(default=None, max_length=16)
    goal_streak: int | None = Field(default=None, ge=1, le=365)

    _name = field_validator("name", "emoji")(_not_blank)


class ToggleRequest(BaseModel):
    date: str  # YYYY-MM-DD

    @field_validator("date")
    @classmethod
    def valid_date(cls, value: str) -> str:
        return date.fromisoformat(value).isoformat()


@router.get("/api/habits")
def get_habits(user: dict = Depends(get_current_user)) -> list[dict]:
    return list_habits(user["user_id"])


@router.post("/api/habits", status_code=201)
def post_habit(body: HabitCreate, user: dict = Depends(get_current_user)) -> dict:
    return create_habit(user["user_id"], body.name, body.emoji, body.goal_streak)


@router.patch("/api/habits/{habit_id}")
def patch_habit(habit_id: str, body: HabitUpdate, user: dict = Depends(get_current_user)) -> dict:
    try:
        return update_habit(user["user_id"], habit_id, body.name, body.emoji, body.goal_streak)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/api/habits/{habit_id}/toggle")
def post_toggle(habit_id: str, body: ToggleRequest, user: dict = Depends(get_current_user)) -> dict:
    try:
        return toggle_completion(user["user_id"], habit_id, body.date)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/api/habits/{habit_id}", status_code=204)
def delete_habit_endpoint(habit_id: str, user: dict = Depends(get_current_user)) -> None:
    try:
        delete_habit(user["user_id"], habit_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
