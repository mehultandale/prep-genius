"""Company-site crawler built on Scrapy.

Crawls from a seed URL, follows only same-host links, ranks candidate pages
for "what they do" and "how they hire" signals, and fetches the most promising
ones. Relative links are resolved at every step; the host is never assumed.
"""

from __future__ import annotations

from typing import Dict, List
from urllib.parse import urljoin, urlparse

import scrapy
from scrapy.crawler import CrawlerProcess

from .extract import clean_html, classify_url
from . import POLITE_USER_AGENT

MAX_PAGES_DEFAULT = 12
MAX_TEXT_CHARS = 9000

# Textual signals used to rank links worth fetching.
_HIRING_HINTS = (
    "career", "careers", "job", "jobs", "hiring", "join us", "joinUs".lower(),
    "work with us", "work for", "we're hiring", "we are hiring", "open roles",
    "open positions", "openings", "vacancies", "apply", "recruit", "handbook",
)
_ABOUT_HINTS = (
    "about", "company", "our story", "mission", "values", "culture", "team",
    "what we do", "product", "products", "customers", "pricing",
)
_PROCESS_HINTS = (
    "interview", "hiring process", "application process", "recruiting process",
    "how we hire", "take-home", "take home",
)
_SKIP_EXT = (
    ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico", ".pdf", ".zip",
    ".mp4", ".mp3", ".css", ".js", ".woff", ".woff2", ".ttf", ".json", ".xml",
)

# Fetch priority by URL classification (lower = fetched first).
_PRIORITY = {"careers": 0, "handbook": 1, "process": 2, "about": 3, "blog": 4, "product": 5, "other": 9}


def _same_host(url: str, seed_host: str) -> bool:
    try:
        return urlparse(url).netloc.lower() in ("", seed_host.lower())
    except Exception:
        return False


def _score_link(url: str, text: str) -> float:
    """Higher score = more promising page to fetch."""
    u = url.lower()
    t = text.lower()
    score = 0.0
    for hint in _HIRING_HINTS:
        if hint in u:
            score += 6.0
        if hint in t:
            score += 4.0
    for hint in _PROCESS_HINTS:
        if hint in u or hint in t:
            score += 3.0
    for hint in _ABOUT_HINTS:
        if hint in u:
            score += 2.0
        if hint in t:
            score += 1.0
    depth_penalty = min(url.count("/") - 2, 4) * 0.1
    return score - depth_penalty


class CompanySpider(scrapy.Spider):
    name = "company"

    custom_settings = {
        "USER_AGENT": POLITE_USER_AGENT,
        "ROBOTSTXT_OBEY": True,
        "DOWNLOAD_DELAY": 1.5,
        "CONCURRENT_REQUESTS": 2,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 1,
        "RETRY_TIMES": 2,
        "RETRY_HTTP_CODES": [500, 502, 503, 504, 408, 429],
        "HTTPCACHE_ENABLED": False,
        "COOKIES_ENABLED": False,
        "DEPTH_LIMIT": 2,
        "CLOSESPIDER_PAGECOUNT": MAX_PAGES_DEFAULT,
        "REQUEST_FINGERPRINTER_IMPLEMENTATION": "2.7",
    }

    def __init__(self, seed_url: str, max_pages: int = MAX_PAGES_DEFAULT, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_urls = [seed_url]
        self.seed_host = urlparse(seed_url).netloc
        self.max_pages = max_pages
        self.pages: List[Dict] = []
        self._fetched: set = set()

    def _links_from(self, response) -> List[Dict[str, str]]:
        cleaned = clean_html(response.text, response.url)
        return cleaned["links"]

    def parse(self, response):
        page = clean_html(response.text, response.url)
        if not self._fetched:
            self._fetched.add(response.url)

        # Follow same-host links only (relative links already resolved by clean_html).
        candidates: List[Dict] = []
        for link in page["links"]:
            url, text = link["url"], link["text"]
            if not _same_host(url, self.seed_host):
                continue
            if urlparse(url).path.lower().endswith(_SKIP_EXT):
                continue
            if url in self._fetched:
                continue
            candidates.append({"url": url, "text": text, "score": _score_link(url, text)})

        candidates.sort(key=lambda c: (-c["score"], c["url"]))
        # Budget: fetch top-scoring candidates beyond the seed page.
        remaining = self.max_pages - len(self._fetched)
        to_fetch = [c for c in candidates[:max(remaining + 4, 6)] if c["score"] > 0.5]

        for c in to_fetch:
            if len(self._fetched) >= self.max_pages:
                break
            if c["url"] in self._fetched:
                continue
            self._fetched.add(c["url"])
            yield scrapy.Request(c["url"], callback=self.parse_page, cb_kwargs={"kind_hint": classify_url(c["url"]), "link_text": c["text"]}, priority=int(10 - _PRIORITY.get(classify_url(c["url"]), 9)), dont_filter=False)

        # Seed page itself is a page too.
        self._emit(response.url, page, "home")

    def parse_page(self, response, kind_hint: str, link_text: str):
        page = clean_html(response.text, response.url)
        self._emit(response.url, page, kind_hint)

    def _emit(self, url: str, page: Dict, kind: str) -> None:
        self.pages.append({
            "url": url,
            "title": page["title"],
            "text": page["text"][:MAX_TEXT_CHARS],
            "kind": kind,
        })


def crawl_company(seed_url: str, max_pages: int = MAX_PAGES_DEFAULT) -> Dict:
    """Run the spider to completion and return ranked pages."""
    result: Dict = {"pages": [], "errors": []}
    try:
        process = CrawlerProcess(settings={"LOG_ENABLED": False}, install_root_handler=False)
        spider = CompanySpider(seed_url=seed_url, max_pages=max_pages)
        process.crawl(spider)
        process.start()
        result["pages"] = spider.pages
    except Exception as exc:  # noqa: BLE001
        result["errors"].append(str(exc))
    return result
