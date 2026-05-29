# VitPlotter

A minimal, web-based plotting tool built with a **Python backend + a modern frontend**,
inspired by [PlotJuggler](https://github.com/facontidavide/PlotJuggler).

Initial version: upload or drag-and-drop a CSV file and plot its data as interactive curves.

- **Backend** — FastAPI + pandas (CSV parsing)
- **Frontend** — Vue 3 + Vite + [uPlot](https://github.com/leeoniya/uPlot) (high-performance time-series charts)
- **Theme** — Catppuccin Latte (light) / Mocha (dark), with a toggle that follows your system preference

Convention: the **first column is the X axis** (falls back to a row index if it isn't numeric);
every remaining column becomes a toggleable Y series.

## Quick start

The `run.py` task runner (stdlib only, no extra deps) drives the whole project:

```bash
python run.py setup     # install backend + frontend dependencies
python run.py dev       # run backend (reload) + Vite dev server together
```

Then open <http://localhost:5173> and select or drop `sample.csv` (sample data ships in the repo root).

| Command | What it does |
| --- | --- |
| `python run.py setup` | Create the backend venv and install backend + frontend deps |
| `python run.py dev` | Run backend (auto-reload) and the Vite dev server side by side |
| `python run.py build` | Build the frontend into `frontend/dist` |
| `python run.py serve` | **Fast local deploy** — build, then serve everything on one port |
| `python run.py clean` | Remove `dist`, `.venv`, and `node_modules` |

`dev` and `serve` accept `--host` / `--port` (default `localhost:8000`).

### Fast local deployment (single port)

```bash
python run.py serve            # builds the frontend, then serves it via the backend
python run.py serve --port 9000 --host 0.0.0.0
```

This builds `frontend/dist` and starts the backend, which hosts the built frontend at `/`
and the API under `/api`, so you only need <http://localhost:8000>.

### Manual steps (without the runner)

```bash
# Backend
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

## Layout

```text
run.py      Task runner — setup / dev / build / serve / clean
backend/    FastAPI app and CSV parsing
frontend/   Vue + Vite single-page app
sample.csv  Sample data (time / sine / cosine / ramp / noise)
```

## Roadmap

Real-time streaming (WebSocket), cursors and linked plots, large-file downsampling,
selectable X-axis column, more file formats.

## License

See [LICENSE](LICENSE).
