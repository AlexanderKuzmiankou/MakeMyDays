from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from prometheus_fastapi_instrumentator import Instrumentator

from app.auth.router import router as auth_router
from app.briefing.router import router as briefing_router
from app.habits.router import router as habits_router
from app.planner.router import router as planner_router
from app.shared_costs.router import router as shared_costs_router
from app.shopping.router import router as shopping_router

app = FastAPI()

Instrumentator().instrument(app).expose(app)

app.include_router(auth_router)
app.include_router(briefing_router)
app.include_router(habits_router)
app.include_router(planner_router)
app.include_router(shared_costs_router)
app.include_router(shopping_router)

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if (FRONTEND_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


@app.get("/health")
def health() -> dict[str, str]:
    """
    Health check endpoint.
    """
    return {"status": "ok"}


@app.get("/{full_path:path}")
def serve_frontend(full_path: str) -> FileResponse:
    """
    Serve the React SPA build. Any path not matched by an API route above
    (e.g. /habits, /shopping) falls back to index.html so client-side
    routing can take over.
    """
    index_file = FRONTEND_DIST / "index.html"
    if not index_file.is_file():
        raise HTTPException(status_code=404, detail="Frontend build not found. Run `npm run build` in /frontend.")
    return FileResponse(index_file)
