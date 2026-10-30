import calendar
import uuid
from collections import defaultdict
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from dateutil.relativedelta import relativedelta

# Partition key user_id + sort key item_id. A user's whole budget lives in their
# own partition, so it loads in a single query and ownership is enforced by the
# key itself. The item_id prefix tells the record types apart:
#   SETTINGS        currency; its existence means default categories were seeded
#   CAT#<id>        spending / income category
#   TX#<id>         transaction (TX#<recurring id>#<n> when generated from a template)
#   REC#<id>        recurring income or expense template
#   CAP#<period>    budget cap for "YYYY-MM", "YYYY", or the defaults "monthly" / "yearly"
TABLE_NAME = "makemydays-user-budget"

DEFAULT_CURRENCY = "EUR"
KINDS = ("expense", "income")
FREQUENCIES = {
    "weekly": relativedelta(weeks=1),
    "biweekly": relativedelta(weeks=2),
    "monthly": relativedelta(months=1),
    "quarterly": relativedelta(months=3),
    "yearly": relativedelta(years=1),
}
DEFAULT_CAP_PERIODS = ("monthly", "yearly")

# Seeded on first use; colours follow the frontend's categorical palette order.
DEFAULT_CATEGORIES = [
    ("Housing", "expense", "#2a78d6"),
    ("Food & groceries", "expense", "#eb6834"),
    ("Transport", "expense", "#1baf7a"),
    ("Utilities", "expense", "#eda100"),
    ("Health", "expense", "#e87ba4"),
    ("Entertainment", "expense", "#008300"),
    ("Shopping", "expense", "#6250d6"),
    ("Other", "expense", "#e34948"),
    ("Salary", "income", "#2a78d6"),
    ("Other income", "income", "#eb6834"),
]

CENT = Decimal("0.01")

_dynamodb = None


def _table():
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb", region_name="eu-central-1")
    return _dynamodb.Table(TABLE_NAME)


def _money(value) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def _key(user_id: str, item_id: str) -> dict:
    return {"user_id": user_id, "item_id": item_id}


def _query(user_id: str, prefix: str = "") -> list[dict]:
    condition = Key("user_id").eq(user_id)
    if prefix:
        condition = condition & Key("item_id").begins_with(prefix)
    kwargs = {"KeyConditionExpression": condition}
    items: list[dict] = []
    while True:
        response = _table().query(**kwargs)
        items.extend(response.get("Items", []))
        if "LastEvaluatedKey" not in response:
            return items
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]


def _get(user_id: str, item_id: str) -> dict | None:
    return _table().get_item(Key=_key(user_id, item_id)).get("Item")


def _set_fields(user_id: str, item_id: str, updates: dict) -> None:
    # "name" and "date" are DynamoDB reserved words, so alias every attribute.
    _table().update_item(
        Key=_key(user_id, item_id),
        UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in updates),
        ConditionExpression="attribute_exists(item_id)",
        ExpressionAttributeNames={f"#{k}": k for k in updates},
        ExpressionAttributeValues={f":{k}": v for k, v in updates.items()},
    )


def _strip(item_id: str, prefix: str) -> str:
    return item_id[len(prefix):]


# ── settings ─────────────────────────────────────────────────────────────────

def _ensure_setup(user_id: str) -> dict:
    """Return the settings record, seeding default categories on first use."""
    settings = _get(user_id, "SETTINGS")
    if settings:
        return settings
    settings = {"user_id": user_id, "item_id": "SETTINGS", "currency": DEFAULT_CURRENCY,
                "created_at": date.today().isoformat()}
    try:
        _table().put_item(Item=settings, ConditionExpression="attribute_not_exists(item_id)")
    except ClientError as e:
        if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        return _get(user_id, "SETTINGS")  # a concurrent request seeded already
    for name, kind, color in DEFAULT_CATEGORIES:
        _put_category(user_id, name, kind, color)
    return settings


def get_settings(user_id: str) -> dict:
    return _serialize_settings(_ensure_setup(user_id))


def update_settings(user_id: str, currency: str | None = None) -> dict:
    settings = _ensure_setup(user_id)
    if currency is not None:
        _set_fields(user_id, "SETTINGS", {"currency": currency})
        settings["currency"] = currency
    return _serialize_settings(settings)


