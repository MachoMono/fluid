"""The shelf: forms you chose to keep, stored as plain readable files.

Layout, under $FLUID_HOME (default ~/Fluid):
    README.md           a short note about the folder
    forms/<name>.json   one file per kept form: {"fluid": 1, "name", "kept", "theme", "ui"}

Files are human-readable and safe to copy, edit or put in git. The agent never reads this folder: opening
a kept form is a local action, so it costs no agent run and adds nothing to the agent's context.
"""

import json
import os
import re
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

HOME = Path(os.getenv("FLUID_HOME") or Path.home() / "Fluid")
FORMS = HOME / "forms"
ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}
MAX_BYTES = 1_000_000
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")

README = """# Fluid

Things you chose to keep from Fluid.

- `forms/` holds one file per kept form. Each is plain JSON: a name, when it was kept, and the interface itself.
  Copy, rename, edit or delete them freely. Fluid reads this folder when you open its shelf.
"""

router = APIRouter(prefix="/shelf")


class Keep(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    ui: dict
    theme: dict = {}


class Rename(BaseModel):
    name: str = Field(min_length=1, max_length=80)


def _local_origin(request: Request):
    # Anything that changes the shelf must come from the Fluid page itself, never from another site.
    if request.headers.get("origin") not in ALLOWED_ORIGINS:
        raise HTTPException(403, "Not allowed from this origin")


def _slug(name: str) -> str:
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-")[:48].strip("-")
    return s or "form"


def _path(slug: str) -> Path:
    if not SLUG.match(slug):
        raise HTTPException(404, "No such form")
    return FORMS / f"{slug}.json"


def _write(path: Path, doc: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _read(path: Path) -> dict | None:
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        return doc if isinstance(doc, dict) and isinstance(doc.get("ui"), dict) else None
    except (OSError, ValueError):
        return None


@router.get("")
def list_forms():
    rows = []
    for p in FORMS.glob("*.json") if FORMS.exists() else []:
        doc = _read(p)
        if doc:
            rows.append({"id": p.stem, "name": str(doc.get("name") or p.stem), "kept": doc.get("kept", "")})
    rows.sort(key=lambda r: r["kept"], reverse=True)
    return rows


@router.get("/{slug}")
def get_form(slug: str):
    doc = _read(_path(slug))
    if not doc:
        raise HTTPException(404, "No such form")
    return {"id": slug, "name": doc.get("name", slug), "kept": doc.get("kept", ""), "ui": doc["ui"], "theme": doc.get("theme", {})}


@router.post("", dependencies=[Depends(_local_origin)])
def keep_form(body: Keep):
    if len(json.dumps(body.ui)) + len(json.dumps(body.theme)) > MAX_BYTES:
        raise HTTPException(413, "This form is too large to keep")
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "A name is needed")
    base = _slug(name)
    slug, n = base, 2
    while _path(slug).exists():
        slug, n = f"{base}-{n}", n + 1
    if not (HOME / "README.md").exists():
        HOME.mkdir(parents=True, exist_ok=True)
        (HOME / "README.md").write_text(README, encoding="utf-8")
    kept = datetime.now(timezone.utc).isoformat(timespec="seconds")
    _write(_path(slug), {"fluid": 1, "name": name, "kept": kept, "theme": body.theme, "ui": body.ui})
    return {"id": slug, "name": name, "kept": kept}


@router.patch("/{slug}", dependencies=[Depends(_local_origin)])
def rename_form(slug: str, body: Rename):
    path = _path(slug)
    doc = _read(path)
    if not doc:
        raise HTTPException(404, "No such form")
    doc["name"] = body.name.strip()
    _write(path, doc)
    return {"id": slug, "name": doc["name"]}


@router.delete("/{slug}", dependencies=[Depends(_local_origin)])
def remove_form(slug: str):
    path = _path(slug)
    if not path.exists():
        raise HTTPException(404, "No such form")
    path.unlink()
    return {"id": slug}
