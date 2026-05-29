# VitPlotter

A minimal, web-based plotting tool built with a **Python backend + a modern frontend**,
inspired by [PlotJuggler](https://github.com/facontidavide/PlotJuggler).

Two ways to get data in:

- **CSV** — upload or drag-and-drop a file and plot it as interactive curves.
- **Live UDP stream** — receive JSON datagrams on a host:port and plot them in real time,
  PlotJuggler-style.

Stack:

- **Backend** — FastAPI + pandas (CSV), asyncio UDP listener + WebSocket (streaming)
- **Frontend** — Vue 3 + Vite + [uPlot](https://github.com/leeoniya/uPlot) (high-performance time-series charts)
- **Theme** — Catppuccin Latte (light) / Mocha (dark), with a toggle that follows your system preference

CSV convention: the **first column is the X axis** (falls back to a row index if it isn't
numeric); every remaining column becomes a toggleable Y series.

## Quick start

The `run.py` task runner (stdlib only, no extra deps) drives the whole project:

```bash
python run.py setup     # install backend + frontend dependencies
python run.py dev       # run backend (reload) + Vite dev server together
```

Then open <http://localhost:5173> and select or drop `sample.csv` (sample data ships in the repo root).

| Command               | What it does                                                     |
| --------------------- | ---------------------------------------------------------------- |
| `python run.py setup` | Create the backend venv and install backend + frontend deps      |
| `python run.py dev`   | Run backend (auto-reload) and the Vite dev server side by side   |
| `python run.py build` | Build the frontend into `frontend/dist`                          |
| `python run.py serve` | **Fast local deploy** — build, then serve everything on one port |
| `python run.py clean` | Remove `dist`, `.venv`, and `node_modules`                       |

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

## Live UDP streaming

In the app, choose the **UDP stream** tab, enter a host/port (default `0.0.0.0:9870`,
PlotJuggler's default), and connect. The backend binds a UDP socket and forwards each JSON
datagram to the browser over a WebSocket; curves update live on a rolling window.

- **Message format** — each datagram is a JSON object. Nested objects/arrays are flattened
  into dotted series names (`{"imu":{"ax":1}}` → `imu.ax`); only numeric leaves are plotted.
- **Timestamp** — auto-detected from a `t` / `time` / `timestamp` / `stamp` / `ts` field
  (overridable in the form); if none is present, the server's arrival time is used. The
  timestamp field itself is not plotted as a series.
- **One listener at a time** — connecting replaces any existing listener.

Try it with the bundled emitter:

```bash
python tools/udp_sender.py --host 127.0.0.1 --port 9870 --rate 100
```

Stream API (also usable directly): `POST /api/stream/start` `{host, port, timestamp_field?}`,
`POST /api/stream/stop`, `GET /api/stream/status`, `WS /api/stream/ws`.

## Layout

```text
run.py            Task runner — setup / dev / build / serve / clean
backend/          FastAPI app, CSV parsing, UDP streaming
frontend/         Vue + Vite single-page app
tools/udp_sender.py  Sample UDP JSON emitter (streaming analog of sample.csv)
sample.csv        Sample data (time / sine / cosine / ramp / noise)
```

## Roadmap

Real-time streaming (WebSocket), cursors and linked plots, large-file downsampling,
selectable X-axis column, more file formats.

## License

See [LICENSE](LICENSE).
