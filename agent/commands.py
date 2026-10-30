"""Run one shell command the person has just approved.

The agent has no shell. It proposes a command in shared state; the shell shows the exact text on an approval card,
and only when the person presses Run does the page call this endpoint with that text. Commands run as the person,
inside ~/Fluid or a folder they have added, with no input, a time limit and a cap on output. Every command is logged.
"""

import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from fsutil import HOME, allowed_roots, local_origin

router = APIRouter(prefix="/commands")

TIMEOUT_S = 30
MAX_OUT = 20_000
# A second line of defence behind the person's own approval: things that are almost never intended.
REFUSED = re.compile(r"\b(sudo|su|doas|mkfs\w*|shutdown|reboot|poweroff)\b|\bdd\s+if=|:\(\)\s*\{|>\s*/dev/(sd|nvme)|\brm\s+-\w*r\w*f?\w*\s+(/|~|\$HOME)(\s|$)")


class Command(BaseModel):
    cmd: str = Field(min_length=1, max_length=2000)
    cwd: str = ""


def _folder(cwd: str) -> Path:
    roots = allowed_roots()
    if not cwd:
        return roots[0]
    p = Path(cwd).expanduser()
    p = (roots[0] / p) if not p.is_absolute() else p
    try:
        p = p.resolve()
    except OSError:
        raise HTTPException(400, "That folder does not exist")
    if not p.is_dir() or not any(p == r or r in p.parents for r in roots):
        raise HTTPException(403, "Commands can only run in ~/Fluid or a folder you have added")
    return p


def _clip(text: str) -> str:
    return text if len(text) <= MAX_OUT else text[:MAX_OUT] + f"\n[output cut at {MAX_OUT} characters]"


@router.post("", dependencies=[Depends(local_origin)])
def run(body: Command):
    if REFUSED.search(body.cmd):
        raise HTTPException(403, "That command is not allowed")
    folder = _folder(body.cwd)
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "LANG", "LC_ALL", "TERM", "USER")}
    timed_out = False
    try:
        r = subprocess.run(["/bin/bash", "-c", body.cmd], cwd=folder, env=env, stdin=subprocess.DEVNULL,
                           capture_output=True, text=True, timeout=TIMEOUT_S, errors="replace")
        code, out, err = r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired as e:
        timed_out, code = True, -1
        out = (e.stdout.decode(errors="replace") if isinstance(e.stdout, bytes) else e.stdout) or ""
        err = (e.stderr.decode(errors="replace") if isinstance(e.stderr, bytes) else e.stderr) or ""
    try:
        (HOME / "runs").mkdir(parents=True, exist_ok=True)
        with open(HOME / "runs" / "commands.log", "a", encoding="utf-8") as f:
            f.write(json.dumps({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "cwd": str(folder),
                                "cmd": body.cmd, "exit": code, "timed_out": timed_out}, ensure_ascii=False) + "\n")
    except OSError:
        pass
    return {"exit": code, "stdout": _clip(out), "stderr": _clip(err), "timed_out": timed_out, "cwd": str(folder)}
