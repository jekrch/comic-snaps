# Source identifiers for tracking which sources have processed an entry
SOURCE_WIKIPEDIA = "wikipedia"
SOURCE_COMICVINE = "comicvine"
SOURCE_METRON = "metron"
SOURCE_GCD = "gcd"


def _set_if_missing(entry: dict, field: str, value) -> bool:
    """Set `entry[field] = value` only if missing/empty. Returns True if changed."""
    if value in (None, "", [], {}):
        return False
    existing = entry.get(field)
    if existing not in (None, "", [], {}):
        return False
    entry[field] = value
    return True


def has_source(entry: dict, source_id: str) -> bool:
    """Check if an entry has already been processed by the given source."""
    return source_id in entry.get("sources", [])


def mark_source(entry: dict, source_id: str) -> None:
    """Record that a source has processed this entry (even if nothing was found)."""
    sources = entry.setdefault("sources", [])
    if source_id not in sources:
        sources.append(source_id)


def ensure_reference(entry: dict, name: str, url: str) -> None:
    """Add a reference to `entry` if one with the same name isn't already present."""
    refs = entry.setdefault("references", [])
    for ref in refs:
        if (ref.get("name") or "").strip().lower() == name.strip().lower():
            return
    refs.append({"name": name, "url": url})
