#!/usr/bin/env python3
"""Send sine, cosine, and square-wave samples to VitPlotter over UDP.

Start VitPlotter, connect the UDP stream to 0.0.0.0:9870, then run:

    python demo/udp_stream_demo.py
    python demo/udp_stream_demo.py --host 127.0.0.1 --port 9870 --rate 100
"""

from __future__ import annotations

import argparse
import json
import math
import socket
import time


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Send real-time sine, cosine, and square-wave data over UDP."
    )
    parser.add_argument("--host", default="127.0.0.1", help="destination host")
    parser.add_argument("--port", type=int, default=9870, help="destination UDP port")
    parser.add_argument("--rate", type=float, default=50.0, help="samples per second")
    parser.add_argument("--frequency", type=float, default=1.0, help="wave frequency in Hz")
    parser.add_argument("--amplitude", type=float, default=1.0, help="signal amplitude")
    parser.add_argument(
        "--duration",
        type=float,
        default=0.0,
        help="seconds to run; 0 means run until Ctrl+C",
    )
    return parser.parse_args()


def square_wave(phase: float, amplitude: float) -> float:
    return amplitude if math.sin(phase) >= 0.0 else -amplitude


def make_sample(t: float, frequency: float, amplitude: float) -> dict[str, float]:
    phase = 2.0 * math.pi * frequency * t
    return {
        "t": round(t, 6),
        "sine": amplitude * math.sin(phase),
        "cosine": amplitude * math.cos(phase),
        "square": square_wave(phase, amplitude),
    }


def main() -> None:
    args = parse_args()
    if args.rate <= 0:
        raise SystemExit("--rate must be greater than 0")
    if args.frequency <= 0:
        raise SystemExit("--frequency must be greater than 0")

    period = 1.0 / args.rate
    start = time.monotonic()
    next_send = start
    sent = 0

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    print(
        f"Sending sine/cosine/square to {args.host}:{args.port} at {args.rate:g} Hz "
        f"({args.frequency:g} Hz signal). Press Ctrl+C to stop."
    )

    try:
        while True:
            now = time.monotonic()
            t = now - start
            if args.duration > 0 and t >= args.duration:
                break

            sample = make_sample(t, args.frequency, args.amplitude)
            payload = json.dumps(sample, separators=(",", ":")).encode("utf-8")
            sock.sendto(payload, (args.host, args.port))
            sent += 1

            next_send += period
            sleep_for = next_send - time.monotonic()
            if sleep_for > 0:
                time.sleep(sleep_for)
            else:
                next_send = time.monotonic()
    except KeyboardInterrupt:
        pass
    finally:
        sock.close()

    print(f"Stopped after {sent} samples.")


if __name__ == "__main__":
    main()
