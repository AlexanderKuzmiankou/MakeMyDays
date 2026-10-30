import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from app.auth.dependencies import get_current_user
from app.budget import service

router = APIRouter(prefix="/api/budget")

_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_PERIOD_RE = re.compile(r"^(\d{4}(-(0[1-9]|1[0-2]))?|monthly|yearly)$")

MAX_AMOUNT = 100_000_000


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


def _validate_color(value: str | None) -> str | None:
    if value is not None and not _COLOR_RE.match(value):
        raise ValueError("Colour must be a hex value like #2a78d6")
    return value.lower() if value else value


def _validate_kind(value: str | None) -> str | None:
    if value is not None and value not in service.KINDS:
        raise ValueError(f"Kind must be one of: {', '.join(service.KINDS)}")
    return value


def _validate_frequency(value: str) -> str:
    if value not in service.FREQUENCIES:
        raise ValueError(f"Frequency must be one of: {', '.join(service.FREQUENCIES)}")
    return value


class SettingsUpdate(BaseModel):
    currency: str | None = None

    _currency = field_validator("currency")(_validate_currency)


class CategoryCreate(BaseModel):
    name: str = Field(max_length=40)
    kind: str = "expense"
    color: str = "#2a78d6"

    _name = field_validator("name")(_validate_name)
    _kind = field_validator("kind")(_validate_kind)
    _color = field_validator("color")(_validate_color)


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=40)
    color: str | None = None

    _name = field_validator("name")(_validate_name)
    _color = field_validator("color")(_validate_color)


class TransactionCreate(BaseModel):
    kind: str
    amount: float = Field(gt=0, le=MAX_AMOUNT)
    description: str = Field(default="", max_length=120)
    category_id: str | None = None
    date: str | None = None  # YYYY-MM-DD, defaults to today

    _kind = field_validator("kind")(_validate_kind)
    _date = field_validator("date")(_validate_date)


class TransactionUpdate(BaseModel):
    amount: float | None = Field(default=None, gt=0, le=MAX_AMOUNT)
    description: str | None = Field(default=None, max_length=120)
    category_id: str | None = None  # "" removes the category
    date: str | None = None

    _date = field_validator("date")(_validate_date)


class RecurringCreate(BaseModel):
    kind: str
    amount: float = Field(gt=0, le=MAX_AMOUNT)
    frequency: str  # weekly | biweekly | monthly | quarterly | yearly
    start_date: str  # YYYY-MM-DD
    end_date: str | None = None
    description: str = Field(default="", max_length=120)
    category_id: str | None = None

    _kind = field_validator("kind")(_validate_kind)
    _frequency = field_validator("frequency")(_validate_frequency)
    _dates = field_validator("start_date", "end_date")(_validate_date)


class RecurringUpdate(BaseModel):
    amount: float | None = Field(default=None, gt=0, le=MAX_AMOUNT)
    description: str | None = Field(default=None, max_length=120)
    category_id: str | None = None  # "" removes the category
    end_date: str | None = None  # "" removes the end date

    @field_validator("end_date")
    @classmethod
    def check_end_date(cls, value: str | None) -> str | None:
        return value if value == "" else _validate_date(value)


class CapSet(BaseModel):
    total: float | None = Field(default=None, gt=0, le=MAX_AMOUNT)
    categories: dict[str, float] = Field(default_factory=dict)

    @field_validator("categories")
    @classmethod
    def check_amounts(cls, value: dict[str, float]) -> dict[str, float]:
        if any(not 0 < v <= MAX_AMOUNT for v in value.values()):
            raise ValueError("Category caps must be positive amounts")
        return value


def _check_period(period: str) -> str:
    if not _PERIOD_RE.match(period):
        raise HTTPException(status_code=400, detail="Period must be YYYY, YYYY-MM, 'monthly' or 'yearly'")
    return period


def _call(fn, *args, **kwargs):
    """ValueError -> 404 (missing / not yours), LookupError -> 400 (bad input)."""
    try:
        return fn(*args, **kwargs)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except LookupError as e:
        raise HTTPException(status_code=400, detail=str(e))


_YEAR = Query(ge=1970, le=2200)
_MONTH = Query(default=None, ge=1, le=12)