def _serialize_settings(item: dict) -> dict:
    return {"currency": item.get("currency", DEFAULT_CURRENCY)}


# ── categories ───────────────────────────────────────────────────────────────

def _put_category(user_id: str, name: str, kind: str, color: str) -> dict:
    record = {
        "user_id": user_id,
        "item_id": f"CAT#{uuid.uuid4()}",
        "name": name.strip(),
        "kind": kind,
        "color": color,
        "created_at": date.today().isoformat(),
    }
    _table().put_item(Item=record)
    return record


def list_categories(user_id: str) -> list[dict]:
    _ensure_setup(user_id)
    return _sorted_categories(_query(user_id, "CAT#"))


def _sorted_categories(items: list[dict]) -> list[dict]:
    categories = [_serialize_category(i) for i in items]
    categories.sort(key=lambda c: (KINDS.index(c["kind"]), c["created_at"], c["name"].lower()))
    return categories


def create_category(user_id: str, name: str, kind: str, color: str) -> dict:
    _ensure_setup(user_id)
    if kind not in KINDS:
        raise LookupError(f"Kind must be one of: {', '.join(KINDS)}")
    return _serialize_category(_put_category(user_id, name, kind, color))


def update_category(user_id: str, category_id: str, name: str | None = None, color: str | None = None) -> dict:
    """The kind is fixed: changing it would silently move existing transactions."""
    item = _get(user_id, f"CAT#{category_id}")
    if not item:
        raise ValueError(f"Category {category_id} not found")
    updates = {}
    if name is not None and name.strip():
        updates["name"] = name.strip()
    if color is not None:
        updates["color"] = color
    if updates:
        _set_fields(user_id, item["item_id"], updates)
        item.update(updates)
    return _serialize_category(item)


def delete_category(user_id: str, category_id: str) -> None:
    """Transactions keep their category id and show up as uncategorized."""
    if not _get(user_id, f"CAT#{category_id}"):
        raise ValueError(f"Category {category_id} not found")
    _table().delete_item(Key=_key(user_id, f"CAT#{category_id}"))


def _serialize_category(item: dict) -> dict:
    return {
        "category_id": _strip(item["item_id"], "CAT#"),
        "name": item["name"],
        "kind": item["kind"],
        "color": item.get("color", "#2a78d6"),
        "created_at": item.get("created_at", ""),
    }


def _check_category(user_id: str, category_id: str | None, kind: str) -> None:
    if not category_id:
        return
    item = _get(user_id, f"CAT#{category_id}")
    if not item:
        raise LookupError("Unknown category")
    if item["kind"] != kind:
        raise LookupError(f"That is an {item['kind']} category, not an {kind} one")


# ── transactions ─────────────────────────────────────────────────────────────

def _period_bounds(year: int, month: int | None = None) -> tuple[str, str]:
    if month is None:
        return f"{year:04d}-01-01", f"{year:04d}-12-31"
    last = calendar.monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last:02d}"


def list_transactions(user_id: str, year: int | None = None, month: int | None = None) -> list[dict]:
    materialize_recurring(user_id)
    items = _query(user_id, "TX#")
    if year is not None:
        start, end = _period_bounds(year, month)
        items = [i for i in items if start <= i["date"] <= end]
    return _sorted_transactions(items)


def _sorted_transactions(items: list[dict]) -> list[dict]:
    transactions = [_serialize_transaction(i) for i in items]
    transactions.sort(key=lambda t: (t["date"], t["created_at"]), reverse=True)
    return transactions


def create_transaction(
    user_id: str,
    kind: str,
    amount: float,
    description: str = "",
    category_id: str | None = None,
    transaction_date: str | None = None,
) -> dict:
    if kind not in KINDS:
        raise LookupError(f"Kind must be one of: {', '.join(KINDS)}")
    _check_category(user_id, category_id, kind)
    record = _transaction_record(
        user_id=user_id,
        transaction_id=str(uuid.uuid4()),
        kind=kind,
        amount=amount,
        description=description,
        category_id=category_id,
        transaction_date=transaction_date or date.today().isoformat(),
    )
    _table().put_item(Item=record)
    return _serialize_transaction(record)


