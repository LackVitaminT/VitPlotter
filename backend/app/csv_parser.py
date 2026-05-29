"""CSV parsing: turn an uploaded CSV byte stream into a frontend-agnostic plot structure.

Conventions (initial version):
- The first column is the X axis. If it parses as numeric it is used as-is;
  otherwise it falls back to a row index 0..N-1.
- Every remaining column is a Y series, coerced to numeric; unparseable cells become NaN.
- NaN is serialized as None in the output (uPlot treats it as a gap).
"""

from __future__ import annotations

import io
import math
from typing import Any

import pandas as pd


class CsvParseError(ValueError):
    """Raised when the CSV cannot be parsed or its content is unexpected."""


def _clean(values: list[Any]) -> list[Any]:
    """Replace non-finite floats (NaN/inf) with None so the result is JSON-serializable."""
    cleaned: list[Any] = []
    for v in values:
        if isinstance(v, float) and not math.isfinite(v):
            cleaned.append(None)
        else:
            cleaned.append(v)
    return cleaned


def parse_csv(file_bytes: bytes) -> dict[str, Any]:
    """Parse a CSV byte stream into {"x": {...}, "series": [...], "rows": N}.

    Raises CsvParseError (with a human-readable message) when the file is empty
    or cannot be parsed.
    """
    if not file_bytes or not file_bytes.strip():
        raise CsvParseError("The file is empty.")

    try:
        df = pd.read_csv(io.BytesIO(file_bytes))
    except pd.errors.EmptyDataError as exc:
        raise CsvParseError("The CSV has no columns or data to parse.") from exc
    except Exception as exc:  # pandas can raise several parser errors
        raise CsvParseError(f"Could not parse the CSV: {exc}") from exc

    if df.shape[1] == 0:
        raise CsvParseError("The CSV has no columns.")
    if df.shape[0] == 0:
        raise CsvParseError("The CSV has no data rows.")

    # First column is the X axis.
    x_col = df.columns[0]
    x_numeric = pd.to_numeric(df[x_col], errors="coerce")
    if x_numeric.notna().any():
        x_name = str(x_col)
        x_values = _clean(x_numeric.tolist())
    else:
        # First column is non-numeric (e.g. string labels); fall back to a row index.
        x_name = "index"
        x_values = list(range(len(df)))

    # Remaining columns are Y series.
    series: list[dict[str, Any]] = []
    for col in df.columns[1:]:
        col_numeric = pd.to_numeric(df[col], errors="coerce")
        series.append({"name": str(col), "values": _clean(col_numeric.tolist())})

    if not series:
        raise CsvParseError(
            "The CSV needs at least two columns (first as X axis, the rest as data)."
        )

    return {
        "x": {"name": x_name, "values": x_values},
        "series": series,
        "rows": int(len(df)),
    }
