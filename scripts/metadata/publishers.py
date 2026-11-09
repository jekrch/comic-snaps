"""
The publisher registry: `public/data/publishers.json`.

Series used to carry their publisher as a free-text string, written by
whichever source matched the series first. The same company ended up spelled
several ways ("Image" / "Image Comics", "Kitchen Sink" / "Kitchen Sink
Press"), imprints were stored as if they were publishers ("Skybound"), and
nothing else could be said about a publisher because there was nowhere to say
it.

Each publisher, imprint or self-publishing label is now one registry entry:

    {
      "id": "kitchen-sink-press",
      "name": "Kitchen Sink Press",
      "kind": "publisher",            # or "imprint", "self-published"
      "parent": null,                  # an imprint's publisher id
      "aliases": ["Kitchen Sink"],
      "description": "...",
      "imageUrl": "...",
      "foundedYear": 1970,             # Metron's founding year
      "activeFrom": 1969, "activeUntil": 1999,   # GCD's publishing years
      "country": "United States", "location": "Princeton, Wisconsin",
      "website": "...",
      "founders": [{"artistId": "denis-kitchen", "name": "Denis Kitchen"}],
      "references": [...],
      "ids": {"metron": 12, "comicvine": 1234, "gcd": 56},
      "sources": ["wikipedia", "metron"]
    }

A series points at it with `publisherId` and, for an imprint, `imprintId`. The
`publisher` string stays on the series as the display name of the parent
publisher (and `imprint` as the imprint's), so the site and the Telegram
worker keep working without loading the registry. The string is also what
people edit: when it no longer names the linked entry, it wins and the ids are
re-resolved from it.

The network passes run in this order, each skipping work an earlier one made
unnecessary:

1. Wikipedia intros for entries with a Wikipedia reference (preferred
   description).
2. Metron series detail, by the series id already in the Metron reference:
   the publisher and imprint as ids, not just names.
3. Metron publisher/imprint detail: description, logo, founding year,
   country, and Comic Vine / GCD ids for free.
4. Comic Vine volume detail, then GCD series detail, only for series whose
   publisher still lacks that source's id.
5. Comic Vine and GCD publisher detail: location, aliases, the years GCD
   has the publisher's books spanning, website, and descriptions where
   nothing better exists.

GCD's years are kept apart from `foundedYear`. They are the span of the
publisher's books in its index, which can start before the company did
(Fantagraphics: 1972 in GCD, founded 1976).

A source's answer only ever *adds*: it fills a missing publisher, attaches its
id to the entry we already link, or files the series under one of that
publisher's imprints. When it names a different publisher than the one a
series already has, that is logged and left alone, since the existing value
may be a deliberate hand edit (Archie's 2026 titles are Oni Press, not Archie
Comics).
"""

import json
import re
import sys
import time
from pathlib import Path

from .health import IntegrationHealth
from .references import _set_if_missing, ensure_reference, has_source, mark_source
from .sources.comicvine import (
    comic_vine_get,
    extract_comicvine_image,
    extract_comicvine_volume_id,
)
from .sources.gcd import GCD_BASE, GCD_BASE_SLEEP, gcd_fetch_json
from .sources.metron import metron_get
from .sources.wikipedia import backfill_wikipedia_descriptions
from .text import is_meaningful_description, slugify, strip_html

KIND_PUBLISHER = "publisher"
KIND_IMPRINT = "imprint"
KIND_SELF_PUBLISHED = "self-published"

# Per-series markers: this source's series record has been read for its
# publisher. Kept apart from the plain source markers, which record the
# field backfills that ran long before the registry existed.
SERIES_LOOKUP_MARKERS = {
    "metron": "metron-publisher",
    "comicvine": "comicvine-publisher",
    "gcd": "gcd-publisher",
}

METRON_SLEEP = 3.0  # 20 requests/min
COMIC_VINE_SLEEP = 1.0

METRON_SERIES_ID_RE = re.compile(r"metron\.cloud/series/(\d+)")
GCD_SERIES_ID_RE = re.compile(r"comics\.org/series/(\d+)")
GCD_PUBLISHER_ID_RE = re.compile(r"/publisher/(\d+)")

