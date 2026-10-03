import uuid
from datetime import date
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

# Partition key user_id + sort key item_id: one user has many items, and a
# user's list is a single query. Items can only be addressed through their
# owner's user_id, so ownership is enforced by the key itself.
TABLE_NAME = "makemydays-shopping-items"

_UNSET = object()

_dynamodb = None


def _table():
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb", region_name="eu-central-1")
    return _dynamodb.Table(TABLE_NAME)


def _key(user_id: str, item_id: str) -> dict:
    return {"user_id": user_id, "item_id": item_id}


def _price(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(str(value))


def _get_owned(user_id: str, item_id: str) -> dict:
    item = _table().get_item(Key=_key(user_id, item_id)).get("Item")
    if not item:
        raise ValueError(f"Item {item_id} not found")
    return item


def list_items(user_id: str) -> list[dict]:
    kwargs = {"KeyConditionExpression": Key("user_id").eq(user_id)}
    items: list[dict] = []
    while True:
        response = _table().query(**kwargs)
        items.extend(_serialize(i) for i in response.get("Items", []))
        if "LastEvaluatedKey" not in response:
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    items.sort(key=lambda i: (i["created_at"], i["item_id"]))
    return items


def create_item(
    user_id: str,
    name: str,
    description: str = "",
    price_min: float | None = None,
    price_max: float | None = None,
    url: str = "",
) -> dict:
    record: dict = {
        "user_id": user_id,
        "item_id": str(uuid.uuid4()),
        "name": name.strip(),
        "description": description.strip(),
        "url": url.strip(),
        "purchased": False,
        "created_at": date.today().isoformat(),
    }
    if price_min is not None:
        record["price_min"] = _price(price_min)
    if price_max is not None:
        record["price_max"] = _price(price_max)

    _table().put_item(Item=record)
    return _serialize(record)


def update_item(
    user_id: str,
    item_id: str,
    name: str | None = None,
    description: str | None = None,
    price_min=_UNSET,
    price_max=_UNSET,
    url: str | None = None,
) -> dict:
    """Edit fields; None keeps text fields as they are. Prices are left alone
    unless passed, and passing None for a price clears it."""
    item = _get_owned(user_id, item_id)

    sets: dict = {}
    removes: list[str] = []
    if name is not None and name.strip():
        sets["name"] = name.strip()
    if description is not None:
        sets["description"] = description.strip()
    if url is not None:
        sets["url"] = url.strip()
    for field, value in (("price_min", price_min), ("price_max", price_max)):
        if value is _UNSET:
            continue
        if value is None:
            removes.append(field)
        else:
            sets[field] = _price(value)

    if sets or removes:
        # "name" and "url" are DynamoDB reserved words, so alias every attribute.
        parts = []
        if sets:
            parts.append("SET " + ", ".join(f"#{k} = :{k}" for k in sets))
        if removes:
            parts.append("REMOVE " + ", ".join(f"#{k}" for k in removes))
        kwargs = {
            "Key": _key(user_id, item_id),
            "UpdateExpression": " ".join(parts),
            "ExpressionAttributeNames": {f"#{k}": k for k in [*sets, *removes]},
        }
        if sets:
            kwargs["ExpressionAttributeValues"] = {f":{k}": v for k, v in sets.items()}
        _table().update_item(**kwargs)
        item.update(sets)
        for field in removes:
            item.pop(field, None)

    return _serialize(item)


def toggle_purchased(user_id: str, item_id: str) -> dict:
    item = _get_owned(user_id, item_id)
    new_state = not item.get("purchased", False)
    _table().update_item(
        Key=_key(user_id, item_id),
        UpdateExpression="SET purchased = :p",
        ExpressionAttributeValues={":p": new_state},
    )
    item["purchased"] = new_state
    return _serialize(item)


def delete_item(user_id: str, item_id: str) -> None:
    try:
        _table().delete_item(Key=_key(user_id, item_id), ConditionExpression="attribute_exists(item_id)")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise ValueError(f"Item {item_id} not found")
        raise


def _serialize(item: dict) -> dict:
    price_min = item.get("price_min")
    price_max = item.get("price_max")
    return {
        "item_id": item["item_id"],
        "name": item["name"],
        "description": item.get("description", ""),
        "price_min": float(price_min) if price_min is not None else None,
        "price_max": float(price_max) if price_max is not None else None,
        "url": item.get("url", ""),
        "purchased": bool(item.get("purchased", False)),
        "created_at": item.get("created_at", ""),
    }
