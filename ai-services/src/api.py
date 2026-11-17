"""Compatibility ASGI entry point for ``uvicorn src.api:app``."""

from .main import app

__all__ = ["app"]
