"""VitPlotter FastAPI application.

Provides:
- POST /api/upload  accept a CSV file and return parsed plot data
- GET  /api/health  health check
- If frontend/dist exists (production build), serve it as a static site for single-port deployment
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .csv_parser import CsvParseError, parse_csv

app = FastAPI(title="VitPlotter", description="Web-based plotting utility", version="0.1.0")

# Dev: the Vite dev server runs on 5173; allow it to call the backend cross-origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB cap to avoid huge files overwhelming the server


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


# Production: if the frontend has been built, serve it at the root path
# (in dev this directory does not exist, so this is skipped).
_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="frontend")
