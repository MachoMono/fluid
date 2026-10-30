"""Runs: one execution of a playbook, stored as JSON files in $FLUID_HOME/runs/<id>.json."""

import json
import re
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from fsutil import HOME, atomic_write_text, local_origin, slugify, unique_path

DIR = HOME / "runs"
ID = re.compile(r"^[0-9T]{15}-[a-z0-9-]{1,64}$")

router = APIRouter(prefix="/runs")


class NewRun(BaseModel):
    playbook: str = Field(min_length=1, max_length=80)
    playbook_id: str = Field(default="", max_length=64)


class RunPatch(BaseModel):
    status: Literal["working", "waiting", "done", "failed"] | None = None
    note: str | None = Field(default=None, max_length=300)
    step: str | None = Field(default=None, max_length=120)
    work_id: str | None = Field(default=None, max_length=64)
    dismissed: bool | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _path(rid: str):
    if not ID.match(rid):
        raise HTTPException(404, "No such run")
    return DIR / f"{rid}.json"


def _load(path):
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return doc if isinstance(doc, dict) and doc.get("id") == path.stem else None


def _save(doc: dict):
    atomic_write_text(DIR / f"{doc['id']}.json", json.dumps(doc, ensure_ascii=False, indent=2) + "\n")


@router.get("")
def list_runs(open: bool = False, limit: int = Query(default=50, ge=1, le=200)):
    rows = []
    for p in DIR.glob("*.json") if DIR.exists() else []:
        doc = _load(p)
        if not doc:
            continue
        if open and not (doc.get("status") in ("waiting", "failed") and not doc.get("dismissed")):
            continue
        rows.append(doc)
    rows.sort(key=lambda r: (str(r.get("started", "")), str(r.get("id", ""))), reverse=True)
    return rows[:limit]


@router.get("/{rid}")
def get_run(rid: str):
    doc = _load(_path(rid))
    if not doc:
        raise HTTPException(404, "No such run")
    return doc


@router.post("", dependencies=[Depends(local_origin)])
def create_run(body: NewRun):
    name = " ".join(body.playbook.split())
    if not name:
        raise HTTPException(422, "A playbook name is needed")
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y%m%dT%H%M%S")
    path = unique_path(DIR, f"{stamp}-{slugify(name)}", ".json")
    doc = {"id": path.stem, "playbook": name, "playbook_id": body.playbook_id.strip(), "status": "working",
           "note": "", "step": "", "started": now.isoformat(timespec="seconds"),
           "updated": now.isoformat(timespec="seconds"), "finished": "", "work_id": "", "dismissed": False}
    _save(doc)
    return doc


@router.patch("/{rid}", dependencies=[Depends(local_origin)])
def patch_run(rid: str, body: RunPatch):
    doc = _load(_path(rid))
    if not doc:
        raise HTTPException(404, "No such run")
    for k, v in body.model_dump(exclude_none=True).items():
        doc[k] = " ".join(v.split()) if isinstance(v, str) else v
    now = _now()
    doc["updated"] = now
    if doc.get("status") in ("done", "failed") and not doc.get("finished"):
        doc["finished"] = now
    _save(doc)
    return doc


@router.delete("/{rid}", dependencies=[Depends(local_origin)])
def remove_run(rid: str):
    path = _path(rid)
    if not path.exists():
        raise HTTPException(404, "No such run")
    path.unlink()
    return {"id": rid}
