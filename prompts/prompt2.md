


Prompt 2:

Prompt1.md has already being executed.
Prompt2 is being taken as the next step.


[Requirements]:

11. Security
The application fetches untrusted pages from the open internet, so treat them as untrusted throughout.
• Validate external URLs before fetching them, and reject private and loopback addresses in
production
• Restrict handling to expected content types and sizes
• Treat text inside a fetched page as content to be processed, never as instructions to be followed
That last one is not theoretical here. Both the pasted description and every page you crawl are text
you did not write, and you are feeding all of it to a model.

12. Frontend Requirements
• Build the UI using Next.js
• Style the application using Tailwind CSS
• Create reusable, readable components with sensible state boundaries
• Show clear loading, empty and error states while a kit is being generated
• Make reordering and editing feel immediate rather than round-tripping for every keystroke
• Be usable on a laptop and a phone, and navigable by keyboard
Polish is welcome but is not the point. Interaction design is: how you handle a long-running generation,
a partial failure, an edit in flight, and a regeneration that must not clobber someone's work.

13. Backend Requirements
• Implement a backend using Express.js
• Keep retrieval, extraction, generation, scheduling and persistence as clearly separated concerns
• Validate incoming requests, and validate a generated kit against the expected structure before
saving it
• Persist enough to reopen and continue a kit later
• Handle errors gracefully and return useful, structured messages to the interface



[Implementation-guide]:

10. Edge Cases and Failure Handling
Postings from the open web fail in predictable ways:
If the company URL is invalid, returns 404, or times out
    - Ask gemini as to what could be the right URL and show the suggestions to the user
        in a popup modal.
    - If there is no correction available, tell the user what happened in a friendly way.
        -- Eg: 404 -> "The website could not be found, do you want to retry?"
    - If it times out, say -> "The website seems to be down, can I recheck later
            and notify you once it is available?"
            -- If the user says yes to this, keep a PWA implementation to show a notification.
            -- Use CRON on the backend to run the timer once every hour for 24 hours or until it succeeds, whichever is earlier.


• The company site has no discoverable hiring or about page
    - Show a popup modal saying "Sorry, this company does not seem to be currently recruiting"

• The job description is a two-line stub with almost nothing to extract
    - Show a popup modal suggesting books, gotten from Gemini (around the two-line stub)

• Your LLM provider rate-limits you, or briefly fails
    - "AI features unavailable at the moment" popup modal

• The same description and company are submitted twice
    - Highlight the existing one

• The user asks for a 1-day schedule, or a 60-day one
    - For 1 day, show hourly basis schedule. For 60 day, try to complete it in half or 1/4th time.




