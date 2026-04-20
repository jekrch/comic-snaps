import json
import re
import sys
import time
from pathlib import Path

import requests

from ..health import IntegrationHealth
from ..references import SOURCE_WIKIPEDIA, has_source, mark_source
from ..text import is_meaningful_description


def get_wikipedia_title(url: str) -> str | None:
    """Extract the article title from a Wikipedia URL."""
    m = re.match(r"https?://en\.wikipedia\.org/wiki/(.+)", url)
    return m.group(1) if m else None


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

    api_url = "https://en.wikipedia.org/w/api.php"
    params = {
        "action": "query",
        "titles": title.replace("_", " "),
        "prop": "extracts",
        "exintro": True,
        "explaintext": True,
        "format": "json",
    }
    try:
        resp = requests.get(api_url, params=params, headers={"User-Agent": "comic-snaps/1.0"}, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        pages = data.get("query", {}).get("pages", {})
        page = next(iter(pages.values()), {})
        text = page.get("extract", "")
        if not text:
            return None
        # Remove reference markers like [1], [2], [note 1], etc.
        text = re.sub(r"\[[\w\s]*\d+\]", "", text)
        # Normalize whitespace that may result from removed refs
        text = re.sub(r"  +", " ", text).strip()
        # Convert newlines to \r\n
        text = text.replace("\n", "\r\n\r\n")
        return text
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

    Returns the number of entries updated.
    """
    if not path.exists():
        return 0

    data = json.loads(path.read_text())
    entries = data.get(key, [])
    updated = 0

    health = IntegrationHealth("Wikipedia")

    for entry in entries:
        if health.should_bail:
            break
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

        print(f"  Fetching Wikipedia intro for {entry.get('name', entry.get('id'))}...")
        intro = fetch_wikipedia_intro(wiki_url, health=health)
        if intro and is_meaningful_description(intro):
            entry["description"] = intro
            print(f"    OK: {intro[:80]}...")
        elif intro:
            print(f"    SKIP: intro too short ({len(intro)} chars)")
        else:
            print(f"    SKIP: no intro text found")

        mark_source(entry, SOURCE_WIKIPEDIA)
        updated += 1

        # Be polite to Wikipedia
        time.sleep(0.5)

    if updated:
        path.write_text(json.dumps(data, indent=2) + "\n")
        print(f"  Updated {updated} entr(ies) in {path} from Wikipedia.")

    return updated
