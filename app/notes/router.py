import json
from typing import Annotated, Literal, Union

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.auth.dependencies import get_current_user
from app.notes.service import create_note, delete_note, list_notes, update_note

router = APIRouter()

# DynamoDB items max out at 400 KB; leave headroom for keys and attribute names.
MAX_NOTE_BYTES = 300_000


class TextBlock(BaseModel):
    type: Literal["text"]
    text: str = Field(default="", max_length=20_000)


class ListItem(BaseModel):
    text: str = Field(default="", max_length=500)
    checked: bool = False


class ListBlock(BaseModel):
    type: Literal["list"]
    checklist: bool = False
    items: list[ListItem] = Field(default_factory=list, max_length=200)


class TableBlock(BaseModel):
    type: Literal["table"]
    rows: list[list[Annotated[str, Field(max_length=500)]]] = Field(min_length=1, max_length=50)

    @field_validator("rows")
    @classmethod
    def rectangular(cls, rows: list[list[str]]) -> list[list[str]]:
        width = len(rows[0])
        if not 1 <= width <= 10:
            raise ValueError("A table needs 1 to 10 columns")
        if any(len(r) != width for r in rows):
            raise ValueError("Every table row must have the same number of columns")
        return rows


Block = Annotated[Union[TextBlock, ListBlock, TableBlock], Field(discriminator="type")]


def _fits(blocks: list[Block] | None) -> list[Block] | None:
    if blocks is not None:
        size = len(json.dumps([b.model_dump() for b in blocks], ensure_ascii=False).encode())
        if size > MAX_NOTE_BYTES:
            raise ValueError("Note is too large")
    return blocks


class NoteCreate(BaseModel):
    title: str = Field(default="", max_length=120)
    blocks: list[Block] = Field(default_factory=list, max_length=100)
    pinned: bool = False

    _blocks = field_validator("blocks")(_fits)


class NoteUpdate(BaseModel):
    """Omitted fields are unchanged."""

    title: str | None = Field(default=None, max_length=120)
    blocks: list[Block] | None = Field(default=None, max_length=100)
    pinned: bool | None = None

    _blocks = field_validator("blocks")(_fits)


def _dump(blocks: list[Block] | None) -> list[dict] | None:
    return None if blocks is None else [b.model_dump() for b in blocks]


@router.get("/api/notes")
def get_notes(user: dict = Depends(get_current_user)) -> list[dict]:
    return list_notes(user["user_id"])


@router.post("/api/notes", status_code=201)
def post_note(body: NoteCreate, user: dict = Depends(get_current_user)) -> dict:
    return create_note(user["user_id"], body.title, _dump(body.blocks), body.pinned)


@router.patch("/api/notes/{note_id}")
def patch_note(note_id: str, body: NoteUpdate, user: dict = Depends(get_current_user)) -> dict:
    try:
        return update_note(user["user_id"], note_id, body.title, _dump(body.blocks), body.pinned)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/api/notes/{note_id}", status_code=204)
def delete_note_endpoint(note_id: str, user: dict = Depends(get_current_user)) -> None:
    try:
        delete_note(user["user_id"], note_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
