"""VitPlotter FastAPI application.

Provides:
- POST /api/upload         accept a CSV file and return parsed plot data
- GET  /api/health         health check
- POST /api/stream/start   start a UDP JSON listener
- POST /api/stream/stop    stop the UDP listener
- GET  /api/stream/status  current listener status
- WS   /api/stream/ws      live stream of parsed points
- If frontend/dist exists (production build), serve it as a static site for single-port deployment
"""

from __future__ import annotations

import os
from contextlib import ExitStack
from importlib import resources
from pathlib import Path

from fastapi import (
    FastAPI,
    File,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .csv_parser import CsvParseError, parse_csv
from .udp_stream import manager

app = FastAPI(title="VitPlotter", description="Web-based plotting utility", version="0.1.0")

# Dev: the Vite dev server runs on 5173; allow it to call the backend cross-origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB cap to avoid huge files overwhelming the server
_STATIC_STACK = ExitStack()


def _package_dist() -> Path | None:
    """Return the packaged frontend dist directory if the wheel bundles one."""
    try:
        static_ref = resources.files("vitplotter").joinpath("frontend-dist")
    except (ModuleNotFoundError, AttributeError):  # package not installed yet
        return None
    if not static_ref.is_dir():
        return None
    try:
        static_path = _STATIC_STACK.enter_context(resources.as_file(static_ref))
    except (FileNotFoundError, TypeError):
        return None
    path = Path(static_path)
    return path if (path / "index.html").is_file() else None


def _frontend_dist() -> Path | None:
    env_dist = os.environ.get("VITPLOTTER_DIST_DIR")
    if env_dist:
        candidate = Path(env_dist).expanduser()
        if (candidate / "index.html").is_file():
            return candidate

    packaged = _package_dist()
    if packaged is not None:
        return packaged

    repo_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
    if (repo_dist / "index.html").is_file():
        return repo_dist
    return None


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)) -> dict:
    filename = file.filename or "upload.csv"
    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported.")

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (50 MB limit).")

    try:
        result = parse_csv(contents)
    except CsvParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    result["filename"] = filename
    return result


# --------------------------------------------------------------------------- #
# Live UDP streaming
# --------------------------------------------------------------------------- #
class StreamStartRequest(BaseModel):
    host: str = "0.0.0.0"
    port: int
    timestamp_field: str | None = None


@app.post("/api/stream/start")
async def stream_start(req: StreamStartRequest) -> dict:
    if not (1 <= req.port <= 65535):
        raise HTTPException(status_code=400, detail="Port must be between 1 and 65535.")
    try:
        await manager.start(req.host, req.port, req.timestamp_field)
    except OSError as exc:
        # e.g. address already in use, or permission denied on a privileged port
        raise HTTPException(
            status_code=400, detail=f"Could not bind {req.host}:{req.port} — {exc}"
        ) from exc
    return manager.status()


@app.post("/api/stream/stop")
async def stream_stop() -> dict:
    await manager.stop()
    return manager.status()


@app.get("/api/stream/status")
def stream_status() -> dict:
    return manager.status()


@app.websocket("/api/stream/ws")
async def stream_ws(ws: WebSocket) -> None:
    await ws.accept()
    queue = manager.subscribe()
    try:
        # Initial frame lets the client render current state immediately.
        await ws.send_json({"type": "status", "status": manager.status()})
        while True:
            point = await queue.get()
            await ws.send_json({"type": "point", **point})
    except WebSocketDisconnect:
        pass
    except Exception:  # pragma: no cover - send failures, client gone, etc.
        pass
    finally:
        manager.unsubscribe(queue)


# Production: if the frontend has been built, serve it at the root path
# (in dev this directory does not exist, so this is skipped).
_dist = _frontend_dist()
if _dist is not None:
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="frontend")
