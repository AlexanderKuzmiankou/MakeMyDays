from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from app.auth.dependencies import get_current_user
from app.shopping import service

router = APIRouter(prefix="/api/shopping")


def _validate_name(value: str | None) -> str | None:
    if value is not None and not value.strip():
        raise ValueError("Must not be empty")
    return value


def _call(fn, *args, **kwargs):
    """ValueError -> 404 (missing / not yours), LookupError -> 400 (bad input),
    PermissionError -> 403 (a member, but not allowed)."""
    try:
        return fn(*args, **kwargs)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except LookupError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


# ── lists ────────────────────────────────────────────────────────────────────

class ListName(BaseModel):
    name: str = Field(max_length=60)

    _name = field_validator("name")(_validate_name)


class MemberAdd(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


@router.get("/lists")
def get_lists(user: dict = Depends(get_current_user)) -> list[dict]:
    return service.list_lists(user["user_id"])


@router.post("/lists", status_code=201)
def post_list(body: ListName, user: dict = Depends(get_current_user)) -> dict:
    return service.create_list(user, body.name)


@router.patch("/lists/{list_id}")
def patch_list(list_id: str, body: ListName, user: dict = Depends(get_current_user)) -> dict:
    return _call(service.rename_list, user["user_id"], list_id, body.name)


@router.delete("/lists/{list_id}", status_code=204)
def delete_list(list_id: str, user: dict = Depends(get_current_user)) -> None:
    _call(service.delete_list, user["user_id"], list_id)


@router.post("/lists/{list_id}/members", status_code=201)
def post_member(list_id: str, body: MemberAdd, user: dict = Depends(get_current_user)) -> dict:
    return _call(service.add_member, user["user_id"], list_id, body.email)


@router.post("/lists/{list_id}/leave", status_code=204)
def post_leave(list_id: str, user: dict = Depends(get_current_user)) -> None:
    _call(service.leave_list, user["user_id"], list_id)


# ── items ────────────────────────────────────────────────────────────────────

class _PriceRange(BaseModel):
    @model_validator(mode="after")
    def check_range(self):
        if self.price_min is not None and self.price_max is not None and self.price_min > self.price_max:
            raise ValueError("Minimum price must not be above the maximum")
        return self


class ShoppingItemCreate(_PriceRange):
    name: str = Field(max_length=80)
    description: str = Field(default="", max_length=200)
    price_min: float | None = Field(default=None, ge=0)
    price_max: float | None = Field(default=None, ge=0)
    url: str = Field(default="", max_length=2000)

    _name = field_validator("name")(_validate_name)


class ShoppingItemUpdate(_PriceRange):
    """Omitted fields are unchanged; an explicit null price clears it."""

    name: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=200)
    price_min: float | None = Field(default=None, ge=0)
    price_max: float | None = Field(default=None, ge=0)
    url: str | None = Field(default=None, max_length=2000)

    _name = field_validator("name")(_validate_name)


@router.get("/lists/{list_id}/items")
def get_items(list_id: str, user: dict = Depends(get_current_user)) -> list[dict]:
    return _call(service.list_items, user["user_id"], list_id)


@router.post("/lists/{list_id}/items", status_code=201)
def post_item(list_id: str, body: ShoppingItemCreate, user: dict = Depends(get_current_user)) -> dict:
    return _call(
        service.create_item, user["user_id"], list_id, body.name, body.description, body.price_min, body.price_max, body.url
    )


@router.patch("/lists/{list_id}/items/{item_id}")
def patch_item(list_id: str, item_id: str, body: ShoppingItemUpdate, user: dict = Depends(get_current_user)) -> dict:
    prices = {f: getattr(body, f) for f in ("price_min", "price_max") if f in body.model_fields_set}
    return _call(
        service.update_item,
        user["user_id"],
        list_id,
        item_id,
        name=body.name,
        description=body.description,
        url=body.url,
        **prices,
    )


@router.post("/lists/{list_id}/items/{item_id}/toggle")
def post_toggle(list_id: str, item_id: str, user: dict = Depends(get_current_user)) -> dict:
    return _call(service.toggle_purchased, user["user_id"], list_id, item_id)


@router.delete("/lists/{list_id}/items/{item_id}", status_code=204)
def delete_item(list_id: str, item_id: str, user: dict = Depends(get_current_user)) -> None:
    _call(service.delete_item, user["user_id"], list_id, item_id)
