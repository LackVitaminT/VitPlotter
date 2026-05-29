#!/usr/bin/env python3
"""VitPlotter task runner — build, package, and locally deploy from one place.

Stdlib only; no extra dependencies. Commands:

    python run.py setup     Create the backend venv, install backend + frontend deps
    python run.py dev       Run backend (reload) + Vite dev server together
    python run.py build     Build the frontend into frontend/dist
    python run.py serve     Build the frontend, then serve everything on a single port
    python run.py clean     Remove build artifacts (dist, venv, node_modules)

Examples:
    python run.py dev
    python run.py serve --port 9000 --host 0.0.0.0
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import signal
import subprocess
import sys
import venv
from pathlib import Path
from typing import NoReturn

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
VENV = BACKEND / ".venv"
DIST = FRONTEND / "dist"
NODE_MODULES = FRONTEND / "node_modules"

IS_WINDOWS = platform.system() == "Windows"
COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def info(msg: str) -> None:
    prefix = "\033[35m▸\033[0m" if COLOR else "▸"
    print(f"{prefix} {msg}", flush=True)


def fail(msg: str) -> NoReturn:
    text = f"\033[31m✗ {msg}\033[0m" if COLOR else f"✗ {msg}"
    print(text, file=sys.stderr, flush=True)
    sys.exit(1)


def venv_bin(name: str) -> Path:
    """Path to an executable inside the backend venv."""
    sub = "Scripts" if IS_WINDOWS else "bin"
    exe = f"{name}.exe" if IS_WINDOWS else name
    return VENV / sub / exe


def venv_python() -> Path:
    return venv_bin("python")


def npm_cmd() -> str:
    found = shutil.which("npm")
    if not found:
        fail("npm not found on PATH. Install Node.js (https://nodejs.org) first.")
    return found


def run(cmd: list[str | Path], cwd: Path | None = None) -> None:
    """Run a command, inheriting stdio, and abort on failure."""
    printable = " ".join(str(c) for c in cmd)
    info(printable)
    result = subprocess.run([str(c) for c in cmd], cwd=str(cwd) if cwd else None)
    if result.returncode != 0:
        fail(f"command failed ({result.returncode}): {printable}")


def popen_group(cmd: list[str], cwd: Path) -> subprocess.Popen:
    """Start a long-running child in its own process group so we can kill its whole tree."""
    kwargs: dict = {}
    if IS_WINDOWS:
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    else:
        kwargs["start_new_session"] = True  # child becomes its own group leader
    return subprocess.Popen(cmd, cwd=str(cwd), **kwargs)


def terminate_tree(p: subprocess.Popen, sig: int = signal.SIGTERM) -> None:
    """Kill a child and all of its descendants (reload workers, node, etc.)."""
    if p.poll() is not None:
        return
    try:
        if IS_WINDOWS:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(p.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            os.killpg(os.getpgid(p.pid), sig)
    except (ProcessLookupError, PermissionError, OSError):
        pass


# --------------------------------------------------------------------------- #
# Setup steps (idempotent)
# --------------------------------------------------------------------------- #
def ensure_venv() -> None:
    if not venv_python().exists():
        info(f"Creating virtualenv at {VENV.relative_to(ROOT)}")
        venv.create(VENV, with_pip=True)


def ensure_backend_deps() -> None:
    ensure_venv()
    run([venv_python(), "-m", "pip", "install", "-q", "-r", BACKEND / "requirements.txt"])


def ensure_frontend_deps() -> None:
    if not NODE_MODULES.exists():
        run([npm_cmd(), "install"], cwd=FRONTEND)


def build_frontend() -> None:
    ensure_frontend_deps()
    run([npm_cmd(), "run", "build"], cwd=FRONTEND)
    info(f"Frontend built → {DIST.relative_to(ROOT)}")


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #
def cmd_setup(_args: argparse.Namespace) -> None:
    ensure_backend_deps()
    ensure_frontend_deps()
    info("Setup complete. Try: python run.py dev")


def cmd_build(_args: argparse.Namespace) -> None:
    build_frontend()


def cmd_serve(args: argparse.Namespace) -> None:
    """Single-port local deployment: build the frontend, then serve it via the backend."""
    ensure_backend_deps()
    build_frontend()
    info(f"Serving on http://{args.host}:{args.port}  (backend hosts the built frontend)")
    run(
        [
            venv_python(),
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            args.host,
            "--port",
            str(args.port),
        ],
        cwd=BACKEND,
    )


def cmd_dev(args: argparse.Namespace) -> None:
    """Run backend (auto-reload) and the Vite dev server side by side."""
    ensure_backend_deps()
    ensure_frontend_deps()

    backend_cmd = [
        str(venv_python()),
        "-m",
        "uvicorn",
        "app.main:app",
        "--reload",
        "--host",
        args.host,
        "--port",
        str(args.port),
    ]
    frontend_cmd = [npm_cmd(), "run", "dev"]

    info(f"Backend  → http://{args.host}:{args.port}")
    info("Frontend → http://localhost:5173  (open this one)")
    info("Press Ctrl+C to stop both.")

    procs: list[subprocess.Popen] = []

    def shutdown(*_a) -> None:
        info("Stopping…")
        for p in procs:
            terminate_tree(p, signal.SIGTERM)
        for p in procs:
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
        # Final sweep: SIGKILL each group to catch slow grandchildren (e.g. Vite's
        # esbuild service) that outlive the direct child we waited on. Harmless if dead.
        if not IS_WINDOWS:
            for p in procs:
                terminate_tree(p, signal.SIGKILL)
        sys.exit(0)

    # Handle SIGTERM too (e.g. `kill <pid>`), not just Ctrl+C.
    if not IS_WINDOWS:
        signal.signal(signal.SIGTERM, shutdown)

    try:
        procs.append(popen_group(backend_cmd, cwd=BACKEND))
        procs.append(popen_group(frontend_cmd, cwd=FRONTEND))
        # Exit if either process dies; otherwise wait for a stop signal.
        while True:
            for p in procs:
                code = p.poll()
                if code is not None:
                    info(f"A process exited ({code}); shutting down.")
                    shutdown()
            try:
                procs[0].wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                pass
    except KeyboardInterrupt:
        shutdown()


def cmd_clean(_args: argparse.Namespace) -> None:
    for target in (DIST, NODE_MODULES, VENV):
        if target.exists():
            info(f"Removing {target.relative_to(ROOT)}")
            shutil.rmtree(target, ignore_errors=True)
    info("Clean complete.")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main() -> None:
    parser = argparse.ArgumentParser(
        description="VitPlotter task runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("setup", help="install backend + frontend dependencies")
    sub.add_parser("build", help="build the frontend into frontend/dist")
    sub.add_parser("clean", help="remove dist, venv, and node_modules")

    p_dev = sub.add_parser("dev", help="run backend + Vite dev server together")
    p_dev.add_argument("--host", default="localhost")
    p_dev.add_argument("--port", type=int, default=8000, help="backend port (default 8000)")

    p_serve = sub.add_parser("serve", help="build, then serve everything on one port")
    p_serve.add_argument("--host", default="localhost")
    p_serve.add_argument("--port", type=int, default=8000, help="server port (default 8000)")

    args = parser.parse_args()
    handlers = {
        "setup": cmd_setup,
        "build": cmd_build,
        "serve": cmd_serve,
        "dev": cmd_dev,
        "clean": cmd_clean,
    }
    handlers[args.command](args)


if __name__ == "__main__":
    main()
