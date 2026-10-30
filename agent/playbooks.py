"""Playbooks: reusable ways of working, stored as markdown files in $FLUID_HOME/playbooks/<slug>.md."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from fsutil import HOME, atomic_write_text, compose_md, local_origin, parse_md, slugify, unique_path, valid_slug

DIR = HOME / "playbooks"
MAX_BYTES = 100_000

router = APIRouter(prefix="/playbooks")


class NewPlaybook(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    purpose: str = Field(default="", max_length=200)
    ask: list[str] = []
    steps: list[str] = []
    approvals: list[str] = []
    result: str = Field(default="", max_length=500)


def _path(slug: str):
    if not valid_slug(slug):
        raise HTTPException(404, "No such playbook")
    return DIR / f"{slug}.md"


def _load(path):
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, ValueError):
        return None
    meta, _ = parse_md(text)
    return (meta, text) if meta.get("name") else None


def _items(items: list[str]) -> list[str]:
    out = []
    for i in items:
        s = " ".join(i.split())
        for prefix in ("- ", "1. "):
            if s.startswith(prefix):
                s = s[len(prefix):].strip()
                break
        if s:
            out.append(s)
    return out


@router.get("")
def list_playbooks():
    rows = []
    for p in DIR.glob("*.md") if DIR.exists() else []:
        got = _load(p)
        if got:
            m = got[0]
            rows.append({"id": p.stem, "name": m["name"], "purpose": m.get("purpose", ""), "last_run": m.get("last_run", "")})
    rows.sort(key=lambda r: r["name"].lower())
    rows.sort(key=lambda r: r["last_run"], reverse=True)  # stable: empty last_run sorts last
    return rows


@router.get("/{slug}")
def get_playbook(slug: str):
    got = _load(_path(slug))
    if not got:
        raise HTTPException(404, "No such playbook")
    m, text = got
    return {"id": slug, "name": m["name"], "purpose": m.get("purpose", ""), "trigger": m.get("trigger", ""),
            "last_run": m.get("last_run", ""), "text": text}


@router.post("", dependencies=[Depends(local_origin)])
def create_playbook(body: NewPlaybook):
    name = " ".join(body.name.split())
    if not name:
        raise HTTPException(422, "A name is needed")
    ask, steps, approvals = _items(body.ask), _items(body.steps), _items(body.approvals)
    parts = []
    if ask:
        parts.append("## Ask\n" + "\n".join(f"- {a}" for a in ask))
    parts.append("## Steps\n" + "\n".join(f"{n}. {s}" for n, s in enumerate(steps, 1)))
    if approvals:
        parts.append("## Approvals\n" + "\n".join(f"- {a}" for a in approvals))
    parts.append("## Result\n" + body.result.strip())
    meta = {"name": name, "purpose": " ".join(body.purpose.split()), "trigger": "manual", "last_run": ""}
    text = compose_md(meta, "\n\n".join(parts))
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise HTTPException(413, "This playbook is too large")
    path = unique_path(DIR, slugify(name), ".md")
    atomic_write_text(path, text)
    return {"id": path.stem, "name": name}


@router.post("/{slug}/ran", dependencies=[Depends(local_origin)])
def mark_ran(slug: str):
    path = _path(slug)
    if not _load(path):
        raise HTTPException(404, "No such playbook")
    meta, body = parse_md(path.read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    meta["last_run"] = now
    atomic_write_text(path, compose_md(meta, body))
    return {"id": slug, "last_run": now}


@router.delete("/{slug}", dependencies=[Depends(local_origin)])
def remove_playbook(slug: str):
    path = _path(slug)
    if not path.exists():
        raise HTTPException(404, "No such playbook")
    path.unlink()
    return {"id": slug}
