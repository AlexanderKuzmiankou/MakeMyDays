from typing import Any, LiteralString

import anthropic
import boto3
import io
from dotenv import load_dotenv
from fastapi.responses import StreamingResponse

from app.config import load_config
from app.notifications.telegram_bot import send_briefing

load_dotenv()

def create_briefing() -> dict:
    """
    Get the briefing as a JSON response, based on the user's calendar events and tasks for today.
    The briefing is generated using the Claude API and sent to the user via Telegram.
    """
    # TODO: build from the user's own tasks and events (app.planner); the Google
    # Calendar/Tasks source was removed. format_context still expects the old shape.
    #briefing = generate_briefing(events, tasks)
    #send_briefing(briefing)
    return {"briefing": "briefing text"}  # Placeholder for testing


def generate_briefing(events: list, tasks: list) -> str | Any:
    """
    Generate a morning briefing based on calendar events and tasks.
    """
    config = load_config()

    client = anthropic.Anthropic(api_key=config["anthropic_api_key"])

    context = format_context(events, tasks)

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system="""You are a personal morning assistant. Your job is to give the user
        a brief, encouraging morning briefing based on their calendar and tasks.
        Be warm but concise. No bullet points — write in natural flowing sentences.
        End with one short motivational thought.""",
        messages=[
            {
                "role": "user",
                "content": f"Here is my context for today:\n{context}\n\n\
                Please give me my morning briefing."
            }
        ]
    )
    return message.content[0].text # type: ignore


def format_context(events: list, tasks: list) -> LiteralString:
    """
    Format the context for the briefing based on calendar events and tasks.
    """
    lines = []
    if events:
        lines.append("Calendar events for today:")
        for event in events:
            start = event["start"].get("dateTime", event["start"].get("date"))
            summary = event.get("summary", "Untitled event")
            lines.append(f"- {start}: {summary}")
    else:
        lines.append("No calendar events scheduled for today.")

    lines.append("")

    if tasks:
        lines.append("Pending tasks:")
        for task in tasks:
            due = f" (due: {task['due'][:10]})" if task['due'] else ""
            lines.append(f"  - [{task['tasklist']}] {task['title']}{due}")
    else:
        lines.append("No pending tasks.")

    return "\n".join(lines)

def create_briefing_audio() -> StreamingResponse:
    """
    Create a briefing audio response.
    This function generates the briefing text and converts it to audio using Amazon Polly.
    The audio is then returned as a StreamingResponse.
    """
    briefing_dict = create_briefing()
    briefing_text = briefing_dict.get("briefing", "")
    audio_bytes = generate_audio(briefing_text)
    return StreamingResponse(
        io.BytesIO(audio_bytes),
        media_type="audio/mpeg",
        headers={"Content-Disposition": "inline; filename=briefing.mp3"}
    )

def generate_audio(text: str) -> bytes:
    """
    Generate audio from text using Amazon Polly.
    """
    client = boto3.client("polly", region_name="eu-central-1")

    # Truncate to 2500 chars to stay within Polly's limit
    # and keep briefings concise for audio
    truncated = text[:2500]

    response = client.synthesize_speech(
        Text=truncated,
        OutputFormat="mp3",
        VoiceId="Joanna",
        Engine="neural"
    )

    audio_stream = response["AudioStream"]
    return audio_stream.read()
