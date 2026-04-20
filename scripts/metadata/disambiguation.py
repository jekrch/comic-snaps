import json

from .paths import DISAMBIGUATION_PATH


def load_disambiguation() -> dict:
    """Load the disambiguation file. Returns the parsed dict or empty structure."""
    if DISAMBIGUATION_PATH.exists():
        return json.loads(DISAMBIGUATION_PATH.read_text())
    return {}


def save_disambiguation(data: dict) -> None:
    """Write the disambiguation file back to disk."""
    DISAMBIGUATION_PATH.write_text(json.dumps(data, indent=2) + "\n")


def get_disambiguation_id(data: dict, source: str, resource: str, name: str) -> int | None:
    """
    Look up a manually-assigned ID for (source, resource, name).
    Returns the ID if resolved, None otherwise.
    """
    key = f"{source}:{resource}"
    entry = data.get(key, {}).get(name)
    if isinstance(entry, dict) and entry.get("id"):
        return entry["id"]
    return None


def record_disambiguation_candidates(
    data: dict, source: str, resource: str, name: str, candidates: list
) -> None:
    """
    Record unresolved candidates so the user can pick the right one later.
    Only writes if there isn't already an entry for this name.
    """
    key = f"{source}:{resource}"
    section = data.setdefault(key, {})
    if name in section:
        return  # don't overwrite existing entry (may already be resolved)
    section[name] = {
        "id": None,
        "candidates": [
            {"id": c.get("id"), "name": c.get("name")}
            for c in candidates[:10]  # cap at 10 to keep file manageable
        ],
    }
