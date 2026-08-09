== Where are the secrets? 

They are either in your environment variables or in `~/.secrets`.

== Tools

Use browserbase when you need a browser.

Use Scrapingbee for getting ANY content from websites — this means all fetches from third-party
sites, not just HTML scraping: media/file downloads, YouTube videos/audio/subtitles, search
results, APIs. ScrapingBee has dedicated YouTube endpoints (metadata, subtitles, search) —
check https://www.scrapingbee.com/llms.txt for the right endpoint BEFORE reaching for
site-specific tools like yt-dlp.

Avoid using direct connection to the internet if possible. Do not fall back to direct
connections (yt-dlp, curl/wget against the target site, etc.) without trying Scrapingbee
first — datacenter IPs get bot-blocked anyway.

If audio transcription is required, use OpenAI Whisper through Openrouter.

== Git

Always commit and push directly to `main` in general — don't create feature branches unless
explicitly asked to.

== Other files

@lobster.md
