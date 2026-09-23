"""Polite HTTP fetching: robots.txt compliance, rate limiting, retries with backoff."""

from __future__ import annotations

import time
import urllib.robotparser
from typing import Optional
from urllib.parse import urlparse

import requests

from . import POLITE_USER_AGENT

_REQUEST_MIN_INTERVAL = 1.2  # seconds between any two outbound requests
_last_request_at = [0.0]

_robots_cache: dict = {}


def _throttle() -> None:
    elapsed = time.time() - _last_request_at[0]
    if elapsed < _REQUEST_MIN_INTERVAL:
        time.sleep(_REQUEST_MIN_INTERVAL - elapsed)
    _last_request_at[0] = time.time()


def _robots_parser(scheme: str, host: str) -> Optional[urllib.robotparser.RobotFileParser]:
    key = f"{scheme}://{host}"
    if key in _robots_cache:
        return _robots_cache[key]
    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(f"{key}/robots.txt")
    try:
        rp.read()
    except Exception:
        rp = None  # type: ignore[assignment]
    _robots_cache[key] = rp
    return rp


def allowed_by_robots(url: str) -> bool:
    parsed = urlparse(url)
    rp = _robots_parser(parsed.scheme, parsed.netloc)
    if rp is None:
        return True  # unreachable robots.txt -> default allow
    try:
        return rp.can_fetch(POLITE_USER_AGENT, url)
    except Exception:
        return True


def fetch(
    url: str,
    *,
    max_retries: int = 3,
    timeout: float = 12.0,
    respect_robots: bool = True,
) -> dict:
    """Fetch a URL politely. Returns {status, url, html, error}.

    status is the HTTP status code, 0 for transport-level failures,
    or -1 when robots.txt disallows the fetch.
    """
    if respect_robots and not allowed_by_robots(url):
        return {"status": -1, "url": url, "html": "", "error": "disallowed by robots.txt"}

    headers = {
        "User-Agent": POLITE_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    delay = 1.5
    last_error = ""
    for attempt in range(max_retries + 1):
        _throttle()
        try:
            resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
            if resp.status_code == 429 or 500 <= resp.status_code < 600:
                last_error = f"HTTP {resp.status_code}"
                if attempt < max_retries:
                    time.sleep(delay)
                    delay *= 2
                    continue
            return {
                "status": resp.status_code,
                "url": resp.url,
                "html": resp.text if resp.status_code == 200 else "",
                "error": "" if resp.status_code == 200 else f"HTTP {resp.status_code}",
            }
        except requests.RequestException as exc:
            last_error = str(exc.__class__.__name__)
            if attempt < max_retries:
                time.sleep(delay)
                delay *= 2

    return {"status": 0, "url": url, "html": "", "error": last_error or "unreachable"}
