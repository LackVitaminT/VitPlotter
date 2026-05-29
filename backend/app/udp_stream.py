"""Live UDP → WebSocket streaming, PlotJuggler-style.

The backend binds a UDP socket on a configurable host:port. Each datagram is expected to
carry a JSON message; numeric values are flattened into dotted series names and streamed to
connected WebSocket clients as time-stamped points.

Conventions:
- Nested objects/arrays are flattened: {"imu": {"ax": 1}} -> "imu.ax", [1, 2] -> "a.0", "a.1".
- Only numeric leaves become series (int/float, and bool as 0/1). Strings/None are skipped.
- The X axis (timestamp) is taken from a field in the message when present
  (t / time / timestamp / stamp / ts, or an explicit override); otherwise the server's
  arrival time (seconds since the stream started) is used.

Only one listener is active at a time; starting a new one replaces the previous.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

logger = logging.getLogger("vitplotter.udp")

# Field names checked (in order) when auto-detecting a timestamp.
TIMESTAMP_FIELDS = ("t", "time", "timestamp", "stamp", "ts")

# Per-client queue bound. Slow clients drop their oldest points instead of blocking ingest.
QUEUE_MAXSIZE = 2000


def _is_number(value: Any) -> bool:
    # bool is a subclass of int; treat it as numeric (0/1).
    return isinstance(value, (int, float)) and not isinstance(value, complex)


def flatten_json(obj: Any, prefix: str = "") -> dict[str, float]:
    """Flatten a JSON value into {dotted_name: number}, keeping only numeric leaves."""
    out: dict[str, float] = {}

    if isinstance(obj, dict):
        for key, value in obj.items():
            name = f"{prefix}.{key}" if prefix else str(key)
            out.update(flatten_json(value, name))
    elif isinstance(obj, (list, tuple)):
        for i, value in enumerate(obj):
            name = f"{prefix}.{i}" if prefix else str(i)
            out.update(flatten_json(value, name))
    elif isinstance(obj, bool):
        out[prefix] = 1.0 if obj else 0.0
    elif _is_number(obj):
        out[prefix] = float(obj)
    # strings / None / other types are ignored

    return out


def extract_timestamp(message: Any, override: str | None = None) -> tuple[float, str] | None:
    """Return (timestamp, field_name) from the top level of the message, or None if not found."""
    if not isinstance(message, dict):
        return None
    fields = (override,) if override else TIMESTAMP_FIELDS
    for field in fields:
        if field and field in message and _is_number(message[field]):
            return float(message[field]), field
    return None


class _Protocol(asyncio.DatagramProtocol):
    """Hands received datagrams to the manager."""

    def __init__(self, manager: "UdpStreamManager") -> None:
        self._manager = manager

    def datagram_received(self, data: bytes, addr) -> None:
        self._manager.ingest(data, addr)

    def error_received(self, exc: Exception) -> None:  # pragma: no cover - rare
        logger.warning("UDP error: %s", exc)

    def connection_lost(self, exc: Exception | None) -> None:  # pragma: no cover
        if exc:
            logger.warning("UDP connection lost: %s", exc)


class UdpStreamManager:
    """Owns the UDP endpoint and fans out parsed points to WebSocket subscribers."""

    def __init__(self) -> None:
        self._transport: asyncio.DatagramTransport | None = None
        self._subscribers: set[asyncio.Queue] = set()
        self._series: set[str] = set()
        self.host: str | None = None
        self.port: int | None = None
        self.timestamp_field: str | None = None
        self._t0: float = 0.0
        self._packets: int = 0
        self._errors: int = 0
        self._started_at: float | None = None

    # -- lifecycle ---------------------------------------------------------- #
    @property
    def running(self) -> bool:
        return self._transport is not None

    async def start(self, host: str, port: int, timestamp_field: str | None = None) -> None:
        """Bind the UDP socket. Replaces any existing listener. Raises OSError on bind failure."""
        await self.stop()
        loop = asyncio.get_running_loop()
        transport, _ = await loop.create_datagram_endpoint(
            lambda: _Protocol(self),
            local_addr=(host, port),
        )
        self._transport = transport  # type: ignore[assignment]
        self.host = host
        self.port = port
        self.timestamp_field = (timestamp_field or "").strip() or None
        self._series = set()
        self._packets = 0
        self._errors = 0
        self._t0 = time.monotonic()
        self._started_at = time.time()
        logger.info("UDP listener started on %s:%d", host, port)

    async def stop(self) -> None:
        if self._transport is not None:
            self._transport.close()
            self._transport = None
            logger.info("UDP listener stopped")
        self.host = None
        self.port = None
        self._started_at = None

    # -- subscriptions ------------------------------------------------------ #
    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    # -- ingest ------------------------------------------------------------- #
    def ingest(self, data: bytes, addr) -> None:
        """Parse a datagram and broadcast its points to subscribers (runs on the event loop)."""
        for message in self._decode(data):
            values = flatten_json(message)
            detected = extract_timestamp(message, self.timestamp_field)
            if detected is not None:
                ts, ts_field = detected
                values.pop(ts_field, None)  # don't plot the timestamp as a series
            else:
                ts = time.monotonic() - self._t0
            if not values:
                continue
            self._series.update(values.keys())
            point = {"t": ts, "values": values}
            self._broadcast(point)
        self._packets += 1

    def _decode(self, data: bytes) -> list[Any]:
        """Decode a datagram as one JSON document, falling back to newline-delimited JSON."""
        text = data.decode("utf-8", errors="replace").strip()
        if not text:
            return []
        try:
            return [json.loads(text)]
        except json.JSONDecodeError:
            pass
        messages: list[Any] = []
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                messages.append(json.loads(line))
            except json.JSONDecodeError:
                self._errors += 1
        return messages

    def _broadcast(self, point: dict) -> None:
        for q in self._subscribers:
            if q.full():
                try:
                    q.get_nowait()  # drop oldest to make room (slow-consumer backpressure)
                except asyncio.QueueEmpty:
                    pass
            try:
                q.put_nowait(point)
            except asyncio.QueueFull:  # pragma: no cover - racing fullness
                pass

    # -- introspection ------------------------------------------------------ #
    def status(self) -> dict:
        return {
            "running": self.running,
            "host": self.host,
            "port": self.port,
            "timestamp_field": self.timestamp_field,
            "packets": self._packets,
            "errors": self._errors,
            "series": sorted(self._series),
            "subscribers": len(self._subscribers),
            "started_at": self._started_at,
        }


# Module-level singleton shared by the API routes.
manager = UdpStreamManager()
