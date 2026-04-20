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
