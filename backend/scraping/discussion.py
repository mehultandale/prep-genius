"""Public discussion search for a company's interview process.

DuckDuckGo HTML endpoint (no API key) + Reddit's public JSON API.
Every source is skipped and reported rather than failing the run.
"""

from __future__ import annotations

import json
import re
from typing import Dict, List
from urllib.parse import quote_plus, urlparse

import requests

from .politeness import fetch
from . import MAX_TEXT_CHARS

DDG_HTML = "https://html.duckduckgo.com/html/?q={q}"
REDDIT_SEARCH = "https://www.reddit.com/search.json?q={q}&sort=relevance&limit=8"
REDDIT_COMMENTS = "https://www.reddit.com/comments/{id}.json?limit=30"

UA_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) PrepGenius/1.0 research",
    "Accept": "application/json",
}


def search_ddg(query: str, max_results: int = 6) -> List[Dict[str, str]]:
    url = DDG_HTML.format(q=quote_plus(query))
    resp = fetch(url, max_retries=2)
    if resp["status"] != 200:
        return []
    results: List[Dict[str, str]] = []
    # DDG html results look like: <a class="result__a" href="...">Title</a>
    for m in re.finditer(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', resp["html"], re.S):
        href = m.group(1)
        title = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        if href.startswith("//duckduckgo.com/l/?uddg="):
            try:
                from urllib.parse import unquote
                href = unquote(href.split("uddg=")[1].split("&")[0])
            except Exception:
                pass
        if not href.startswith("http"):
            continue
        results.append({"url": href, "title": title})
        if len(results) >= max_results:
            break
    return results


def reddit_search(query: str, max_results: int = 6) -> List[Dict[str, str]]:
    url = REDDIT_SEARCH.format(q=quote_plus(query))
    try:
        resp = requests.get(url, headers=UA_HEADERS, timeout=12)
        if resp.status_code != 200:
            return []
        data = resp.json()
        out: List[Dict[str, str]] = []
        for child in data.get("data", {}).get("children", [])[:max_results]:
            d = child.get("data", {})
            permalink = "https://www.reddit.com" + d.get("permalink", "")
            out.append({
                "url": permalink,
                "title": d.get("title", "")[:200],
                "id": d.get("id", ""),
                "subreddit": d.get("subreddit", ""),
            })
        return out
    except Exception:
        return []


def reddit_comments(post_id: str) -> str:
    try:
        resp = requests.get(REDDIT_COMMENTS.format(id=post_id), headers=UA_HEADERS, timeout=12)
        if resp.status_code != 200:
            return ""
        data = resp.json()
        texts: List[str] = []

        def walk(node) -> None:
            if isinstance(node, dict):
                body = node.get("data", {}).get("body")
                if body and len(texts) < 25:
                    texts.append(body[:1500])
                for child in node.get("data", {}).get("children", []) or []:
                    walk(child)
            elif isinstance(node, list):
                for item in node:
                    walk(item)

        walk(data)
        return "\n\n".join(texts)[:MAX_TEXT_CHARS]
    except Exception:
        return ""


def search_discussion(company: str, role_hint: str = "") -> Dict:
    """Look for public discussion of the company's interview process."""
    out: Dict = {"results": [], "threads": [], "errors": []}
    queries = [
        f"{company} interview process",
        f"{company} interview experience software engineer",
        f"{company} hiring process site:reddit.com",
    ]
    for q in queries:
        for r in search_ddg(q, max_results=4):
            if all(r["url"] != x["url"] for x in out["results"]):
                out["results"].append(r)

    r_query = f"{company} interview process"
    if role_hint:
        r_query += f" {role_hint}"
    for r in reddit_search(r_query):
        if all(r["url"] != x["url"] for x in out["results"]):
            out["results"].append(r)

    # Fetch top reddit threads (they are public JSON APIs; polite).
    seen_threads = 0
    for r in out["results"]:
        if seen_threads >= 2:
            break
        if "reddit.com/comments/" in r["url"] and r.get("id"):
            body = reddit_comments(r["id"])
            if body:
                out["threads"].append({
                    "url": r["url"],
                    "title": r.get("title", ""),
                    "body": body[:6000],
                })
                seen_threads += 1

    if not out["results"] and not out["threads"]:
        out["errors"].append("no public discussion found")
    return out
