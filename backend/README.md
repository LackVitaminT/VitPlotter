# VitPlotter — Backend

FastAPI + pandas. Accepts and parses CSV files, and runs a live UDP→WebSocket stream.

## Run

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # optional
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

- Interactive API docs: <http://localhost:8000/docs>
- Health check: `GET /api/health`

## API

### `POST /api/upload`

`multipart/form-data` with a `file` field holding a `.csv`. Returns:

```json
{
  "x": { "name": "time", "values": [0, 1, 2] },
  "series": [{ "name": "signal_a", "values": [0.1, 0.2, null] }],
  "rows": 3,
  "filename": "sample.csv"
}
```

Convention: the first column is the X axis (falls back to a row index if non-numeric),
the remaining columns are Y series, and unparseable values become `null`.

### Live UDP streaming

The backend can bind a UDP socket and forward parsed JSON datagrams to WebSocket clients.
One listener is active at a time; starting a new one replaces it.

- `POST /api/stream/start` — body `{ "host": "0.0.0.0", "port": 9870, "timestamp_field": null }`.
  Returns the listener status. Bind failures (port in use, privileged port) return `400`.
- `POST /api/stream/stop` — stop the listener.
- `GET /api/stream/status` — `{ running, host, port, timestamp_field, packets, errors, series, subscribers, started_at }`.
- `WS /api/stream/ws` — sends an initial `{ "type": "status", ... }` frame, then
  `{ "type": "point", "t": <float>, "values": { "<series>": <number>, ... } }` per message.

Parsing conventions (see [app/udp_stream.py](app/udp_stream.py)):

- Nested objects/arrays are flattened into dotted names (`{"imu":{"ax":1}}` → `imu.ax`,
  `[1,2]` → `0`, `1`). Only numeric leaves (incl. bool as 0/1) become series.
- The timestamp comes from `t` / `time` / `timestamp` / `stamp` / `ts` (or an explicit
  `timestamp_field`); otherwise the server's arrival time is used. The timestamp field is
  not emitted as a series.
