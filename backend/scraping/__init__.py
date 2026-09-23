"""Prep Genius — scraping layer (Python: Scrapy + BeautifulSoup).

Invoked by the Node backend as a child process; communicates exclusively
via JSON on stdin/stdout. See main.py for the contract.
"""

POLITE_USER_AGENT = (
    "PrepGeniusBot/1.0 (+interview-prep research assistant; respects robots.txt)"
)

# Hard cap on any single text blob handed to the LLM layer.
MAX_TEXT_CHARS = 9000
