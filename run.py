#!/usr/bin/env python3
"""VitPlotter task runner — build, package, and locally deploy from one place.

Stdlib only; no extra dependencies. Commands:

    python run.py setup     Create the backend venv, install backend + frontend deps
    python run.py dev       Run backend (reload) + Vite dev server together
    python run.py build     Build the frontend into frontend/dist
    python run.py serve     Build the frontend, then serve everything on a single port
    python run.py clean     Remove build artifacts (dist, venv, node_modules)
    python run.py release   Build a wheel/sdist release for distribution

Examples:
    python run.py dev
    python run.py serve --port 9000 --host 0.0.0.0
    python run.py release --version 0.1.0-rc.1
"""

from __future__ import annotations

import argparse
import os
import platform
import re
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
PACKAGE = ROOT / "vitplotter"
PACKAGE_STATIC = PACKAGE / "frontend-dist"
VENV = BACKEND / ".venv"
DIST = FRONTEND / "dist"
NODE_MODULES = FRONTEND / "node_modules"
RELEASE_DIST = ROOT / "dist"
RELEASE_BUILD = ROOT / "build"
VERSION_FILE = PACKAGE / "_version.py"

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
    # Bake the version into the frontend so the welcome watermark shows it (build-time env).
    # `release` sets VITE_APP_VERSION first (clean release string); any other build (build/serve/dev)
    # falls back to a clearly-marked dev version so it never masquerades as a published release.
    os.environ.setdefault("VITE_APP_VERSION", dev_frontend_version())
    run([npm_cmd(), "run", "build"], cwd=FRONTEND)
    info(f"Frontend built → {DIST.relative_to(ROOT)}")


# --------------------------------------------------------------------------- #
# Release helpers
# --------------------------------------------------------------------------- #
_VERSION_RE = re.compile(
    r"^(?:vitplotter[-_/])?v?"
    r"(?P<base>\d+\.\d+\.\d+)"
    r"(?:(?:[-_.]?)(?P<label>alpha|a|beta|b|rc|ga)(?:[-_.]?(?P<num>\d+))?)?$",
    re.IGNORECASE,
)
_SUFFIX_TO_PEP440 = {
    "alpha": "a",
    "a": "a",
    "beta": "b",
    "b": "b",
    "rc": "rc",
    "ga": "ga",
}


def _normalize_suffix(suffix: str | None) -> str | None:
    if suffix is None:
        return None
    normalized = _SUFFIX_TO_PEP440.get(suffix.lower())
    if normalized is None:
        fail("suffix must be one of: alpha, beta, rc, ga")
    return normalized


def normalize_release_version(
    raw: str,
    suffix: str | None = None,
    pre_number: int | None = None,
) -> str:
    """Normalize tags/CLI versions into PEP 440 versions accepted by wheel metadata."""
    match = _VERSION_RE.fullmatch(raw.strip())
    if not match:
        fail(
            "Version must look like 1.2.3, v1.2.3, 1.2.3-alpha.1, "
            "1.2.3-beta.1, 1.2.3-rc.1, or 1.2.3-ga."
        )

    if pre_number is not None and pre_number < 0:
        fail("--pre-number must be 0 or greater.")

    base = match.group("base")
    tag_suffix = _normalize_suffix(match.group("label"))
    tag_number = int(match.group("num")) if match.group("num") else None
    cli_suffix = _normalize_suffix(suffix)
    effective_suffix = cli_suffix or tag_suffix

    if effective_suffix in (None, "ga"):
        return base

    number = pre_number if pre_number is not None else tag_number if tag_number is not None else 1
    return f"{base}{effective_suffix}{number}"


