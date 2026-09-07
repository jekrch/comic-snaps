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


def parse_year_began(value) -> int | None:
    """Parse a series' start year out of a source payload, or None.

    Sources disagree on the type: Metron sends an int, Comic Vine a string.
    Anything unparseable comes back as None, which every caller reads as
    "unknown" rather than "contradiction".
    """
    try:
        return int(value) if value else None
    except (TypeError, ValueError):
        return None


def filter_by_start_year(results: list, start_year: int | None, key: str) -> list:
    """
    Drop series/volume results whose start year contradicts the one we know.

    Both sources search on title alone, so a relaunch under an old name
    ("Legion of Super-Heroes", 1989 and 2026) hands back every volume that
    ever carried it. When an earlier source — or a hand edit — has already
    established startYear, a differing start year is proof of a wrong
    series. Results with no parseable year stay in: a missing year isn't a
    contradiction.

    `key` is whichever field the source spells it with (`year_began` on
    Metron, `start_year` on Comic Vine).
    """
    if not start_year:
        return results
    return [
        r for r in results
        if parse_year_began(r.get(key)) in (None, start_year)
    ]


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
