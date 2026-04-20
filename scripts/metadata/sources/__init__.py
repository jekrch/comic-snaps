API_HEADERS = {"User-Agent": "comic-snaps/1.0 (https://github.com/jekrch/comic-snaps)"}

MAX_COVER_IMAGES = 4


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
