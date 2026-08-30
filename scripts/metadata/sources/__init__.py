API_HEADERS = {"User-Agent": "comic-snaps/1.0 (https://github.com/jekrch/comic-snaps)"}

MAX_COVER_IMAGES = 4


def parse_issue_number(value) -> int | None:
    """Parse a whole issue number out of a source payload, or None.

    Returns None only when the value is absent or isn't a whole number
    (Metron's "½", Comic Vine's "1.MU").  Issue **0** is a real number —
    one-shots and specials carry it in the gallery — so it must come back as
    0 rather than collapsing into None the way a plain truthiness test would
    make it.
    """
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def pick_exact_match(results: list, name: str, tiebreak_key: str | None = None) -> dict | None:
    """
    Pick the result whose name matches `name` case-insensitively.

    If multiple exact matches exist and `tiebreak_key` is provided, pick the
    one with the highest numeric value for that key (e.g. count_of_issues).
    Returns None if no exact match.
    """
    norm = name.strip().lower()
    exact = [r for r in results if (r.get("name") or "").strip().lower() == norm]
    if not exact:
        return None
    if len(exact) == 1 or not tiebreak_key:
        return exact[0]
    return max(exact, key=lambda r: int(r.get(tiebreak_key) or 0))
