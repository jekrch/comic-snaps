import json

from .paths import ARTISTS_PATH, SERIES_PATH
from .text import slugify


def seed_artists(panels: list) -> None:
    """Ensure artists.json contains an entry for every distinct artist in the gallery."""
    if ARTISTS_PATH.exists():
        data = json.loads(ARTISTS_PATH.read_text())
        artists = data.get("artists", [])
    else:
        artists = []

    existing_ids = {a.get("id") for a in artists}
    existing_names = {a.get("name") for a in artists}

    added = 0
    seen_new = set()
    for panel in panels:
        name = panel.get("artist", "")
        if not name or name in seen_new or name in existing_names:
            continue
        artist_id = slugify(name)
        if artist_id in existing_ids:
            continue
        seen_new.add(name)
        existing_ids.add(artist_id)
        existing_names.add(name)
        artists.append({
            "id": artist_id,
            "name": name,
            "description": "",
            "imageUrl": None,
            "references": [],
        })
        added += 1

    artists.sort(key=lambda a: a["name"])
    ARTISTS_PATH.write_text(json.dumps({"artists": artists}, indent=2) + "\n")
    if added:
        print(f"Added {added} new artist(s) to {ARTISTS_PATH}.")


def seed_series(panels: list) -> None:
    """Ensure series.json contains an entry for every distinct series in the gallery."""
    if SERIES_PATH.exists():
        data = json.loads(SERIES_PATH.read_text())
        series_list = data.get("series", [])
    else:
        series_list = []

    existing_ids = {s.get("id") for s in series_list}

    added = 0
    seen_new = set()
    for panel in panels:
        title = panel.get("title", "")
        slug = panel.get("slug", "")
        if not title or not slug or slug in seen_new or slug in existing_ids:
            continue
        seen_new.add(slug)
        existing_ids.add(slug)
        series_list.append({
            "id": slug,
            "name": title,
            "parentSeries": None,
            "description": "",
            "imageUrl": None,
            "references": [],
        })
        added += 1

    series_list.sort(key=lambda s: s["name"])
    SERIES_PATH.write_text(json.dumps({"series": series_list}, indent=2) + "\n")
    if added:
        print(f"Added {added} new series to {SERIES_PATH}.")


def _issue_number(value) -> int | None:
    """Return a panel's issue as a whole number, or None if it isn't one.

    Issues are usually ints, but the gallery also carries "N/A", "Vol 8", and
    the occasional half-issue — none of which say anything about how far a
    series has run.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else None
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


def sync_issue_counts(panels: list) -> int:
    """Raise each series' issueCount to the highest issue number in the gallery.

    A series is queried once, when it first appears, and the external
    backfills never revisit an entry they have already filled. For a series
    that was still being published at that moment, the recorded count goes
    stale as new issues are posted. Rather than re-query every series on every
    run, treat the gallery as evidence: owning a panel from issue N means the
    series ran to at least N issues.

    Only raises counts that already exist. A missing count means no source
    matched the series at all, and a single panel is far too little to guess
    the length of a run from.

    Because it is a floor rather than a verified count, a raised value is
    marked `issueCountInferred` so the UI can present it as "N+ issues". The
    mark is cleared if the stored count later climbs above the gallery's
    highest issue, which means a source (or a hand edit) has superseded it.
    """
    if not SERIES_PATH.exists():
        return 0

    highest: dict[str, int] = {}
    for panel in panels:
        slug = panel.get("slug", "")
        number = _issue_number(panel.get("issue"))
        if not slug or number is None or number < 1:
            continue
        if number > highest.get(slug, 0):
            highest[slug] = number

    data = json.loads(SERIES_PATH.read_text())
    series_list = data.get("series", [])

    raised = 0
    cleared = 0
    for series in series_list:
        count = series.get("issueCount")
        if not isinstance(count, int):
            continue
        seen = highest.get(series.get("id", ""))
        if seen is None:
            continue
        if seen > count:
            print(f"    {series['id']}: issueCount {count} → {seen} (panel from issue {seen})")
            series["issueCount"] = seen
            series["issueCountInferred"] = True
            raised += 1
        elif count > seen and series.get("issueCountInferred"):
            # Something more authoritative now exceeds our floor.
            del series["issueCountInferred"]
            cleared += 1

    if raised or cleared:
        SERIES_PATH.write_text(json.dumps({"series": series_list}, indent=2) + "\n")
    return raised
