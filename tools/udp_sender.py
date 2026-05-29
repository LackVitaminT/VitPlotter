#!/usr/bin/env python3
"""Emit sample JSON datagrams over UDP — the streaming analog of sample.csv.

Useful for testing VitPlotter's live UDP stream. Each datagram is one JSON object with a
timestamp plus a few signals, including a nested object to exercise dotted-name flattening.

Usage:
    python tools/udp_sender.py                      # -> 127.0.0.1:9870 at 50 Hz
    python tools/udp_sender.py --host 127.0.0.1 --port 9870 --rate 100
"""

from __future__ import annotations

import argparse
import json
import math
import socket
import time


def main() -> None:
    ap = argparse.ArgumentParser(description="Send sample JSON datagrams over UDP.")
    ap.add_argument("--host", default="127.0.0.1", help="destination host (default 127.0.0.1)")
    ap.add_argument("--port", type=int, default=9870, help="destination port (default 9870)")
    ap.add_argument("--rate", type=float, default=50.0, help="messages per second (default 50)")
    args = ap.parse_args()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    period = 1.0 / args.rate if args.rate > 0 else 0.0
    start = time.monotonic()
    n = 0

    print(f"Sending to {args.host}:{args.port} at {args.rate} Hz — Ctrl+C to stop.")
    try:
        while True:
            t = time.monotonic() - start
            msg = {
                "t": round(t, 4),
                "sine": math.sin(t),
                "cosine": math.cos(t),
                "ramp": (t * 0.2) % 2.0,
                "imu": {
                    "ax": math.sin(t * 3.0) * 0.5,
                    "ay": math.cos(t * 2.0) * 0.5,
                },
                # Slash-separated keys (e.g. ROS-style) also nest into the tree.
                "pose/x": math.cos(t * 0.5),
                "pose/y": math.sin(t * 0.5),
            }
            sock.sendto(json.dumps(msg).encode("utf-8"), (args.host, args.port))
            n += 1
            if period:
                time.sleep(period)
    except KeyboardInterrupt:
        print(f"\nStopped after {n} messages.")
    finally:
        sock.close()


if __name__ == "__main__":
    main()