# Words that differ between sources' spellings of one company and say
# nothing about which company it is: "Image" / "Image Comics",
# "Kitchen Sink" / "Kitchen Sink Press", "Boom! Studios" / "BOOM!".
_CORPORATE_SUFFIXES = {
    "comics", "comic", "press", "publishing", "publications", "publication",
    "publishers", "publisher", "books", "inc", "ltd", "llc", "co", "corp",
    "company", "entertainment", "studios", "studio", "productions",
    "production", "group", "media", "international",
}

# Metron and GCD give ISO 3166-1 codes; artists.json stores country names,
# so publishers do too. Only codes plausible for this collection are listed —
# an unlisted code is dropped rather than stored raw.
_COUNTRY_NAMES = {
    "us": "United States", "gb": "United Kingdom", "uk": "United Kingdom",
    "ca": "Canada", "fr": "France", "be": "Belgium", "it": "Italy",
    "es": "Spain", "de": "Germany", "nl": "Netherlands", "jp": "Japan",
    "kr": "South Korea", "au": "Australia", "nz": "New Zealand",
    "ie": "Ireland", "se": "Sweden", "no": "Norway", "dk": "Denmark",
    "fi": "Finland", "ch": "Switzerland", "at": "Austria", "pt": "Portugal",
    "pl": "Poland", "mx": "Mexico", "ar": "Argentina", "br": "Brazil",
}


def country_name(code) -> str | None:
    if not isinstance(code, str):
        return None
    return _COUNTRY_NAMES.get(code.strip().lower())


def _exact(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().lower())


def name_key(name: str) -> str:
    """A loose matching key for a publisher name.

    Lower-cased, "&" read as "and", bracketed asides dropped ("Food Chain
    (self-published)", GCD's "Nate Powell [SeeMyBrotherDance]"), punctuation
    removed, a leading "the" and trailing corporate words stripped. Never
    strips down to nothing: a name made only of such words keys as itself.
    """
    text = name.lower().replace("&", " and ")
    text = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", text)
    words = re.findall(r"[a-z0-9]+", text)
    if words[:1] == ["the"] and len(words) > 1:
        words = words[1:]
    while len(words) > 1 and words[-1] in _CORPORATE_SUFFIXES:
        words.pop()
    return " ".join(words) or _exact(name)


class Registry:
    """publishers.json in memory, indexed for name and source-id lookups."""

    def __init__(self, entries: list[dict]):
        self.entries = entries
        self.changed = False

    @classmethod
    def load(cls, path: Path) -> "Registry":
        if path.exists():
            return cls(json.loads(path.read_text()).get("publishers", []))
        return cls([])

    def save(self, path: Path) -> None:
        self.entries.sort(key=lambda e: (e.get("name") or "").lower())
        path.write_text(json.dumps({"publishers": self.entries}, indent=2) + "\n")

    def get(self, entry_id: str | None) -> dict | None:
        if not entry_id:
            return None
        for e in self.entries:
            if e.get("id") == entry_id:
                return e
        return None

    @staticmethod
    def names_of(entry: dict) -> list[str]:
        return [entry.get("name") or ""] + list(entry.get("aliases") or [])

    def names_match(self, entry: dict, name: str) -> bool:
        exact = _exact(name)
        key = name_key(name)
        return any(
            _exact(n) == exact or name_key(n) == key
            for n in self.names_of(entry) if n
        )

    def resolve(self, name: str | None) -> dict | None:
        """The one entry this name refers to, or None if none or several do.

        An exact name or alias wins outright; only then is the loose key
        tried, and a key two entries share is treated as no match.
        """
        if not name or not name.strip():
            return None
        exact = _exact(name)
        hits = [e for e in self.entries if any(_exact(n) == exact for n in self.names_of(e) if n)]
        if len(hits) == 1:
            return hits[0]
        if hits:
            return None
        key = name_key(name)
        hits = [e for e in self.entries if any(name_key(n) == key for n in self.names_of(e) if n)]
        return hits[0] if len(hits) == 1 else None

    def by_source_id(self, source: str, source_id, imprint: bool | None = None) -> dict | None:
        """The entry holding this source id.

        Metron numbers imprints and publishers separately, so `imprint`
        restricts the search to one kind (None searches both — right for
        Comic Vine and GCD, which file imprints as publishers).
        """
        if source_id is None:
            return None
        for e in self.entries:
            if imprint is True and e.get("kind") != KIND_IMPRINT:
                continue
            if imprint is False and e.get("kind") == KIND_IMPRINT:
                continue
            if (e.get("ids") or {}).get(source) == source_id:
                return e
        return None

    def create(self, name: str, kind: str = KIND_PUBLISHER, parent: str | None = None) -> dict:
        base = slugify(name) or "publisher"
        entry_id = base
        n = 2
        while self.get(entry_id):
            entry_id = f"{base}-{n}"
            n += 1
        entry = {
            "id": entry_id,
            "name": name.strip(),
            "kind": kind,
            "parent": parent,
            "aliases": [],
            "description": "",
            "imageUrl": None,
            "references": [],
            "ids": {},
        }
        self.entries.append(entry)
        self.changed = True
        print(f"    + new {kind}: {entry['name']} ({entry_id})")
        return entry

    def attach_id(self, entry: dict, source: str, source_id) -> bool:
        """Record a source id on an entry, never replacing a different one."""
        if source_id is None:
            return False
        ids = entry.setdefault("ids", {})
        current = ids.get(source)
        if current == source_id:
            return False
        if current is not None:
            print(f"    WARN: {entry['id']} already has {source} id {current}, "
                  f"not replacing it with {source_id}")
            return False
        ids[source] = source_id
        self.changed = True
        return True

    def make_imprint(self, entry: dict, parent_id: str) -> None:
        """Re-file an entry as an imprint of `parent_id` (a source said so)."""
        if entry.get("kind") == KIND_IMPRINT and entry.get("parent"):
            return
        entry["kind"] = KIND_IMPRINT
        entry["parent"] = parent_id
        self.changed = True
        print(f"    {entry['id']} is an imprint of {parent_id}")

    def add_aliases(self, entry: dict, names) -> bool:
        changed = False
        aliases = entry.setdefault("aliases", [])
        for raw in names or []:
            if not isinstance(raw, str) or not raw.strip():
                continue
            alias = raw.strip()
            if any(_exact(alias) == _exact(n) for n in self.names_of(entry) if n):
                continue
            aliases.append(alias)
            changed = True
        if changed:
            self.changed = True
        return changed


