


Prompt 1:



[Requirement]:

Build a web application that turns a job description into a personalised interview preparation kit.

The user pastes in the job description, gives you the company's website address, and tells you how
many days they have before the interview. From there the application does the research itself: it crawls
the company site to find what they do and how they hire, looks for public discussion of that company's
interview process, and combines all of it with the job description to generate a structured kit — a
company brief, a breakdown of the role, a bank of likely questions, flashcards, and a day-by-day study
schedule. The user can then reshape any part of it, and practise against it inside the app.


Two parts of this brief are exact rather than open: the kit structure in Section 5 and the batch entry
point in Section 9. We run your pipeline against job descriptions you have not seen, so those two need
to match. Everything else is yours to design.


5. The Kit Structure
Every generated kit must conform to the structure in Appendix A. You may extend it where that
genuinely helps, but these fields must be present and named exactly as given. Three rules keep kits
comparable between submissions:
• Every requirement gets a stable id, and every question references the requirement ids it covers. This is what makes coverage checkable rather than a matter of opinion.
Every requirement is marked must or nice, taken from how the posting words it. A “required”
line and a “bonus points for” line are not the same thing.
• Durations are integer minutes. No floats, no “about an hour”


9. Batch Entry Point (Mandatory)
Your repository must expose one command that reads a file of cases and writes the resulting kits to a
file, so that the pipeline can be run over a set of job descriptions without going through the interface:
npm run evaluate -- --input <cases.json> --output <kits.json>

Reads an array of cases, each with an id, a jd string, a company_url and days
• Runs your full retrieval, generation and validation path on each — the same code your application uses, not a parallel implementation
• Uses the days value given for each case when building the schedule
• Writes a single JSON file in the shape given in Appendix B
• Continues after one case fails, recording the failure rather than aborting the run
• Completes five cases within fifteen minutes, including any retries rate limits force
• Reads credentials from environment variables documented in .env.example, and needs no
setup beyond your documented install step

The company sites used with this command may be served from a local address, so your retrieval
code must not assume a particular host and must follow relative links. This command must run from a
clean clone.


About LLM feature usage in the app:
Bear in mind that free tiers limit tokens per minute, not just requests, and that limit is easy to hit. A
pipeline that falls over the first time a provider says “slow down” is the most common way to lose points
here.



Application Overview
Build an application where a user can:
• Register and log in, and see only their own kits
• Create a kit by pasting in a job description and the company website address
• Prepare for more than one role at once by uploading a file of description-and-company pairs
• Say how many days they have before the interview
• Watch the kit being generated, with visible progress and clear failure states
• Read a company brief, a role breakdown, a categorised question bank, flashcards and a study
schedule
• Edit, reorder, add and delete anything in the kit
• Regenerate one section without losing edits made elsewhere
• Practise against the flashcards and track what they have covered



Core Requirements
1. Authentication
Implement secure registration, login and logout with session handling, so that a signed-out visitor
cannot reach protected pages or endpoints.
• Secure user authentication
• Users can read and modify only their own kits
• Sensible handling of expired or invalid sessions
Keep this layer minimal. Email verification, password reset and role hierarchies are out of scope and
are not scored.
2. Input and Research
The job description is pasted directly into the interface as text, not fetched from a job board. Most
boards block automated access, and we would rather you spent your time on the interesting part.
Alongside it the user gives the company website address, and that is where the retrieval work begins.
• A textarea for the job description, and a field for the company website
• A way to prepare for more than one role — pasting again, or uploading a file of descriptionand-company pairs
• Crawl the company site to find what they do and, if it exists, how they hire
• Look for public discussion of that company's interview process
• Skip and report a source that cannot be retrieved, rather than failing the whole run
• Rate-limit your requests and back off on failure
Finding the hiring page is the interesting half of this. Companies bury it in different places — /careers,
/jobs, a handbook, an engineering blog — and the path cannot be hard-coded. When we tested this
we guessed one company URL and got a 404, while GitLab and PostHog both publish detailed hiring processes at paths we would never have predicted. Crawl the site, rank the links, fetch what looks right. A fixed list of paths is not sufficient.
Respect robots.txt and site terms, and say in your README which sources you used.


[Implementation-guide]:

The web application's frontend and backend should be in those named directories, which are already created.

Use this tech stack only:
Frontend: Next.js + Tailwind CSS
Backend: Express
Database: MongoDB
Language: TypeScript
Scraping: Python -> BeautifulSoup and Scrapy
    - The directory for scraping, too, already exists inside the backend directory with 'scraping' name. Code for crawling company site and looking for public discussion online, should be inside this directory.
LLM: Gemini
    - Use npm install @google/genai


Do not touch the README.md that already exists in the root of this repository.
Instead, use AI_README.md for mentioning sources you used, while respecting robots.txt and site terms.





