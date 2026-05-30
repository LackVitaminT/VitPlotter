"""VitPlotter package metadata."""

from __future__ import annotations

try:
    from ._version import __version__
except ImportError:  # pragma: no cover - only happens in unusual editable states
    __version__ = "0.0.0"

__all__ = ["__version__"]
