import uuid
from collections import defaultdict
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

import boto3
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError
from dateutil.relativedelta import relativedelta

from app.auth.service import get_user_by_email

GROUPS_TABLE = "makemydays-shared-groups"
EXPENSES_TABLE = "makemydays-shared-expenses"
RECURRING_TABLE = "makemydays-shared-recurring"

DEFAULT_CURRENCY = "EUR"
FREQUENCIES = {
    "weekly": relativedelta(weeks=1),
    "monthly": relativedelta(months=1),
    "yearly": relativedelta(years=1),
}

CENT = Decimal("0.01")

_dynamodb = None


def _resource():
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb", region_name="eu-central-1")
    return _dynamodb


def _groups():
    return _resource().Table(GROUPS_TABLE)


def _expenses():
    return _resource().Table(EXPENSES_TABLE)


def _recurring():
    return _resource().Table(RECURRING_TABLE)


def _scan_all(table, filter_expression) -> list[dict]:
    """Scan with pagination — a single scan page stops at 1 MB."""
    kwargs = {"FilterExpression": filter_expression}
    items: list[dict] = []
    while True:
        response = table.scan(**kwargs)
        items.extend(response.get("Items", []))
        if "LastEvaluatedKey" not in response:
            return items
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]


def _money(value) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


# ── groups ───────────────────────────────────────────────────────────────────

def _get_group_for_member(user_id: str, group_id: str) -> dict:
    item = _groups().get_item(Key={"group_id": group_id}).get("Item")
    # Non-members get the same error as a missing group so group ids can't be probed.
    if not item or user_id not in item.get("member_ids", set()):
        raise ValueError(f"Group {group_id} not found")
    return item


def list_groups(user_id: str) -> list[dict]:
    items = _scan_all(_groups(), Attr("member_ids").contains(user_id))
    groups = [_serialize_group(i) for i in items]
    groups.sort(key=lambda g: g["created_at"])
    return groups


def get_group(user_id: str, group_id: str) -> dict:
    return _serialize_group(_get_group_for_member(user_id, group_id))


def create_group(user: dict, name: str, currency: str = DEFAULT_CURRENCY) -> dict:
    record = {
        "group_id": str(uuid.uuid4()),
        "name": name.strip(),
        "currency": currency,
        "created_by": user["user_id"],
        "created_at": date.today().isoformat(),
        "member_ids": {user["user_id"]},
        "members": {user["user_id"]: {"name": user.get("name", ""), "email": user["email"]}},
    }
    _groups().put_item(Item=record)
    return _serialize_group(record)


def update_group(user_id: str, group_id: str, name: str | None = None, currency: str | None = None) -> dict:
    item = _get_group_for_member(user_id, group_id)

    updates: dict = {}
    if name is not None and name.strip():
        updates["name"] = name.strip()
    if currency is not None:
        updates["currency"] = currency

    if updates:
        # "name" is a DynamoDB reserved word, so alias every attribute.
        _groups().update_item(
            Key={"group_id": group_id},
            UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in updates),
            ExpressionAttributeNames={f"#{k}": k for k in updates},
            ExpressionAttributeValues={f":{k}": v for k, v in updates.items()},
        )
        item.update(updates)

    return _serialize_group(item)


def add_member(user_id: str, group_id: str, email: str) -> dict:
    item = _get_group_for_member(user_id, group_id)

    new_user = get_user_by_email(email)
    if not new_user:
        raise LookupError("No MakeMyDays account exists with that email")
    new_id = new_user["user_id"]
    if new_id in item["member_ids"]:
        raise LookupError("That user is already in this group")

    member = {"name": new_user.get("name", ""), "email": new_user["email"]}
    _groups().update_item(
        Key={"group_id": group_id},
        UpdateExpression="ADD member_ids :ids SET #members.#uid = :member",
        ExpressionAttributeNames={"#members": "members", "#uid": new_id},
        ExpressionAttributeValues={":ids": {new_id}, ":member": member},
    )
    item["member_ids"] = set(item["member_ids"]) | {new_id}
    item["members"] = {**item["members"], new_id: member}
    return _serialize_group(item)


def _serialize_group(item: dict) -> dict:
    members = item.get("members", {})
    return {
        "group_id": item["group_id"],
        "name": item["name"],
        "currency": item.get("currency", DEFAULT_CURRENCY),
        "created_by": item.get("created_by", ""),
        "created_at": item.get("created_at", ""),
        "members": sorted(
            (
                {"user_id": uid, "name": m.get("name", ""), "email": m.get("email", "")}
                for uid, m in members.items()
            ),
            key=lambda m: (m["name"].lower(), m["email"]),
        ),
    }