def git_release_tag() -> str:
    if not shutil.which("git"):
        fail("git not found. Pass --version explicitly, e.g. python run.py release --version 0.1.0")

    result = subprocess.run(
        ["git", "describe", "--tags", "--exact-match", "HEAD"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip()

    latest = subprocess.run(
        ["git", "describe", "--tags", "--abbrev=0"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    hint = ""
    if latest.returncode == 0 and latest.stdout.strip():
        hint = f" Latest tag is {latest.stdout.strip()}, but HEAD is not exactly on it."
    fail(
        "No --version was provided and the current commit is not tagged."
        f"{hint} Create a tag like v0.1.0 or pass --version."
    )


def resolve_release_version(args: argparse.Namespace) -> tuple[str, str]:
    if args.version:
        raw = args.version
        source = "--version"
    else:
        raw = git_release_tag()
        source = "git tag"
    return normalize_release_version(raw, args.suffix, args.pre_number), source


def ensure_build_deps() -> None:
    ensure_venv()
    check = subprocess.run(
        [str(venv_python()), "-c", "import build"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if check.returncode != 0:
        run([venv_python(), "-m", "pip", "install", "-q", "build"])


_PKG_VERSION_RE = re.compile(r'__version__\s*=\s*["\']([^"\']+)["\']')


def read_package_version() -> str:
    """Read __version__ from vitplotter/_version.py (fallback '0.0.0'); baked into the frontend."""
    try:
        match = _PKG_VERSION_RE.search(VERSION_FILE.read_text(encoding="utf-8"))
    except OSError:
        return "0.0.0"
    return match.group(1) if match else "0.0.0"


def git_short_sha() -> str | None:
    """Short commit SHA, with a `.dirty` suffix if the working tree has uncommitted changes."""
    if not shutil.which("git"):
        return None
    head = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], cwd=str(ROOT), capture_output=True, text=True
    )
    sha = head.stdout.strip()
    if head.returncode != 0 or not sha:
        return None
    dirty = subprocess.run(
        ["git", "status", "--porcelain"], cwd=str(ROOT), capture_output=True, text=True
    )
    if dirty.returncode == 0 and dirty.stdout.strip():
        sha += ".dirty"
    return sha


def dev_frontend_version() -> str:
    """Version label for non-release builds (dev/build/serve): the last released base from
    _version.py plus a `+dev` local segment and the git SHA, so a dev build never looks like a
    published release. Example: `0.1.0a1+dev.g1a2b3c.dirty`. `release` overrides this with the
    clean release string before building."""
    base = read_package_version()
    sha = git_short_sha()
    return f"{base}+dev.g{sha}" if sha else f"{base}+dev"


def write_version_file(version: str) -> None:
    content = (
        f'"""Release version, updated by `python run.py release`."""\n\n__version__ = "{version}"\n'
    )
    if VERSION_FILE.exists() and VERSION_FILE.read_text(encoding="utf-8") == content:
        return
    VERSION_FILE.write_text(content, encoding="utf-8")
    info(f"Version file updated → {VERSION_FILE.relative_to(ROOT)}")


def sync_frontend_static() -> None:
    if not (DIST / "index.html").is_file():
        fail(
            "frontend/dist is missing. Run without --skip-frontend or run python run.py build first."
        )
    if PACKAGE_STATIC.exists():
        shutil.rmtree(PACKAGE_STATIC)
    shutil.copytree(DIST, PACKAGE_STATIC)
    info(f"Frontend assets copied → {PACKAGE_STATIC.relative_to(ROOT)}")


def clean_release_workdirs(clean_dist: bool) -> None:
    targets = [RELEASE_BUILD, *ROOT.glob("*.egg-info")]
    if clean_dist:
        targets.append(RELEASE_DIST)
    for target in targets:
        if target.exists():
            info(f"Removing {target.relative_to(ROOT)}")
            shutil.rmtree(target, ignore_errors=True)


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #
def cmd_setup(_args: argparse.Namespace) -> None:
    ensure_backend_deps()
    ensure_frontend_deps()
    info("Setup complete. Try: python run.py dev")


def cmd_build(_args: argparse.Namespace) -> None:
    build_frontend()


def cmd_release(args: argparse.Namespace) -> None:
    version, source = resolve_release_version(args)
    info(f"Release version: {version} ({source})")

    if args.dry_run:
        info("Dry run complete; no files were changed.")
        return

    ensure_build_deps()
    # The resolved release version wins over the _version.py default baked by build_frontend().
    os.environ["VITE_APP_VERSION"] = version
    if not args.skip_frontend:
        build_frontend()
    sync_frontend_static()
    write_version_file(version)
    clean_release_workdirs(clean_dist=args.clean)

    build_cmd = [venv_python(), "-m", "build", "--outdir", RELEASE_DIST]
    if args.wheel_only:
        build_cmd.append("--wheel")
    else:
        build_cmd.extend(["--sdist", "--wheel"])
    run(build_cmd, cwd=ROOT)

    artifacts = sorted(RELEASE_DIST.glob(f"*{version}*"))
    if artifacts:
        info("Release artifacts:")
        for artifact in artifacts:
            info(f"  {artifact.relative_to(ROOT)}")


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
    # Mark the dev frontend's watermark as a development build (base + git sha + dirty flag).
    os.environ.setdefault("VITE_APP_VERSION", dev_frontend_version())

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

    p_release = sub.add_parser("release", help="build a wheel/sdist release for distribution")
    p_release.add_argument("--version", help="release version, e.g. 0.1.0 or v0.1.0-rc.1")
    p_release.add_argument(
        "--suffix",
        choices=["alpha", "beta", "rc", "ga"],
        help="release suffix override; ga means a final release",
    )
    p_release.add_argument(
        "--pre-number",
        type=int,
        default=None,
        help="pre-release number for alpha/beta/rc, defaults to 1",
    )
    p_release.add_argument(
        "--wheel-only",
        action="store_true",
        help="build only the wheel instead of both wheel and sdist",
    )
    p_release.add_argument(
        "--skip-frontend",
        action="store_true",
        help="reuse an existing frontend/dist instead of rebuilding it",
    )
    p_release.add_argument(
        "--clean",
        action="store_true",
        help="remove build artifacts from earlier release attempts before packaging",
    )
    p_release.add_argument(
        "--dry-run",
        action="store_true",
        help="print the resolved release version and stop before writing files",
    )

    args = parser.parse_args()
    handlers = {
        "setup": cmd_setup,
        "build": cmd_build,
        "serve": cmd_serve,
        "dev": cmd_dev,
        "clean": cmd_clean,
        "release": cmd_release,
    }
    handlers[args.command](args)


if __name__ == "__main__":
    main()
