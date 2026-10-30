"""Work: things Fluid made for you, stored as markdown files in $FLUID_HOME/work/<slug>.md."""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from fsutil import HOME, atomic_write_text, compose_md, local_origin, parse_md, slugify, unique_path, valid_slug

DIR = HOME / "work"

router = APIRouter(prefix="/work")


class NewWork(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    kind: str = Field(default="note", max_length=40)
    body: str = Field(default="", max_length=200_000)
    playbook: str = Field(default="", max_length=80)


class Status(BaseModel):
    status: Literal["open", "done"]


def _path(slug: str):
    if not valid_slug(slug):
        raise HTTPException(404, "No such item")
    return DIR / f"{slug}.md"


def _load(path):
    try:
        meta, body = parse_md(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not meta.get("title"):
        return None
    return {"id": path.stem, "title": meta["title"], "kind": meta.get("kind", ""), "status": meta.get("status", "open"),
            "playbook": meta.get("playbook", ""), "made": meta.get("made", "")}, body


@router.get("")
def list_work():
    rows = []
    for p in DIR.glob("*.md") if DIR.exists() else []:
        got = _load(p)
        if got:
            rows.append(got[0])
    rows.sort(key=lambda r: r["made"], reverse=True)
    return rows


@router.get("/{slug}")
def get_work(slug: str):
    got = _load(_path(slug))
    if not got:
        raise HTTPException(404, "No such item")
    return {**got[0], "body": got[1]}


@router.post("", dependencies=[Depends(local_origin)])
def create_work(body: NewWork):
    title = " ".join(body.title.split())
    if not title:
        raise HTTPException(422, "A title is needed")
    made = datetime.now(timezone.utc).isoformat(timespec="seconds")
    meta = {"title": title, "kind": body.kind.strip() or "note", "status": "open", "playbook": body.playbook.strip(), "made": made}
    path = unique_path(DIR, slugify(title), ".md")
    atomic_write_text(path, compose_md(meta, body.body))
    return {"id": path.stem, "title": title, "made": made}


@router.patch("/{slug}", dependencies=[Depends(local_origin)])
def set_status(slug: str, body: Status):
    path = _path(slug)
    if not _load(path):
        raise HTTPException(404, "No such item")
    meta, text = parse_md(path.read_text(encoding="utf-8"))
    meta["status"] = body.status
    atomic_write_text(path, compose_md(meta, text))
    return {"id": slug, "status": body.status}


@router.delete("/{slug}", dependencies=[Depends(local_origin)])
def remove_work(slug: str):
    path = _path(slug)
    if not path.exists():
        raise HTTPException(404, "No such item")
    path.unlink()
    return {"id": slug}