def update_transaction(
    user_id: str,
    transaction_id: str,
    amount: float | None = None,
    description: str | None = None,
    category_id: str | None = None,
    transaction_date: str | None = None,
    clear_category: bool = False,
) -> dict:
    """Fields left as None are unchanged. Editing an occurrence of a recurring
    transaction changes only that occurrence."""
    item = _get(user_id, f"TX#{transaction_id}")
    if not item:
        raise ValueError(f"Transaction {transaction_id} not found")
    if category_id is not None:
        _check_category(user_id, category_id, item["kind"])

    record = _transaction_record(
        user_id=user_id,
        transaction_id=transaction_id,
        kind=item["kind"],
        amount=amount if amount is not None else item["amount"],
        description=description if description is not None else item.get("description", ""),
        category_id=None if clear_category else (category_id or item.get("category_id")),
        transaction_date=transaction_date or item["date"],
        recurring_id=item.get("recurring_id"),
    )
    record["created_at"] = item.get("created_at", record["created_at"])
    _table().put_item(Item=record)
    return _serialize_transaction(record)


def delete_transaction(user_id: str, transaction_id: str) -> None:
    """Deleting a generated occurrence is final: the template has moved past it."""
    if not _get(user_id, f"TX#{transaction_id}"):
        raise ValueError(f"Transaction {transaction_id} not found")
    _table().delete_item(Key=_key(user_id, f"TX#{transaction_id}"))


def _transaction_record(
    user_id: str,
    transaction_id: str,
    kind: str,
    amount,
    description: str,
    category_id: str | None,
    transaction_date: str,
    recurring_id: str | None = None,
) -> dict:
    record = {
        "user_id": user_id,
        "item_id": f"TX#{transaction_id}",
        "kind": kind,
        "amount": _money(amount),
        "description": description.strip(),
        "date": transaction_date,
        "created_at": date.today().isoformat(),
    }
    if category_id:
        record["category_id"] = category_id
    if recurring_id:
        record["recurring_id"] = recurring_id
    return record


def _serialize_transaction(item: dict) -> dict:
    return {
        "transaction_id": _strip(item["item_id"], "TX#"),
        "kind": item["kind"],
        "amount": float(item["amount"]),
        "description": item.get("description", ""),
        "category_id": item.get("category_id"),
        "date": item["date"],
        "recurring_id": item.get("recurring_id"),
        "created_at": item.get("created_at", ""),
    }


# ── recurring income and expenses ────────────────────────────────────────────
# Same model as shared costs: a template whose occurrences are generated lazily
# whenever the budget is read, so no scheduler is needed. Occurrence n is always
# start_date + n * frequency, which avoids month-end drift.

def _occurrence_date(start: date, frequency: str, n: int) -> date:
    step = FREQUENCIES[frequency]
    return start + relativedelta(years=step.years * n, months=step.months * n, days=step.days * n)


def list_recurring(user_id: str) -> list[dict]:
    return _sorted_recurring(_query(user_id, "REC#"))


def _sorted_recurring(items: list[dict]) -> list[dict]:
    recurring = [_serialize_recurring(i) for i in items]
    recurring.sort(key=lambda r: (KINDS.index(r["kind"]), r["created_at"], r["description"].lower()))
    return recurring


def create_recurring(
    user_id: str,
    kind: str,
    amount: float,
    frequency: str,
    start_date: str,
    description: str = "",
    category_id: str | None = None,
    end_date: str | None = None,
) -> dict:
    if kind not in KINDS:
        raise LookupError(f"Kind must be one of: {', '.join(KINDS)}")
    if frequency not in FREQUENCIES:
        raise LookupError(f"Frequency must be one of: {', '.join(FREQUENCIES)}")
    if end_date and end_date < start_date:
        raise LookupError("End date must not be before the start date")
    _check_category(user_id, category_id, kind)

    recurring_id = str(uuid.uuid4())
    record = {
        "user_id": user_id,
        "item_id": f"REC#{recurring_id}",
        "kind": kind,
        "amount": _money(amount),
        "description": description.strip(),
        "frequency": frequency,
        "start_date": start_date,
        "occurrences": 0,
        "created_at": date.today().isoformat(),
    }
    if category_id:
        record["category_id"] = category_id
    if end_date:
        record["end_date"] = end_date
    _table().put_item(Item=record)
    materialize_recurring(user_id)
    return _serialize_recurring(_get(user_id, record["item_id"]) or record)