@router.get("/overview")
def get_overview(year: int = _YEAR, month: int | None = _MONTH, user: dict = Depends(get_current_user)) -> dict:
    return service.get_overview(user["user_id"], year, month)


@router.get("/settings")
def get_settings(user: dict = Depends(get_current_user)) -> dict:
    return service.get_settings(user["user_id"])


@router.patch("/settings")
def patch_settings(body: SettingsUpdate, user: dict = Depends(get_current_user)) -> dict:
    return service.update_settings(user["user_id"], body.currency)


@router.get("/categories")
def get_categories(user: dict = Depends(get_current_user)) -> list[dict]:
    return service.list_categories(user["user_id"])


@router.post("/categories", status_code=201)
def post_category(body: CategoryCreate, user: dict = Depends(get_current_user)) -> dict:
    return _call(service.create_category, user["user_id"], body.name, body.kind, body.color)


@router.patch("/categories/{category_id}")
def patch_category(category_id: str, body: CategoryUpdate, user: dict = Depends(get_current_user)) -> dict:
    return _call(service.update_category, user["user_id"], category_id, body.name, body.color)


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: str, user: dict = Depends(get_current_user)) -> None:
    _call(service.delete_category, user["user_id"], category_id)


@router.get("/transactions")
def get_transactions(
    year: int | None = Query(default=None, ge=1970, le=2200),
    month: int | None = _MONTH,
    user: dict = Depends(get_current_user),
) -> list[dict]:
    if month is not None and year is None:
        raise HTTPException(status_code=400, detail="A month needs a year")
    return service.list_transactions(user["user_id"], year, month)


@router.post("/transactions", status_code=201)
def post_transaction(body: TransactionCreate, user: dict = Depends(get_current_user)) -> dict:
    return _call(
        service.create_transaction,
        user["user_id"],
        body.kind,
        body.amount,
        description=body.description,
        category_id=body.category_id or None,
        transaction_date=body.date,
    )


@router.patch("/transactions/{transaction_id}")
def patch_transaction(transaction_id: str, body: TransactionUpdate, user: dict = Depends(get_current_user)) -> dict:
    return _call(
        service.update_transaction,
        user["user_id"],
        transaction_id,
        amount=body.amount,
        description=body.description,
        category_id=body.category_id or None,
        transaction_date=body.date,
        clear_category=body.category_id == "",
    )


@router.delete("/transactions/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: str, user: dict = Depends(get_current_user)) -> None:
    _call(service.delete_transaction, user["user_id"], transaction_id)


@router.get("/recurring")
def get_recurring(user: dict = Depends(get_current_user)) -> list[dict]:
    return service.list_recurring(user["user_id"])


@router.post("/recurring", status_code=201)
def post_recurring(body: RecurringCreate, user: dict = Depends(get_current_user)) -> dict:
    return _call(
        service.create_recurring,
        user["user_id"],
        body.kind,
        body.amount,
        body.frequency,
        body.start_date,
        description=body.description,
        category_id=body.category_id or None,
        end_date=body.end_date,
    )


@router.patch("/recurring/{recurring_id}")
def patch_recurring(recurring_id: str, body: RecurringUpdate, user: dict = Depends(get_current_user)) -> dict:
    return _call(
        service.update_recurring,
        user["user_id"],
        recurring_id,
        amount=body.amount,
        description=body.description,
        category_id=body.category_id or None,
        end_date=body.end_date or None,
        clear_end_date=body.end_date == "",
        clear_category=body.category_id == "",
    )


@router.delete("/recurring/{recurring_id}", status_code=204)
def delete_recurring(recurring_id: str, user: dict = Depends(get_current_user)) -> None:
    _call(service.delete_recurring, user["user_id"], recurring_id)


@router.get("/caps")
def get_caps(user: dict = Depends(get_current_user)) -> list[dict]:
    return service.list_caps(user["user_id"])


@router.put("/caps/{period}")
def put_cap(period: str, body: CapSet, user: dict = Depends(get_current_user)) -> dict:
    return _call(service.set_cap, user["user_id"], _check_period(period), body.total, body.categories)


@router.delete("/caps/{period}", status_code=204)
def delete_cap(period: str, user: dict = Depends(get_current_user)) -> None:
    _call(service.delete_cap, user["user_id"], _check_period(period))
