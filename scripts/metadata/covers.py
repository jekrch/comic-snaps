import hashlib
import json
import os
import sys
import time
from pathlib import Path

import requests

from .health import IntegrationHealth
from .paths import COVERS_DIR, COVERS_WEB_PREFIX
from .sources import MAX_COVER_IMAGES
from .sources.comicvine import fetch_comicvine_covers
from .sources.metron import fetch_metron_covers

COVER_DOWNLOAD_UA = "comic-snaps/1.0 (+https://github.com/jekrch/comic-snaps)"


def get_gallery_issues_for_series(panels: list, series_slug: str) -> list[int]:
    """Return sorted list of issue numbers from the gallery for a given series."""
    issues = set()
    for panel in panels:
        if panel.get("slug") == series_slug:
            issue = panel.get("issue")
            if isinstance(issue, (int, float)):
                issues.add(int(issue))
    return sorted(issues)


def backfill_cover_images(path: Path, panels: list) -> int:
    """
    For series entries missing coverImages, fetch up to 4 cover image URLs
    from Metron and/or GCD. Prioritizes covers for issues that appear in
    the gallery.
    """
    if not path.exists():
        return 0

    username = os.environ.get("METRON_USERNAME")
    password = os.environ.get("METRON_PASSWORD")
    cv_api_key = os.environ.get("COMIC_VINE_API_KEY")

    data = json.loads(path.read_text())
    entries = data.get("series", [])
    updated = 0

    metron_health = IntegrationHealth("Metron")
    comicvine_health = IntegrationHealth("Comic Vine")

    for entry in entries:
        existing = entry.get("coverImages") or []
        if len(existing) >= MAX_COVER_IMAGES:
            continue

        series_slug = entry.get("id")
        if not series_slug:
            continue

        # Both integrations are bailed — nothing more we can do
        if metron_health.should_bail and comicvine_health.should_bail:
            break

        gallery_issues = get_gallery_issues_for_series(panels, series_slug)
        covers = list(existing)
        seen_urls: set[str] = set()

        def try_add(url: str) -> None:
            # Download the URL inline; only record the cover if the file
            # actually landed on disk, so we never persist a broken hotlink.
            if url in seen_urls or len(covers) >= MAX_COVER_IMAGES:
                return
            seen_urls.add(url)
            local = localize_cover_url(url, series_slug)
            if local and local not in covers:
                covers.append(local)

        # Try Metron first
        if username and password and not metron_health.should_bail and len(covers) < MAX_COVER_IMAGES:
            metron_covers = fetch_metron_covers(
                entry, gallery_issues, username, password, health=metron_health
            )
            for url in metron_covers:
                try_add(url)

        # Supplement with Comic Vine. GCD covers are skipped — files1.comics.org
        # blocks automated downloads (captcha-gated in the browser).
        if cv_api_key and not comicvine_health.should_bail and len(covers) < MAX_COVER_IMAGES:
            cv_covers = fetch_comicvine_covers(
                entry, gallery_issues, cv_api_key, health=comicvine_health
            )
            for url in cv_covers:
                try_add(url)

        if covers and covers != existing:
            entry["coverImages"] = covers
            updated += 1
            print(f"  {entry.get('name')}: {len(covers)} cover(s)")

    if updated:
        data["series"] = entries
        path.write_text(json.dumps(data, indent=2) + "\n")
        print(f"  Fetched covers for {updated} series.")

    return updated


def _cover_extension(url: str) -> str:
    clean = url.split("?")[0].split("#")[0]
    _, ext = os.path.splitext(clean.rsplit("/", 1)[-1])
    ext = ext.lower()
    if ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        return ".jpg" if ext == ".jpeg" else ext
    return ".jpg"


def _cover_filename(url: str) -> str:
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
    return f"{digest}{_cover_extension(url)}"


def _download_cover(url: str, dest: Path) -> bool:
    try:
        resp = requests.get(url, headers={"User-Agent": COVER_DOWNLOAD_UA}, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        print(f"    WARN: download failed for {url}: {e}", file=sys.stderr)
        return False
    if not resp.content:
        print(f"    WARN: empty response for {url}", file=sys.stderr)
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(resp.content)
    return True


def localize_cover_url(url: str, series_slug: str) -> str | None:
    """Download a remote cover URL into public/data/covers/<slug>/<hash><ext>
    and return its relative web path. Returns the input unchanged if it's
    already a local path, or None if the download fails — so callers can
    drop broken URLs instead of persisting them.
    """
    if not url.startswith("http"):
        return url
    filename = _cover_filename(url)
    dest = COVERS_DIR / series_slug / filename
    rel = f"{COVERS_WEB_PREFIX}/{series_slug}/{filename}"
    if dest.exists() and dest.stat().st_size > 0:
        return rel
    if _download_cover(url, dest):
        time.sleep(0.15)
        return rel
    return None


def localize_cover_images(path: Path) -> int:
    """Rewrite coverImages in series.json so every entry is a locally-served
    relative path. URLs that fail to download are dropped rather than kept,
    so the UI never renders a broken hotlink — the next run can re-discover
    them via backfill_cover_images.
    """
    if not path.exists():
        return 0
    data = json.loads(path.read_text())
    entries = data.get("series", [])
    updated = 0

    for entry in entries:
        covers = entry.get("coverImages") or []
        if not covers:
            continue
        series_slug = entry.get("id")
        if not series_slug:
            continue

        new_covers: list[str] = []
        for url in covers:
            local = localize_cover_url(url, series_slug)
            if local is None:
                continue
            if local not in new_covers:
                new_covers.append(local)

        if new_covers != covers:
            if new_covers:
                entry["coverImages"] = new_covers
            else:
                entry.pop("coverImages", None)
            updated += 1
            dropped = len(covers) - len(new_covers)
            suffix = f" (dropped {dropped})" if dropped else ""
            print(f"  {entry.get('name')}: {len(new_covers)} local{suffix}")

    if updated:
        data["series"] = entries
        path.write_text(json.dumps(data, indent=2) + "\n")

    return updated
