"""Console entrypoint for the packaged VitPlotter application."""

from __future__ import annotations

import argparse
import socket
import threading
import webbrowser

import uvicorn

from . import __version__


def _port_is_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def _choose_port(host: str, preferred: int, exact: bool) -> int:
    if not (1 <= preferred <= 65535):
        raise SystemExit("Port must be between 1 and 65535.")

    if exact:
        if _port_is_free(host, preferred):
            return preferred
        raise SystemExit(f"Port {preferred} is already in use on {host}.")

    for port in range(preferred, min(preferred + 100, 65536)):
        if _port_is_free(host, port):
            return port
    raise SystemExit(f"No free port found in {preferred}-{min(preferred + 99, 65535)}.")


def _browser_url(host: str, port: int) -> str:
    browser_host = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    return f"http://{browser_host}:{port}"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="VitPlotter",
        description="Run VitPlotter as a local web application.",
    )
    parser.add_argument("--host", default="127.0.0.1", help="host to bind (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="preferred port (default 8000)")
    parser.add_argument(
        "--exact-port",
        action="store_true",
        help="fail if --port is busy instead of trying the next free port",
    )
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser")
    parser.add_argument(
        "--log-level",
        default="info",
        choices=["critical", "error", "warning", "info", "debug", "trace"],
        help="uvicorn log level (default info)",
    )
    parser.add_argument("--version", action="version", version=f"VitPlotter {__version__}")
    args = parser.parse_args(argv)

    port = _choose_port(args.host, args.port, args.exact_port)
    url = _browser_url(args.host, port)
    print(f"VitPlotter {__version__} running at {url}", flush=True)
    print("Press Ctrl+C to stop.", flush=True)

    if not args.no_browser:
        threading.Timer(0.8, webbrowser.open, args=(url,)).start()

    uvicorn.run(
        "vitplotter.app.main:app",
        host=args.host,
        port=port,
        log_level=args.log_level,
    )


if __name__ == "__main__":
    main()