def update_recurring(
    user_id: str,
    recurring_id: str,
    amount: float | None = None,
    description: str | None = None,
    category_id: str | None = None,
    end_date: str | None = None,
    clear_end_date: bool = False,
    clear_category: bool = False,
) -> dict:
    """Changes apply to future occurrences; already generated ones are kept."""
    item = _get(user_id, f"REC#{recurring_id}")
    if not item:
        raise ValueError(f"Recurring transaction {recurring_id} not found")
    if category_id is not None:
        _check_category(user_id, category_id, item["kind"])
    if end_date and end_date < item["start_date"]:
        raise LookupError("End date must not be before the start date")

    updates: dict = {}
    if amount is not None:
        updates["amount"] = _money(amount)
    if description is not None:
        updates["description"] = description.strip()
    if category_id is not None:
        updates["category_id"] = category_id
    if end_date is not None:
        updates["end_date"] = end_date
    if updates:
        _set_fields(user_id, item["item_id"], updates)
        item.update(updates)
    removals = [a for a, clear in (("end_date", clear_end_date), ("category_id", clear_category)) if clear and a in item]
    if removals:
        _table().update_item(Key=_key(user_id, item["item_id"]), UpdateExpression="REMOVE " + ", ".join(removals))
        for a in removals:
            del item[a]
    materialize_recurring(user_id)
    return _serialize_recurring(_get(user_id, item["item_id"]) or item)


def delete_recurring(user_id: str, recurring_id: str) -> None:
    """Stops future occurrences. Already generated transactions are kept."""
    if not _get(user_id, f"REC#{recurring_id}"):
        raise ValueError(f"Recurring transaction {recurring_id} not found")
    _table().delete_item(Key=_key(user_id, f"REC#{recurring_id}"))


def materialize_recurring(user_id: str, today: date | None = None) -> int:
    """Create transactions for every recurring occurrence due up to today.

    Occurrence ids are deterministic ("<recurring_id>#<n>") and written with a
    condition, so concurrent requests can never double-book an occurrence.
    """
    today = today or date.today()
    created = 0
    for template in _query(user_id, "REC#"):
        recurring_id = _strip(template["item_id"], "REC#")
        start = date.fromisoformat(template["start_date"])
        end = date.fromisoformat(template["end_date"]) if template.get("end_date") else None
        n = int(template.get("occurrences", 0))
        first = n

        while True:
            due = _occurrence_date(start, template["frequency"], n)
            if due > today or (end and due > end):
                break
            record = _transaction_record(
                user_id=user_id,
                transaction_id=f"{recurring_id}#{n}",
                kind=template["kind"],
                amount=template["amount"],
                description=template.get("description", ""),
                category_id=template.get("category_id"),
                transaction_date=due.isoformat(),
                recurring_id=recurring_id,
            )
            try:
                _table().put_item(Item=record, ConditionExpression="attribute_not_exists(item_id)")
                created += 1
            except ClientError as e:
                if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise
            n += 1

        if n != first:
            try:
                _set_fields(user_id, template["item_id"], {"occurrences": n})
            except ClientError as e:
                # Template deleted mid-way: its occurrences are kept, nothing to advance.
                if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise
    return created


def _upcoming(template: dict, after: date, until: date) -> list[date]:
    """Occurrences of a template in (after, until] that are not generated yet."""
    start = date.fromisoformat(template["start_date"])
    end = date.fromisoformat(template["end_date"]) if template.get("end_date") else None
    n = int(template.get("occurrences", 0))
    dates = []
    while True:
        due = _occurrence_date(start, template["frequency"], n)
        if due > until or (end and due > end):
            return dates
        if due > after:
            dates.append(due)
        n += 1


