# VitPlotter — Backend

FastAPI + pandas. Accepts and parses CSV files and returns plot data.

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
  "series": [
    { "name": "signal_a", "values": [0.1, 0.2, null] }
  ],
  "rows": 3,
  "filename": "sample.csv"
}
```

Convention: the first column is the X axis (falls back to a row index if non-numeric),
the remaining columns are Y series, and unparseable values become `null`.
