import uuid
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

# Partition key user_id + sort key note_id, same layout as habits: a user's
# notes are one query and a note can only be addressed through its owner.
#
# A note's body is an ordered list of blocks, stored as-is:
#   {"type": "text",  "text": str}
#   {"type": "list",  "checklist": bool, "items": [{"text": str, "checked": bool}]}
#   {"type": "table", "rows": [[str, ...], ...]}   (first row is the header)
TABLE_NAME = "makemydays-user-notes"

_dynamodb = None


def _table():
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb", region_name="eu-central-1")
    return _dynamodb.Table(TABLE_NAME)


def _key(user_id: str, note_id: str) -> dict:
    return {"user_id": user_id, "note_id": note_id}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _serialize(item: dict) -> dict:
    return {
        "note_id": item["note_id"],
        "title": item.get("title", ""),
        "blocks": item.get("blocks", []),
        "pinned": bool(item.get("pinned", False)),
        "created_at": item.get("created_at", ""),
        "updated_at": item.get("updated_at", ""),
    }


def list_notes(user_id: str) -> list[dict]:
    kwargs = {"KeyConditionExpression": Key("user_id").eq(user_id)}
    notes: list[dict] = []
    while True:
        response = _table().query(**kwargs)
        notes.extend(_serialize(i) for i in response.get("Items", []))
        if "LastEvaluatedKey" not in response:
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    # Pinned first, then most recently edited.
    notes.sort(key=lambda n: n["updated_at"], reverse=True)
    notes.sort(key=lambda n: not n["pinned"])
    return notes


def create_note(user_id: str, title: str, blocks: list[dict], pinned: bool = False) -> dict:
    now = _now()
    record = {
        "user_id": user_id,
        "note_id": str(uuid.uuid4()),
        "title": title.strip(),
        "blocks": blocks,
        "pinned": pinned,
        "created_at": now,
        "updated_at": now,
    }
    _table().put_item(Item=record)
    return _serialize(record)


def update_note(
    user_id: str,
    note_id: str,
    title: str | None = None,
    blocks: list[dict] | None = None,
    pinned: bool | None = None,
) -> dict:
    """Edit fields; None keeps the current value."""
    updates: dict = {"updated_at": _now()}
    if title is not None:
        updates["title"] = title.strip()
    if blocks is not None:
        updates["blocks"] = blocks
    if pinned is not None:
        updates["pinned"] = pinned

    try:
        response = _table().update_item(
            Key=_key(user_id, note_id),
            UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in updates),
            ConditionExpression="attribute_exists(note_id)",
            ExpressionAttributeNames={f"#{k}": k for k in updates},
            ExpressionAttributeValues={f":{k}": v for k, v in updates.items()},
            ReturnValues="ALL_NEW",
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise ValueError(f"Note {note_id} not found")
        raise
    return _serialize(response["Attributes"])


def delete_note(user_id: str, note_id: str) -> None:
    try:
        _table().delete_item(Key=_key(user_id, note_id), ConditionExpression="attribute_exists(note_id)")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise ValueError(f"Note {note_id} not found")
        raise