# ---------------------------------------------------------------------------
# Linking series to the registry (offline)
# ---------------------------------------------------------------------------

def _place_after(entry: dict, anchor: str, fields: dict) -> None:
    """Set `fields` on `entry` right after `anchor`, keeping the file's key
    order so a rewrite diffs only where values changed. A None value removes
    the key."""
    items = [(k, v) for k, v in entry.items() if k not in fields]
    out: list[tuple[str, object]] = []
    placed = False
    for k, v in items:
        out.append((k, v))
        if k == anchor:
            out.extend((fk, fv) for fk, fv in fields.items() if fv is not None)
            placed = True
    if not placed:
        out.extend((fk, fv) for fk, fv in fields.items() if fv is not None)
    entry.clear()
    entry.update(out)


def _write_series_links(series: dict, reg: Registry, publisher_id: str | None,
                        imprint_id: str | None) -> bool:
    pub = reg.get(publisher_id)
    imp = reg.get(imprint_id)
    before = {k: series.get(k) for k in ("publisher", "publisherId", "imprintId", "imprint")}
    fields = {
        "publisherId": publisher_id,
        "imprintId": imprint_id,
        "imprint": imp["name"] if imp else None,
    }
    if pub:
        series["publisher"] = pub["name"]
    if "publisher" not in series:
        series["publisher"] = None
    _place_after(series, "publisher", fields)
    after = {k: series.get(k) for k in ("publisher", "publisherId", "imprintId", "imprint")}
    return before != after


