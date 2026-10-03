from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from app.briefing.service import create_briefing, create_briefing_audio

router = APIRouter()


@router.get("/api/briefing")
def get_briefing_json() -> dict:
    return create_briefing()


@router.get("/api/briefing/audio")
def get_briefing_audio() -> StreamingResponse:
    return create_briefing_audio()
