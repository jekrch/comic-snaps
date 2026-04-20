import html
import re

MIN_DESCRIPTION_CHARS = 40
MIN_DESCRIPTION_WORDS = 5


def strip_html(raw: str) -> str:
    """
    Convert a Comic Vine HTML description to plain text with \\r\\n\\r\\n paragraph
    separators, preserving paragraph breaks and list items while discarding images
    and trailing "List of issues"-style sections.
    """
    text = raw
    # Drop figures/images entirely — they carry no textual content
    text = re.sub(r"<figure[^>]*>.*?</figure>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<img[^>]*/?>", "", text, flags=re.IGNORECASE)
    # Comic Vine descriptions often end with headings like "List of issues" or
    # "Collected editions" — truncate at the first heading to keep the intro only.
    text = re.split(r"<h[1-6][^>]*>", text, maxsplit=1, flags=re.IGNORECASE)[0]
    # Preserve structural breaks before stripping remaining tags
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</li\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<li[^>]*>", "- ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    # Collapse whitespace and rebuild paragraphs
    text = re.sub(r"[ \t]+", " ", text)
    paragraphs = [re.sub(r"\s*\n\s*", " ", p).strip() for p in re.split(r"\n\s*\n", text)]
    paragraphs = [p for p in paragraphs if p]
    return "\r\n\r\n".join(paragraphs)


def is_meaningful_description(text: str) -> bool:
    """Reject descriptions that are too short to be useful (e.g. "Artist.")."""
    stripped = text.strip()
    if len(stripped) < MIN_DESCRIPTION_CHARS:
        return False
    if len(stripped.split()) < MIN_DESCRIPTION_WORDS:
        return False
    return True


def extract_year(raw) -> int | None:
    """
    Extract a 4-digit year from a Comic Vine birth/death field. The field may
    be a string ('Dec 1, 1957'), a dict ({'date': '1957-02-01 00:00:00', ...}),
    or None.
    """
    if not raw:
        return None
    if isinstance(raw, dict):
        raw = raw.get("date") or raw.get("year") or ""
    if not isinstance(raw, str):
        raw = str(raw)
    m = re.search(r"\b(1[89]\d{2}|20\d{2})\b", raw)
    return int(m.group(1)) if m else None


def slugify(name: str) -> str:
    """Convert a name to a URL-friendly slug."""
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")