def link_series(series: dict, reg: Registry) -> bool:
    """Bring one series' publisherId/imprintId and display strings into line
    with the registry. Returns True if the series changed."""
    name = series.get("publisher")
    if isinstance(name, str) and re.match(r"^https?://", name):
        # A source once wrote a GCD API URL here; it names nothing.
        name = None
        series["publisher"] = None
    publisher_id = series.get("publisherId")
    imprint_id = series.get("imprintId")

    # The string is the field people edit. If it no longer names the linked
    # publisher or imprint, it was changed by hand and the ids follow it.
    if publisher_id and name:
        pub, imp = reg.get(publisher_id), reg.get(imprint_id)
        if not ((pub and reg.names_match(pub, name)) or (imp and reg.names_match(imp, name))):
            print(f"    {series.get('id')}: publisher \"{name}\" no longer matches "
                  f"{publisher_id}; re-linking from the name")
            publisher_id = imprint_id = None

    if not publisher_id and name:
        entry = reg.resolve(name) or reg.create(name)
        publisher_id = entry["id"]

    pub = reg.get(publisher_id)
    if publisher_id and not pub:
        print(f"    WARN: {series.get('id')}: publisherId {publisher_id} is not in the registry",
              file=sys.stderr)
        return False

    # Linked straight to an imprint (its name was the series' publisher
    # string, or a source has since re-filed the entry as an imprint).
    if pub and pub.get("kind") == KIND_IMPRINT:
        imprint_id = imprint_id or pub["id"]
        publisher_id = pub.get("parent") or pub["id"]

    imp = reg.get(imprint_id)
    if imprint_id and not imp:
        print(f"    WARN: {series.get('id')}: imprintId {imprint_id} is not in the registry",
              file=sys.stderr)
    elif imp and imp.get("parent") and imp.get("parent") != publisher_id:
        print(f"    WARN: {series.get('id')}: imprint {imprint_id} belongs to "
              f"{imp['parent']}, not {publisher_id}", file=sys.stderr)

    return _write_series_links(series, reg, publisher_id, imprint_id)


def link_all_series(series_list: list[dict], reg: Registry) -> int:
    return sum(1 for s in series_list if link_series(s, reg))


# ---------------------------------------------------------------------------
# Applying a source's answer to a series
# ---------------------------------------------------------------------------

def apply_source_publisher(series: dict, reg: Registry, source: str,
                           pub_id, pub_name: str | None,
                           imprint_id=None, imprint_name: str | None = None) -> bool:
    """Fold one source's publisher (and imprint) for a series into the
    registry and the series. Only adds; see the module docstring."""
    if not pub_name and pub_id is None:
        return False
    sid = series.get("id")
    metron = source == "metron"
    entry = reg.by_source_id(source, pub_id, imprint=False if metron else None) or reg.resolve(pub_name)
    publisher_id = series.get("publisherId")
    current_imprint = series.get("imprintId")
    changed = False

    if not publisher_id:
        if entry is None:
            if not pub_name:
                return False
            entry = reg.create(pub_name)
        if entry.get("kind") == KIND_IMPRINT:
            current_imprint = entry["id"]
            publisher_id = entry.get("parent") or entry["id"]
        else:
            publisher_id = entry["id"]
        print(f"    {sid}: publisher from {source}: {entry['name']}")
        reg.attach_id(entry, source, pub_id)
        changed = True
    elif entry is None:
        print(f"    {sid}: {source} says \"{pub_name}\", which isn't {publisher_id} "
              f"or any known publisher; left as is")
    elif entry["id"] in (publisher_id, current_imprint):
        reg.attach_id(entry, source, pub_id)
    elif entry.get("kind") == KIND_IMPRINT and entry.get("parent") == publisher_id and not current_imprint:
        current_imprint = entry["id"]
        reg.attach_id(entry, source, pub_id)
        print(f"    {sid}: imprint from {source}: {entry['name']}")
        changed = True
    else:
        print(f"    {sid}: {source} says {entry['id']}, series has {publisher_id}; left as is")

    if metron and imprint_name:
        imp = reg.by_source_id(source, imprint_id, imprint=True) or reg.resolve(imprint_name)
        # Metron's imprint belongs to Metron's publisher; only take it when
        # that publisher is the one this series is linked to.
        source_publisher_agrees = entry is not None and entry["id"] == publisher_id
        if imp is None and source_publisher_agrees:
            imp = reg.create(imprint_name, kind=KIND_IMPRINT, parent=publisher_id)
        if imp is not None and source_publisher_agrees and imp["id"] != publisher_id:
            if imp.get("kind") != KIND_IMPRINT:
                reg.make_imprint(imp, publisher_id)
            if not current_imprint and imp.get("parent") == publisher_id:
                current_imprint = imp["id"]
                print(f"    {sid}: imprint from {source}: {imp['name']}")
                changed = True
            if current_imprint == imp["id"]:
                reg.attach_id(imp, source, imprint_id)

    if changed or series.get("imprintId") != current_imprint:
        _write_series_links(series, reg, publisher_id, current_imprint)
        return True
    return False


# ---------------------------------------------------------------------------
# Series lookups (network)
# ---------------------------------------------------------------------------

def _ref_id(series: dict, ref_name: str, pattern: re.Pattern) -> int | None:
    for ref in series.get("references") or []:
        if (ref.get("name") or "").strip().lower() == ref_name.lower():
            m = pattern.search(ref.get("url") or "")
            if m:
                return int(m.group(1))
    return None


