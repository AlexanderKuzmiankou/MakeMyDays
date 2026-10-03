"""Shopping lists that can be shared between users.

Lists live in their own table (partition key list_id) with the members on the
list, like Shared Costs groups. Items are keyed by list_id + item_id, so a
list's items are a single query and every item access goes through a list
the user is a member of.
"""
import uuid
from datetime import date
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from app.auth.service import get_user_by_email

LISTS_TABLE = "makemydays-shopping-lists"
ITEMS_TABLE = "makemydays-shopping-list-items"

UNSET = object()

_dynamodb = None


def _resource():
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb", region_name="eu-central-1")
    return _dynamodb


def _lists():
    return _resource().Table(LISTS_TABLE)


def _items():
    return _resource().Table(ITEMS_TABLE)


def _paginate(op, **kwargs) -> list[dict]:
    items: list[dict] = []
    while True:
        response = op(**kwargs)
        items.extend(response.get("Items", []))
        if "LastEvaluatedKey" not in response:
            return items
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]


def _price(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(str(value))


# ── lists ────────────────────────────────────────────────────────────────────

def _get_list_for_member(user_id: str, list_id: str) -> dict:
    item = _lists().get_item(Key={"list_id": list_id}).get("Item")
    # Non-members get the same error as a missing list so list ids can't be probed.
    if not item or user_id not in item.get("member_ids", set()):
        raise ValueError("List not found")
    return item


def _profile(email: str, cache: dict) -> dict | None:
    if email not in cache:
        cache[email] = get_user_by_email(email) if email else None
    return cache[email]


def _serialize_list(item: dict, list_items: list[dict] | None = None, profiles: dict | None = None) -> dict:
    profiles = {} if profiles is None else profiles
    members = []
    for uid, m in item.get("members", {}).items():
        # Name and avatar come from the live profile; the stored copy is the fallback.
        profile = _profile(m.get("email", ""), profiles) or {}
        members.append({
            "user_id": uid,
            "name": profile.get("name") or m.get("name", ""),
            "email": m.get("email", ""),
            "avatar_url": profile.get("avatar_url") or None,
        })
    members.sort(key=lambda m: (m["name"].lower(), m["email"]))
    result = {
        "list_id": item["list_id"],
        "name": item["name"],
        "created_by": item.get("created_by", ""),
        "created_at": item.get("created_at", ""),
        "members": members,
    }
    if list_items is not None:
        result["item_count"] = len(list_items)
        result["pending_count"] = sum(1 for i in list_items if not i.get("purchased"))
    return result


def _query_items(list_id: str) -> list[dict]:
    return _paginate(_items().query, KeyConditionExpression=Key("list_id").eq(list_id))


def list_lists(user_id: str) -> list[dict]:
    """The user's lists, oldest first, with item counts."""
    records = _paginate(_lists().scan, FilterExpression=Attr("member_ids").contains(user_id))
    profiles: dict = {}
    lists = [_serialize_list(r, _query_items(r["list_id"]), profiles) for r in records]
    lists.sort(key=lambda lst: (lst["created_at"], lst["list_id"]))
    return lists


def create_list(user: dict, name: str) -> dict:
    record = {
        "list_id": str(uuid.uuid4()),
        "name": name.strip(),
        "created_by": user["user_id"],
        "created_at": date.today().isoformat(),
        "member_ids": {user["user_id"]},
        "members": {user["user_id"]: {"name": user.get("name", ""), "email": user["email"]}},
    }
    _lists().put_item(Item=record)
    return _serialize_list(record, [])


def rename_list(user_id: str, list_id: str, name: str) -> dict:
    item = _get_list_for_member(user_id, list_id)
    _lists().update_item(
        Key={"list_id": list_id},
        UpdateExpression="SET #name = :name",
        ExpressionAttributeNames={"#name": "name"},
        ExpressionAttributeValues={":name": name.strip()},
    )
    item["name"] = name.strip()
    return _serialize_list(item, _query_items(list_id))


def add_member(user_id: str, list_id: str, email: str) -> dict:
    item = _get_list_for_member(user_id, list_id)

    new_user = get_user_by_email(email)
    if not new_user:
        raise LookupError("No MakeMyDays account exists with that email")
    new_id = new_user["user_id"]
    if new_id in item["member_ids"]:
        raise LookupError("That user is already on this list")

    member = {"name": new_user.get("name", ""), "email": new_user["email"]}
    _lists().update_item(
        Key={"list_id": list_id},
        UpdateExpression="ADD member_ids :ids SET #members.#uid = :member",
        ExpressionAttributeNames={"#members": "members", "#uid": new_id},
        ExpressionAttributeValues={":ids": {new_id}, ":member": member},
    )
    item["member_ids"] = set(item["member_ids"]) | {new_id}
    item["members"] = {**item["members"], new_id: member}
    return _serialize_list(item, _query_items(list_id))


def leave_list(user_id: str, list_id: str) -> None:
    """Removes the user from a shared list. The last member deletes it instead."""
    item = _get_list_for_member(user_id, list_id)
    if len(item["member_ids"]) == 1:
        raise LookupError("You're the only member — delete the list instead")
    _lists().update_item(
        Key={"list_id": list_id},
        UpdateExpression="DELETE member_ids :ids REMOVE #members.#uid",
        ExpressionAttributeNames={"#members": "members", "#uid": user_id},
        ExpressionAttributeValues={":ids": {user_id}},
    )


def delete_list(user_id: str, list_id: str) -> None:
    """Only the list's creator can delete it; its items go with it."""
    item = _get_list_for_member(user_id, list_id)
    if item.get("created_by") != user_id:
        raise PermissionError("Only the person who created this list can delete it")
    with _items().batch_writer() as batch:
        for i in _query_items(list_id):
            batch.delete_item(Key={"list_id": list_id, "item_id": i["item_id"]})
    _lists().delete_item(Key={"list_id": list_id})


# ── items ────────────────────────────────────────────────────────────────────

def _item_key(list_id: str, item_id: str) -> dict:
    return {"list_id": list_id, "item_id": item_id}


def _get_item(user_id: str, list_id: str, item_id: str) -> dict:
    _get_list_for_member(user_id, list_id)
    item = _items().get_item(Key=_item_key(list_id, item_id)).get("Item")
    if not item:
        raise ValueError(f"Item {item_id} not found")
    return item


def list_items(user_id: str, list_id: str) -> list[dict]:
    _get_list_for_member(user_id, list_id)
    items = [_serialize(i) for i in _query_items(list_id)]
    items.sort(key=lambda i: (i["created_at"], i["item_id"]))
    return items


def create_item(
    user_id: str,
    list_id: str,
    name: str,
    description: str = "",
    price_min: float | None = None,
    price_max: float | None = None,
    url: str = "",
) -> dict:
    _get_list_for_member(user_id, list_id)
    record: dict = {
        "list_id": list_id,
        "item_id": str(uuid.uuid4()),
        "name": name.strip(),
        "description": description.strip(),
        "url": url.strip(),
        "purchased": False,
        "added_by": user_id,
        "created_at": date.today().isoformat(),
    }
    if price_min is not None:
        record["price_min"] = _price(price_min)
    if price_max is not None:
        record["price_max"] = _price(price_max)

    _items().put_item(Item=record)
    return _serialize(record)


def update_item(
    user_id: str,
    list_id: str,
    item_id: str,
    name: str | None = None,
    description: str | None = None,
    price_min=UNSET,
    price_max=UNSET,
    url: str | None = None,
) -> dict:
    """Edit fields; None keeps text fields as they are. Prices are left alone
    unless passed, and passing None for a price clears it."""
    item = _get_item(user_id, list_id, item_id)

    sets: dict = {}
    removes: list[str] = []
    if name is not None and name.strip():
        sets["name"] = name.strip()
    if description is not None:
        sets["description"] = description.strip()
    if url is not None:
        sets["url"] = url.strip()
    for field, value in (("price_min", price_min), ("price_max", price_max)):
        if value is UNSET:
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
            "Key": _item_key(list_id, item_id),
            "UpdateExpression": " ".join(parts),
            "ExpressionAttributeNames": {f"#{k}": k for k in [*sets, *removes]},
        }
        if sets:
            kwargs["ExpressionAttributeValues"] = {f":{k}": v for k, v in sets.items()}
        _items().update_item(**kwargs)
        item.update(sets)
        for field in removes:
            item.pop(field, None)

    return _serialize(item)


def toggle_purchased(user_id: str, list_id: str, item_id: str) -> dict:
    item = _get_item(user_id, list_id, item_id)
    new_state = not item.get("purchased", False)
    _items().update_item(
        Key=_item_key(list_id, item_id),
        UpdateExpression="SET purchased = :p",
        ExpressionAttributeValues={":p": new_state},
    )
    item["purchased"] = new_state
    return _serialize(item)


def delete_item(user_id: str, list_id: str, item_id: str) -> None:
    _get_list_for_member(user_id, list_id)
    try:
        _items().delete_item(Key=_item_key(list_id, item_id), ConditionExpression="attribute_exists(item_id)")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise ValueError(f"Item {item_id} not found")
        raise


def _serialize(item: dict) -> dict:
    price_min = item.get("price_min")
    price_max = item.get("price_max")
    return {
        "item_id": item["item_id"],
        "list_id": item["list_id"],
        "name": item["name"],
        "description": item.get("description", ""),
        "price_min": float(price_min) if price_min is not None else None,
        "price_max": float(price_max) if price_max is not None else None,
        "url": item.get("url", ""),
        "purchased": bool(item.get("purchased", False)),
        "added_by": item.get("added_by"),
        "created_at": item.get("created_at", ""),
    }
