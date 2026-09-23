# AI_README — Prep Genius

Notes on sources, politeness, the state model, and the coverage-pass policy.

## Sources used for research

The retrieval layer (`backend/scraping`, Python + Scrapy/BeautifulSoup) uses:

1. **The company site itself** (the URL the user gives). A Scrapy spider crawls
   same-host pages only, resolves relative links, and ranks candidates by
   textual signals (`careers`, `jobs`, `hiring`, `handbook`, `about`, …). No
   path is hard-coded: the crawler discovers `/careers`, `/jobs`, handbooks and
   engineering blogs wherever the company happens to put them.
2. **Public discussion search**:
   - DuckDuckGo HTML endpoint (`html.duckduckgo.com/html`) — keyless search for
     `"<company> interview process"` and similar queries.
   - Reddit public JSON API (`reddit.com/search.json` and
     `reddit.com/comments/<id>.json`) for interview-experience threads.

The LLM (Gemini) is *not* used for retrieval. Search ranking and link selection
are deterministic code; the model only summarises/filters the text we already
fetched. Job boards are never fetched — the JD is user-pasted, as required.

## robots.txt and site terms

- The Scrapy spider sets `ROBOTSTXT_OBEY = True`.
- The non-Scrapy polite fetcher (`politeness.py`) consults `robots.txt` with
  `urllib.robotparser` before every request and reports (never silently
  ignores) disallowed URLs; a disallowed page is recorded as a skipped source.
- Identified user agent: `PrepGeniusBot/1.0 (+interview-prep research
  assistant; respects robots.txt)`.
- Global throttle: at most one outbound request every ~1.2 s, exponential
  backoff (×2, capped) with retries on 429/5xx.
- Skipped/unreachable sources are recorded in the run output and progress log
  rather than failing the kit — a missing hiring page is not a failure.

## Representing generated / edited / pinned state

Every editable item (brief, requirement, question, flashcard) carries an
explicit `meta` object:

```json
{ "origin": "generated" | "user_added", "edited": true|false, "pinned": true|false }
```

- **generated** — produced by the pipeline, untouched by the user. Rendered
  with the `Generated` tag.
- **regenerated** — produced by a section regeneration run. It is a *different
  tag* from "generated" in the UI (items carry run-scoped id prefixes such as
  `q_re_…`, which the UI uses to pick the tag).
- **edited** — the user modified this specific item; the `Edited` tag is shown.
  Regeneration of the section treats edited items as user-owned.
- **pinned** — the user wants the item protected and prominent. Pinned items:
  1. always sort to the top of their list, with an amber highlight and the
     amber `Pinned` banner at the top of the page/tab;
  2. are never replaced or discarded by a regeneration of their section
     (`isUserOwned()` in `backend/src/types/state.ts`).
- **user_added** — created by hand (`Added` tag). Survives regeneration like
  pinned items.

Regenerating a section replaces only generated, unpinned, unedited items in
*that* section; nothing else in the kit is touched.

## Coverage passes policy

A kit with uncovered must-have requirements is a failed kit, so the pipeline
loops until every must-have requirement has at least one question:

- After the first draft, a **deterministic** check (`computeCoverage`) diffs
  question `requirement_ids` against requirement ids. The model never decides
  what is uncovered.
- Each uncovered requirement is sent for **targeted** question generation
  (category derived from its `kind`), not a whole-kit re-roll.
- The loop repeats until must-have coverage is 100% or `MAX_COVERAGE_PASSES`
  (4) is exhausted; `coverage.passes` records the honest count.
- Any still-uncovered requirement — must or nice — is reported in
  `coverage.uncovered_requirement_ids` and surfaced in the UI. We stop at 4
  passes because beyond that a requirement is usually un-coverable (ambiguous
  or genuinely absent from usable sources), and further passes only burn
  rate-limited tokens.

## Slow / failing / duplicated generation

Generation is slow, external and failure-prone, so:

- **Asynchronous jobs**: kit creation returns `202` immediately; generation
  runs in the background with a phase-by-phase progress log polled by the UI.
- **Retries with backoff**: every LLM call retries up to `LLM_MAX_RETRIES`
  times on 429/5xx, honouring `Retry-After` and using exponential backoff with
  jitter. A global concurrency cap (`LLM_MAX_CONCURRENCY`) and a minimum
  interval between requests (`LLM_MIN_REQUEST_INTERVAL_MS`) keep the pipeline
  inside free-tier per-minute token limits — the most common failure mode.
- **Idempotent triggers**: each create request produces exactly one job doc;
  the UI polls that job rather than re-submitting. Duplicate submissions
  create separate jobs rather than corrupting an in-flight one.
- **Crash safety**: a cron janitor reaps jobs stuck in `generating` for more
  than 20 minutes and marks them `failed` with a clear code, so the user is
  never left looking at an eternal spinner.

## Invalid model output

If the model returns invalid JSON or an incomplete kit, the call is retried
(tolerant JSON extraction first, then a fresh attempt); if it still fails, the
phase is failed with a descriptive code in the progress log for the user, and
the case is recorded as `failed` in batch runs rather than aborting the run.