def _named(obj) -> tuple[int | None, str | None]:
    if isinstance(obj, dict):
        raw_id = obj.get("id")
        try:
            raw_id = int(raw_id) if raw_id is not None else None
        except (TypeError, ValueError):
            raw_id = None
        return raw_id, (obj.get("name") or None)
    if isinstance(obj, str) and obj.strip():
        return None, obj.strip()
    return None, None


def _needs_source_id(series: dict, reg: Registry, source: str) -> bool:
    """Whether a lookup in `source` could still tell us something new: the
    series has no publisher, or its publisher (or imprint) lacks this
    source's id."""
    pub = reg.get(series.get("publisherId"))
    if pub is None:
        return True
    linked = [pub] + ([reg.get(series["imprintId"])] if series.get("imprintId") else [])
    return any(e is not None and (e.get("ids") or {}).get(source) is None for e in linked)


def lookup_metron_series(series_list: list[dict], reg: Registry, username: str, password: str) -> int:
    health = IntegrationHealth("Metron (publishers)")
    marker = SERIES_LOOKUP_MARKERS["metron"]
    done = 0
    for series in series_list:
        if health.should_bail:
            break
        if has_source(series, marker):
            continue
        metron_id = _ref_id(series, "Metron", METRON_SERIES_ID_RE)
        if metron_id is None:
            continue
        print(f"  Fetching Metron series {metron_id} for {series.get('name')}...")
        data = metron_get(f"series/{metron_id}/", {}, username, password, health=health)
        time.sleep(METRON_SLEEP)
        if not data:
            continue
        pub_id, pub_name = _named(data.get("publisher"))
        imp_id, imp_name = _named(data.get("imprint"))
        apply_source_publisher(series, reg, "metron", pub_id, pub_name, imp_id, imp_name)
        mark_source(series, marker)
        done += 1
    return done


def lookup_comicvine_series(series_list: list[dict], reg: Registry, api_key: str) -> int:
    health = IntegrationHealth("Comic Vine (publishers)")
    marker = SERIES_LOOKUP_MARKERS["comicvine"]
    done = 0
    for series in series_list:
        if health.should_bail:
            break
        if has_source(series, marker) or not _needs_source_id(series, reg, "comicvine"):
            continue
        volume_id = extract_comicvine_volume_id(series)
        if not volume_id:
            continue
        print(f"  Fetching Comic Vine volume {volume_id} for {series.get('name')}...")
        data = comic_vine_get(f"volume/4050-{volume_id}/", {"field_list": "publisher"},
                              api_key, health=health)
        time.sleep(COMIC_VINE_SLEEP)
        if not data:
            continue
        pub_id, pub_name = _named((data.get("results") or {}).get("publisher"))
        apply_source_publisher(series, reg, "comicvine", pub_id, pub_name)
        mark_source(series, marker)
        done += 1
    return done


def lookup_gcd_series(series_list: list[dict], reg: Registry,
                      gcd_cache: dict[int, dict]) -> int:
    health = IntegrationHealth("GCD (publishers)")
    marker = SERIES_LOOKUP_MARKERS["gcd"]
    done = 0
    for series in series_list:
        if health.should_bail:
            break
        if has_source(series, marker) or not _needs_source_id(series, reg, "gcd"):
            continue
        gcd_id = _ref_id(series, "Grand Comics Database", GCD_SERIES_ID_RE)
        if gcd_id is None:
            continue
        print(f"  Fetching GCD series {gcd_id} for {series.get('name')}...")
        data = gcd_fetch_json(f"{GCD_BASE}/series/{gcd_id}/", health=health)
        time.sleep(GCD_BASE_SLEEP)
        if not data:
            continue
        m = GCD_PUBLISHER_ID_RE.search(str(data.get("publisher") or ""))
        if not m:
            mark_source(series, marker)
            continue
        pub_id = int(m.group(1))
        pub_data = gcd_cache.get(pub_id) or _fetch_gcd_publisher(pub_id, health, gcd_cache)
        if pub_data is None:
            continue
        apply_source_publisher(series, reg, "gcd", pub_id, pub_data.get("name"))
        mark_source(series, marker)
        done += 1
    return done


# ---------------------------------------------------------------------------
# Publisher detail (network)
# ---------------------------------------------------------------------------

