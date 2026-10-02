import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.auth.dependencies import get_current_user
from app.shared_costs import service

router = APIRouter(prefix="/api/shared-costs")

_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")


def _validate_currency(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip().upper()
    if not _CURRENCY_RE.match(value):
        raise ValueError("Currency must be a 3-letter ISO 4217 code, e.g. EUR")
    return value


def _validate_date(value: str | None) -> str | None:
    if value is None:
        return None
    return date.fromisoformat(value).isoformat()


def _validate_name(value: str | None) -> str | None:
    if value is not None and not value.strip():
        raise ValueError("Must not be empty")
    return value


class GroupCreate(BaseModel):
    name: str = Field(max_length=80)
    currency: str = service.DEFAULT_CURRENCY

    _name = field_validator("name")(_validate_name)
    _currency = field_validator("currency")(_validate_currency)


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    currency: str | None = None

    _currency = field_validator("currency")(_validate_currency)


class MemberAdd(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class ExpenseCreate(BaseModel):
    description: str = Field(max_length=120)
    amount: float = Field(gt=0, le=1_000_000)
    currency: str | None = None  # defaults to the group's currency
    paid_by: str | None = None  # defaults to the current user
    split_between: list[str] | None = None  # defaults to every member
    date: str | None = None  # YYYY-MM-DD, defaults to today

    _description = field_validator("description")(_validate_name)
    _currency = field_validator("currency")(_validate_currency)
    _date = field_validator("date")(_validate_date)


class RecurringCreate(BaseModel):
    description: str = Field(max_length=120)
    amount: float = Field(gt=0, le=1_000_000)
    frequency: str  # weekly | monthly | yearly
    start_date: str  # YYYY-MM-DD
    end_date: str | None = None
    currency: str | None = None
    paid_by: str | None = None
    split_between: list[str] | None = None

    _description = field_validator("description")(_validate_name)
    _currency = field_validator("currency")(_validate_currency)
    _dates = field_validator("start_date", "end_date")(_validate_date)


def _call(fn, *args, **kwargs):
    """ValueError -> 404 (missing / not yours), LookupError -> 400 (bad input)."""
    try:
        return fn(*args, **kwargs)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except LookupError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/overview")
def get_overview(user: dict = Depends(get_current_user)) -> dict:
    return service.get_overview(user["user_id"])


@router.get("/groups")
def get_groups(user: dict = Depends(get_current_user)) -> list[dict]:
    return service.list_groups(user["user_id"])


@router.post("/groups", status_code=201)
def post_group(body: GroupCreate, user: dict = Depends(get_current_user)) -> dict:
    return service.create_group(user, body.name, body.currency)


@router.get("/groups/{group_id}")
def get_group(group_id: str, user: dict = Depends(get_current_user)) -> dict:
    return _call(service.get_group, user["user_id"], group_id)


@router.patch("/groups/{group_id}")
def patch_group(group_id: str, body: GroupUpdate, user: dict = Depends(get_current_user)) -> dict:
    return _call(service.update_group, user["user_id"], group_id, body.name, body.currency)


@router.post("/groups/{group_id}/members", status_code=201)
def post_member(group_id: str, body: MemberAdd, user: dict = Depends(get_current_user)) -> dict:
    return _call(service.add_member, user["user_id"], group_id, body.email)


@router.get("/groups/{group_id}/expenses")
def get_expenses(group_id: str, user: dict = Depends(get_current_user)) -> list[dict]:
    return _call(service.list_expenses, user["user_id"], group_id)


@router.post("/groups/{group_id}/expenses", status_code=201)
def post_expense(group_id: str, body: ExpenseCreate, user: dict = Depends(get_current_user)) -> dict:
    return _call(
        service.create_expense,
        user["user_id"],
        group_id,
        body.description,
        body.amount,
        currency=body.currency,
        paid_by=body.paid_by,
        split_between=body.split_between,
        expense_date=body.date,
    )


@router.delete("/groups/{group_id}/expenses/{expense_id}", status_code=204)
def delete_expense(group_id: str, expense_id: str, user: dict = Depends(get_current_user)) -> None:
    _call(service.delete_expense, user["user_id"], group_id, expense_id)


@router.get("/groups/{group_id}/recurring")
def get_recurring(group_id: str, user: dict = Depends(get_current_user)) -> list[dict]:
    return _call(service.list_recurring, user["user_id"], group_id)


@router.post("/groups/{group_id}/recurring", status_code=201)
def post_recurring(group_id: str, body: RecurringCreate, user: dict = Depends(get_current_user)) -> dict:
    return _call(
        service.create_recurring,
        user["user_id"],
        group_id,
        body.description,
        body.amount,
        body.frequency,
        body.start_date,
        end_date=body.end_date,
        currency=body.currency,
        paid_by=body.paid_by,
        split_between=body.split_between,
    )


@router.delete("/groups/{group_id}/recurring/{recurring_id}", status_code=204)
def delete_recurring(group_id: str, recurring_id: str, user: dict = Depends(get_current_user)) -> None:
    _call(service.delete_recurring, user["user_id"], group_id, recurring_id)


@router.get("/groups/{group_id}/balances")
def get_balances(group_id: str, user: dict = Depends(get_current_user)) -> dict:
    return _call(service.get_balances, user["user_id"], group_id)
