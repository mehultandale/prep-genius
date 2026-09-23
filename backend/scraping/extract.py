"""BeautifulSoup-based extraction/cleaning of individual pages."""

from __future__ import annotations

import re
from typing import Dict, List
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from . import MAX_TEXT_CHARS

_NOISE_TAGS = [
    "script", "style", "noscript", "iframe", "svg", "form", "nav", "footer",
    "header", "aside", "template", "button", "select", "input",
]
_NOISE_SELECTORS = [
    "[role=navigation]", "[role=banner]", "[role=menu]", "[aria-hidden=true]",
    ".cookie", ".cookies", ".consent", ".newsletter", ".subscribe", ".social",
    "#cookie", "#consent", ".nav", ".menu", ".sidebar", ".footer", ".header",
]


def classify_url(url: str) -> str:
    u = url.lower()
    if any(k in u for k in (
        "career", "jobs", "hiring", "join-us", "joinus", "work-with-us",
        "workfor", "openings", "vacanc", "recruit", "apply",
    )):
        return "careers"
    if "handbook" in u:
        return "handbook"
    if any(k in u for k in ("about", "company", "story", "mission", "values", "team", "culture")):
        return "about"
    if any(k in u for k in ("blog", "news", "engineering", "devblog", "eng-blog", "press")):
        return "blog"
    if any(k in u for k in ("product", "pricing", "features", "solutions", "platform", "docs", "documentation")):
        return "product"
    if any(k in u for k in ("interview", "process", "faq")):
        return "process"
    return "other"


def clean_html(html: str, base_url: str = "") -> Dict:
    """Clean an HTML page: strip boilerplate, keep title/text/links."""
    soup = BeautifulSoup(html, "html.parser")

    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    h1 = soup.find("h1")
    if not title and h1:
        title = h1.get_text(" ", strip=True)

    for sel in _NOISE_SELECTORS:
        for node in soup.select(sel):
            node.decompose()
    for tag in soup.find_all(_NOISE_TAGS):
        tag.decompose()

    links: List[Dict[str, str]] = []
    seen = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        absolute = urljoin(base_url, href) if base_url else href
        text = a.get_text(" ", strip=True)[:120]
        parsed = urlparse(absolute)
        if parsed.scheme not in ("http", "https"):
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        links.append({"url": absolute, "text": text})

    text = re.sub(r"\n{3,}", "\n\n", soup.get_text("\n", strip=True))
    text = re.sub(r"[ \t]{2,}", " ", text)

    return {
        "title": title[:200],
        "text": text[:MAX_TEXT_CHARS],
        "links": links[:400],
        "url": base_url,
    }