# ── expenses ─────────────────────────────────────────────────────────────────

def _validate_participants(group: dict, paid_by: str, split_between: list[str]) -> None:
    member_ids = group["member_ids"]
    if paid_by not in member_ids:
        raise LookupError("The payer must be a member of the group")
    if not split_between:
        raise LookupError("An expense must be split between at least one member")
    if any(uid not in member_ids for uid in split_between):
        raise LookupError("Expenses can only be split between group members")


def list_expenses(user_id: str, group_id: str) -> list[dict]:
    _get_group_for_member(user_id, group_id)
    materialize_recurring(group_id)
    return _list_group_expenses(group_id)


def _list_group_expenses(group_id: str) -> list[dict]:
    items = _scan_all(_expenses(), Attr("group_id").eq(group_id))
    expenses = [_serialize_expense(i) for i in items]
    expenses.sort(key=lambda e: (e["date"], e["created_at"]), reverse=True)
    return expenses


def create_expense(
    user_id: str,
    group_id: str,
    description: str,
    amount: float,
    currency: str | None = None,
    paid_by: str | None = None,
    split_between: list[str] | None = None,
    expense_date: str | None = None,
) -> dict:
    group = _get_group_for_member(user_id, group_id)
    paid_by = paid_by or user_id
    split_between = list(dict.fromkeys(split_between or sorted(group["member_ids"])))
    _validate_participants(group, paid_by, split_between)

    record = _expense_record(
        expense_id=str(uuid.uuid4()),
        group_id=group_id,
        description=description,
        amount=amount,
        currency=currency or group.get("currency", DEFAULT_CURRENCY),
        paid_by=paid_by,
        split_between=split_between,
        expense_date=expense_date or date.today().isoformat(),
        created_by=user_id,
    )
    _expenses().put_item(Item=record)
    return _serialize_expense(record)


def delete_expense(user_id: str, group_id: str, expense_id: str) -> None:
    _get_group_for_member(user_id, group_id)
    item = _expenses().get_item(Key={"expense_id": expense_id}).get("Item")
    if not item or item.get("group_id") != group_id:
        raise ValueError(f"Expense {expense_id} not found")
    _expenses().delete_item(Key={"expense_id": expense_id})


def update_expense(
    user_id: str,
    group_id: str,
    expense_id: str,
    description: str | None = None,
    amount: float | None = None,
    currency: str | None = None,
    paid_by: str | None = None,
    split_between: list[str] | None = None,
    expense_date: str | None = None,
) -> dict:
    """Edit any field; fields left as None keep their current value.

    Editing an occurrence of a recurring expense changes only that occurrence.
    """
    group = _get_group_for_member(user_id, group_id)
    item = _expenses().get_item(Key={"expense_id": expense_id}).get("Item")
    if not item or item.get("group_id") != group_id:
        raise ValueError(f"Expense {expense_id} not found")

    paid_by = paid_by or item["paid_by"]
    split_between = list(dict.fromkeys(split_between)) if split_between else list(item["split_between"])
    _validate_participants(group, paid_by, split_between)

    record = _expense_record(
        expense_id=expense_id,
        group_id=group_id,
        description=description if description is not None else item.get("description", ""),
        amount=amount if amount is not None else item["amount"],
        currency=currency or item.get("currency", DEFAULT_CURRENCY),
        paid_by=paid_by,
        split_between=split_between,
        expense_date=expense_date or item.get("date", date.today().isoformat()),
        created_by=item.get("created_by", user_id),
        recurring_id=item.get("recurring_id"),
    )
    record["created_at"] = item.get("created_at", record["created_at"])
    record["updated_by"] = user_id
    _expenses().put_item(Item=record)
    return _serialize_expense(record)


def _expense_record(
    expense_id: str,
    group_id: str,
    description: str,
    amount,
    currency: str,
    paid_by: str,
    split_between: list[str],
    expense_date: str,
    created_by: str,
    recurring_id: str | None = None,
) -> dict:
    record = {
        "expense_id": expense_id,
        "group_id": group_id,
        "description": description.strip(),
        "amount": _money(amount),
        "currency": currency,
        "paid_by": paid_by,
        "split_between": split_between,
        "date": expense_date,
        "created_by": created_by,
        "created_at": date.today().isoformat(),
    }
    if recurring_id:
        record["recurring_id"] = recurring_id
    return record


