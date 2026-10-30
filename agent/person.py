"""The person's profile: a single plain file, ~/Fluid/profile.md, written by the interview and editable by hand.

Only the front matter is read here: `name: Caleb` is what the Horizon greets them by. Read-only on purpose;
the companion agent saves changes through the shell, like everything else the person keeps.
"""

from fastapi import APIRouter

from fsutil import HOME, parse_md

router = APIRouter(prefix="/profile")


@router.get("")
def get_profile():
    try:
        meta, _ = parse_md((HOME / "profile.md").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"name": ""}
    return {"name": meta.get("name", "").strip()[:60]}
