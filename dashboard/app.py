from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.responses import JSONResponse

from services import discovery, status, control, log_streamer
from services.log_streamer import VALID_LOG_TYPES

DASHBOARD_DIR = Path(__file__).parent
templates = Jinja2Templates(directory=str(DASHBOARD_DIR / "templates"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(title="Hermes Agents Dashboard", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(DASHBOARD_DIR / "static")), name="static")


# ── Pages ──────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Main dashboard page."""
    profiles = discovery.list_profiles()
    agents = [status.get_status(p) for p in profiles]
    return templates.TemplateResponse(request, "index.html", {
        "agents": agents,
        "log_types": VALID_LOG_TYPES,
    })


@app.get("/api/agents")
async def list_agents(request: Request):
    """GET all agents with status (for HTMX polling refresh)."""
    profiles = discovery.list_profiles()
    agents = [status.get_status(p) for p in profiles]
    return templates.TemplateResponse(request, "agent_cards.html", {
        "agents": agents,
        "log_types": VALID_LOG_TYPES,
    })


# ── Agent Control ─────────────────────────────────────────────────────────

@app.post("/api/agents/{profile_name}/start")
async def start_agent(profile_name: str):
    profiles = discovery.list_profiles()
    if profile_name not in profiles:
        return JSONResponse({"error": "Profile not found"}, status_code=404)
    result = control.start(profile_name)
    return JSONResponse(result)


@app.post("/api/agents/{profile_name}/stop")
async def stop_agent(profile_name: str):
    profiles = discovery.list_profiles()
    if profile_name not in profiles:
        return JSONResponse({"error": "Profile not found"}, status_code=404)
    result = control.stop(profile_name)
    return JSONResponse(result)


@app.post("/api/agents/{profile_name}/restart")
async def restart_agent(profile_name: str):
    profiles = discovery.list_profiles()
    if profile_name not in profiles:
        return JSONResponse({"error": "Profile not found"}, status_code=404)
    result = control.restart(profile_name)
    return JSONResponse(result)


@app.post("/api/agents/{profile_name}/open-terminal")
async def open_terminal(profile_name: str):
    profiles = discovery.list_profiles()
    if profile_name not in profiles:
        return JSONResponse({"error": "Profile not found"}, status_code=404)
    result = control.open_terminal(profile_name)
    return JSONResponse(result)


# ── Log Endpoints ──────────────────────────────────────────────────────────

@app.get("/api/logs/{profile_name}/recent")
async def get_recent_logs(profile_name: str, log_type: str = "gateway.log"):
    profiles = discovery.list_profiles()
    if profile_name not in profiles:
        return JSONResponse({"error": "Profile not found"}, status_code=404)
    if log_type not in VALID_LOG_TYPES:
        return JSONResponse({"error": "Invalid log type"}, status_code=400)
    lines = log_streamer.get_recent_lines(profile_name, log_type)
    return JSONResponse({"lines": lines})


@app.get("/api/logs/{profile_name}/stream")
async def stream_logs(profile_name: str, log_type: str = "gateway.log"):
    """SSE endpoint for live log streaming."""
    profiles = discovery.list_profiles()
    if profile_name not in profiles:
        return JSONResponse({"error": "Profile not found"}, status_code=404)
    if log_type not in VALID_LOG_TYPES:
        return JSONResponse({"error": "Invalid log type"}, status_code=400)

    return StreamingResponse(
        log_streamer.stream_new_lines(profile_name, log_type),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