def _fill_description(entry: dict, raw: str | None, label: str) -> bool:
    if is_meaningful_description(entry.get("description") or ""):
        return False
    clean = strip_html(raw) if raw else ""
    if is_meaningful_description(clean):
        entry["description"] = clean
        print(f"    desc ({label}): {clean[:80]}...")
        return True
    return False


def _fill(entry: dict, field: str, value) -> bool:
    if _set_if_missing(entry, field, value):
        print(f"    {field}: {value}")
        return True
    return False


def _int_or_none(value) -> int | None:
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def apply_metron_detail(entry: dict, reg: Registry, data: dict) -> None:
    _fill_description(entry, data.get("desc"), "Metron")
    _fill(entry, "imageUrl", data.get("image"))
    _fill(entry, "foundedYear", _int_or_none(data.get("founded")))
    _fill(entry, "country", country_name(data.get("country")))
    reg.add_aliases(entry, data.get("alt_names"))
    reg.attach_id(entry, "comicvine", _int_or_none(data.get("cv_id")))
    reg.attach_id(entry, "gcd", _int_or_none(data.get("gcd_id")))
    if data.get("resource_url"):
        ensure_reference(entry, "Metron", data["resource_url"])
    if entry.get("kind") == KIND_IMPRINT and not entry.get("parent"):
        parent_id, parent_name = _named(data.get("publisher"))
        parent = reg.by_source_id("metron", parent_id, imprint=False) or reg.resolve(parent_name)
        if parent is not None:
            entry["parent"] = parent["id"]
            print(f"    parent: {parent['id']}")


def apply_comicvine_detail(entry: dict, reg: Registry, data: dict) -> None:
    _fill_description(entry, data.get("description") or data.get("deck"), "Comic Vine")
    _fill(entry, "imageUrl", extract_comicvine_image(data))
    city = (data.get("location_city") or "").strip()
    state = (data.get("location_state") or "").strip()
    _fill(entry, "location", ", ".join(p for p in (city, state) if p) or None)
    aliases = (data.get("aliases") or "").splitlines()
    reg.add_aliases(entry, aliases)
    if data.get("site_detail_url"):
        ensure_reference(entry, "Comic Vine", data["site_detail_url"])


def apply_gcd_detail(entry: dict, gcd_id: int, data: dict) -> None:
    _fill_description(entry, data.get("notes"), "GCD")
    if not data.get("year_began_uncertain"):
        _fill(entry, "activeFrom", _int_or_none(data.get("year_began")))
    if not data.get("year_ended_uncertain"):
        _fill(entry, "activeUntil", _int_or_none(data.get("year_ended")))
    _fill(entry, "country", country_name(data.get("country")))
    _fill(entry, "website", (data.get("url") or "").strip() or None)
    ensure_reference(entry, "Grand Comics Database", f"https://www.comics.org/publisher/{gcd_id}/")


def _fetch_gcd_publisher(gcd_id: int, health: IntegrationHealth,
                         cache: dict[int, dict]) -> dict | None:
    data = gcd_fetch_json(f"{GCD_BASE}/publisher/{gcd_id}/", health=health)
    time.sleep(GCD_BASE_SLEEP)
    if data:
        cache[gcd_id] = data
    return data


def fetch_metron_details(reg: Registry, username: str, password: str) -> int:
    health = IntegrationHealth("Metron (publisher detail)")
    done = 0
    for entry in list(reg.entries):
        if health.should_bail:
            break
        metron_id = (entry.get("ids") or {}).get("metron")
        if metron_id is None or has_source(entry, "metron"):
            continue
        resource = "imprint" if entry.get("kind") == KIND_IMPRINT else "publisher"
        print(f"  Fetching Metron {resource} {metron_id} for {entry['name']}...")
        data = metron_get(f"{resource}/{metron_id}/", {}, username, password, health=health)
        time.sleep(METRON_SLEEP)
        if not data:
            continue
        apply_metron_detail(entry, reg, data)
        mark_source(entry, "metron")
        reg.changed = True
        done += 1
    return done


