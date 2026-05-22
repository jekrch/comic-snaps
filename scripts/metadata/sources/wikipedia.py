import json
import re
import sys
import time
from pathlib import Path

import requests

from ..health import IntegrationHealth
from ..references import SOURCE_WIKIPEDIA, has_source, mark_source
from ..text import is_meaningful_description

WIKIPEDIA_API_URL = "https://en.wikipedia.org/w/api.php"
WIKIPEDIA_HEADERS = {"User-Agent": "comic-snaps/1.0"}

# Reused for keep-alive across all Wikipedia requests in a run.
_SESSION = requests.Session()
_SESSION.headers.update(WIKIPEDIA_HEADERS)

# MediaWiki accepts up to 50 titles in a single ``titles=|`` query.
WIKIPEDIA_BATCH_SIZE = 50


def get_wikipedia_title(url: str) -> str | None:
    """Extract the article title from a Wikipedia URL."""
    m = re.match(r"https?://en\.wikipedia\.org/wiki/(.+)", url)
    return m.group(1) if m else None


def _clean_wikipedia_extract(text: str) -> str:
    """Strip reference markers and normalise whitespace/newlines.

    Kept identical to the previous inline post-processing so single- and
    batch-paths produce byte-identical descriptions.
    """
    text = re.sub(r"\[[\w\s]*\d+\]", "", text)
    text = re.sub(r"  +", " ", text).strip()
    text = text.replace("\n", "\r\n\r\n")
    return text


