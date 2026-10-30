"""Shared helpers for Fluid's file-backed storage APIs (shelf, playbooks, work)."""

import os
import re
import tempfile
import unicodedata
from pathlib import Path

from fastapi import HTTPException, Request

HOME = Path(os.getenv("FLUID_HOME") or Path.home() / "Fluid")
ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def local_origin(request: Request):
    # Anything that changes stored files must come from the Fluid page itself, never from another site.
    if request.headers.get("origin") not in ALLOWED_ORIGINS:
        raise HTTPException(403, "Not allowed from this origin")


def slugify(name: str) -> str:
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-")[:48].strip("-")
    return s or "item"


def valid_slug(s: str) -> bool:
    return bool(SLUG.match(s))


def unique_path(dir: Path, base: str, ext: str) -> Path:
    ext = ext if ext.startswith(".") else f".{ext}"
    p, n = Path(dir) / f"{base}{ext}", 2
    while p.exists():
        p, n = Path(dir) / f"{base}-{n}{ext}", n + 1
    return p


def atomic_write_text(path: Path, text: str):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def parse_md(text: str) -> tuple[dict[str, str], str]:
    """Split a file starting with a `---` block of `key: value` lines into (meta, body)."""
    lines = text.lstrip("﻿").split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, text
    meta: dict[str, str] = {}
    for i in range(1, len(lines)):
        line = lines[i].rstrip("\r")
        if line.strip() == "---":
            return meta, "\n".join(lines[i + 1:]).lstrip("\r\n")
        if ":" in line:
            k, v = line.split(":", 1)
            if k.strip():
                meta[k.strip()] = v.strip()
    return {}, text  # never closed: not frontmatter


def compose_md(meta: dict, body: str) -> str:
    out = ["---"]
    for k, v in meta.items():
        v = " ".join(str(v).split())
        out.append(f"{k}: {v}" if v else f"{k}:")
    out.append("---")
    return "\n".join(out) + "\n\n" + body.strip("\n") + "\n"