def _serialize_expense(item: dict) -> dict:
    return {
        "expense_id": item["expense_id"],
        "group_id": item["group_id"],
        "description": item.get("description", ""),
        "amount": float(item["amount"]),
        "currency": item.get("currency", DEFAULT_CURRENCY),
        "paid_by": item["paid_by"],
        "split_between": list(item.get("split_between", [])),
        "date": item.get("date", ""),
        "created_by": item.get("created_by", ""),
        "created_at": item.get("created_at", ""),
        "recurring_id": item.get("recurring_id"),
    }


# ── recurring expenses ───────────────────────────────────────────────────────
# A recurring expense is a template. Concrete expenses are generated lazily
# ("materialized") whenever the group's expenses or balances are read, so no
# scheduler is needed. Occurrence n is always start_date + n * frequency, which
# avoids month-end drift (Jan 31 -> Feb 28 -> Mar 31, not Mar 28).

def _occurrence_date(start: date, frequency: str, n: int) -> date:
    step = FREQUENCIES[frequency]
    return start + relativedelta(
        years=step.years * n, months=step.months * n, days=step.days * n
    )


def list_recurring(user_id: str, group_id: str) -> list[dict]:
    _get_group_for_member(user_id, group_id)
    items = _scan_all(_recurring(), Attr("group_id").eq(group_id))
    recurring = [_serialize_recurring(i) for i in items]
    recurring.sort(key=lambda r: r["created_at"])
    return recurring


def create_recurring(
    user_id: str,
    group_id: str,
    description: str,
    amount: float,
    frequency: str,
    start_date: str,
    end_date: str | None = None,
    currency: str | None = None,
    paid_by: str | None = None,
    split_between: list[str] | None = None,
) -> dict:
    group = _get_group_for_member(user_id, group_id)
    if frequency not in FREQUENCIES:
        raise LookupError(f"Frequency must be one of: {', '.join(FREQUENCIES)}")
    if end_date and end_date < start_date:
        raise LookupError("End date must not be before the start date")
    paid_by = paid_by or user_id
    split_between = list(dict.fromkeys(split_between or sorted(group["member_ids"])))
    _validate_participants(group, paid_by, split_between)

    record = {
        "recurring_id": str(uuid.uuid4()),
        "group_id": group_id,
        "description": description.strip(),
        "amount": _money(amount),
        "currency": currency or group.get("currency", DEFAULT_CURRENCY),
        "paid_by": paid_by,
        "split_between": split_between,
        "frequency": frequency,
        "start_date": start_date,
        "occurrences": 0,
        "created_by": user_id,
        "created_at": date.today().isoformat(),
    }
    if end_date:
        record["end_date"] = end_date
    _recurring().put_item(Item=record)
    materialize_recurring(group_id)
    return _serialize_recurring(_recurring().get_item(Key={"recurring_id": record["recurring_id"]}).get("Item", record))


def delete_recurring(user_id: str, group_id: str, recurring_id: str) -> None:
    """Stops future occurrences. Already generated expenses are kept."""
    _get_group_for_member(user_id, group_id)
    item = _recurring().get_item(Key={"recurring_id": recurring_id}).get("Item")
    if not item or item.get("group_id") != group_id:
        raise ValueError(f"Recurring expense {recurring_id} not found")
    _recurring().delete_item(Key={"recurring_id": recurring_id})


def materialize_recurring(group_id: str, today: date | None = None) -> int:
    """Create concrete expenses for every recurring occurrence due up to today.

    Occurrence ids are deterministic ("<recurring_id>#<n>") and written with a
    condition, so concurrent requests can never double-book an occurrence.
    """
    today = today or date.today()
    created = 0
    for template in _scan_all(_recurring(), Attr("group_id").eq(group_id)):
        start = date.fromisoformat(template["start_date"])
        end = date.fromisoformat(template["end_date"]) if template.get("end_date") else None
        frequency = template["frequency"]
        n = int(template.get("occurrences", 0))

        while True:
            due = _occurrence_date(start, frequency, n)
            if due > today or (end and due > end):
                break
            record = _expense_record(
                expense_id=f"{template['recurring_id']}#{n}",
                group_id=group_id,
                description=template["description"],
                amount=template["amount"],
                currency=template["currency"],
                paid_by=template["paid_by"],
                split_between=list(template["split_between"]),
                expense_date=due.isoformat(),
                created_by=template["created_by"],
                recurring_id=template["recurring_id"],
            )
            try:
                _expenses().put_item(Item=record, ConditionExpression="attribute_not_exists(expense_id)")
                created += 1
            except ClientError as e:
                if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise
            n += 1

        if n != int(template.get("occurrences", 0)):
            _recurring().update_item(
                Key={"recurring_id": template["recurring_id"]},
                UpdateExpression="SET occurrences = :n",
                ConditionExpression="attribute_exists(recurring_id)",
                ExpressionAttributeValues={":n": n},
            )
    return created