def fetch_wikipedia_intros_batch(
    titles: list[str], health: IntegrationHealth | None = None
) -> dict[str, str]:
    """Fetch intros for many titles in one MediaWiki query.

    Returns a mapping of input-title → cleaned intro for titles that
    returned non-empty text.  Missing/empty extracts are simply absent
    from the result.

    The MediaWiki ``titles=`` parameter accepts up to 50 page titles
    pipe-separated.  ``exintro|explaintext`` give the same intro section
    that the single-title fetch returned, so post-processing is identical.
    """
    if not titles:
        return {}

    # Map normalised lookup form ("Foo Bar") back to the original title
    # so the caller can look up by what it passed in.  MediaWiki returns
    # canonicalised page titles which can differ in case/spacing.
    lookup_to_input: dict[str, str] = {}
    requested: list[str] = []
    for t in titles:
        norm = t.replace("_", " ")
        lookup_to_input.setdefault(norm, t)
        requested.append(norm)

    params = {
        "action": "query",
        "titles": "|".join(requested),
        "prop": "extracts",
        "exintro": True,
        "explaintext": True,
        "format": "json",
        "redirects": 1,
    }
    try:
        resp = _SESSION.get(WIKIPEDIA_API_URL, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.Timeout:
        if health:
            health.mark_throttled("request timed out")
        print(f"  WARN: Wikipedia batch fetch timed out ({len(titles)} title(s))", file=sys.stderr)
        return {}
    except requests.exceptions.HTTPError as e:
        if health and e.response is not None and e.response.status_code == 429:
            health.mark_throttled("rate limited (429)")
        print(f"  WARN: Wikipedia batch fetch failed: {e}", file=sys.stderr)
        return {}
    except Exception as e:
        print(f"  WARN: Wikipedia batch fetch failed: {e}", file=sys.stderr)
        return {}

    # MediaWiki returns a "normalized" list (from → to) for case/spacing
    # canonicalisation, plus a "redirects" list when ``redirects=1`` is set.
    # Walk both chains so we can map every returned page back to whichever
    # title the caller originally asked about.
    query = data.get("query", {}) or {}
    forward: dict[str, str] = {}
    for n in query.get("normalized", []) or []:
        if n.get("from") and n.get("to"):
            forward[n["from"]] = n["to"]
    for r in query.get("redirects", []) or []:
        if r.get("from") and r.get("to"):
            forward[r["from"]] = r["to"]

    def resolve(name: str) -> str:
        # follow normalize → redirect chains, bounded to avoid cycles
        seen = set()
        cur = name
        while cur in forward and cur not in seen:
            seen.add(cur)
            cur = forward[cur]
        return cur

    final_to_input: dict[str, str] = {}
    for norm, original in lookup_to_input.items():
        final_to_input[resolve(norm)] = original

    out: dict[str, str] = {}
    pages = query.get("pages", {}) or {}
    for page in pages.values():
        page_title = page.get("title")
        text = page.get("extract", "")
        if not page_title or not text:
            continue
        original = final_to_input.get(page_title)
        if original is None:
            # Wikipedia returned a page we didn't index — skip rather
            # than guess.
            continue
        out[original] = _clean_wikipedia_extract(text)
    return out


def fetch_wikipedia_intro(url: str, health: IntegrationHealth | None = None) -> str | None:
    """
    Fetch the introductory section of a Wikipedia article as plain text.

    Uses the MediaWiki API to get the full intro section (everything before
    the first heading), removes bracketed reference markers like [1][2],
    and converts newlines to \\r\\n.
    """
    title = get_wikipedia_title(url)
    if not title:
        return None

    params = {
        "action": "query",
        "titles": title.replace("_", " "),
        "prop": "extracts",
        "exintro": True,
        "explaintext": True,
        "format": "json",
    }
    try:
        resp = _SESSION.get(WIKIPEDIA_API_URL, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        pages = data.get("query", {}).get("pages", {})
        page = next(iter(pages.values()), {})
        text = page.get("extract", "")
        if not text:
            return None
        return _clean_wikipedia_extract(text)
    except requests.exceptions.Timeout:
        if health:
            health.mark_throttled("request timed out")
        print(f"  WARN: Wikipedia fetch timed out for {url}", file=sys.stderr)
        return None
    except requests.exceptions.HTTPError as e:
        if health and e.response is not None and e.response.status_code == 429:
            health.mark_throttled("rate limited (429)")
        print(f"  WARN: Wikipedia fetch failed for {url}: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  WARN: Wikipedia fetch failed for {url}: {e}", file=sys.stderr)
        return None


def backfill_wikipedia_descriptions(path: Path, key: str) -> int:
    """
    For entries in the given JSON file that have a Wikipedia reference
    but no description, fetch the intro from Wikipedia and fill it in.

    Titles are fetched in batches of up to WIKIPEDIA_BATCH_SIZE per
    MediaWiki query, which is dramatically faster than one-per-request.

    Returns the number of entries updated.
    """
    if not path.exists():
        return 0

    data = json.loads(path.read_text())
    entries = data.get(key, [])
    updated = 0

    health = IntegrationHealth("Wikipedia")

    # Pass 1: handle entries that already have a description (just mark
    # them processed) and collect the rest into a fetch queue.
    to_fetch: list[tuple[dict, str, str]] = []  # (entry, wiki_url, title)
    for entry in entries:
        if has_source(entry, SOURCE_WIKIPEDIA):
            continue

        wiki_url = None
        for ref in entry.get("references", []):
            if ref.get("name", "").lower() == "wikipedia":
                wiki_url = ref.get("url")
                break

        if not wiki_url:
            continue

        desc = entry.get("description", "")
        if desc and desc.strip():
            mark_source(entry, SOURCE_WIKIPEDIA)
            updated += 1
            continue

        title = get_wikipedia_title(wiki_url)
        if not title:
            mark_source(entry, SOURCE_WIKIPEDIA)
            updated += 1
            continue

        to_fetch.append((entry, wiki_url, title))

    # Pass 2: fetch intros in batches.
    for start in range(0, len(to_fetch), WIKIPEDIA_BATCH_SIZE):
        if health.should_bail:
            break

        chunk = to_fetch[start:start + WIKIPEDIA_BATCH_SIZE]
        titles = [t for (_, _, t) in chunk]
        print(f"  Fetching Wikipedia intros for {len(titles)} title(s)...")
        intros = fetch_wikipedia_intros_batch(titles, health=health)

        for entry, _wiki_url, title in chunk:
            intro = intros.get(title)
            label = entry.get("name", entry.get("id"))
            if intro and is_meaningful_description(intro):
                entry["description"] = intro
                print(f"    OK [{label}]: {intro[:80]}...")
            elif intro:
                print(f"    SKIP [{label}]: intro too short ({len(intro)} chars)")
            else:
                print(f"    SKIP [{label}]: no intro text found")
            mark_source(entry, SOURCE_WIKIPEDIA)
            updated += 1

        # Be polite to Wikipedia between batches.
        time.sleep(0.5)

    if updated:
        path.write_text(json.dumps(data, indent=2) + "\n")
        print(f"  Updated {updated} entr(ies) in {path} from Wikipedia.")

    return updated
