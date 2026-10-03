import uuid
from datetime import date, timedelta

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

# Partition key user_id + sort key habit_id: one user has many habits, and a
# user's habits are a single query. Habits can only be addressed through their
# owner's user_id, so ownership is enforced by the key itself.
TABLE_NAME = "makemydays-user-habits"

_dynamodb = None


def _table():
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb", region_name="eu-central-1")
    return _dynamodb.Table(TABLE_NAME)


def _key(user_id: str, habit_id: str) -> dict:
    return {"user_id": user_id, "habit_id": habit_id}


def _get_owned(user_id: str, habit_id: str) -> dict:
    item = _table().get_item(Key=_key(user_id, habit_id)).get("Item")
    if not item:
        raise ValueError(f"Habit {habit_id} not found")
    return item


def _calculate_current_streak(completions: set[str]) -> int:
    check = date.today()
    # Today not ticked yet: a streak running up to yesterday is still alive.
    if check.isoformat() not in completions:
        check -= timedelta(days=1)
    streak = 0
    while check.isoformat() in completions and streak <= 365:
        streak += 1
        check -= timedelta(days=1)
    return streak


def _serialize(item: dict) -> dict:
    completions: set[str] = set(item.get("completions", []))
    return {
        "habit_id": item["habit_id"],
        "name": item["name"],
        "emoji": item.get("emoji", "⭐"),
        "goal_streak": int(item.get("goal_streak", 30)),
        "current_streak": _calculate_current_streak(completions),
        "completions": sorted(completions),
        "created_at": item.get("created_at", ""),
    }


def list_habits(user_id: str) -> list[dict]:
    kwargs = {"KeyConditionExpression": Key("user_id").eq(user_id)}
    habits: list[dict] = []
    while True:
        response = _table().query(**kwargs)
        habits.extend(_serialize(i) for i in response.get("Items", []))
        if "LastEvaluatedKey" not in response:
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    habits.sort(key=lambda h: (h["created_at"], h["habit_id"]))
    return habits


def create_habit(user_id: str, name: str, emoji: str = "⭐", goal_streak: int = 30) -> dict:
    # DynamoDB does not allow empty sets, so omit completions on creation
    record = {
        "user_id": user_id,
        "habit_id": str(uuid.uuid4()),
        "name": name.strip(),
        "emoji": emoji.strip() or "⭐",
        "goal_streak": goal_streak,
        "created_at": date.today().isoformat(),
    }
    _table().put_item(Item=record)
    return _serialize(record)


def update_habit(
    user_id: str,
    habit_id: str,
    name: str | None = None,
    emoji: str | None = None,
    goal_streak: int | None = None,
) -> dict:
    """Edit fields; None keeps the current value. Completions are untouched."""
    item = _get_owned(user_id, habit_id)

    updates: dict = {}
    if name is not None and name.strip():
        updates["name"] = name.strip()
    if emoji is not None and emoji.strip():
        updates["emoji"] = emoji.strip()
    if goal_streak is not None:
        updates["goal_streak"] = goal_streak

    if updates:
        # "name" is a DynamoDB reserved word, so alias every attribute.
        _table().update_item(
            Key=_key(user_id, habit_id),
            UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in updates),
            ExpressionAttributeNames={f"#{k}": k for k in updates},
            ExpressionAttributeValues={f":{k}": v for k, v in updates.items()},
        )
        item.update(updates)

    return _serialize(item)


def toggle_completion(user_id: str, habit_id: str, date_str: str) -> dict:
    table = _table()
    item = _get_owned(user_id, habit_id)

    completions: set[str] = set(item.get("completions", []))
    if date_str in completions:
        completions.discard(date_str)
        action = "DELETE"
    else:
        completions.add(date_str)
        action = "ADD"
    table.update_item(
        Key=_key(user_id, habit_id),
        UpdateExpression=f"{action} completions :d",
        ExpressionAttributeValues={":d": {date_str}},
    )

    return {
        "habit_id": habit_id,
        "done": date_str in completions,
        "current_streak": _calculate_current_streak(completions),
        "completions": sorted(completions),
    }


def delete_habit(user_id: str, habit_id: str) -> None:
    try:
        _table().delete_item(Key=_key(user_id, habit_id), ConditionExpression="attribute_exists(habit_id)")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise ValueError(f"Habit {habit_id} not found")
        raise