def _serialize_recurring(item: dict) -> dict:
    start = date.fromisoformat(item["start_date"])
    n = int(item.get("occurrences", 0))
    next_due = _occurrence_date(start, item["frequency"], n)
    end_date = item.get("end_date")
    return {
        "recurring_id": item["recurring_id"],
        "group_id": item["group_id"],
        "description": item.get("description", ""),
        "amount": float(item["amount"]),
        "currency": item.get("currency", DEFAULT_CURRENCY),
        "paid_by": item["paid_by"],
        "split_between": list(item.get("split_between", [])),
        "frequency": item["frequency"],
        "start_date": item["start_date"],
        "end_date": end_date,
        "next_due": None if end_date and next_due.isoformat() > end_date else next_due.isoformat(),
        "created_by": item.get("created_by", ""),
        "created_at": item.get("created_at", ""),
    }


# ── balances ─────────────────────────────────────────────────────────────────

def split_amount(amount: Decimal, participants: list[str]) -> dict[str, Decimal]:
    """Split equally to the cent; leftover cents go to the first participants."""
    total_cents = int(_money(amount) / CENT)
    base, remainder = divmod(total_cents, len(participants))
    return {
        uid: Decimal(base + (1 if i < remainder else 0)) * CENT
        for i, uid in enumerate(participants)
    }


def compute_balances(expenses: list[dict]) -> dict[str, dict[str, Decimal]]:
    """Net balance per currency per user: positive = is owed, negative = owes."""
    balances: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    for e in expenses:
        amount = _money(e["amount"])
        per_currency = balances[e["currency"]]
        per_currency[e["paid_by"]] += amount
        for uid, share in split_amount(amount, e["split_between"]).items():
            per_currency[uid] -= share
    return balances


def settle_up(net: dict[str, Decimal]) -> list[dict]:
    """Greedy minimal-ish set of transfers that zeroes every balance."""
    creditors = sorted(((v, k) for k, v in net.items() if v > 0), reverse=True)
    debtors = sorted(((-v, k) for k, v in net.items() if v < 0), reverse=True)
    transfers = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        owed, debtor = debtors[i]
        due, creditor = creditors[j]
        paid = min(owed, due)
        transfers.append({"from": debtor, "to": creditor, "amount": paid})
        debtors[i] = (owed - paid, debtor)
        creditors[j] = (due - paid, creditor)
        if debtors[i][0] == 0:
            i += 1
        if creditors[j][0] == 0:
            j += 1
    return transfers


def get_balances(user_id: str, group_id: str) -> dict:
    _get_group_for_member(user_id, group_id)
    materialize_recurring(group_id)
    return _group_balances(group_id, _list_group_expenses(group_id))


def _group_balances(group_id: str, expenses: list[dict]) -> dict:
    result = {"group_id": group_id, "currencies": []}
    for currency, net in sorted(compute_balances(expenses).items()):
        result["currencies"].append({
            "currency": currency,
            "balances": [
                {"user_id": uid, "amount": float(amount)}
                for uid, amount in sorted(net.items())
            ],
            "settlements": [
                {**t, "amount": float(t["amount"])} for t in settle_up(net)
            ],
        })
    return result


def get_overview(user_id: str) -> dict:
    """Everything the Shared Costs page needs in one call."""
    groups = list_groups(user_id)
    all_expenses: list[dict] = []
    # Per counterpart per currency, from the current user's perspective:
    # positive = they owe you, negative = you owe them.
    with_people: dict[tuple[str, str], Decimal] = defaultdict(Decimal)

    for group in groups:
        materialize_recurring(group["group_id"])
        expenses = _list_group_expenses(group["group_id"])
        all_expenses.extend(expenses)

        totals: dict[str, Decimal] = defaultdict(Decimal)
        for e in expenses:
            totals[e["currency"]] += _money(e["amount"])
        group["totals"] = {c: float(v) for c, v in sorted(totals.items())}

        for currency, net in compute_balances(expenses).items():
            for t in settle_up(net):
                if t["to"] == user_id:
                    with_people[(t["from"], currency)] += t["amount"]
                elif t["from"] == user_id:
                    with_people[(t["to"], currency)] -= t["amount"]

    all_expenses.sort(key=lambda e: (e["date"], e["created_at"]), reverse=True)
    return {
        "groups": groups,
        "balances": [
            {"user_id": uid, "currency": currency, "amount": float(amount)}
            for (uid, currency), amount in sorted(with_people.items())
            if amount != 0
        ],
        "recent_expenses": all_expenses[:20],
    }
