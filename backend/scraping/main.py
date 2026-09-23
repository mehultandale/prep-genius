"""CLI entrypoint for the scraping layer.

The Node backend spawns this as a child process and communicates via JSON:

  stdin:  {"op": "crawl_company", "url": "...", "max_pages": 12}
          {"op": "search_discussion", "company": "Acme", "role_hint": "..."}
          {"op": "fetch_page", "url": "..."}
  stdout: one JSON object with the result, or {"ok": false, "error": "..."}

Run directly for testing:  python3 main.py '{"op":"crawl_company","url":"http://localhost:8099/acme/"}'
"""

from __future__ import annotations

import json
import os
import sys
import traceback

# Make sibling modules importable when run as a script.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from crawler import crawl_company  # noqa: E402
from discussion import search_discussion  # noqa: E402
from extract import clean_html  # noqa: E402
from politeness import fetch  # noqa: E402


def handle(request: dict) -> dict:
    op = request.get("op")

    if op == "crawl_company":
        url = request["url"]
        pages = crawl_company(url, max_pages=int(request.get("max_pages", 12)))
        return {"ok": True, "pages": pages["pages"], "errors": pages["errors"]}

    if op == "search_discussion":
        company = request["company"]
        role_hint = request.get("role_hint", "")
        return {"ok": True, **search_discussion(company, role_hint)}

    if op == "fetch_page":
        resp = fetch(request["url"])
        if resp["status"] != 200:
            return {"ok": False, "error": resp["error"] or f"HTTP {resp['status']}", "status": resp["status"]}
        cleaned = clean_html(resp["html"], resp["url"])
        return {"ok": True, "page": cleaned}

    return {"ok": False, "error": f"unknown op: {op}"}


def main() -> None:
    raw = sys.stdin.read()
    try:
        request = json.loads(raw) if raw.strip() else {}
        response = handle(request)
    except Exception as exc:  # noqa: BLE001
        response = {
            "ok": False,
            "error": f"{exc.__class__.__name__}: {exc}",
            "trace": traceback.format_exc(limit=3),
        }
    sys.stdout.write(json.dumps(response))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