def _serialize_recurring(item: dict) -> dict:
    start = date.fromisoformat(item["start_date"])
    next_due = _occurrence_date(start, item["frequency"], int(item.get("occurrences", 0)))
    end_date = item.get("end_date")
    return {
        "recurring_id": _strip(item["item_id"], "REC#"),
        "kind": item["kind"],
        "amount": float(item["amount"]),
        "description": item.get("description", ""),
        "category_id": item.get("category_id"),
        "frequency": item["frequency"],
        "start_date": item["start_date"],
        "end_date": end_date,
        "next_due": None if end_date and next_due.isoformat() > end_date else next_due.isoformat(),
        "created_at": item.get("created_at", ""),
    }


# ── caps ─────────────────────────────────────────────────────────────────────
# A cap limits spending for a period: an optional overall total plus optional
# per-category limits. A specific month or year overrides the matching default
# ("monthly" / "yearly"). With neither, a year's cap is the sum of its twelve
# monthly caps, as long as every month has one.

def list_caps(user_id: str) -> list[dict]:
    return sorted((_serialize_cap(i) for i in _query(user_id, "CAP#")), key=lambda c: c["period"])


def set_cap(user_id: str, period: str, total: float | None, categories: dict[str, float]) -> dict:
    if total is None and not categories:
        raise LookupError("Set an overall cap or at least one category cap")
    if categories:
        known = {_strip(i["item_id"], "CAT#"): i["kind"] for i in _query(user_id, "CAT#")}
        for category_id in categories:
            if known.get(category_id) != "expense":
                raise LookupError("Caps can only be set on expense categories")
    record = {
        "user_id": user_id,
        "item_id": f"CAP#{period}",
        "categories": {k: _money(v) for k, v in categories.items()},
        "updated_at": date.today().isoformat(),
    }
    if total is not None:
        record["total"] = _money(total)
    _table().put_item(Item=record)
    return _serialize_cap(record)


def delete_cap(user_id: str, period: str) -> None:
    if not _get(user_id, f"CAP#{period}"):
        raise ValueError(f"No cap set for {period}")
    _table().delete_item(Key=_key(user_id, f"CAP#{period}"))


def _serialize_cap(item: dict) -> dict:
    return {
        "period": _strip(item["item_id"], "CAP#"),
        "total": float(item["total"]) if item.get("total") is not None else None,
        "categories": {k: float(v) for k, v in item.get("categories", {}).items()},
    }


def effective_cap(caps: dict[str, dict], year: int, month: int | None = None) -> dict:
    """The cap in force for a period, with where it came from."""
    if month is not None:
        for period, source in ((f"{year:04d}-{month:02d}", "month"), ("monthly", "default")):
            if period in caps:
                return {**caps[period], "source": source}
        return {"total": None, "categories": {}, "source": None}

    for period, source in ((f"{year:04d}", "year"), ("yearly", "default")):
        if period in caps:
            return {**caps[period], "source": source}

    months = [effective_cap(caps, year, m) for m in range(1, 13)]
    total = sum(m["total"] for m in months) if all(m["total"] is not None for m in months) else None
    shared = set.intersection(*(set(m["categories"]) for m in months))
    categories = {c: sum(m["categories"][c] for m in months) for c in sorted(shared)}
    if total is None and not categories:
        return {"total": None, "categories": {}, "source": None}
    return {"total": total, "categories": categories, "source": "months"}


# ── summary ──────────────────────────────────────────────────────────────────

def _totals(transactions: list[dict]) -> dict[str, Decimal]:
    totals = {k: Decimal(0) for k in KINDS}
    for t in transactions:
        totals[t["kind"]] += _money(t["amount"])
    return totals


