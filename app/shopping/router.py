from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from app.auth.dependencies import get_current_user
from app.shopping.service import create_item, delete_item, list_items, toggle_purchased, update_item

router = APIRouter()


def _validate_name(value: str | None) -> str | None:
    if value is not None and not value.strip():
        raise ValueError("Must not be empty")
    return value


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


@router.get("/api/shopping")
def get_items(user: dict = Depends(get_current_user)) -> list[dict]:
    return list_items(user["user_id"])


@router.post("/api/shopping", status_code=201)
def post_item(body: ShoppingItemCreate, user: dict = Depends(get_current_user)) -> dict:
    return create_item(user["user_id"], body.name, body.description, body.price_min, body.price_max, body.url)


@router.patch("/api/shopping/{item_id}")
def patch_item(item_id: str, body: ShoppingItemUpdate, user: dict = Depends(get_current_user)) -> dict:
    prices = {f: getattr(body, f) for f in ("price_min", "price_max") if f in body.model_fields_set}
    try:
        return update_item(
            user["user_id"], item_id, name=body.name, description=body.description, url=body.url, **prices
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/api/shopping/{item_id}/toggle")
def post_toggle(item_id: str, user: dict = Depends(get_current_user)) -> dict:
    try:
        return toggle_purchased(user["user_id"], item_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/api/shopping/{item_id}", status_code=204)
def delete_item_endpoint(item_id: str, user: dict = Depends(get_current_user)) -> None:
    try:
        delete_item(user["user_id"], item_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
