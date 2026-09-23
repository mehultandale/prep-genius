

I did the branding "prep-genius", to camouflage the assignment while keeping the repository public.


# Tech stack
Frontend: Next.js + Tailwind CSS
    - To not deviate from preferences much
Backend: Express
    - Used Express for not reinventing the wheel unnecessarily with Node
Database: MongoDB
    - Works well with ExpressJS
Language: TypeScript
    - TypeScript for type safety
Scraping: Python
    - Because BeautifulSoup, Scrapy are Python libraries
LLM: Gemini
    - Because their free tier is generous


"Decide for yourself how many passes are sensible and when to stop, and explain the choice in your README."
    - Passes will be made till must-haves are covered 100%.
    - In my opinion, a candidate should not compromise on studying the bare minimum.











[TODO]:
"Decide how you represent generated, edited and pinned state, and note the approach in your README. This is the hardest state
problem in the assessment and we will look closely at how you solved it."
    - 

Handle the cases below, and describe your
approach briefly in the README
    • Public discussion of the company turns up nothing at all
        -- This particular case doesn't seem to necessiate a response
    • The model returns invalid JSON or an incomplete kit
        -- This case should be sent to devs through error log
        -- Not implementing this case because ElasticSearch or similar service would be far-fetched for this assignment. Have used CRON in one of the places, instead of redis, for the same reason: limiting the scope.


Generation is slow, external and failure-prone. Consider what happens when it takes ninety seconds,
fails halfway, or is triggered twice for the same posting. Describe your approach briefly in the
README.