def build_summary(
    transactions: list[dict],
    templates: list[dict],
    categories: list[dict],
    caps: dict[str, dict],
    year: int,
    month: int | None = None,
    today: date | None = None,
) -> dict:
    """Totals, per-category breakdown and chart series for one month or year.

    `transactions` are serialized and may span any dates; only the period's are
    counted. "Projected" amounts are recurring occurrences still to come in the
    period, so the chart can show where the budget is heading.
    """
    today = today or date.today()
    start, end = _period_bounds(year, month)
    in_period = [t for t in transactions if start <= t["date"] <= end]

    upcoming: list[dict] = []
    period_end = date.fromisoformat(end)
    if period_end > today:
        after = max(today, date.fromisoformat(start) - relativedelta(days=1))
        for template in templates:
            for due in _upcoming(template, after, period_end):
                upcoming.append({"kind": template["kind"], "amount": template["amount"],
                                 "category_id": template.get("category_id"), "date": due.isoformat()})

    totals = _totals(in_period)
    projected = _totals(upcoming)
    cap = effective_cap(caps, year, month)

    # Per category: actual + still-to-come recurring, with the category cap.
    # Transactions whose category is unset or deleted group as "Uncategorized".
    known = {c["category_id"] for c in categories}
    actual: dict = defaultdict(Decimal)
    planned: dict = defaultdict(Decimal)
    for bucket, rows in ((actual, in_period), (planned, upcoming)):
        for t in rows:
            cid = t.get("category_id")
            bucket[cid if cid in known else (None, t["kind"])] += _money(t["amount"])

    def row(key, name, kind, color, limit=None):
        return {"category_id": key if isinstance(key, str) else None, "name": name, "kind": kind,
                "color": color, "amount": float(actual.get(key, 0)),
                "projected": float(planned.get(key, 0)), "cap": limit}

    breakdown = []
    for c in categories:
        cid = c["category_id"]
        limit = cap["categories"].get(cid)
        if cid in actual or cid in planned or limit is not None:
            breakdown.append(row(cid, c["name"], c["kind"], c["color"], limit))
    for kind in KINDS:
        if (None, kind) in actual or (None, kind) in planned:
            breakdown.append(row((None, kind), "Uncategorized", kind, None))
    breakdown.sort(key=lambda b: (KINDS.index(b["kind"]), -(b["amount"] + b["projected"])))

    if month is None:
        series = []
        for m in range(1, 13):
            prefix = f"{year:04d}-{m:02d}"
            got = _totals([t for t in in_period if t["date"].startswith(prefix)])
            ahead = _totals([t for t in upcoming if t["date"].startswith(prefix)])
            series.append({
                "period": prefix,
                "income": float(got["income"]), "expenses": float(got["expense"]),
                "projected_income": float(ahead["income"]), "projected_expenses": float(ahead["expense"]),
                "cap": effective_cap(caps, year, m)["total"],
            })
    else:
        series = []
        running = Decimal(0)
        for d in range(1, calendar.monthrange(year, month)[1] + 1):
            day = f"{year:04d}-{month:02d}-{d:02d}"
            got = _totals([t for t in in_period if t["date"] == day])
            ahead = _totals([t for t in upcoming if t["date"] == day])
            running += got["expense"] + ahead["expense"]
            series.append({
                "date": day,
                "income": float(got["income"]), "expenses": float(got["expense"]),
                "projected_income": float(ahead["income"]), "projected_expenses": float(ahead["expense"]),
                "cumulative_expenses": float(running),
            })

    return {
        "period": f"{year:04d}" if month is None else f"{year:04d}-{month:02d}",
        "income": float(totals["income"]),
        "expenses": float(totals["expense"]),
        "balance": float(totals["income"] - totals["expense"]),
        "projected_income": float(projected["income"]),
        "projected_expenses": float(projected["expense"]),
        "cap": cap,
        "categories": breakdown,
        "series": series,
    }


def get_overview(user_id: str, year: int, month: int | None = None) -> dict:
    """Everything the Budget page needs for one period, from a single query."""
    settings = _ensure_setup(user_id)
    materialize_recurring(user_id)
    items = _query(user_id)
    by_type: dict[str, list[dict]] = defaultdict(list)
    for i in items:
        by_type[i["item_id"].split("#", 1)[0]].append(i)

    categories = _sorted_categories(by_type["CAT"])
    caps = {c["period"]: c for c in (_serialize_cap(i) for i in by_type["CAP"])}
    transactions = _sorted_transactions(by_type["TX"])
    start, end = _period_bounds(year, month)

    return {
        "settings": _serialize_settings(settings),
        "categories": categories,
        "recurring": _sorted_recurring(by_type["REC"]),
        "caps": sorted(caps.values(), key=lambda c: c["period"]),
        "summary": build_summary(transactions, by_type["REC"], categories, caps, year, month),
        "transactions": [t for t in transactions if start <= t["date"] <= end],
    }