def fetch_comicvine_details(reg: Registry, api_key: str) -> int:
    health = IntegrationHealth("Comic Vine (publisher detail)")
    done = 0
    fields = "name,aliases,deck,description,image,location_city,location_state,site_detail_url"
    for entry in reg.entries:
        if health.should_bail:
            break
        cv_id = (entry.get("ids") or {}).get("comicvine")
        if cv_id is None or has_source(entry, "comicvine"):
            continue
        print(f"  Fetching Comic Vine publisher {cv_id} for {entry['name']}...")
        data = comic_vine_get(f"publisher/4010-{cv_id}/", {"field_list": fields},
                              api_key, health=health)
        time.sleep(COMIC_VINE_SLEEP)
        if not data:
            continue
        apply_comicvine_detail(entry, reg, data.get("results") or {})
        mark_source(entry, "comicvine")
        reg.changed = True
        done += 1
    return done


def fetch_gcd_details(reg: Registry, cache: dict[int, dict]) -> int:
    health = IntegrationHealth("GCD (publisher detail)")
    done = 0
    for entry in reg.entries:
        if health.should_bail:
            break
        gcd_id = (entry.get("ids") or {}).get("gcd")
        if gcd_id is None or has_source(entry, "gcd"):
            continue
        data = cache.get(gcd_id)
        if data is None:
            print(f"  Fetching GCD publisher {gcd_id} for {entry['name']}...")
            data = _fetch_gcd_publisher(gcd_id, health, cache)
        if not data:
            continue
        apply_gcd_detail(entry, gcd_id, data)
        mark_source(entry, "gcd")
        reg.changed = True
        done += 1
    return done


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def backfill_publishers(series_path: Path, publishers_path: Path, *,
                        metron_creds: tuple[str, str] | None,
                        comic_vine_key: str | None,
                        skip_gcd: bool) -> int:
    """Link every series to the registry, then enrich it from the sources
    that are available. Returns the number of series whose links changed."""
    if not series_path.exists():
        return 0
    data = json.loads(series_path.read_text())
    series_list = data.get("series", [])
    reg = Registry.load(publishers_path)
    series_before = json.dumps(series_list)

    linked = link_all_series(series_list, reg)
    if linked:
        print(f"  Linked {linked} series to the registry.")
    if reg.changed or not publishers_path.exists():
        reg.save(publishers_path)
        reg.changed = False

    # The Wikipedia pass works on the file, so it runs on the saved registry
    # and the registry is reloaded after it.
    backfill_wikipedia_descriptions(publishers_path, "publishers")
    reg = Registry.load(publishers_path)

    gcd_cache: dict[int, dict] = {}

    if metron_creds:
        lookup_metron_series(series_list, reg, *metron_creds)
        fetch_metron_details(reg, *metron_creds)
    else:
        print("  SKIP Metron publisher lookups (METRON_USERNAME/METRON_PASSWORD not set).")

    if comic_vine_key:
        lookup_comicvine_series(series_list, reg, comic_vine_key)
    else:
        print("  SKIP Comic Vine publisher lookups (COMIC_VINE_API_KEY not set).")

    if skip_gcd:
        print("  SKIP GCD publisher lookups (--skip-gcd).")
    else:
        lookup_gcd_series(series_list, reg, gcd_cache)

    if comic_vine_key:
        fetch_comicvine_details(reg, comic_vine_key)
    if not skip_gcd:
        fetch_gcd_details(reg, gcd_cache)

    # Sources may have created entries or re-filed one as an imprint.
    link_all_series(series_list, reg)

    if reg.changed:
        reg.save(publishers_path)
    series_changed = json.dumps(series_list) != series_before
    if series_changed:
        series_path.write_text(json.dumps(data, indent=2) + "\n")
    return linked


def main() -> None:
    """Run only the publisher step, from the repo root:

        PYTHONPATH=scripts python -m metadata.publishers [--skip-gcd]

    CI runs it inside compute-image-metadata.py with --skip-gcd, so this is
    the way to fill in GCD's publisher data (founding span, country,
    website) from a machine that isn't rate-limited by it.
    """
    import argparse
    import os

    from .paths import PUBLISHERS_PATH, SERIES_PATH

    parser = argparse.ArgumentParser(description=main.__doc__.splitlines()[0])
    parser.add_argument("--skip-gcd", action="store_true")
    args = parser.parse_args()
    user, password = os.environ.get("METRON_USERNAME"), os.environ.get("METRON_PASSWORD")
    backfill_publishers(
        SERIES_PATH, PUBLISHERS_PATH,
        metron_creds=(user, password) if user and password else None,
        comic_vine_key=os.environ.get("COMIC_VINE_API_KEY") or None,
        skip_gcd=args.skip_gcd,
    )


if __name__ == "__main__":
    main()
